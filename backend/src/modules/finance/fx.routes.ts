import { Router } from 'express';
import { z } from 'zod';
import { query, getClient, releaseClient } from '../../db/pool.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authorize } from '../../middleware/authorize.js';
import { AppError } from '../../middleware/errors.js';

// CC-078 / DEC-022: exchange settings, monetary-account marking and period-end revaluation (migration 087).
// Revaluation (cumulative method, EAS 13): for each account marked fx_revalue and each foreign currency, the base
// balance as of the period end is brought to foreign balance x closing rate; the difference posts in the base currency
// against the company's exchange gain / loss accounts. This also clears the base residue of settlements made at another
// rate. Figures come from the ledger and the register only; nothing is accepted from the request but the date.
export const fxRouter = Router();
fxRouter.use(authorize('finance', 'view'));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

fxRouter.get('/fx-settings', asyncHandler(async (req, res) => {
  const [s] = await query(`select o.fx_gain_account_id, o.fx_loss_account_id, o.fx_max_rate_age_days, bc.code as base_currency_code
    from organizations o left join currencies bc on bc.id = o.base_currency_id where o.id = $1`, [req.user!.org_id]);
  res.json({ success: true, data: s });
}));

fxRouter.patch('/fx-settings', authorize('finance', 'manage'), asyncHandler(async (req, res) => {
  const b = z.object({ fx_gain_account_id: z.number().int().positive(), fx_loss_account_id: z.number().int().positive(), fx_max_rate_age_days: z.number().int().min(0).max(366) }).parse(req.body);
  const accts = await query<any>(`select id, account_type from chart_of_accounts where org_id = $1 and id in ($2, $3) and is_active`, [req.user!.org_id, b.fx_gain_account_id, b.fx_loss_account_id]);
  const type = (id: number) => accts.find(a => Number(a.id) === id)?.account_type;
  if (type(b.fx_gain_account_id) !== 'revenue') throw new AppError(422, 'The exchange gain account must be an active revenue account of the organization');
  if (type(b.fx_loss_account_id) !== 'expense') throw new AppError(422, 'The exchange loss account must be an active expense account of the organization');
  const [s] = await query(`update organizations set fx_gain_account_id = $2, fx_loss_account_id = $3, fx_max_rate_age_days = $4, updated_at = now() where id = $1
    returning fx_gain_account_id, fx_loss_account_id, fx_max_rate_age_days`, [req.user!.org_id, b.fx_gain_account_id, b.fx_loss_account_id, b.fx_max_rate_age_days]);
  res.json({ success: true, data: s });
}));

fxRouter.patch('/chart-of-accounts/:id/fx-revalue', authorize('finance', 'manage'), asyncHandler(async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const b = z.object({ fx_revalue: z.boolean() }).parse(req.body);
  const [a] = await query<any>(`select id, account_type from chart_of_accounts where id = $1 and org_id = $2`, [id, req.user!.org_id]);
  if (!a) throw new AppError(404, 'Account not found');
  if (b.fx_revalue && !['asset', 'liability'].includes(a.account_type)) throw new AppError(422, 'Only asset and liability accounts are monetary items that can be revalued');
  const [r] = await query(`update chart_of_accounts set fx_revalue = $2 where id = $1 returning id, account_code, fx_revalue`, [id, b.fx_revalue]);
  res.json({ success: true, data: r });
}));

fxRouter.get('/fx-revaluations', asyncHandler(async (req, res) => {
  const runs = await query(`select * from fx_revaluations where org_id = $1 order by period_end desc`, [req.user!.org_id]);
  const lines = await query(`select l.*, a.account_code, a.account_name, c.code as currency_code from fx_revaluation_lines l
    join chart_of_accounts a on a.id = l.account_id join currencies c on c.id = l.currency_id where l.org_id = $1 order by l.revaluation_id desc, a.account_code`, [req.user!.org_id]);
  res.json({ success: true, data: runs.map((r: any) => ({ ...r, lines: lines.filter((l: any) => Number(l.revaluation_id) === Number(r.id)) })) });
}));

fxRouter.post('/fx-revaluations', authorize('finance', 'post'), asyncHandler(async (req, res) => {
  const { period_end } = z.object({ period_end: isoDate }).parse(req.body);
  const orgId = Number(req.user!.org_id);
  const client = await getClient();
  try {
    await client.query('begin');
    const o = (await client.query(`select base_currency_id, fx_gain_account_id, fx_loss_account_id from organizations where id = $1 for update`, [orgId])).rows[0];
    if (!o?.fx_gain_account_id || !o?.fx_loss_account_id) throw new AppError(422, 'Set the exchange gain and loss accounts first (exchange settings)');
    const later = (await client.query(`select period_end from fx_revaluations where org_id = $1 and period_end >= $2::date order by period_end desc limit 1`, [orgId, period_end])).rows[0];
    if (later) throw new AppError(409, `An exchange revaluation already exists for ${String(later.period_end).slice(0, 10)}; revaluations follow one another in date order`);
    const run = (await client.query(`insert into fx_revaluations(org_id, period_end, created_by) values ($1, $2, $3) returning *`, [orgId, period_end, req.user!.id])).rows[0];
    const bal = (await client.query(`
      select g.account_id, x.cur_id as currency_id,
             sum(case when g.currency_id = x.cur_id then g.debit - g.credit else 0 end)::numeric(18,2) as foreign_balance,
             sum(g.debit_base - g.credit_base)::numeric(18,2) as base_before
        from general_ledger g
        join chart_of_accounts a on a.id = g.account_id and a.fx_revalue
       cross join lateral (select coalesce(g.fx_revalued_currency_id, g.currency_id) as cur_id) x
       where g.org_id = $1 and g.transaction_date <= $2::date and x.cur_id <> $3
       group by g.account_id, x.cur_id
       order by g.account_id, x.cur_id`, [orgId, period_end, o.base_currency_id])).rows;
    const lines = [];
    for (const b of bal) {
      const r = (await client.query(`select rate, rate_date from fx_rate_to_base($1, $2, $3::date)`, [orgId, b.currency_id, period_end])).rows[0];
      if (r?.rate == null) {
        const c = (await client.query(`select code from currencies where id = $1`, [b.currency_id])).rows[0];
        throw new AppError(422, `No exchange rate for ${c?.code} on or before ${period_end} - record the closing rate first`);
      }
      const v = (await client.query(`select round($1::numeric * $2::numeric, 2) as target, (round($1::numeric * $2::numeric, 2) - $3::numeric)::numeric(18,2) as adj`, [b.foreign_balance, r.rate, b.base_before])).rows[0];
      let batch: number | null = null;
      if (Number(v.adj) !== 0) {
        batch = Number((await client.query(`select nextval('gl_journal_batch_seq')::bigint as id`)).rows[0].id);
        const up = Number(v.adj) > 0;
        const amt = String((await client.query(`select abs($1::numeric)::numeric(18,2) as a`, [v.adj])).rows[0].a);
        const rows: [number, string, string, number | null][] = up
          ? [[Number(b.account_id), amt, '0', Number(b.currency_id)], [Number(o.fx_gain_account_id), '0', amt, null]]
          : [[Number(o.fx_loss_account_id), amt, '0', null], [Number(b.account_id), '0', amt, Number(b.currency_id)]];
        for (const [account, debit, credit, revalued] of rows) {
          await client.query(`insert into general_ledger(org_id, project_id, account_id, transaction_date, debit, credit, currency_id, source_module, source_table, source_record_id, journal_batch_id, description, fx_revalued_currency_id)
            values ($1, null, $2, $3::date, $4::numeric, $5::numeric, $6, 'fx_revaluation', 'fx_revaluations', $7, $8, $9, $10)`,
            [orgId, account, period_end, debit, credit, o.base_currency_id, run.id, batch, `Exchange revaluation ${period_end}`, revalued]);
        }
      }
      const line = (await client.query(`insert into fx_revaluation_lines(org_id, revaluation_id, account_id, currency_id, foreign_balance, closing_rate, rate_date, base_before, base_target, adjustment, gl_batch_id)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *`, [orgId, run.id, b.account_id, b.currency_id, b.foreign_balance, r.rate, r.rate_date, b.base_before, v.target, v.adj, batch])).rows[0];
      lines.push(line);
    }
    const posted = (await client.query(`update fx_revaluations set status = 'posted', posted_at = now() where id = $1 returning *`, [run.id])).rows[0];
    await client.query('commit');
    res.status(201).json({ success: true, data: { ...posted, lines } });
  } catch (e) { await client.query('rollback'); throw e; } finally { await releaseClient(client); }
}));
