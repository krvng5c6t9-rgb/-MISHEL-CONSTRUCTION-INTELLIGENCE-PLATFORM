import type { PoolClient } from 'pg';
import { AppError } from '../middleware/errors.js';
import { postActualCostForVendorInvoice, postCommittedCostForPurchaseOrder } from './costPosting.service.js';

export type ApprovalModule = 'purchase_order' | 'vendor_invoice' | 'material_requisition' | 'comparative_statement' | 'tender_submission' | 'contract_signing' | 'variation' | 'ipc_submission' | 'manual_journal_entry' | 'payment' | 'subcontract_signing' | 'subcontract_certificate' | 'payroll_run' | 'equipment_usage';

async function getMatchingDoa(client: PoolClient, orgId: number, module: string, amount: number | string | null, currencyId: number | null, level: number) {
  const result = await client.query(`
    select d.*
    from delegation_of_authority d
    where d.org_id = $1
      and d.module = $2
      and d.approval_level = $3
      and d.is_active = true
      and d.is_confirmed = true
      and d.effective_from <= current_date
      and (d.effective_to is null or d.effective_to >= current_date)
      and (d.currency_id is null or d.currency_id = $5)
      and ($4::numeric is null or ($4 >= d.min_amount and (d.max_amount is null or $4 <= d.max_amount)))
    order by d.approval_level asc, d.min_amount asc
    limit 1
  `, [orgId, module, level, amount, currencyId]);
  return result.rows[0] ?? null;
}

async function nextApprovalLevel(client: PoolClient, orgId: number, module: string, amount: number | string | null, currencyId: number | null, currentLevel: number) {
  const result = await client.query(`
    select min(d.approval_level)::int as next_level
    from delegation_of_authority d
    where d.org_id = $1
      and d.module = $2
      and d.approval_level > $3
      and d.is_active = true
      and d.is_confirmed = true
      and d.effective_from <= current_date
      and (d.effective_to is null or d.effective_to >= current_date)
      and (d.currency_id is null or d.currency_id = $5)
      and ($4::numeric is null or ($4 >= d.min_amount and (d.max_amount is null or $4 <= d.max_amount)))
  `, [orgId, module, currentLevel, amount, currencyId]);
  return result.rows[0]?.next_level ?? null;
}

export async function createApprovalInstance(client: PoolClient, input: {
  org_id: number;
  module: ApprovalModule;
  record_id: number;
  amount: number | string | null;
  currency_id: number | null;
  initiated_by: number;
}) {
  const firstDoa = await getMatchingDoa(client, input.org_id, input.module, input.amount, input.currency_id, 1);
  if (!firstDoa) {
    throw new AppError(422, `No active DOA rule configured for ${input.module}`);
  }

  const existing = await client.query(`
    select * from approval_instances
    where org_id = $1 and module = $2 and record_id = $3 and status = 'pending'
    limit 1
  `, [input.org_id, input.module, input.record_id]);
  if (existing.rows[0]) return existing.rows[0];

  const created = await client.query(`
    insert into approval_instances
      (org_id, module, record_id, amount, currency_id, current_step, status, initiated_by)
    values ($1, $2, $3, $4, $5, 1, 'pending', $6)
    returning *
  `, [input.org_id, input.module, input.record_id, input.amount, input.currency_id, input.initiated_by]);
  return created.rows[0];
}

async function finalizeApprovedRecord(client: PoolClient, module: string, recordId: number) {
  if (module === 'purchase_order') {
    const updated = await client.query(`
      update purchase_orders
      set status = 'approved', updated_at = now()
      where id = $1 and status = 'draft'
      returning *
    `, [recordId]);
    if (!updated.rows[0]) throw new AppError(409, 'Purchase order is not in draft state');
    const cost_transaction = await postCommittedCostForPurchaseOrder(client, recordId);
    return { record: updated.rows[0], cost_transaction };
  }

  if (module === 'vendor_invoice') {
    const updated = await client.query(`
      update vendor_invoices
      set status = 'approved', updated_at = now()
      where id = $1 and status = 'matched'
      returning *
    `, [recordId]);
    if (!updated.rows[0]) throw new AppError(409, 'Vendor invoice is not matched');
    const cost_transaction = await postActualCostForVendorInvoice(client, recordId);
    return { record: updated.rows[0], cost_transaction };
  }

  if (module === 'material_requisition') {
    const updated = await client.query(`
      update material_requisitions
      set status = 'approved', updated_at = now()
      where id = $1 and status = 'draft'
      returning *
    `, [recordId]);
    if (!updated.rows[0]) throw new AppError(409, 'Material requisition is not in draft state');
    return { record: updated.rows[0] };
  }

  if (module === 'comparative_statement') {
    const updated = await client.query(`
      update comparative_statements
      set status = 'approved', updated_at = now()
      where id = $1 and status in ('draft','submitted')
      returning *
    `, [recordId]);
    if (!updated.rows[0]) throw new AppError(409, 'Comparative statement is not awaiting approval');
    return { record: updated.rows[0] };
  }

  if (module === 'tender_submission') {
    const updated = await client.query(`
      update tenders
      set status = 'submitted', updated_at = now()
      where id = $1 and status = 'in_progress'
      returning *
    `, [recordId]);
    if (!updated.rows[0]) throw new AppError(409, 'Tender is not in progress');
    return { record: updated.rows[0] };
  }

  if (module === 'contract_signing') {
    const updated = await client.query(`
      update contracts
      set contract_status = 'signed', signing_date = coalesce(signing_date, current_date), updated_at = now()
      where id = $1 and contract_status = 'under_review'
      returning *
    `, [recordId]);
    if (!updated.rows[0]) throw new AppError(409, 'Contract is not under review');
    return { record: updated.rows[0] };
  }

  if (module === 'variation') {
    const updated = await client.query(`
      update variations
      set status = 'approved', updated_at = now()
      where id = $1 and status = 'under_review'
      returning *
    `, [recordId]);
    if (!updated.rows[0]) throw new AppError(409, 'Variation is not under review');
    return { record: updated.rows[0] };
  }

  if (module === 'subcontract_signing') {
    const updated = await client.query(`
      update subcontracts set status = 'active', updated_at = now()
      where id = $1 and status = 'draft' returning *
    `, [recordId]);
    if (!updated.rows[0]) throw new AppError(409, 'Subcontract is not in draft state');
    return { record: updated.rows[0] };
  }

  if (module === 'subcontract_certificate') {
    const cert = (await client.query(`
      select sc.*, s.cost_code_id, s.currency_id, s.vendor_id, s.org_id as sc_org_id, (sc.less_retention > 0) as has_retention
      from subcontract_certificates sc
      join subcontracts s on s.id = sc.subcontract_id
      where sc.id = $1 for update
    `, [recordId])).rows[0];
    if (!cert) throw new AppError(404, 'Subcontract certificate not found');
    if (cert.status !== 'qs_certified') throw new AppError(409, 'Subcontract certificate is not QS-certified');
    // DEC-016 (migration 078): approval applies the subcontract's confirmed input tax code; the payable = net + input tax.
    const due = (await client.query(`update subcontract_certificates set status='approved', updated_at=now() where id=$1
      returning (net_amount_due + coalesce(input_tax_amount, 0))::text as payable, (net_amount_due + coalesce(input_tax_amount, 0) > 0) as has_payable`, [recordId])).rows[0];
    if (!cert.cost_code_id) throw new AppError(422, 'Subcontract requires cost_code_id before cost posting');
    const existing = (await client.query(`select id from cost_transactions where source_module='subcontract' and source_table='subcontract_certificates' and source_record_id=$1`, [recordId])).rows[0];
    if (existing) throw new AppError(409, 'Subcontract certificate already has a cost transaction');
    const posted = (await client.query(`
      insert into cost_transactions
        (project_id,cost_code_id,source_module,source_table,source_record_id,transaction_type,amount,currency_id,transaction_date,description)
      values ($1,$2,'subcontract','subcontract_certificates',$3,'actual',$4,$5,current_date,$6)
      returning *
    `, [cert.project_id, cert.cost_code_id, cert.id, cert.gross_work_done, cert.currency_id, `Actual subcontract cost (gross) from certificate ${cert.certificate_no}`])).rows[0];
    // DEC-012 (migration 077): cost at gross; the subcontractor's payable is the net amount due; retention withheld is a
    // liability held until released. Advance recovery and back-charges are credited in the GL posting of the cost.
    const payable = due.has_payable ? (await client.query(`
      insert into accounts_payable (org_id, vendor_id, project_id, source_type, source_record_id, amount, currency_id)
      values ($1,$2,$3,'subcontract_certificate',$4,$5,$6) returning *
    `, [cert.sc_org_id, cert.vendor_id, cert.project_id, cert.id, due.payable, cert.currency_id])).rows[0] : null;
    const retention = cert.has_retention ? (await client.query(`
      insert into subcontract_retentions (org_id, subcontract_id, certificate_id, amount) values ($1,$2,$3,$4) returning *
    `, [cert.sc_org_id, cert.subcontract_id, cert.id, cert.less_retention])).rows[0] : null;
    const updated = (await client.query(`update subcontract_certificates set status='posted', posted_cost_transaction_id=$2, updated_at=now() where id=$1 returning *`, [recordId, posted.id])).rows[0];
    return { record: updated, cost_transaction: posted, accounts_payable: payable, retention };
  }

  if (module === 'ipc_submission') {
    const updated = await client.query(`
      update ipcs
      set status = 'submitted_to_client', submitted_date = current_date, updated_at = now()
      where id = $1 and status = 'draft'
      returning *
    `, [recordId]);
    if (!updated.rows[0]) throw new AppError(409, 'IPC is not in draft state');
    return { record: updated.rows[0] };
  }

  if (module === 'manual_journal_entry') {
    const updated = await client.query(`
      update manual_journal_entries
      set status = 'approved', updated_at = now()
      where id = $1 and status = 'pending_approval'
      returning *
    `, [recordId]);
    if (!updated.rows[0]) throw new AppError(409, 'Manual journal is not pending approval');
    return { record: updated.rows[0] };
  }

  if (module === 'payroll_run') {
    const updated = await client.query(`
      update payroll_runs
      set status = 'approved', updated_at = now()
      where id = $1 and status = 'pending_approval'
      returning *
    `, [recordId]);
    if (!updated.rows[0]) throw new AppError(409, 'Payroll run is not pending approval');
    return { record: updated.rows[0] };
  }

  if (module === 'equipment_usage') {
    const updated = await client.query(`
      update equipment_usage
      set status = 'approved'
      where id = $1 and status = 'draft'
      returning *
    `, [recordId]);
    if (!updated.rows[0]) throw new AppError(409, 'Equipment usage is not in draft state');
    return { record: updated.rows[0] };
  }

  if (module === 'payment') {
    const updated = await client.query(`
      update payments
      set status = 'approved', updated_at = now()
      where id = $1 and status = 'draft'
      returning *
    `, [recordId]);
    if (!updated.rows[0]) throw new AppError(409, 'Payment is not in draft state');
    return { record: updated.rows[0] };
  }

  return null;
}

// RK-003 / CC-027: a rejected or returned approval must release the business record. Before this, only the
// approval instance changed; records whose submit route moved them out of draft (contracts, variations, manual
// journals, payroll runs) were stranded in their under-review state with no way to correct or resubmit them.
// 'returned' = back to the editable state for correction and resubmission. 'rejected' = terminal where the record
// has a rejected state, otherwise back to the editable state (the rejection stays in approval_actions_log).
// approval_instance_id is cleared so that a resubmission starts a fresh instance; history is never deleted.
const releaseOnRejection: Record<string, { table: string; column: string; from: string[]; returned: string; rejected: string }> = {
  contract_signing: { table: 'contracts', column: 'contract_status', from: ['under_review'], returned: 'draft', rejected: 'draft' },
  variation: { table: 'variations', column: 'status', from: ['under_review'], returned: 'proposed', rejected: 'rejected' },
  manual_journal_entry: { table: 'manual_journal_entries', column: 'status', from: ['pending_approval'], returned: 'draft', rejected: 'rejected' },
  payroll_run: { table: 'payroll_runs', column: 'status', from: ['pending_approval'], returned: 'draft', rejected: 'draft' },
  comparative_statement: { table: 'comparative_statements', column: 'status', from: ['draft', 'submitted'], returned: 'draft', rejected: 'rejected' },
};
const clearInstanceOnly: Record<string, string> = {
  purchase_order: 'purchase_orders', vendor_invoice: 'vendor_invoices', material_requisition: 'material_requisitions',
  tender_submission: 'tenders', subcontract_signing: 'subcontracts', ipc_submission: 'ipcs', payment: 'payments', equipment_usage: 'equipment_usage',
};

async function releaseRejectedRecord(client: PoolClient, module: string, recordId: number, approvalId: number, action: 'rejected' | 'returned', actorId: number, reason: string) {
  if (module === 'subcontract_certificate') {
    // The certificate state machine has no direct qs_certified -> draft; both outcomes record a reasoned rejection,
    // from which the existing rejected -> draft rework path applies. Valuation stays frozen until then.
    const updated = await client.query(
      `update subcontract_certificates set status = 'rejected', rejection_reason = $3, rejected_by = $4, rejected_at = now(), approval_instance_id = null
       where id = $1 and approval_instance_id = $2 and status = 'qs_certified' returning *`,
      [recordId, approvalId, `${action}: ${reason}`, actorId]
    );
    return { record: updated.rows[0] ?? null };
  }
  const rule = releaseOnRejection[module];
  if (rule) {
    const target = action === 'returned' ? rule.returned : rule.rejected;
    const updated = await client.query(
      `update ${rule.table} set ${rule.column} = $3, approval_instance_id = null, updated_at = now()
       where id = $1 and approval_instance_id = $2 and ${rule.column} = any($4::text[]) returning *`,
      [recordId, approvalId, target, rule.from]
    );
    return { record: updated.rows[0] ?? null };
  }
  const table = clearInstanceOnly[module];
  if (table) {
    const hasUpdatedAt = table !== 'equipment_usage';
    const updated = await client.query(
      `update ${table} set approval_instance_id = null${hasUpdatedAt ? ', updated_at = now()' : ''} where id = $1 and approval_instance_id = $2 returning *`,
      [recordId, approvalId]
    );
    return { record: updated.rows[0] ?? null };
  }
  return null;
}

export async function actOnApproval(client: PoolClient, approvalId: number, input: {
  actor_user_id: number;
  actor_role_id: number;
  action: 'approved' | 'rejected' | 'returned';
  comment?: string | null;
}) {
  const instanceResult = await client.query('select * from approval_instances where id = $1 for update', [approvalId]);
  const instance = instanceResult.rows[0];
  if (!instance) throw new AppError(404, 'Approval instance not found');
  if (instance.status !== 'pending') throw new AppError(409, 'Approval instance is not pending');

  const doa = await getMatchingDoa(
    client,
    instance.org_id,
    instance.module,
    instance.amount === null ? null : String(instance.amount),
    instance.currency_id,
    instance.current_step
  );
  if (!doa) throw new AppError(422, `No active DOA approver configured for ${instance.module} step ${instance.current_step}`);
  if (Number(doa.approver_role_id) !== input.actor_role_id) {
    throw new AppError(403, 'Logged-in user role is not the configured approver for the current DOA step');
  }
  if (Number(instance.initiated_by) === input.actor_user_id) {
    throw new AppError(403, 'Segregation of duties: initiator cannot approve the same transaction');
  }
  const duplicateAction = await client.query(`
    select 1 from approval_actions_log
    where approval_instance_id=$1 and approver_id=$2 and action='approved'
    limit 1
  `, [approvalId, input.actor_user_id]);
  if (duplicateAction.rows[0]) throw new AppError(409, 'Segregation of duties: the same user cannot approve more than one step of the same transaction');

  await client.query(`
    insert into approval_actions_log (approval_instance_id, step_no, approver_id, action, comment)
    values ($1, $2, $3, $4, $5)
  `, [approvalId, instance.current_step, input.actor_user_id, input.action, input.comment ?? null]);

  if (input.action !== 'approved') {
    const updated = await client.query(`
      update approval_instances
      set status = $2, completed_at = now()
      where id = $1
      returning *
    `, [approvalId, input.action]);
    const finalization = await releaseRejectedRecord(client, instance.module, instance.record_id, approvalId, input.action, input.actor_user_id, input.comment ?? '');
    return { approval: updated.rows[0], finalization };
  }

  const nextLevel = await nextApprovalLevel(
    client,
    instance.org_id,
    instance.module,
    instance.amount === null ? null : String(instance.amount),
    instance.currency_id,
    instance.current_step
  );

  if (nextLevel) {
    const updated = await client.query(`
      update approval_instances
      set current_step = $2
      where id = $1
      returning *
    `, [approvalId, nextLevel]);
    return { approval: updated.rows[0], finalization: null };
  }

  const updated = await client.query(`
    update approval_instances
    set status = 'approved', completed_at = now()
    where id = $1
    returning *
  `, [approvalId]);
  const finalization = await finalizeApprovedRecord(client, instance.module, instance.record_id);
  return { approval: updated.rows[0], finalization };
}
