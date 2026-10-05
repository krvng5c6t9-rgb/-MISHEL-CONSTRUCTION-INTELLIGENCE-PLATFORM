import { Router } from 'express';
import { z } from 'zod';
import { getClient, query, releaseClient } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';
import { AppError } from '../../middleware/errors.js';

export const boqRouter = Router();
boqRouter.use(authorize('boq', 'view'));

const masterBase = z.object({
  tender_id:z.number().int().positive().optional().nullable(), project_id:z.number().int().positive().optional().nullable(),
  item_no:z.string().min(1).max(20), section:z.string().max(150).optional().nullable(), description:z.string().min(1), unit_of_measure:z.string().min(1).max(20),
  quantity:z.number().nonnegative().default(0), cost_code_id:z.number().int().positive().optional().nullable(), unit_rate_material:z.number().nonnegative().default(0),
  unit_rate_labor:z.number().nonnegative().default(0), unit_rate_equipment:z.number().nonnegative().default(0), unit_rate_subcontract:z.number().nonnegative().default(0),
  overhead_percent:z.number().min(0).max(100).default(0), profit_percent:z.number().min(0).max(100).default(0)
});
const masterSchema = masterBase.refine(v=>v.tender_id||v.project_id,{message:'tender_id or project_id is required'});

boqRouter.get('/master', asyncHandler(async(req,res)=>{
 const tenderId=Number(req.query.tender_id||0), projectId=Number(req.query.project_id||0);
 const rows=await query(`select b.*,c.code cost_code from boq_master b left join cost_codes c on c.id=b.cost_code_id where ($1::bigint=0 or b.tender_id=$1) and ($2::bigint=0 or b.project_id=$2) order by b.section nulls first,b.item_no`,[tenderId,projectId]);
 res.json({success:true,data:rows});
}));
boqRouter.post('/master', authorize('boq','create'), asyncHandler(async(req,res)=>{
 const b=masterSchema.parse(req.body); const [r]=await query(`insert into boq_master(org_id,tender_id,project_id,item_no,section,description,unit_of_measure,quantity,cost_code_id,unit_rate_material,unit_rate_labor,unit_rate_equipment,unit_rate_subcontract,overhead_percent,profit_percent,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning *`,[req.user!.org_id,b.tender_id??null,b.project_id??null,b.item_no,b.section??null,b.description,b.unit_of_measure,b.quantity,b.cost_code_id??null,b.unit_rate_material,b.unit_rate_labor,b.unit_rate_equipment,b.unit_rate_subcontract,b.overhead_percent,b.profit_percent,req.user!.id]); res.status(201).json({success:true,data:r});
}));
boqRouter.patch('/master/:id', authorize('boq','edit'), asyncHandler(async(req,res)=>{
 const id=Number(req.params.id), b=masterBase.partial().parse(req.body); const fields:any[]=[]; const vals:any[]=[]; for(const [k,v] of Object.entries(b)){fields.push(`${k}=$${fields.length+2}`);vals.push(v);} if(!fields.length)throw new AppError(400,'No fields to update');
 const rows=await query(`update boq_master set ${fields.join(',')},updated_at=now() where id=$1 and approval_instance_id is null returning *`,[id,...vals]); if(!rows[0])throw new AppError(409,'BOQ row is approved/submitted or not found');res.json({success:true,data:rows[0]});
}));
boqRouter.delete('/master/:id', authorize('boq','delete'), asyncHandler(async(req,res)=>{const rows=await query(`delete from boq_master where id=$1 and approval_instance_id is null returning id`,[Number(req.params.id)]);if(!rows[0])throw new AppError(409,'BOQ row is approved/submitted or not found');res.json({success:true,data:rows[0]});}));
boqRouter.get('/master/:id/rate-buildup',asyncHandler(async(req,res)=>res.json({success:true,data:await query(`select rb.*,r.resource_name,r.unit_of_measure from boq_rate_buildup rb left join resource_library r on r.id=rb.resource_id where rb.boq_master_id=$1 order by rb.id`,[Number(req.params.id)])})));
boqRouter.post('/master/:id/rate-buildup',authorize('boq','edit'),asyncHandler(async(req,res)=>{const b=z.object({resource_type:z.enum(['material','labor','equipment']),resource_id:z.number().int().positive().optional().nullable(),quantity_per_unit:z.number().positive(),unit_cost:z.number().nonnegative(),source:z.enum(['own_db','vendor_quote']).default('own_db')}).parse(req.body);const [r]=await query(`insert into boq_rate_buildup(boq_master_id,resource_type,resource_id,quantity_per_unit,unit_cost,source) values($1,$2,$3,$4,$5,$6) returning *`,[Number(req.params.id),b.resource_type,b.resource_id??null,b.quantity_per_unit,b.unit_cost,b.source]);res.status(201).json({success:true,data:r});}));
boqRouter.get('/resources',asyncHandler(async(_req,res)=>res.json({success:true,data:await query(`select * from resource_library where is_active=true order by resource_type,resource_name`)})));
boqRouter.post('/resources',authorize('boq','create'),asyncHandler(async(req,res)=>{const b=z.object({resource_type:z.enum(['material','labor','equipment']),resource_name:z.string().min(1),unit_of_measure:z.string().min(1).max(20),current_market_rate:z.number().nonnegative().optional().nullable(),currency_id:z.number().int().positive().optional().nullable()}).parse(req.body);const [r]=await query(`insert into resource_library(org_id,resource_type,resource_name,unit_of_measure,current_market_rate,currency_id,last_updated) values($1,$2,$3,$4,$5,$6,current_date) returning *`,[req.user!.org_id,b.resource_type,b.resource_name,b.unit_of_measure,b.current_market_rate??null,b.currency_id??null]);res.status(201).json({success:true,data:r});}));

boqRouter.get('/project/:projectId', asyncHandler(async (req, res) => {
  const rows = await query(`select id,item_no,section,description,unit_of_measure,contract_quantity,contract_unit_rate,contract_amount,revised_quantity,revised_amount,cost_code_id,is_locked from project_boq where project_id=$1 order by item_no`, [Number(req.params.projectId)]);
  res.json({ success: true, data: rows });
}));

// G-001: estimating -> execution BOQ handover (migration 038). A zero difference between the
// handed-over BOQ total and the contract value completes immediately; any difference waits for
// acceptance by a different user holding boq.approve, who must give a reason.
const handoverSchema = z.object({
  contract_id: z.number().int().positive(),
  source_tender_id: z.number().int().positive().optional().nullable(),
  difference_reason: z.string().trim().min(10).max(2000).optional().nullable()
});

async function sourceRows(client: import('pg').PoolClient, projectId: number, tenderId: number | null) {
  const where = tenderId ? 'tender_id=$1' : 'project_id=$1';
  return (await client.query(`select id,item_no,section,description,unit_of_measure,quantity,total_rate,cost_code_id from boq_master where ${where} order by item_no for update`, [tenderId ?? projectId])).rows;
}
const cents = (v: unknown) => Math.round(Number(v) * 100);

async function completeHandover(client: import('pg').PoolClient, h: any, rows: any[]) {
  for (const r of rows) {
    await client.query(`insert into project_boq(org_id,project_id,boq_master_id,item_no,section,description,unit_of_measure,contract_quantity,contract_unit_rate,cost_code_id,is_locked,handover_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11)`,
      [h.org_id, h.project_id, r.id, r.item_no, r.section, r.description, r.unit_of_measure, r.quantity, r.total_rate, r.cost_code_id, h.id]);
  }
}

boqRouter.get('/project/:projectId/handovers', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await query(`select * from boq_handovers where project_id=$1 order by id desc`, [Number(req.params.projectId)]) });
}));

boqRouter.post('/project/:projectId/handover', authorize('boq', 'create'), asyncHandler(async (req, res) => {
  const user = req.user!;
  const projectId = Number(req.params.projectId);
  if (!Number.isSafeInteger(projectId) || projectId <= 0) throw new AppError(400, 'Invalid project id');
  const b = handoverSchema.parse(req.body);
  const client = await getClient();
  try {
    await client.query('begin');
    const project = (await client.query(`select id,org_id from projects where id=$1 for update`, [projectId])).rows[0];
    if (!project) throw new AppError(404, 'Project not found');
    const contract = (await client.query(`select id,contract_value,contract_status from contracts where id=$1 and project_id=$2 for share`, [b.contract_id, projectId])).rows[0];
    if (!contract) throw new AppError(422, 'Contract not found for this project');
    if (!['signed', 'active'].includes(contract.contract_status)) throw new AppError(409, 'Execution BOQ can only be created from a signed or active contract');
    if ((await client.query(`select 1 from boq_handovers where project_id=$1 and status in ('pending_acceptance','completed')`, [projectId])).rows[0]) throw new AppError(409, 'Project already has a pending or completed BOQ handover');
    if ((await client.query(`select 1 from project_boq where project_id=$1 limit 1`, [projectId])).rows[0]) throw new AppError(409, 'Project already has execution BOQ items');
    const tenderId = b.source_tender_id ?? null;
    if (tenderId && !(await client.query(`select 1 from tenders where id=$1`, [tenderId])).rows[0]) throw new AppError(422, 'Source tender not found');
    const rows = await sourceRows(client, projectId, tenderId);
    if (!rows.length) throw new AppError(422, 'No estimating BOQ items to hand over');
    const dup = rows.map(r => r.item_no).find((v, i, a) => a.indexOf(v) !== i);
    if (dup) throw new AppError(422, `Duplicate item number in source BOQ: ${dup}`);
    const totalCents = rows.reduce((s, r) => s + Math.round(Number(r.quantity) * Number(r.total_rate) * 100), 0);
    const diffCents = cents(contract.contract_value) - totalCents;
    const status = diffCents === 0 ? 'completed' : 'pending_acceptance';
    const h = (await client.query(`insert into boq_handovers(org_id,project_id,contract_id,source_type,source_tender_id,item_count,boq_total,contract_value,difference,status,difference_reason,prepared_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
      [project.org_id, projectId, b.contract_id, tenderId ? 'tender' : 'project', tenderId, rows.length, (totalCents / 100).toFixed(2), contract.contract_value, (diffCents / 100).toFixed(2), status, b.difference_reason ?? null, user.id])).rows[0];
    if (status === 'completed') await completeHandover(client, h, rows);
    await client.query('commit');
    res.status(201).json({ success: true, data: { handover: h, items_created: status === 'completed' ? rows.length : 0 } });
  } catch (e) { await client.query('rollback'); throw e; } finally { await releaseClient(client); }
}));

boqRouter.post('/handovers/:id/:decision(accept|reject)', authorize('boq', 'approve'), asyncHandler(async (req, res) => {
  const user = req.user!;
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new AppError(400, 'Invalid handover id');
  const b = z.object({ difference_reason: z.string().trim().min(10).max(2000).optional().nullable() }).parse(req.body ?? {});
  const client = await getClient();
  try {
    await client.query('begin');
    const h = (await client.query(`select * from boq_handovers where id=$1 for update`, [id])).rows[0];
    if (!h) throw new AppError(404, 'Handover not found');
    if (h.status !== 'pending_acceptance') throw new AppError(409, 'Handover is not pending acceptance');
    if (Number(h.prepared_by) === user.id) throw new AppError(403, 'Segregation of duties: the preparer cannot accept or reject their own handover');
    if (req.params.decision === 'reject') {
      const r = (await client.query(`update boq_handovers set status='rejected',accepted_by=$2,accepted_at=now() where id=$1 returning *`, [id, user.id])).rows[0];
      await client.query('commit');
      return res.json({ success: true, data: { handover: r, items_created: 0 } });
    }
    const reason = b.difference_reason ?? h.difference_reason;
    if (!reason) throw new AppError(422, 'A reason is required to accept a BOQ total that differs from the contract value');
    const rows = await sourceRows(client, Number(h.project_id), h.source_tender_id ? Number(h.source_tender_id) : null);
    const totalCents = rows.reduce((s, r) => s + Math.round(Number(r.quantity) * Number(r.total_rate) * 100), 0);
    if (rows.length !== Number(h.item_count) || totalCents !== cents(h.boq_total)) throw new AppError(409, 'Source BOQ changed since the handover was prepared; reject and prepare a new handover');
    const r = (await client.query(`update boq_handovers set status='completed',accepted_by=$2,accepted_at=now(),difference_reason=$3 where id=$1 returning *`, [id, user.id, reason])).rows[0];
    await completeHandover(client, r, rows);
    await client.query('commit');
    res.json({ success: true, data: { handover: r, items_created: rows.length } });
  } catch (e) { await client.query('rollback'); throw e; } finally { await releaseClient(client); }
}));
