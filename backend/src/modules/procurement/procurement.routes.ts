import { Router } from 'express';
import { z } from 'zod';
import { query, getClient, releaseClient } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';
import { AppError } from '../../middleware/errors.js';
import { createApprovalInstance } from '../../services/approval.service.js';

export const procurementRouter = Router();

const positiveId = z.number().int().positive();
const amount = z.number().positive();

const mrLineSchema = z.object({
  item_description: z.string().min(2),
  unit_of_measure: z.string().min(1).max(20),
  quantity: z.number().positive(),
  spec_ref: z.string().max(100).optional().nullable()
});

const createMrSchema = z.object({
  project_id: positiveId,
  mr_no: z.string().min(2).max(30),
  required_date: z.string().optional().nullable(),
  requested_by: positiveId.optional(),
  lines: z.array(mrLineSchema).min(1)
});

const createRfqSchema = z.object({
  project_id: positiveId,
  mr_id: positiveId.optional().nullable(),
  rfq_ref: z.string().min(2).max(30),
  due_date: z.string().optional().nullable(),
  vendor_ids: z.array(positiveId).min(1).optional().default([])
});

const quotationSchema = z.object({
  vendor_id: positiveId,
  quotation_ref: z.string().max(50).optional().nullable(),
  total_amount: amount,
  currency_id: positiveId,
  validity_date: z.string().optional().nullable(),
  lead_time_days: z.number().int().nonnegative().optional().nullable(),
  payment_terms: z.string().max(150).optional().nullable()
});

const comparativeSchema = z.object({
  rfq_id: positiveId,
  recommended_vendor_id: positiveId.optional().nullable(),
  justification: z.string().optional().nullable()
});

const poLineSchema = z.object({
  boq_item_id: positiveId.optional().nullable(),
  item_description: z.string().min(2),
  unit_of_measure: z.string().min(1).max(20),
  quantity: z.number().positive(),
  unit_rate: z.number().nonnegative()
});

const createPoSchema = z.object({
  project_id: positiveId,
  vendor_id: positiveId,
  mr_id: positiveId.optional().nullable(),
  cost_code_id: positiveId,
  po_ref: z.string().min(2).max(30),
  po_date: z.string().optional().nullable(),
  currency_id: positiveId,
  payment_terms: z.string().max(150).optional().nullable(),
  delivery_terms: z.string().max(150).optional().nullable(),
  lines: z.array(poLineSchema).min(1)
});

const invoiceSchema = z.object({
  vendor_id: positiveId,
  project_id: positiveId,
  po_id: positiveId,
  invoice_no: z.string().min(1).max(50),
  invoice_date: z.string().min(8),
  amount: z.number().positive(),
  tax_amount: z.number().nonnegative().default(0),
  currency_id: positiveId,
  matched_grn_id: positiveId.optional().nullable(),
  due_date: z.string().optional().nullable()
});

procurementRouter.get('/reference-data', authorize('procurement', 'view'), asyncHandler(async (_req, res) => {
  const [projects, vendors, costCodes, currencies, warehouses, items] = await Promise.all([
    query(`select id,project_code,project_name,currency_id from projects where status not in ('closed','cancelled') order by project_code`),
    query(`select id,vendor_name,vendor_type from vendors_subcontractors where is_active=true and is_blacklisted=false order by vendor_name`),
    query(`select id,project_id,code,description from cost_codes where is_active=true order by code`),
    query(`select id,code,name from currencies where is_active=true order by code`),
    query(`select id,project_id,code,name from warehouses where is_active=true order by code`),
    query(`select id,item_code,description,unit_of_measure from inventory_items where is_active=true order by item_code`)
  ]);
  res.json({success:true,data:{projects,vendors,costCodes,currencies,warehouses,items}});
}));

procurementRouter.get('/material-requisitions', authorize('procurement', 'view'), asyncHandler(async (_req, res) => {
  const rows = await query(`
    select mr.*, p.project_code, u.full_name as requested_by_name
    from material_requisitions mr
    join projects p on p.id = mr.project_id
    join users u on u.id = mr.requested_by
    order by mr.created_at desc
    limit 200
  `);
  res.json({ success: true, data: rows });
}));

procurementRouter.post('/material-requisitions', authorize('procurement', 'create'), asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError(401, 'Authentication required');
  const body = createMrSchema.parse(req.body);
  const client = await getClient();
  try {
    await client.query('begin');
    const mr = await client.query(`
      insert into material_requisitions (project_id, mr_no, requested_by, required_date, status)
      values ($1,$2,$3,$4,'draft') returning *
    `, [body.project_id, body.mr_no, body.requested_by ?? req.user.id, body.required_date ?? null]);
    for (const line of body.lines) {
      await client.query(`
        insert into mr_lines (mr_id, item_description, unit_of_measure, quantity, spec_ref)
        values ($1,$2,$3,$4,$5)
      `, [mr.rows[0].id, line.item_description, line.unit_of_measure, line.quantity, line.spec_ref ?? null]);
    }
    await client.query('commit');
    res.status(201).json({ success: true, data: mr.rows[0] });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await releaseClient(client);
  }
}));

procurementRouter.post('/material-requisitions/:id/submit-approval', authorize('procurement', 'edit'), asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError(401, 'Authentication required');
  const id = Number(req.params.id);
  const client = await getClient();
  try {
    await client.query('begin');
    const mr = await client.query(`select * from material_requisitions where id=$1 for update`, [id]);
    if (!mr.rows[0]) throw new AppError(404, 'Material requisition not found');
    if (mr.rows[0].status !== 'draft') throw new AppError(409, 'Only draft material requisitions can be submitted for approval');
    const approval = await createApprovalInstance(client, {
      org_id: req.user.org_id,
      module: 'material_requisition',
      record_id: id,
      amount: null,
      currency_id: null,
      initiated_by: req.user.id
    });
    await client.query(`update material_requisitions set approval_instance_id=$2, updated_at=now() where id=$1`, [id, approval.id]);
    await client.query('commit');
    res.json({ success: true, data: { approval } });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await releaseClient(client);
  }
}));

procurementRouter.get('/rfqs', authorize('procurement', 'view'), asyncHandler(async (_req, res) => {
  const rows = await query(`select rfq.*, p.project_code from rfqs rfq join projects p on p.id = rfq.project_id order by rfq.created_at desc limit 200`);
  res.json({ success: true, data: rows });
}));

procurementRouter.post('/rfqs', authorize('procurement', 'create'), asyncHandler(async (req, res) => {
  const body = createRfqSchema.parse(req.body);
  const client = await getClient();
  try {
    await client.query('begin');
    const rfq = await client.query(`
      insert into rfqs (project_id, mr_id, rfq_ref, due_date, status)
      values ($1,$2,$3,$4,'open') returning *
    `, [body.project_id, body.mr_id ?? null, body.rfq_ref, body.due_date ?? null]);
    for (const vendorId of body.vendor_ids) {
      await client.query(`insert into rfq_vendors (rfq_id, vendor_id) values ($1,$2) on conflict do nothing`, [rfq.rows[0].id, vendorId]);
    }
    await client.query('commit');
    res.status(201).json({ success: true, data: rfq.rows[0] });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await releaseClient(client);
  }
}));

procurementRouter.post('/rfqs/:id/vendor-quotations', authorize('procurement', 'edit'), asyncHandler(async (req, res) => {
  const rfqId = Number(req.params.id);
  const body = quotationSchema.parse(req.body);
  const inserted = await query(`
    insert into vendor_quotations
      (rfq_id, vendor_id, quotation_ref, total_amount, currency_id, validity_date, lead_time_days, payment_terms)
    values ($1,$2,$3,$4,$5,$6,$7,$8) returning *
  `, [rfqId, body.vendor_id, body.quotation_ref ?? null, body.total_amount, body.currency_id, body.validity_date ?? null, body.lead_time_days ?? null, body.payment_terms ?? null]);
  await query(`update rfq_vendors set quote_received=true where rfq_id=$1 and vendor_id=$2`, [rfqId, body.vendor_id]);
  res.status(201).json({ success: true, data: inserted[0] });
}));

procurementRouter.get('/comparative-statements', authorize('procurement', 'view'), asyncHandler(async (_req, res) => {
  const rows = await query(`
    select cs.*, rfq.rfq_ref, v.vendor_name as recommended_vendor_name
    from comparative_statements cs
    join rfqs rfq on rfq.id = cs.rfq_id
    left join vendors_subcontractors v on v.id = cs.recommended_vendor_id
    order by cs.created_at desc limit 200
  `);
  res.json({ success: true, data: rows });
}));

procurementRouter.post('/comparative-statements', authorize('procurement', 'create'), asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError(401, 'Authentication required');
  const body = comparativeSchema.parse(req.body);
  const inserted = await query(`
    insert into comparative_statements (rfq_id, prepared_by, recommended_vendor_id, justification, status)
    values ($1,$2,$3,$4,'draft') returning *
  `, [body.rfq_id, req.user.id, body.recommended_vendor_id ?? null, body.justification ?? null]);
  res.status(201).json({ success: true, data: inserted[0] });
}));

procurementRouter.get('/purchase-orders', authorize('procurement', 'view'), asyncHandler(async (_req, res) => {
  const rows = await query(`
    select po.id, po.project_id, p.project_code, po.po_ref, po.po_date,
           v.vendor_name, po.total_amount, cur.code as currency_code, po.status, po.approval_instance_id,
           po.cost_code_id, cc.code as cost_code
    from purchase_orders po
    join projects p on p.id = po.project_id
    join vendors_subcontractors v on v.id = po.vendor_id
    join currencies cur on cur.id = po.currency_id
    left join cost_codes cc on cc.id = po.cost_code_id
    order by po.created_at desc
    limit 200
  `);
  res.json({ success: true, data: rows });
}));

procurementRouter.post('/purchase-orders', authorize('procurement', 'create'), asyncHandler(async (req, res) => {
  const body = createPoSchema.parse(req.body);
  const client = await getClient();
  try {
    await client.query('begin');
    const po = await client.query(`
      insert into purchase_orders
        (project_id, vendor_id, mr_id, cost_code_id, po_ref, po_date, total_amount, currency_id, payment_terms, delivery_terms, status)
      values ($1,$2,$3,$4,$5,coalesce($6::date,current_date),0,$7,$8,$9,'draft') returning *
    `, [body.project_id, body.vendor_id, body.mr_id ?? null, body.cost_code_id, body.po_ref, body.po_date ?? null, body.currency_id, body.payment_terms ?? null, body.delivery_terms ?? null]);
    for (const line of body.lines) {
      await client.query(`
        insert into po_lines (po_id, boq_item_id, item_description, unit_of_measure, quantity, unit_rate)
        values ($1,$2,$3,$4,$5,$6)
      `, [po.rows[0].id, line.boq_item_id ?? null, line.item_description, line.unit_of_measure, line.quantity, line.unit_rate]);
    }
    const total = (await client.query(`select coalesce(sum(amount),0)::numeric(18,2) as total from po_lines where po_id=$1`, [po.rows[0].id])).rows[0].total;
    const updated = await client.query(`update purchase_orders set total_amount=$2::numeric(18,2), updated_at=now() where id=$1 returning *`, [po.rows[0].id, total]);
    await client.query('commit');
    res.status(201).json({ success: true, data: updated.rows[0] });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await releaseClient(client);
  }
}));

procurementRouter.get('/purchase-orders/:id/details', authorize('procurement','view'), asyncHandler(async(req,res)=>{
  const id=Number(req.params.id);
  const po=(await query(`select po.*,p.project_code,v.vendor_name,c.code currency_code from purchase_orders po join projects p on p.id=po.project_id join vendors_subcontractors v on v.id=po.vendor_id join currencies c on c.id=po.currency_id where po.id=$1`,[id]))[0];
  if(!po) throw new AppError(404,'Purchase order not found');
  const lines=await query(`select * from po_lines where po_id=$1 order by id`,[id]);
  res.json({success:true,data:{po,lines}});
}));

procurementRouter.get('/grns', authorize('procurement','view'), asyncHandler(async(_req,res)=>{
  const rows=await query(`select g.*,po.po_ref,p.project_code,w.code warehouse_code from goods_receipt_notes g join purchase_orders po on po.id=g.po_id join projects p on p.id=g.project_id left join warehouses w on w.id=g.warehouse_id order by g.created_at desc limit 300`);
  res.json({success:true,data:rows});
}));

procurementRouter.post('/purchase-orders/:id/submit-approval', authorize('procurement', 'edit'), asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError(401, 'Authentication required');
  const id = Number(req.params.id);
  const client = await getClient();
  try {
    await client.query('begin');
    const po = await client.query(`select * from purchase_orders where id=$1 for update`, [id]);
    if (!po.rows[0]) throw new AppError(404, 'Purchase order not found');
    if (po.rows[0].status !== 'draft') throw new AppError(409, 'Only draft purchase orders can be submitted for approval');
    const approval = await createApprovalInstance(client, {
      org_id: req.user.org_id,
      module: 'purchase_order',
      record_id: id,
      amount: String(po.rows[0].total_amount),
      currency_id: po.rows[0].currency_id,
      initiated_by: req.user.id
    });
    await client.query(`update purchase_orders set approval_instance_id=$2, updated_at=now() where id=$1`, [id, approval.id]);
    await client.query('commit');
    res.json({ success: true, data: { approval } });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await releaseClient(client);
  }
}));

procurementRouter.post('/purchase-orders/:id/issue', authorize('procurement', 'edit'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const updated = await query(`
    update purchase_orders
    set status='issued', updated_at=now()
    where id=$1 and status='approved'
    returning *
  `, [id]);
  if (!updated[0]) throw new AppError(409, 'Only approved purchase orders can be issued');
  res.json({ success: true, data: updated[0] });
}));

const grnSchema = z.object({
  project_id: positiveId, warehouse_id: positiveId, grn_no: z.string().min(1).max(30),
  received_date: z.string().optional(), lines: z.array(z.object({po_line_id: positiveId, inventory_item_id: positiveId,
  quantity_received: z.number().positive(), quantity_accepted: z.number().nonnegative(), quantity_rejected: z.number().nonnegative().default(0), rejection_reason: z.string().optional().nullable()})).min(1)
});

procurementRouter.post('/purchase-orders/:id/grns', authorize('procurement','edit'), asyncHandler(async(req,res)=>{
  if(!req.user) throw new AppError(401,'Authentication required'); const poId=Number(req.params.id); const b=grnSchema.parse(req.body); const client=await getClient();
  try { await client.query('begin'); const po=await client.query(`select * from purchase_orders where id=$1 for update`,[poId]);
    if(!po.rows[0] || po.rows[0].project_id!==b.project_id) throw new AppError(404,'Purchase order not found for project');
    if(!['issued','partially_delivered'].includes(po.rows[0].status)) throw new AppError(409,'PO must be issued before receipt');
    const g=await client.query(`insert into goods_receipt_notes(org_id,po_id,project_id,warehouse_id,grn_no,received_date,received_by,status) values($1,$2,$3,$4,$5,coalesce($6::date,current_date),$7,'draft') returning *`,[req.user.org_id,poId,b.project_id,b.warehouse_id,b.grn_no,b.received_date??null,req.user.id]);
    for(const l of b.lines){ if(l.quantity_accepted+l.quantity_rejected>l.quantity_received) throw new AppError(400,'Accepted + rejected cannot exceed received');
      const pl=await client.query(`select * from po_lines where id=$1 and po_id=$2`,[l.po_line_id,poId]); if(!pl.rows[0]) throw new AppError(400,'GRN line does not belong to PO');
      await client.query(`insert into grn_lines(grn_id,po_line_id,inventory_item_id,quantity_received,quantity_accepted,quantity_rejected,rejection_reason) values($1,$2,$3,$4,$5,$6,$7)`,[g.rows[0].id,l.po_line_id,l.inventory_item_id,l.quantity_received,l.quantity_accepted,l.quantity_rejected,l.rejection_reason??null]);
    } await client.query('commit'); res.status(201).json({success:true,data:g.rows[0]});
  } catch(e){await client.query('rollback');throw e;} finally{await releaseClient(client);}
}));

procurementRouter.post('/grns/:id/confirm', authorize('procurement','edit'), asyncHandler(async(req,res)=>{
 if(!req.user) throw new AppError(401,'Authentication required'); const gid=Number(req.params.id); const c=await getClient(); try{await c.query('begin');
 const g=await c.query(`select * from goods_receipt_notes where id=$1 for update`,[gid]); if(!g.rows[0])throw new AppError(404,'GRN not found'); if(g.rows[0].status!=='draft')throw new AppError(409,'Only draft GRN can be confirmed');
 const lines=await c.query(`select gl.*,pl.unit_rate from grn_lines gl join po_lines pl on pl.id=gl.po_line_id where gl.grn_id=$1`,[gid]);
 for(const l of lines.rows) await c.query(`insert into inventory_transactions(org_id,warehouse_id,project_id,inventory_item_id,transaction_type,quantity,unit_cost,transaction_date,source_table,source_record_id,created_by) values($1,$2,$3,$4,'receipt',$5,$6,$7,'goods_receipt_notes',$8,$9)`,[req.user.org_id,g.rows[0].warehouse_id,g.rows[0].project_id,l.inventory_item_id,l.quantity_accepted,l.unit_rate,g.rows[0].received_date,gid,req.user.id]);
 await c.query(`update goods_receipt_notes set status='confirmed' where id=$1`,[gid]); await c.query(`update purchase_orders set status='partially_delivered',updated_at=now() where id=$1 and status='issued'`,[g.rows[0].po_id]); await c.query('commit'); res.json({success:true});
 }catch(e){await c.query('rollback');throw e;}finally{await releaseClient(c);}
}));

procurementRouter.get('/vendor-invoices', authorize('procurement', 'view'), asyncHandler(async (_req, res) => {
  const rows = await query(`
    select vi.id, vi.project_id, p.project_code, vi.po_id, po.po_ref, vi.invoice_no, vi.invoice_date,
           v.vendor_name, vi.amount, vi.tax_amount, cur.code as currency_code, vi.status, vi.due_date,
           vi.approval_instance_id
    from vendor_invoices vi
    join projects p on p.id = vi.project_id
    join vendors_subcontractors v on v.id = vi.vendor_id
    join currencies cur on cur.id = vi.currency_id
    left join purchase_orders po on po.id = vi.po_id
    order by vi.created_at desc
    limit 200
  `);
  res.json({ success: true, data: rows });
}));

procurementRouter.post('/vendor-invoices', authorize('procurement', 'create'), asyncHandler(async (req, res) => {
  const body = invoiceSchema.parse(req.body);
  const inserted = await query(`
    insert into vendor_invoices
      (vendor_id, project_id, po_id, invoice_no, invoice_date, amount, tax_amount, currency_id, matched_grn_id, due_date, status)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'received') returning *
  `, [body.vendor_id, body.project_id, body.po_id, body.invoice_no, body.invoice_date, body.amount, body.tax_amount, body.currency_id, body.matched_grn_id ?? null, body.due_date ?? null]);
  res.status(201).json({ success: true, data: inserted[0] });
}));

procurementRouter.post('/vendor-invoices/:id/match', authorize('procurement', 'edit'), asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError(401, 'Authentication required'); const id = Number(req.params.id); const tolerance=Number(req.body?.tolerance_amount ?? 0); if(tolerance<0) throw new AppError(400,'Invalid tolerance');
  const client=await getClient(); try{await client.query('begin'); const vi=await client.query(`select * from vendor_invoices where id=$1 for update`,[id]); if(!vi.rows[0])throw new AppError(404,'Vendor invoice not found'); if(!vi.rows[0].matched_grn_id)throw new AppError(409,'Invoice must reference a GRN');
  const g=await client.query(`select * from goods_receipt_notes where id=$1 and po_id=$2 and project_id=$3 and status='confirmed'`,[vi.rows[0].matched_grn_id,vi.rows[0].po_id,vi.rows[0].project_id]); if(!g.rows[0])throw new AppError(409,'Confirmed GRN matching invoice PO/project is required');
  // All monetary arithmetic stays in PostgreSQL NUMERIC; never round-trip through JS Float64.
  const matchCalc=await client.query(`
    with po as (select coalesce(sum(amount),0)::numeric as po_amount from po_lines where po_id=$1),
         ga as (select coalesce(sum(gl.quantity_accepted*pl.unit_rate),0)::numeric as accepted_amount from grn_lines gl join po_lines pl on pl.id=gl.po_line_id where gl.grn_id=$2),
         vals as (select po.po_amount,ga.accepted_amount,(coalesce($3::numeric,0)+coalesce($4::numeric,0))::numeric as invoice_amount,$5::numeric as tolerance_amount from po,ga)
    select po_amount,accepted_amount,invoice_amount,(invoice_amount-accepted_amount)::numeric as variance_amount,tolerance_amount,
           case when abs(invoice_amount-accepted_amount)<=tolerance_amount and invoice_amount<=po_amount+tolerance_amount then 'matched' else 'variance' end as result
    from vals`,[vi.rows[0].po_id,g.rows[0].id,vi.rows[0].amount,vi.rows[0].tax_amount??'0',String(tolerance)]);
  const m=matchCalc.rows[0];
  await client.query(`insert into invoice_match_results(org_id,vendor_invoice_id,po_id,grn_id,po_amount,accepted_grn_amount,invoice_amount,variance_amount,tolerance_amount,result,matched_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[req.user.org_id,id,vi.rows[0].po_id,g.rows[0].id,m.po_amount,m.accepted_amount,m.invoice_amount,m.variance_amount,m.tolerance_amount,m.result,req.user.id]);
  await client.query(`update vendor_invoices set status=$2,match_variance_amount=$3,match_variance_reason=$4,updated_at=now() where id=$1`,[id,m.result==='matched'?'matched':'disputed',m.variance_amount,m.result==='matched'?null:'PO/GRN/Invoice variance exceeds tolerance']); await client.query('commit'); res.json({success:true,data:{result:m.result,po_amount:m.po_amount,accepted_grn_amount:m.accepted_amount,invoice_amount:m.invoice_amount,variance_amount:m.variance_amount,tolerance_amount:m.tolerance_amount}});
  }catch(e){await client.query('rollback');throw e;}finally{await releaseClient(client);}
}));

procurementRouter.post('/vendor-invoices/:id/submit-approval', authorize('procurement', 'edit'), asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError(401, 'Authentication required');
  const id = Number(req.params.id);
  const client = await getClient();
  try {
    await client.query('begin');
    const vi = await client.query(`select * from vendor_invoices where id=$1 for update`, [id]);
    if (!vi.rows[0]) throw new AppError(404, 'Vendor invoice not found');
    if (vi.rows[0].status !== 'matched') throw new AppError(409, 'Invoice must pass 3-way match before approval submission');
    const approval = await createApprovalInstance(client, {
      org_id: req.user.org_id,
      module: 'vendor_invoice',
      record_id: id,
      amount: String((await client.query(`select (amount + coalesce(tax_amount,0))::numeric as approval_amount from vendor_invoices where id=$1`, [id])).rows[0].approval_amount),
      currency_id: vi.rows[0].currency_id,
      initiated_by: req.user.id
    });
    await client.query(`update vendor_invoices set approval_instance_id=$2, updated_at=now() where id=$1`, [id, approval.id]);
    await client.query('commit');
    res.json({ success: true, data: { approval } });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await releaseClient(client);
  }
}));
