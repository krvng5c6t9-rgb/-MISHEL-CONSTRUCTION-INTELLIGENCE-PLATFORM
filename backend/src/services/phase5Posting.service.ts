import type { PoolClient } from 'pg';
import { AppError } from '../middleware/errors.js';

export async function postPayrollLineToCostTransaction(client: PoolClient, payrollLineId: number) {
  const result = await client.query(`
    select pl.*, pr.status as payroll_status
    from payroll_lines pl
    join payroll_runs pr on pr.id = pl.payroll_run_id
    where pl.id = $1
    for update
  `, [payrollLineId]);
  const line = result.rows[0];
  if (!line) throw new AppError(404, 'Payroll line not found');
  if (line.payroll_status !== 'approved') throw new AppError(409, 'Only approved payroll runs can be posted');
  if (!line.project_id) throw new AppError(422, 'This payroll line is overhead. Use payroll overhead GL posting instead.');
  if (!line.cost_code_id) throw new AppError(422, 'Project payroll line requires cost_code_id before cost posting');
  if (line.posted_cost_transaction_id) throw new AppError(409, 'Payroll line already posted to cost transactions');

  const inserted = await client.query(`
    insert into cost_transactions
      (project_id, cost_code_id, source_module, source_table, source_record_id,
       transaction_type, amount, currency_id, transaction_date, description)
    values ($1,$2,'hr_payroll','payroll_lines',$3,'actual',$4,$5,current_date,$6)
    returning *
  `, [line.project_id, line.cost_code_id, line.id, line.net_pay, line.currency_id, `Actual payroll cost from payroll line ${line.id}`]);

  await client.query(`update payroll_lines set posted_cost_transaction_id=$2 where id=$1`, [line.id, inserted.rows[0].id]);
  return inserted.rows[0];
}

export async function postEquipmentUsageToCostTransaction(client: PoolClient, equipmentUsageId: number) {
  const result = await client.query(`select * from equipment_usage where id=$1 for update`, [equipmentUsageId]);
  const usage = result.rows[0];
  if (!usage) throw new AppError(404, 'Equipment usage not found');
  if (usage.status !== 'approved') throw new AppError(409, 'Only approved equipment usage can be posted');
  if (!usage.cost_code_id) throw new AppError(422, 'Equipment usage requires cost_code_id before cost posting');
  if (usage.posted_cost_transaction_id) throw new AppError(409, 'Equipment usage already posted to cost transactions');

  const inserted = await client.query(`
    insert into cost_transactions
      (project_id, cost_code_id, source_module, source_table, source_record_id,
       transaction_type, amount, currency_id, transaction_date, description)
    values ($1,$2,'equipment','equipment_usage',$3,'actual',$4,$5,$6,$7)
    returning *
  `, [usage.project_id, usage.cost_code_id, usage.id, usage.cost_amount, usage.currency_id, usage.usage_date, `Actual equipment cost from equipment usage ${usage.id}`]);

  await client.query(`update equipment_usage set posted_cost_transaction_id=$2 where id=$1`, [usage.id, inserted.rows[0].id]);
  return inserted.rows[0];
}

async function nextBatchId(client: PoolClient) {
  const result = await client.query(`select nextval('gl_journal_batch_seq')::bigint as batch_id`);
  return Number(result.rows[0].batch_id);
}

export async function postPayrollOverheadToGl(client: PoolClient, payrollLineId: number) {
  const lineResult = await client.query(`
    select pl.*, pr.org_id, pr.status as payroll_status
    from payroll_lines pl
    join payroll_runs pr on pr.id = pl.payroll_run_id
    where pl.id=$1
    for update
  `, [payrollLineId]);
  const line = lineResult.rows[0];
  if (!line) throw new AppError(404, 'Payroll line not found');
  if (line.payroll_status !== 'approved') throw new AppError(409, 'Only approved payroll runs can be posted');
  if (line.project_id) throw new AppError(422, 'Project payroll posts through cost_transactions, not overhead GL');
  if (line.posted_gl_batch_id) throw new AppError(409, 'Payroll overhead line already posted to GL');

  const ruleResult = await client.query(`
    select * from gl_posting_rules
    where org_id=$1 and source_module='payroll_overhead' and is_active=true
      and effective_from <= current_date and (effective_to is null or effective_to >= current_date)
    order by effective_from desc, id desc
    limit 1
  `, [line.org_id]);
  const rule = ruleResult.rows[0];
  if (!rule) throw new AppError(422, 'No active GL posting rule for payroll_overhead');

  const amount = String(line.net_pay);
  const validAmount = (await client.query(`select ($1::numeric > 0) as ok`, [amount])).rows[0]?.ok === true;
  if (!validAmount) throw new AppError(422, 'Payroll overhead amount must be greater than zero');

  const batchId = await nextBatchId(client);
  const debit = await client.query(`
    insert into general_ledger
      (org_id, project_id, account_id, transaction_date, debit, credit, currency_id,
       source_module, source_table, source_record_id, journal_batch_id, description)
    values ($1,null,$2,current_date,$3,0,$4,'payroll_overhead','payroll_lines',$5,$6,$7)
    returning *
  `, [line.org_id, rule.debit_account_id, amount, line.currency_id, line.id, batchId, `Overhead payroll GL posting from payroll line ${line.id}`]);
  const credit = await client.query(`
    insert into general_ledger
      (org_id, project_id, account_id, transaction_date, debit, credit, currency_id,
       source_module, source_table, source_record_id, journal_batch_id, description)
    values ($1,null,$2,current_date,0,$3,$4,'payroll_overhead','payroll_lines',$5,$6,$7)
    returning *
  `, [line.org_id, rule.credit_account_id, amount, line.currency_id, line.id, batchId, `Overhead payroll GL posting from payroll line ${line.id}`]);

  await client.query(`update payroll_lines set posted_gl_batch_id=$2 where id=$1`, [line.id, batchId]);
  return { journal_batch_id: batchId, lines: [debit.rows[0], credit.rows[0]] };
}
