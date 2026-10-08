// NDC-011 remainder (CC-035): approved budgets, cost-control summary per project, reproducible cost snapshots
// (ledger-captured inputs, derived accrual, EAC = actual + accrual + ETC), reconciliation listing back-dated postings.
// Uses the chain project (P-TAG) costs and the plant fixtures of sweep_assets. Budgets are TEST FIXTURES.
import { ADMIN, ADMIN_B, TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const day = (o) => new Date(Date.now() + o * 86400000).toISOString().slice(0, 10);
const q1 = (text) => { const r = sql(OWNER, text); return r.out.trim().split('\n').filter(Boolean).pop(); };
try {
  const admin = await login(ADMIN);
  const mkRole = async (name, perms) => must(await api('POST', '/roles', admin, { role_name: `${name} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), `role ${name}`).id;
  const mkUser = async (key, role_id) => {
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    must(await api('POST', '/users', admin, { role_id, full_name: `CO ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return login(u);
  };
  const cc = await mkRole('Cost Control', [['cost_control', 'view'], ['cost_control', 'manage'], ['cost_control', 'approve']]);
  const QS = await mkUser('coqs', cc), CM = await mkUser('cocm', cc);
  const asa = await login({ email: `asa.${TAG}@test.local`, password: 'Passw0rd!asa', org_id: 1 });
  const asb = await login({ email: `asb.${TAG}@test.local`, password: 'Passw0rd!asb', org_id: 1 });
  const proj = must(await api('GET', '/projects', admin), 'projects');
  const P = (Array.isArray(proj) ? proj : proj.projects ?? []).find(p => p.project_code === `P-${TAG}`).id;
  const CODE = 2;
  const truth = (type) => q1(`select coalesce(sum(amount),0)::numeric(18,2) from cost_transactions where project_id=${P} and cost_code_id=${CODE} and transaction_type='${type}'`);
  const othersActual = q1(`select coalesce(sum(amount),0)::numeric(18,2) from cost_transactions where project_id<>${P} and cost_code_id=${CODE} and transaction_type='actual'`);

  // --- Budgets.
  const bud = await run('QS prepares original budget 50,000', async () => must(await api('POST', '/cost-transactions/budgets', QS, { project_id: P, cost_code_id: CODE, budget_type: 'original', amount: 50000 }), 'budget'));
  await expectStatus('preparer cannot approve own budget', () => api('POST', `/cost-transactions/budgets/${bud.id}/approve`, QS), 422);
  await run('cost manager approves budget', async () => must(await api('POST', `/cost-transactions/budgets/${bud.id}/approve`, CM), 'approve budget'));

  // --- Cost-control summary: this project only, global cost code included.
  const sum = must(await api('GET', `/cost-transactions/control-summary?project_id=${P}`, CM), 'summary');
  const row = sum.find(r => Number(r.cost_code_id) === CODE);
  check('summary lists the global cost code for this project', !!row, JSON.stringify(sum).slice(0, 160));
  check('summary actual/committed equal this project ledger only (not other projects on the same code)', row && row.actual === truth('actual') && row.committed === truth('committed') && Number(othersActual) > 0, `row=${row?.actual}/${row?.committed} truth=${truth('actual')}/${truth('committed')} others=${othersActual}`);
  check('summary budget = approved 50,000', row && Number(row.budget) === 50000);

  // --- Reproducible snapshot.
  await expectStatus('manual ETC without a basis refused', () => api('POST', '/cost-transactions/snapshots', QS, { project_id: P, cost_code_id: CODE, as_of: day(-1), etc_method: 'manual', etc_amount: 1000 }), 400);
  const accrualTruth = q1(`select coalesce(sum(greatest(r.v-coalesce(i.v,0),0)),0)::numeric(18,2) from purchase_orders po
     join lateral (select sum(gl.quantity_accepted*pl.unit_rate) v from goods_receipt_notes g join grn_lines gl on gl.grn_id=g.id join po_lines pl on pl.id=gl.po_line_id where g.po_id=po.id and g.received_date<=current_date-1) r on true
     left join lateral (select sum(vi.amount) v from vendor_invoices vi where vi.po_id=po.id and vi.invoice_date<=current_date-1 and vi.status in ('approved','posted_to_gl','paid')) i on true
     where po.project_id=${P} and po.cost_code_id=${CODE} and r.v is not null`);
  const snap = await run('QS captures snapshot as of yesterday (ETC = budget remaining)', async () => must(await api('POST', '/cost-transactions/snapshots', QS, { project_id: P, cost_code_id: CODE, as_of: day(-1), etc_method: 'budget_remaining', budget: 1, actual: 1 }), 'snapshot'));
  const actualY = q1(`select coalesce(sum(amount),0)::numeric(18,2) from cost_transactions where project_id=${P} and cost_code_id=${CODE} and transaction_type='actual' and transaction_date<=current_date-1`);
  check('snapshot inputs captured from the ledger, not from the request', snap.actual === actualY && Number(snap.budget) === 50000 && snap.accrual === accrualTruth, `actual=${snap.actual}/${actualY} accrual=${snap.accrual}/${accrualTruth}`);
  const etcTruth = q1(`select greatest(50000-${snap.actual}-${snap.accrual},0)::numeric(18,2)`);
  check('EAC = actual + accrual + ETC(budget remaining)', snap.etc_amount === etcTruth && snap.eac === q1(`select (${snap.actual}+${snap.accrual}+${etcTruth})::numeric(18,2)`), `${snap.etc_amount} ${snap.eac}`);
  await expectStatus('preparer cannot approve own snapshot', () => api('POST', `/cost-transactions/snapshots/${snap.id}/approve`, QS), 422);
  await run('cost manager approves snapshot', async () => must(await api('POST', `/cost-transactions/snapshots/${snap.id}/approve`, CM), 'approve snap'));
  const rec0 = must(await api('GET', `/cost-transactions/snapshots/${snap.id}/reconcile`, CM), 'reconcile0');
  check('recompute from stored inputs: zero unexplained difference', rec0.unexplained === false && rec0.backdated_postings.length === 0, JSON.stringify(rec0.difference));

  // --- A posting back-dated into the snapshot period surfaces as unexplained variance.
  const ex = must(await api('POST', '/assets/equipment', asa, { asset_code: `EXC-${TAG}`, asset_name: 'Compactor (fixture)', ownership_type: 'rented' }), 'asset');
  must(await api('PATCH', `/assets/equipment/${ex.id}/status`, asa, { status: 'in_use', current_project_id: P }), 'mobilise');
  const u = must(await api('POST', '/assets/equipment-usage', asa, { asset_id: ex.id, project_id: P, usage_date: day(-2), hours_used: 2, cost_code_id: CODE, currency_id: 1, hourly_rate: 100 }), 'usage');
  const ap = must(await api('PATCH', `/assets/equipment-usage/${u.id}/approve`, asa), 'submit').approval;
  must(await api('POST', `/approvals/${ap.id}/actions`, asb, { action: 'approved', comment: 'ok' }), 'approve usage');
  must(await api('POST', `/assets/equipment-usage/${u.id}/post-cost`, asb), 'post');
  const rec1 = must(await api('GET', `/cost-transactions/snapshots/${snap.id}/reconcile`, CM), 'reconcile1');
  check('back-dated posting after approval is listed as unexplained (+200 actual)', rec1.unexplained === true && Number(rec1.difference.actual) === 200 && rec1.backdated_postings.length === 1, JSON.stringify(rec1.difference));

  if (OWNER) {
    const probe = (name, text) => { const r = sql(OWNER, text); check(name, !r.ok, r.out.split('\n').find(l => /ERROR/.test(l)) ?? r.out.slice(0, 120)); };
    probe('DB: approved snapshot immutable', `update cost_forecast_snapshots set etc_amount=0 where id=${snap.id}`);
    probe('DB: snapshots cannot be deleted', `delete from cost_forecast_snapshots where id=${snap.id}`);
    probe('DB: approved budget immutable', `update budgets set amount=1 where id=${bud.id}`);
  } else check('DB probes (OWNER_PSQL_URL required)', false);
  const tb = await login(ADMIN_B);
  await expectStatus('tenant B cannot reconcile tenant A snapshot', () => api('GET', `/cost-transactions/snapshots/${snap.id}/reconcile`, tb), 404);
  check('tenant B summary for tenant A project is empty', must(await api('GET', `/cost-transactions/control-summary?project_id=${P}`, tb), 'sumB').length === 0);
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('sweep_cost_eac');
