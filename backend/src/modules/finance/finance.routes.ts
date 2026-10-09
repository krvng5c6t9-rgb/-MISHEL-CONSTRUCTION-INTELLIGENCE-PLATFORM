import { Router } from 'express';
import { z } from 'zod';
import { query, getClient, releaseClient } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';
import { AppError } from '../../middleware/errors.js';
import { createApprovalInstance } from '../../services/approval.service.js';
import {
  postApprovedIpcToArAndGl,
  postApprovedPaymentToGl,
  postCostTransactionToGl,
  postManualJournalToGl
} from '../../services/glPosting.service.js';

export const financeRouter = Router();
financeRouter.use(authorize('finance', 'view'));

const idParam = z.object({ id: z.coerce.number().int().positive() });

financeRouter.get('/reference-data', asyncHandler(async (req, res) => {
  const orgId=Number(req.user!.org_id);
  const [projects,clients,vendors,currencies,accounts,banks,contracts] = await Promise.all([
    query(`select id,project_code,project_name,currency_id from projects order by project_code`),
    query(`select id,client_name from clients where is_active=true order by client_name`),
    query(`select id,vendor_name from vendors_subcontractors where is_active=true order by vendor_name`),
    query(`select id,code,name from currencies where is_active=true order by code`),
    query(`select id,account_code,account_name,account_type from chart_of_accounts where org_id=$1 and is_active=true order by account_code`,[orgId]),
    query(`select id,bank_name,account_no,currency_id from bank_accounts where org_id=$1 and is_active=true order by bank_name`,[orgId]),
    query(`select id,project_id,client_id,contract_value,currency_id,contract_status from contracts where org_id=$1 order by id desc`,[orgId])
  ]);
  res.json({success:true,data:{projects,clients,vendors,currencies,accounts,banks,contracts}});
}));

financeRouter.get('/chart-of-accounts', asyncHandler(async (req, res) => {
  const orgId = Number(req.user!.org_id);
  const rows = await query(`
    select id, account_code, account_name, account_type, parent_account_id, is_active
    from chart_of_accounts
    where org_id = $1
    order by account_code
  `, [orgId]);
  res.json({ success: true, data: rows });
}));

financeRouter.post('/chart-of-accounts', authorize('finance', 'manage'), asyncHandler(async (req, res) => {
  const orgId = Number(req.user!.org_id);
  const body = z.object({
    account_code: z.string().min(1).max(20),
    account_name: z.string().min(2).max(150),
    account_type: z.enum(['asset','liability','equity','revenue','expense']),
    parent_account_id: z.number().int().positive().nullable().optional(),
    is_active: z.boolean().optional()
  }).parse(req.body);
  const rows = await query(`
    insert into chart_of_accounts
      (org_id, account_code, account_name, account_type, parent_account_id, is_active)
    values ($1,$2,$3,$4,$5,coalesce($6,true))
    returning *
  `, [orgId, body.account_code, body.account_name, body.account_type, body.parent_account_id ?? null, body.is_active ?? true]);
  res.status(201).json({ success: true, data: rows[0] });
}));

financeRouter.get('/gl-posting-rules', asyncHandler(async (req, res) => {
  const orgId = Number(req.user!.org_id);
  const rows = await query(`
    select r.*, da.account_code as debit_account_code, da.account_name as debit_account_name,
           ca.account_code as credit_account_code, ca.account_name as credit_account_name
    from gl_posting_rules r
    join chart_of_accounts da on da.id = r.debit_account_id
    join chart_of_accounts ca on ca.id = r.credit_account_id
    where r.org_id = $1
    order by r.source_module, r.source_subtype nulls first, r.effective_from desc
  `, [orgId]);
  res.json({ success: true, data: rows });
}));

financeRouter.post('/gl-posting-rules', authorize('finance', 'manage'), asyncHandler(async (req, res) => {
  const orgId = Number(req.user!.org_id);
  const body = z.object({
    source_module: z.enum(['cost_transaction','ipc','payment','payroll_overhead']),
    source_subtype: z.string().max(30).nullable().optional(),
    debit_account_id: z.number().int().positive(),
    credit_account_id: z.number().int().positive(),
    effective_from: z.string().optional(),
    effective_to: z.string().nullable().optional(),
    notes: z.string().nullable().optional()
  }).parse(req.body);
  const rows = await query(`
    insert into gl_posting_rules
      (org_id, source_module, source_subtype, debit_account_id, credit_account_id, effective_from, effective_to, notes)
    values ($1,$2,$3,$4,$5,coalesce($6::date,current_date),$7,$8)
    returning *
  `, [orgId, body.source_module, body.source_subtype ?? null, body.debit_account_id, body.credit_account_id,
      body.effective_from ?? null, body.effective_to ?? null, body.notes ?? null]);
  res.status(201).json({ success: true, data: rows[0] });
}));

financeRouter.get('/gl', asyncHandler(async (req, res) => {
  const orgId = Number(req.user!.org_id);
  const rows = await query(`
    select gl.id, gl.org_id, gl.project_id, p.project_name, coa.account_code, coa.account_name,
           gl.transaction_date, gl.debit, gl.credit, cur.code as currency_code,
           gl.source_module, gl.source_table, gl.source_record_id, gl.journal_batch_id, gl.description
    from general_ledger gl
    join chart_of_accounts coa on coa.id = gl.account_id
    join currencies cur on cur.id = gl.currency_id
    left join projects p on p.id = gl.project_id
    where gl.org_id = $1
    order by gl.transaction_date desc, gl.id desc
    limit 500
  `, [orgId]);
  res.json({ success: true, data: rows });
}));

financeRouter.post('/cost-transactions/:id/post-gl', authorize('finance', 'post'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const client = await getClient();
  try {
    await client.query('begin');
    const result = await postCostTransactionToGl(client, id);
    await client.query('commit');
    res.json({ success: true, data: result });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await releaseClient(client);
  }
}));

financeRouter.get('/ipcs', asyncHandler(async (req, res) => {
  const orgId = Number(req.user!.org_id);
  const rows = await query(`
    select i.*, p.project_name, ('CON-' || c.id::text) as contract_ref
    from ipcs i
    join projects p on p.id = i.project_id
    join contracts c on c.id = i.contract_id
    where p.org_id = $1
    order by i.created_at desc
    limit 300
  `, [orgId]);
  res.json({ success: true, data: rows });
}));

financeRouter.post('/ipcs', authorize('finance', 'manage'), asyncHandler(async (req, res) => {
  const userId = Number(req.user!.id);
  const body = z.object({
    project_id: z.number().int().positive(),
    contract_id: z.number().int().positive(),
    ipc_no: z.string().min(1).max(20),
    period_from: z.string(),
    period_to: z.string(),
    gross_work_done_this_period: z.number().nonnegative().default(0),
    cumulative_gross_work_done: z.number().nonnegative().default(0),
    materials_on_site_value: z.number().nonnegative().default(0),
    less_retention: z.number().nonnegative().default(0),
    less_advance_recovery: z.number().nonnegative().default(0),
    less_previous_certified: z.number().nonnegative().default(0)
  }).parse(req.body);
  const rows = await query(`
    insert into ipcs
      (org_id, project_id, contract_id, ipc_no, period_from, period_to, gross_work_done_this_period,
       cumulative_gross_work_done, materials_on_site_value, less_retention, less_advance_recovery,
       less_previous_certified, prepared_by)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    returning *
  `, [Number(req.user!.org_id), body.project_id, body.contract_id, body.ipc_no, body.period_from, body.period_to,
      body.gross_work_done_this_period, body.cumulative_gross_work_done, body.materials_on_site_value,
      body.less_retention, body.less_advance_recovery, body.less_previous_certified, userId]);
  res.status(201).json({ success: true, data: rows[0] });
}));

financeRouter.post('/ipcs/:id/submit-to-client', authorize('finance', 'manage'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const client = await getClient();
  try {
    await client.query('begin');
    const ipc = (await client.query(`
      select i.*, p.org_id, p.currency_id
      from ipcs i join projects p on p.id=i.project_id
      where i.id=$1 for update
    `, [id])).rows[0];
    if (!ipc) throw new AppError(404, 'IPC not found');
    if (ipc.status !== 'draft') throw new AppError(409, 'Only draft IPCs can be submitted');
    const approval = await createApprovalInstance(client, {
      org_id: Number(ipc.org_id), module: 'ipc_submission', record_id: Number(ipc.id),
      amount: String(ipc.net_amount_due), currency_id: Number(ipc.currency_id), initiated_by: Number(req.user!.id)
    });
    await client.query(`update ipcs set approval_instance_id=$2, updated_at=now() where id=$1`, [id, approval.id]);
    await client.query('commit');
    res.json({ success: true, data: { approval } });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await releaseClient(client);
  }
}));

// Stage 22 (F-35, migration 071): the client's certification is recorded as evidence - amount certified, client
// reference and date - by someone other than the preparer; a difference to the submitted net needs a reason.
financeRouter.post('/ipcs/:id/client-approve', authorize('finance', 'manage'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const b = z.object({
    certified_amount: z.number().nonnegative(),
    client_reference: z.string().trim().min(3).max(100),
    certified_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    difference_reason: z.string().trim().min(10).optional(),
    // F-36: the client's breakdown, all four together or none.
    certified_gross: z.number().nonnegative().optional(),
    certified_retention: z.number().nonnegative().optional(),
    certified_advance_recovery: z.number().nonnegative().optional(),
    certified_previous: z.number().nonnegative().optional()
  }).parse(req.body);
  const [ipc] = await query<any>(`select id, status, prepared_by from ipcs where id = $1 and org_id = $2`, [id, req.user!.org_id]);
  if (!ipc) throw new AppError(404, 'IPC not found');
  if (Number(ipc.prepared_by) === Number(req.user!.id)) throw new AppError(403, 'Segregation of duties: the IPC preparer cannot record the client certification');
  if (ipc.status !== 'submitted_to_client') throw new AppError(409, 'IPC must be submitted_to_client before client approval');
  const rows = await query(`
    update ipcs set status='client_approved', client_approved_date=$3::date, client_certified_amount=$4, client_reference=$5,
      client_certified_on=$3::date, certification_recorded_by=$6, certification_difference_reason=$7,
      client_certified_gross=$8, client_certified_retention=$9, client_certified_advance_recovery=$10, client_certified_previous=$11, updated_at=now()
    where id=$1 and org_id=$2 and status='submitted_to_client'
    returning *, net_amount_due - client_certified_amount as certification_difference
  `, [id, req.user!.org_id, b.certified_on, b.certified_amount, b.client_reference, req.user!.id, b.difference_reason ?? null,
      b.certified_gross ?? null, b.certified_retention ?? null, b.certified_advance_recovery ?? null, b.certified_previous ?? null]);
  if (!rows[0]) throw new AppError(409, 'IPC must be submitted_to_client before client approval');
  res.json({ success: true, data: rows[0] });
}));

financeRouter.post('/ipcs/:id/client-dispute', authorize('finance', 'manage'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const b = z.object({ reason: z.string().trim().min(10) }).parse(req.body);
  const rows = await query(`update ipcs set status='disputed', dispute_reason=$3, updated_at=now() where id=$1 and org_id=$2 and status='submitted_to_client' returning *`, [id, req.user!.org_id, b.reason]);
  if (!rows[0]) throw new AppError(409, 'Only an IPC submitted to the client can be recorded as disputed');
  res.json({ success: true, data: rows[0] });
}));

financeRouter.post('/ipcs/:id/resubmit-to-client', authorize('finance', 'manage'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const b = z.object({ note: z.string().trim().min(10) }).parse(req.body);
  const rows = await query(`update ipcs set status='submitted_to_client', resubmission_note=$3, submitted_date=current_date, updated_at=now() where id=$1 and org_id=$2 and status='disputed' returning *`, [id, req.user!.org_id, b.note]);
  if (!rows[0]) throw new AppError(409, 'Only a disputed IPC can be resubmitted');
  res.json({ success: true, data: rows[0] });
}));

financeRouter.post('/ipcs/:id/post-ar-gl', authorize('finance', 'post'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const client = await getClient();
  try {
    await client.query('begin');
    const result = await postApprovedIpcToArAndGl(client, id);
    await client.query('commit');
    res.json({ success: true, data: result });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await releaseClient(client);
  }
}));

financeRouter.get('/ap', asyncHandler(async (req, res) => {
  const orgId = Number(req.user!.org_id);
  const rows = await query(`
    select ap.*, v.vendor_name, p.project_name
    from accounts_payable ap
    join vendors_subcontractors v on v.id = ap.vendor_id
    left join projects p on p.id = ap.project_id
    where ap.org_id = $1
    order by ap.created_at desc
    limit 300
  `, [orgId]);
  res.json({ success: true, data: rows });
}));

financeRouter.get('/ar', asyncHandler(async (req, res) => {
  const orgId = Number(req.user!.org_id);
  const rows = await query(`
    select ar.*, c.client_name, p.project_name, i.ipc_no
    from accounts_receivable ar
    join clients c on c.id = ar.client_id
    join projects p on p.id = ar.project_id
    join ipcs i on i.id = ar.ipc_id
    where ar.org_id = $1
    order by ar.created_at desc
    limit 300
  `, [orgId]);
  res.json({ success: true, data: rows });
}));

financeRouter.get('/bank-accounts', asyncHandler(async (req, res) => {
  const orgId = Number(req.user!.org_id);
  const rows = await query(`select * from bank_accounts where org_id=$1 order by bank_name, account_no`, [orgId]);
  res.json({ success: true, data: rows });
}));

financeRouter.post('/bank-accounts', authorize('finance', 'manage'), asyncHandler(async (req, res) => {
  const orgId = Number(req.user!.org_id);
  const body = z.object({
    bank_name: z.string().min(2).max(150),
    account_no: z.string().min(2).max(50),
    currency_id: z.number().int().positive()
  }).parse(req.body);
  const rows = await query(`
    insert into bank_accounts (org_id, bank_name, account_no, currency_id)
    values ($1,$2,$3,$4) returning *
  `, [orgId, body.bank_name, body.account_no, body.currency_id]);
  res.status(201).json({ success: true, data: rows[0] });
}));

financeRouter.get('/payments', asyncHandler(async (req, res) => {
  const orgId = Number(req.user!.org_id);
  const rows = await query(`
    select pay.*, ba.bank_name, ba.account_no
    from payments pay
    join bank_accounts ba on ba.id = pay.bank_account_id
    where pay.org_id = $1
    order by pay.created_at desc
    limit 300
  `, [orgId]);
  res.json({ success: true, data: rows });
}));

financeRouter.post('/payments', authorize('finance', 'manage'), asyncHandler(async (req, res) => {
  const orgId = Number(req.user!.org_id);
  const userId = Number(req.user!.id);
  const body = z.object({
    payment_type: z.enum(['incoming','outgoing']),
    party_type: z.enum(['client','vendor']),
    party_id: z.number().int().positive(),
    related_ap_id: z.number().int().positive().nullable().optional(),
    related_ar_id: z.number().int().positive().nullable().optional(),
    amount: z.number().positive(),
    currency_id: z.number().int().positive(),
    payment_date: z.string().optional(),
    bank_account_id: z.number().int().positive(),
    method: z.enum(['transfer','cheque','cash']),
    reference_no: z.string().max(50).nullable().optional()
  }).parse(req.body);
  const rows = await query(`
    insert into payments
      (org_id, payment_type, party_type, party_id, related_ap_id, related_ar_id, amount,
       currency_id, payment_date, bank_account_id, method, reference_no, created_by)
    values ($1,$2,$3,$4,$5,$6,$7,$8,coalesce($9::date,current_date),$10,$11,$12,$13)
    returning *
  `, [orgId, body.payment_type, body.party_type, body.party_id, body.related_ap_id ?? null, body.related_ar_id ?? null,
      body.amount, body.currency_id, body.payment_date ?? null, body.bank_account_id, body.method, body.reference_no ?? null, userId]);
  res.status(201).json({ success: true, data: rows[0] });
}));

financeRouter.post('/payments/:id/submit-approval', authorize('finance', 'approve'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const client = await getClient();
  try {
    await client.query('begin');
    const payment = (await client.query(`select * from payments where id=$1 for update`, [id])).rows[0];
    if (!payment) throw new AppError(404, 'Payment not found');
    if (payment.status !== 'draft') throw new AppError(409, 'Payment must be draft before approval submission');
    const approval = await createApprovalInstance(client, {
      org_id: Number(payment.org_id), module: 'payment', record_id: Number(payment.id),
      amount: String(payment.amount), currency_id: Number(payment.currency_id), initiated_by: Number(req.user!.id)
    });
    await client.query(`update payments set approval_instance_id=$2, updated_at=now() where id=$1`, [id, approval.id]);
    await client.query('commit');
    res.json({ success: true, data: { approval } });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await releaseClient(client);
  }
}));

financeRouter.post('/payments/:id/post-gl', authorize('finance', 'post'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const client = await getClient();
  try {
    await client.query('begin');
    const result = await postApprovedPaymentToGl(client, id);
    await client.query('commit');
    res.json({ success: true, data: result });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await releaseClient(client);
  }
}));

financeRouter.get('/manual-journals', asyncHandler(async (req, res) => {
  const orgId = Number(req.user!.org_id);
  const rows = await query(`
    select * from manual_journal_entries where org_id=$1 order by created_at desc limit 300
  `, [orgId]);
  res.json({ success: true, data: rows });
}));

financeRouter.post('/manual-journals', authorize('finance', 'manage'), asyncHandler(async (req, res) => {
  const orgId = Number(req.user!.org_id);
  const userId = Number(req.user!.id);
  const body = z.object({
    project_id: z.number().int().positive().nullable().optional(),
    entry_date: z.string().optional(),
    description: z.string().min(3),
    reason_category: z.enum(['reclassification','accrual','correction','write_off','other']),
    lines: z.array(z.object({
      account_id: z.number().int().positive(),
      debit: z.number().nonnegative().default(0),
      credit: z.number().nonnegative().default(0),
      currency_id: z.number().int().positive(),
      description: z.string().nullable().optional()
    })).min(2)
  }).parse(req.body);
  const client = await getClient();
  try {
    await client.query('begin');
    // Validate balance with PostgreSQL NUMERIC, not JavaScript Float64.
    const balanceCheck = await client.query(`
      select (coalesce(sum((x->>'debit')::numeric),0) - coalesce(sum((x->>'credit')::numeric),0))::numeric as difference
      from jsonb_array_elements($1::jsonb) x
    `, [JSON.stringify(body.lines)]);
    const difference = String(balanceCheck.rows[0]?.difference ?? '0');
    if (difference !== '0' && !/^[-+]?0+(?:\.0+)?$/.test(difference)) throw new AppError(422, `Manual journal lines are not balanced. Difference: ${difference}`);
    const currencyCheck = await client.query(`
      select count(distinct (x->>'currency_id')::bigint)::int as currency_count
      from jsonb_array_elements($1::jsonb) x
    `, [JSON.stringify(body.lines)]);
    if (Number(currencyCheck.rows[0]?.currency_count ?? 0) !== 1) throw new AppError(422, 'Manual journal must use exactly one currency; FX conversion journals require explicit converted lines in one posting currency');
    const entry = await client.query(`
      insert into manual_journal_entries
        (org_id, project_id, entry_date, description, reason_category, requested_by)
      values ($1,$2,coalesce($3::date,current_date),$4,$5,$6)
      returning *
    `, [orgId, body.project_id ?? null, body.entry_date ?? null, body.description, body.reason_category, userId]);
    for (const line of body.lines) {
      await client.query(`
        insert into manual_journal_entry_lines
          (org_id, journal_entry_id, account_id, debit, credit, currency_id, description)
        values ($1,$2,$3,$4,$5,$6,$7)
      `, [orgId, entry.rows[0].id, line.account_id, line.debit, line.credit, line.currency_id, line.description ?? null]);
    }
    await client.query('commit');
    res.status(201).json({ success: true, data: entry.rows[0] });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await releaseClient(client);
  }
}));

financeRouter.post('/manual-journals/:id/submit', authorize('finance', 'manage'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const client = await getClient();
  try {
    await client.query('begin');
    const entry = (await client.query(`select * from manual_journal_entries where id=$1 for update`, [id])).rows[0];
    if (!entry) throw new AppError(404, 'Manual journal not found');
    if (entry.status !== 'draft') throw new AppError(409, 'Manual journal must be draft before submission');
    const totals = (await client.query(`
      select coalesce(sum(debit),0)::numeric as debit, coalesce(sum(credit),0)::numeric as credit,
             (coalesce(sum(debit),0)=coalesce(sum(credit),0) and coalesce(sum(debit),0)>0) as valid,
             count(distinct currency_id)::int as currency_count, min(currency_id) as currency_id
      from manual_journal_entry_lines where journal_entry_id=$1`, [id])).rows[0];
    if (!totals.valid) throw new AppError(422, 'Manual journal must be balanced and greater than zero before approval');
    if (Number(totals.currency_count) !== 1) throw new AppError(422, 'Manual journal must contain exactly one currency before approval');
    const firstCurrency = totals.currency_id;
    const approval = await createApprovalInstance(client, {
      org_id: Number(entry.org_id), module: 'manual_journal_entry', record_id: Number(entry.id),
      amount: String(totals.debit), currency_id: firstCurrency === null ? null : Number(firstCurrency), initiated_by: Number(req.user!.id)
    });
    await client.query(`update manual_journal_entries set status='pending_approval', approval_instance_id=$2, updated_at=now() where id=$1`, [id, approval.id]);
    await client.query('commit');
    res.json({ success: true, data: { approval } });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await releaseClient(client);
  }
}));

financeRouter.post('/manual-journals/:id/approve', authorize('finance', 'approve'), asyncHandler(async (_req, _res) => {
  throw new AppError(409, 'Manual journal approval is handled by the central Approval Workflow');
}));

financeRouter.post('/manual-journals/:id/post-gl', authorize('finance', 'post'), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const client = await getClient();
  try {
    await client.query('begin');
    const result = await postManualJournalToGl(client, id);
    await client.query('commit');
    res.json({ success: true, data: result });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await releaseClient(client);
  }
}));

financeRouter.get('/cash-flow', asyncHandler(async (req, res) => {
  const orgId = Number(req.user!.org_id);
  const rows = await query(`
    select p.id as project_id, p.project_name,
           coalesce((select sum(ar.amount) from accounts_receivable ar where ar.project_id=p.id and ar.status <> 'paid'),0) as open_receivables,
           coalesce((select sum(ap.amount) from accounts_payable ap where ap.project_id=p.id and ap.status <> 'paid'),0) as open_payables,
           coalesce((select sum(ct.amount) from cost_transactions ct where ct.project_id=p.id and ct.transaction_type='committed'),0) as committed_cost,
           coalesce((select sum(ct.amount) from cost_transactions ct where ct.project_id=p.id and ct.transaction_type='actual'),0) as actual_cost
    from projects p
    where p.org_id = $1
    order by p.id
  `, [orgId]);
  res.json({ success: true, data: rows });
}));

financeRouter.get('/cost-summary', asyncHandler(async (req, res) => {
  const orgId = Number(req.user!.org_id);
  const rows = await query(`
    select p.project_name, ct.project_id, ct.cost_code_id, cc.code, cc.description,
           sum(case when ct.transaction_type = 'committed' then ct.amount else 0 end) as committed_cost,
           sum(case when ct.transaction_type = 'actual' then ct.amount else 0 end) as actual_cost,
           sum(case when ct.transaction_type = 'forecast' then ct.amount else 0 end) as forecast_cost,
           bool_or(ct.is_posted_to_gl) as has_gl_posted_rows
    from cost_transactions ct
    join projects p on p.id = ct.project_id
    left join cost_codes cc on cc.id = ct.cost_code_id
    where p.org_id = $1
    group by p.project_name, ct.project_id, ct.cost_code_id, cc.code, cc.description
    order by ct.project_id, cc.code
  `, [orgId]);
  res.json({ success: true, data: rows });
}));

financeRouter.get('/fiscal-periods',asyncHandler(async(_req,res)=>res.json({success:true,data:await query(`select * from fiscal_periods order by fiscal_year desc,period_no`)})));
financeRouter.post('/fiscal-periods',authorize('finance','manage'),asyncHandler(async(req,res)=>{const b=z.object({fiscal_year:z.number().int(),period_no:z.number().int().min(1).max(13),start_date:z.string(),end_date:z.string()}).parse(req.body);const [r]=await query(`insert into fiscal_periods(org_id,fiscal_year,period_no,start_date,end_date) values($1,$2,$3,$4,$5) returning *`,[req.user!.org_id,b.fiscal_year,b.period_no,b.start_date,b.end_date]);res.status(201).json({success:true,data:r});}));
// F-14 fix + reopen SoD (migration 045). Closing: finance.manage. Reopening a closed period: finance.approve,
// a different user from the closer, with a reason.
financeRouter.post('/fiscal-periods/:id/status',authorize('finance','manage'),asyncHandler(async(req,res)=>{
  const b=z.object({status:z.enum(['open','soft_closed','closed']),reason:z.string().trim().min(10).max(2000).optional()}).parse(req.body);
  const { id } = idParam.parse(req.params);
  const cur=(await query<any>(`select id,status,closed_by from fiscal_periods where id=$1`,[id]))[0];
  if(!cur)throw new AppError(404,'Fiscal period not found');
  if(cur.status===b.status)throw new AppError(409,`Fiscal period is already ${b.status}`);
  const reopening = cur.status==='closed';
  if(reopening){
    const granted: { module: string; action: string }[] = req.user!.permissions;
    if(!granted.some(g=>g.module==='finance'&&g.action==='approve'))throw new AppError(403,'Missing permission: finance.approve (reopening a closed period)');
    if(Number(cur.closed_by)===req.user!.id)throw new AppError(403,'Segregation of duties: the user who closed a period cannot reopen it');
    if(!b.reason)throw new AppError(422,'A reason is required to reopen a closed period');
  }
  const [r]=await query(`update fiscal_periods set status=$2::varchar,
      closed_by=case when $2::varchar='closed' then $3::bigint else closed_by end,
      closed_at=case when $2::varchar='closed' then now() else closed_at end,
      reopened_by=case when $4::boolean then $3::bigint else reopened_by end,
      reopened_at=case when $4::boolean then now() else reopened_at end,
      reopen_reason=case when $4::boolean then $5::text else reopen_reason end
    where id=$1 returning *`,[id,b.status,req.user!.id,reopening,b.reason??null]);
  res.json({success:true,data:r});
}));
financeRouter.get('/exchange-rates',asyncHandler(async(_req,res)=>res.json({success:true,data:await query(`select e.*,c.code currency_code from exchange_rates e join currencies c on c.id=e.currency_id order by rate_date desc,c.code limit 500`)})));
financeRouter.post('/exchange-rates',authorize('finance','manage'),asyncHandler(async(req,res)=>{const b=z.object({currency_id:z.number().int().positive(),rate_date:z.string(),rate_to_base:z.number().positive(),source:z.string().max(100).optional().nullable()}).parse(req.body);const [r]=await query(`insert into exchange_rates(org_id,currency_id,rate_date,rate_to_base,source) values($1,$2,$3,$4,$5) on conflict(org_id,currency_id,rate_date) do update set rate_to_base=excluded.rate_to_base,source=excluded.source returning *`,[req.user!.org_id,b.currency_id,b.rate_date,b.rate_to_base,b.source??null]);res.status(201).json({success:true,data:r});}));
