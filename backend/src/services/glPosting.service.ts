import type { PoolClient } from 'pg';
import { AppError } from '../middleware/errors.js';

async function getActiveRule(client: PoolClient, orgId: number, sourceModule: string, sourceSubtype: string | null) {
  const result = await client.query(`
    select *
    from gl_posting_rules
    where org_id = $1
      and source_module = $2
      and is_active = true
      and effective_from <= current_date
      and (effective_to is null or effective_to >= current_date)
      and (source_subtype is not distinct from $3::varchar or source_subtype is null)
    order by case when source_subtype is not null then 0 else 1 end, effective_from desc, id desc
    limit 1
  `, [orgId, sourceModule, sourceSubtype]);
  return result.rows[0] ?? null;
}

async function nextBatchId(client: PoolClient) {
  const result = await client.query(`select nextval('gl_journal_batch_seq')::bigint as batch_id`);
  return Number(result.rows[0].batch_id);
}

async function insertBalancedGlBatch(client: PoolClient, input: {
  org_id: number;
  project_id: number | null;
  debit_account_id: number;
  credit_account_id: number;
  amount: number | string;
  currency_id: number;
  transaction_date: string;
  source_module: 'cost_transaction' | 'ipc' | 'payment' | 'manual_journal' | 'payroll_overhead' | 'revenue_recognition' | 'retention_release';
  source_table: string;
  source_record_id: number;
  description: string;
}) {
  const amountCheck = await client.query(`select ($1::numeric > 0) as valid`, [input.amount]);
  if (!amountCheck.rows[0]?.valid) throw new AppError(422, 'GL posting amount must be greater than zero');
  if (input.debit_account_id === input.credit_account_id) {
    throw new AppError(422, 'Debit and credit accounts must be different');
  }

  const batchId = await nextBatchId(client);
  const debit = await client.query(`
    insert into general_ledger
      (org_id, project_id, account_id, transaction_date, debit, credit, currency_id,
       source_module, source_table, source_record_id, journal_batch_id, description)
    values ($1,$2,$3,$4,$5,0,$6,$7,$8,$9,$10,$11)
    returning *
  `, [input.org_id, input.project_id, input.debit_account_id, input.transaction_date, input.amount, input.currency_id,
      input.source_module, input.source_table, input.source_record_id, batchId, input.description]);

  const credit = await client.query(`
    insert into general_ledger
      (org_id, project_id, account_id, transaction_date, debit, credit, currency_id,
       source_module, source_table, source_record_id, journal_batch_id, description)
    values ($1,$2,$3,$4,0,$5,$6,$7,$8,$9,$10,$11)
    returning *
  `, [input.org_id, input.project_id, input.credit_account_id, input.transaction_date, input.amount, input.currency_id,
      input.source_module, input.source_table, input.source_record_id, batchId, input.description]);

  return { journal_batch_id: batchId, lines: [debit.rows[0], credit.rows[0]] };
}

export async function postCostTransactionToGl(client: PoolClient, costTransactionId: number) {
  const result = await client.query(`
    select ct.*, p.org_id
    from cost_transactions ct
    join projects p on p.id = ct.project_id
    where ct.id = $1
    for update
  `, [costTransactionId]);
  const ct = result.rows[0];
  if (!ct) throw new AppError(404, 'Cost transaction not found');
  if (ct.is_posted_to_gl) throw new AppError(409, 'Cost transaction already posted to GL');
  // CC-008: committed cost (PO commitment) is a budget-control figure, not an accounting
  // event. Both committed and actual rows share source_module 'procurement' and therefore
  // the same GL rule, so posting a commitment would double-count expense/AP once the
  // invoice's actual cost posts. Encumbrance accounting, if wanted, needs its own rule.
  if (ct.transaction_type !== 'actual') throw new AppError(422, `Only actual cost transactions post to GL (got ${ct.transaction_type})`);

  const rule = await getActiveRule(client, Number(ct.org_id), 'cost_transaction', ct.source_module ?? null);
  if (!rule) throw new AppError(422, `No active GL posting rule for cost_transaction / ${ct.source_module}`);

  // DEC-013: payroll cost is gross; the employee deductions part is credited to deductions payable, the rest to the
  // rule's credit account (net pay payable). Other sources post the full amount to the rule's credit account.
  let deductions = '0';
  let dedRule: any = null;
  if (ct.source_module === 'hr_payroll' && ct.source_table === 'payroll_lines') {
    const d = (await client.query(`select deductions::text as deductions, (deductions > 0) as has_deductions from payroll_lines where id = $1`, [ct.source_record_id])).rows[0];
    deductions = d?.deductions ?? '0';
    if (d?.has_deductions) {
      dedRule = await getActiveRule(client, Number(ct.org_id), 'cost_transaction', 'payroll_deductions');
      if (!dedRule || dedRule.source_subtype !== 'payroll_deductions') throw new AppError(422, 'No active GL posting rule for payroll deductions (cost_transaction / payroll_deductions)');
    }
  }
  // DEC-012 (migration 077): a subcontract certificate's gross cost is credited to the payable (net), retention payable,
  // the advance recovered (asset) and back-charges recovered (cost recovery) - each by its own rule when non-zero.
  const splits: { amount: string; rule: any; label: string }[] = [];
  if (ct.source_module === 'subcontract' && ct.source_table === 'subcontract_certificates') {
    const c = (await client.query(`select less_retention::text r, less_advance_recovery::text a, penalties_deductions::text b,
      (less_retention > 0) hr, (less_advance_recovery > 0) ha, (penalties_deductions > 0) hb from subcontract_certificates where id = $1`, [ct.source_record_id])).rows[0];
    for (const [has, amt, subtype, label] of [[c.hr, c.r, 'subcontract_retention', 'Retention payable'], [c.ha, c.a, 'subcontract_advance', 'Subcontract advance recovered'], [c.hb, c.b, 'subcontract_backcharge', 'Back-charges recovered']] as const) {
      if (!has) continue;
      const r = await getActiveRule(client, Number(ct.org_id), 'cost_transaction', subtype);
      if (!r || r.source_subtype !== subtype) throw new AppError(422, `No active GL posting rule for cost_transaction / ${subtype}`);
      splits.push({ amount: amt, rule: r, label });
    }
    deductions = (await client.query(`select (coalesce($1::numeric,0) + coalesce($2::numeric,0) + coalesce($3::numeric,0))::text as v`, [c.hr ? c.r : null, c.ha ? c.a : null, c.hb ? c.b : null])).rows[0].v;
  }
  const m = (await client.query(`select ($1::numeric - $2::numeric)::text as v, ($1::numeric - $2::numeric > 0) as positive`, [ct.amount, deductions])).rows[0];
  const main = m.v;
  const base = { org_id: Number(ct.org_id), project_id: Number(ct.project_id), currency_id: Number(ct.currency_id), transaction_date: ct.transaction_date,
    source_module: 'cost_transaction' as const, source_table: 'cost_transactions', source_record_id: Number(ct.id) };
  const batch = !m.positive && splits.length ? null : await insertBalancedGlBatch(client, {
    ...base,
    debit_account_id: Number(rule.debit_account_id),
    credit_account_id: Number(rule.credit_account_id),
    amount: main,
    description: `GL posting from cost transaction ${ct.id} (${ct.transaction_type})`
  });
  const deductionsBatch = dedRule ? await insertBalancedGlBatch(client, {
    ...base,
    debit_account_id: Number(rule.debit_account_id),
    credit_account_id: Number(dedRule.credit_account_id),
    amount: deductions,
    description: `Employee deductions payable from cost transaction ${ct.id}`
  }) : null;

  const splitBatches = [];
  for (const s of splits) {
    splitBatches.push(await insertBalancedGlBatch(client, { ...base, debit_account_id: Number(rule.debit_account_id), credit_account_id: Number(s.rule.credit_account_id),
      amount: s.amount, description: `${s.label} from cost transaction ${ct.id}` }));
  }
  // DEC-016 (migration 078): input tax applied at certificate approval is recoverable: Dr the tax code's account /
  // Cr the subcontractors payable, so the payable credit equals the certificate payable (net + input tax).
  if (ct.source_module === 'subcontract' && ct.source_table === 'subcontract_certificates') {
    const t = (await client.query(`select c.input_tax_amount::text amount, t.gl_account_id, t.code from subcontract_certificates c
      join tax_codes t on t.id = c.input_tax_code_id where c.id = $1 and c.input_tax_amount > 0`, [ct.source_record_id])).rows[0];
    if (t) splitBatches.push(await insertBalancedGlBatch(client, { ...base, debit_account_id: Number(t.gl_account_id), credit_account_id: Number(rule.credit_account_id),
      amount: t.amount, description: `Input tax ${t.code} on subcontract certificate (cost transaction ${ct.id})` }));
  }
  await client.query(`update cost_transactions set is_posted_to_gl = true where id = $1`, [ct.id]);
  if (splitBatches.length) return { ...(batch ?? {}), split_gl: splitBatches };
  return deductionsBatch ? { ...(batch ?? {}), deductions_gl: deductionsBatch } : batch;
}

export async function postApprovedIpcToArAndGl(client: PoolClient, ipcId: number) {
  const result = await client.query(`
    select i.*, c.client_id, p.org_id, p.currency_id as project_currency_id
    from ipcs i
    join contracts c on c.id = i.contract_id
    join projects p on p.id = i.project_id
    where i.id = $1
    for update
  `, [ipcId]);
  const ipc = result.rows[0];
  if (!ipc) throw new AppError(404, 'IPC not found');
  if (ipc.status !== 'client_approved') throw new AppError(409, 'Only client_approved IPC can be posted');
  if (ipc.posted_ar_id) throw new AppError(409, 'IPC already posted to AR/GL');

  // F-35 (migration 071): the receivable is the amount the client certified; IPCs approved before 071 have no
  // certified amount recorded and post at the submitted net (legacy).
  const legacy = ipc.client_certified_amount === null;
  // F-37 (migration 072): due date from the confirmed contract payment terms; NULL when none are recorded.
  const dueDate = (await client.query(`select ipc_payment_due_date($1) as d`, [ipc.id])).rows[0].d;
  const amount = String(legacy ? ipc.net_amount_due : ipc.client_certified_amount);
  // DEC-016 (migration 074): output tax computed at certification; the receivable includes it.
  const tax = Number(ipc.output_tax_amount ?? 0);
  const receivable = (await client.query(`select ($1::numeric + $2::numeric)::text as v`, [amount, String(ipc.output_tax_amount ?? 0)])).rows[0].v;
  const rule = await getActiveRule(client, Number(ipc.org_id), 'ipc', null);
  if (!rule) throw new AppError(422, 'No active GL posting rule for IPC');

  const ar = await client.query(`
    insert into accounts_receivable
      (org_id, client_id, project_id, ipc_id, amount, currency_id, due_date)
    values ($1,$2,$3,$4,$5,$6,$7)
    returning *
  `, [ipc.org_id, ipc.client_id, ipc.project_id, ipc.id, receivable, ipc.project_currency_id, dueDate]);

  const batch = await insertBalancedGlBatch(client, {
    org_id: Number(ipc.org_id),
    project_id: Number(ipc.project_id),
    debit_account_id: Number(rule.debit_account_id),
    credit_account_id: Number(rule.credit_account_id),
    amount,
    currency_id: Number(ipc.project_currency_id),
    transaction_date: ipc.client_approved_date ?? new Date().toISOString().slice(0, 10),
    source_module: 'ipc',
    source_table: 'ipcs',
    source_record_id: Number(ipc.id),
    description: `AR/GL posting from IPC ${ipc.ipc_no}`
  });

  // DEC-009 (migration 079): the IPC is a billing. The period billing (gross) is credited to the IPC rule account
  // (contract billings); besides the receivable (certified net), the retention kept by the client is a conditional
  // contract asset and the advance recovered reduces the client advances liability - each by its own rule when non-zero.
  const parts = (await client.query(`select coalesce(client_certified_retention, less_retention)::text r, coalesce(client_certified_advance_recovery, less_advance_recovery)::text a,
    (coalesce(client_certified_retention, less_retention) > 0) hr, (coalesce(client_certified_advance_recovery, less_advance_recovery) > 0) ha from ipcs where id = $1`, [ipc.id])).rows[0];
  const billingSplits = [];
  for (const [has, amt, subtype, label] of [[parts.hr, parts.r, 'retention_receivable', 'Retention kept by client'], [parts.ha, parts.a, 'client_advance', 'Client advance recovered']] as const) {
    if (!has) continue;
    const r = await getActiveRule(client, Number(ipc.org_id), 'ipc', subtype);
    if (!r || r.source_subtype !== subtype) throw new AppError(422, `No active GL posting rule for ipc / ${subtype}`);
    billingSplits.push(await insertBalancedGlBatch(client, {
      org_id: Number(ipc.org_id), project_id: Number(ipc.project_id),
      debit_account_id: Number(r.debit_account_id), credit_account_id: Number(rule.credit_account_id),
      amount: amt, currency_id: Number(ipc.project_currency_id),
      transaction_date: ipc.client_approved_date ?? new Date().toISOString().slice(0, 10),
      source_module: 'ipc', source_table: 'ipcs', source_record_id: Number(ipc.id),
      description: `${label} on IPC ${ipc.ipc_no}`
    }));
  }

  let taxBatch = null;
  if (tax > 0) {
    const tc = (await client.query(`select code, gl_account_id from tax_codes where id = $1`, [ipc.output_tax_code_id])).rows[0];
    taxBatch = await insertBalancedGlBatch(client, {
      org_id: Number(ipc.org_id), project_id: Number(ipc.project_id),
      debit_account_id: Number(rule.debit_account_id), credit_account_id: Number(tc.gl_account_id),
      amount: String(ipc.output_tax_amount), currency_id: Number(ipc.project_currency_id),
      transaction_date: ipc.client_approved_date ?? new Date().toISOString().slice(0, 10),
      source_module: 'ipc', source_table: 'ipcs', source_record_id: Number(ipc.id),
      description: `Output tax ${tc.code} on IPC ${ipc.ipc_no}`
    });
  }
  await client.query(`update ipcs set status = 'posted', posted_ar_id = $2, updated_at = now() where id = $1`, [ipc.id, ar.rows[0].id]);
  if (Number(ipc.client_certified_retention ?? ipc.less_retention) > 0) {
    await client.query(`
      insert into retention_ledger (org_id, project_id, ipc_id, retained_amount, release_type)
      values ($1,$2,$3,$4,'other')
    `, [ipc.org_id, ipc.project_id, ipc.id, ipc.client_certified_retention ?? ipc.less_retention]);
  }
  return { accounts_receivable: ar.rows[0], gl: batch, basis: legacy ? 'submitted_net_legacy' : 'client_certified', due_date_basis: dueDate ? 'contract_payment_terms' : 'no_confirmed_payment_terms',
    tax_treatment: ipc.tax_treatment ?? 'legacy_no_tax', tax_gl: taxBatch, billing_gl: billingSplits };
}

export async function postApprovedPaymentToGl(client: PoolClient, paymentId: number) {
  const result = await client.query(`
    select * from payments where id = $1 for update
  `, [paymentId]);
  const payment = result.rows[0];
  if (!payment) throw new AppError(404, 'Payment not found');
  if (payment.status !== 'approved') throw new AppError(409, 'Only approved payment can be posted');

  const existing = await client.query(`
    select id from general_ledger where source_module='payment' and source_table='payments' and source_record_id=$1 limit 1
  `, [paymentId]);
  if (existing.rows[0]) throw new AppError(409, 'Payment already posted to GL');

  const rule = await getActiveRule(client, Number(payment.org_id), 'payment', payment.payment_type);
  if (!rule) throw new AppError(422, `No active GL posting rule for payment / ${payment.payment_type}`);

  // F-44 (migration 078): a payment clears the account its payable was credited to. Subcontract payables were credited
  // by the subcontract cost rules (payable, retention payable); an advance payable carries no GL of its own, so paying
  // it debits the advance asset (the account certificate recoveries credit). Vendor invoices keep the payment rule.
  let debitAccount = Number(rule.debit_account_id);
  let creditAccount = Number(rule.credit_account_id);
  // DEC-009 (migrations 079/080): a receipt clears the account its receivable was debited to - an advance request carries
  // no GL of its own, so the receipt credits the client advances liability. Released retention is reclassified to
  // receivables at release (080), so its receipt credits receivables like an IPC receivable.
  if (payment.payment_type === 'incoming' && payment.related_ar_id) {
    const ar = (await client.query(`select source_type from accounts_receivable where id = $1`, [payment.related_ar_id])).rows[0];
    const subtype = ({ client_advance: 'client_advance' } as Record<string, string>)[ar?.source_type];
    if (subtype) {
      const r = await getActiveRule(client, Number(payment.org_id), 'ipc', subtype);
      if (!r || r.source_subtype !== subtype) throw new AppError(422, `No active GL posting rule for ipc / ${subtype} (account cleared by this receipt)`);
      creditAccount = Number(r.debit_account_id);
    }
  }
  if (payment.payment_type === 'outgoing' && payment.related_ap_id) {
    const ap = (await client.query(`select source_type from accounts_payable where id = $1`, [payment.related_ap_id])).rows[0];
    const subtype = ({ subcontract_certificate: 'subcontract', subcontract_retention: 'subcontract_retention', subcontract_advance: 'subcontract_advance' } as Record<string, string>)[ap?.source_type];
    if (subtype) {
      const r = await getActiveRule(client, Number(payment.org_id), 'cost_transaction', subtype);
      if (!r || r.source_subtype !== subtype) throw new AppError(422, `No active GL posting rule for cost_transaction / ${subtype} (account cleared by this payment)`);
      debitAccount = Number(r.credit_account_id);
    }
  }
  const batch = await insertBalancedGlBatch(client, {
    org_id: Number(payment.org_id),
    project_id: null,
    debit_account_id: debitAccount,
    credit_account_id: creditAccount,
    amount: String(payment.amount),
    currency_id: Number(payment.currency_id),
    transaction_date: payment.payment_date,
    source_module: 'payment',
    source_table: 'payments',
    source_record_id: Number(payment.id),
    description: `GL posting from ${payment.payment_type} payment ${payment.reference_no ?? payment.id}`
  });

  // DEC-017 (migrations 074/078): tax withheld by the client settles the receivable as a tax credit asset; tax we
  // withhold from a subcontractor settles the payable against the withholding liability.
  let withholdingBatch = null;
  if (payment.withheld_tax_amount !== null && (await client.query(`select $1::numeric > 0 as yes`, [payment.withheld_tax_amount])).rows[0].yes) {
    const tc = (await client.query(`select code, gl_account_id from tax_codes where id = $1`, [payment.withholding_tax_code_id])).rows[0];
    const incoming = payment.payment_type === 'incoming';
    withholdingBatch = await insertBalancedGlBatch(client, {
      org_id: Number(payment.org_id), project_id: null,
      debit_account_id: incoming ? Number(tc.gl_account_id) : debitAccount, credit_account_id: incoming ? creditAccount : Number(tc.gl_account_id),
      amount: String(payment.withheld_tax_amount), currency_id: Number(payment.currency_id), transaction_date: payment.payment_date,
      source_module: 'payment', source_table: 'payments', source_record_id: Number(payment.id),
      description: incoming ? `Tax withheld by client ${tc.code} (certificate ${payment.withholding_certificate_ref})` : `Tax withheld from subcontractor ${tc.code} (notice ${payment.withholding_certificate_ref})`
    });
  }
  await client.query(`update payments set status = 'posted', updated_at = now() where id = $1`, [payment.id]);
  // Stage 25 (migration 073): the receivable/payable status (partially_paid / paid) and the IPC 'paid' state follow the
  // sum actually settled, set by trg_payment_settlement_status; a posting no longer marks them paid unconditionally.
  return { ...batch, withholding_gl: withholdingBatch };
}

export async function postManualJournalToGl(client: PoolClient, journalEntryId: number) {
  const entryResult = await client.query(`select * from manual_journal_entries where id=$1 for update`, [journalEntryId]);
  const entry = entryResult.rows[0];
  if (!entry) throw new AppError(404, 'Manual journal entry not found');
  if (entry.status !== 'approved') throw new AppError(409, 'Only approved manual journal entry can be posted');
  if (entry.posted_journal_batch_id) throw new AppError(409, 'Manual journal entry already posted');

  const lines = await client.query(`select * from manual_journal_entry_lines where journal_entry_id=$1 order by id`, [journalEntryId]);
  if (lines.rows.length < 2) throw new AppError(422, 'Manual journal entry must have at least two lines');
  // Financial balancing is evaluated by PostgreSQL NUMERIC, never JavaScript Float64.
  const balanceResult = await client.query(`
    select coalesce(sum(debit),0)::numeric - coalesce(sum(credit),0)::numeric as difference
    from manual_journal_entry_lines where journal_entry_id=$1
  `, [journalEntryId]);
  const balance = String(balanceResult.rows[0]?.difference ?? '0');
  if (balance !== '0' && !/^[-+]?0+(?:\.0+)?$/.test(balance)) {
    throw new AppError(422, `Manual journal entry is not balanced. Difference: ${balance}`);
  }

  const batchId = await nextBatchId(client);
  const inserted = [];
  for (const line of lines.rows) {
    const row = await client.query(`
      insert into general_ledger
        (org_id, project_id, account_id, transaction_date, debit, credit, currency_id,
         source_module, source_table, source_record_id, journal_batch_id, description)
      values ($1,$2,$3,$4,$5,$6,$7,'manual_journal','manual_journal_entries',$8,$9,$10)
      returning *
    `, [entry.org_id, entry.project_id, line.account_id, entry.entry_date, line.debit, line.credit, line.currency_id, entry.id, batchId, line.description ?? entry.description]);
    inserted.push(row.rows[0]);
  }
  await client.query(`update manual_journal_entries set status='posted', posted_journal_batch_id=$2, posted_at=now(), updated_at=now() where id=$1`, [entry.id, batchId]);
  return { journal_batch_id: batchId, lines: inserted };
}

// DEC-009 (migration 080): released client retention becomes an unconditional receivable - Dr receivables (IPC rule
// debit account) / Cr retention receivable (ipc / retention_receivable rule debit account).
export async function postRetentionReleaseToGl(client: PoolClient, retentionId: number) {
  const r = (await client.query(`select r.*, p.currency_id from retention_ledger r join projects p on p.id = r.project_id where r.id = $1 for update of r`, [retentionId])).rows[0];
  if (!r) throw new AppError(404, 'Retention not found');
  const ipcRule = await getActiveRule(client, Number(r.org_id), 'ipc', null);
  const retRule = await getActiveRule(client, Number(r.org_id), 'ipc', 'retention_receivable');
  if (!ipcRule || !retRule || retRule.source_subtype !== 'retention_receivable') throw new AppError(422, 'No active GL posting rules for ipc and ipc / retention_receivable');
  const batch = await insertBalancedGlBatch(client, {
    org_id: Number(r.org_id), project_id: Number(r.project_id),
    debit_account_id: Number(ipcRule.debit_account_id), credit_account_id: Number(retRule.debit_account_id),
    amount: String(r.retained_amount), currency_id: Number(r.currency_id), transaction_date: new Date().toISOString().slice(0, 10),
    source_module: 'retention_release', source_table: 'retention_ledger', source_record_id: Number(r.id),
    description: `Retention released (${r.release_reference}) reclassified to receivables`
  });
  await client.query(`update retention_ledger set release_gl_batch_id = $2 where id = $1`, [r.id, batch.journal_batch_id]);
  return batch;
}

// DEC-009 (migration 080): approving a revenue run posts its period movements on the period end - revenue against the
// billings account (rule revenue_recognition) and the onerous provision movement (rule revenue_recognition /
// onerous_provision). A negative movement reverses the sides. The database computed every figure at preparation.
export async function postRevenueRunToGl(client: PoolClient, runId: number) {
  const run = (await client.query(`select r.*, k.currency_id, to_char(r.period_end, 'YYYY-MM-DD') as period_end_text,
      abs(period_revenue)::text as rev_abs, (period_revenue > 0) as rev_up, (period_revenue <> 0) as has_rev,
      abs(period_loss_provision)::text as loss_abs, (period_loss_provision > 0) as loss_up, (period_loss_provision <> 0) as has_loss
    from revenue_recognition_runs r join contracts k on k.id = r.contract_id where r.id = $1 for update of r`, [runId])).rows[0];
  if (!run) throw new AppError(404, 'Revenue run not found');
  if (run.status !== 'prepared') throw new AppError(409, 'Only a prepared revenue run can be approved');
  const base = { org_id: Number(run.org_id), project_id: Number(run.project_id), currency_id: Number(run.currency_id), transaction_date: run.period_end_text,
    source_module: 'revenue_recognition' as const, source_table: 'revenue_recognition_runs', source_record_id: Number(run.id) };
  const batches = [];
  if (run.has_rev) {
    const rule = await getActiveRule(client, Number(run.org_id), 'revenue_recognition', null);
    if (!rule) throw new AppError(422, 'No active GL posting rule for revenue_recognition (Dr contract billings / Cr revenue)');
    const [d, c] = run.rev_up ? [rule.debit_account_id, rule.credit_account_id] : [rule.credit_account_id, rule.debit_account_id];
    batches.push(await insertBalancedGlBatch(client, { ...base, debit_account_id: Number(d), credit_account_id: Number(c), amount: run.rev_abs,
      description: `Revenue recognised ${run.rev_up ? '' : '(reversal) '}for contract ${run.contract_id}, period ending ${run.period_end_text}` }));
  }
  if (run.has_loss) {
    const rule = await getActiveRule(client, Number(run.org_id), 'revenue_recognition', 'onerous_provision');
    if (!rule || rule.source_subtype !== 'onerous_provision') throw new AppError(422, 'No active GL posting rule for revenue_recognition / onerous_provision');
    const [d, c] = run.loss_up ? [rule.debit_account_id, rule.credit_account_id] : [rule.credit_account_id, rule.debit_account_id];
    batches.push(await insertBalancedGlBatch(client, { ...base, debit_account_id: Number(d), credit_account_id: Number(c), amount: run.loss_abs,
      description: `Onerous contract provision ${run.loss_up ? 'recognised' : 'released'} for contract ${run.contract_id}, period ending ${run.period_end_text}` }));
  }
  return batches;
}
