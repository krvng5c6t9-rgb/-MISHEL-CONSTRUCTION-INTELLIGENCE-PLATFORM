// Stage 27 / DEC-014: inventory at moving (weighted) average cost per store. Every outflow is valued by the database at
// the store's average of its moment; issue cost cannot be typed; receipts must carry cost; transfers carry the
// moving average; the valuation report agrees. Quantities and costs are TEST FIXTURES.
import { ADMIN, ADMIN_B, TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
try {
  const admin = await login(ADMIN);
  const role = must(await api('POST', '/roles', admin, { role_name: `IV All ${TAG}`, permissions: ['view', 'edit', 'manage', 'approve'].map(action => ({ module: 'procurement', action, scope: 'all' })) }), 'role').id;
  const mk = async (key) => {
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    must(await api('POST', '/users', admin, { role_id: role, full_name: `IV ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return login(u);
  };
  const S = await mk('ivs1');
  const project = must(await api('POST', '/projects', admin, { project_code: `IV-${TAG}`, project_name: `IV ${TAG}`, currency_id: 1 }), 'project').id;
  const w1 = must(await api('POST', '/inventory/warehouses', S, { project_id: project, code: `IVW1-${TAG}`, name: 'Valuation store 1' }), 'w1').id;
  const w2 = must(await api('POST', '/inventory/warehouses', S, { project_id: project, code: `IVW2-${TAG}`, name: 'Valuation store 2' }), 'w2').id;
  const item = must(await api('POST', '/inventory/items', S, { item_code: `IVC-${TAG}`, description: 'Cement bag (fixture)', unit_of_measure: 'bag', cost_code_id: 2 }), 'item').id;
  const empty = must(await api('POST', '/inventory/items', S, { item_code: `IVE-${TAG}`, description: 'Never received (fixture)', unit_of_measure: 'pc' }), 'empty').id;
  const tx = (body) => api('POST', '/inventory/transactions', S, { warehouse_id: w1, inventory_item_id: item, ...body });
  const val = async (w, it = item) => must(await api('GET', '/inventory/valuation', S), 'valuation').find(v => Number(v.warehouse_id) === w && Number(v.inventory_item_id) === it);

  must(await tx({ transaction_type: 'adjustment', quantity: 100, unit_cost: 10, reason: 'Opening count lot A (fixture)' }), 'in 100 @10');
  must(await tx({ transaction_type: 'adjustment', quantity: 100, unit_cost: 20, reason: 'Opening count lot B (fixture)' }), 'in 100 @20');
  check('moving average after 100 @10 and 100 @20 is 15', Number((await val(w1)).moving_average) === 15, JSON.stringify(await val(w1)));
  await expectStatus('an issue at a typed unit cost is refused', () => tx({ transaction_type: 'issue', quantity: -50, unit_cost: 99, project_id: project, cost_code_id: 2 }), 422);
  const issue = await run('issue of 50 without a cost', async () => must(await tx({ transaction_type: 'issue', quantity: -50, project_id: project, cost_code_id: 2 }), 'issue'));
  check('the issue is valued by the database at the moving average 15', Number(issue.unit_cost) === 15, String(issue.unit_cost));
  must(await tx({ transaction_type: 'adjustment', quantity: 50, unit_cost: 30, reason: 'Found stock lot C (fixture)' }), 'in 50 @30');
  const v = await val(w1);
  check('perpetual moving average (150 x 15 + 50 x 30) / 200 = 18.75 - not the inbound-only average 18.00', Number(v.quantity) === 200 && Number(v.moving_average) === 18.75 && Number(v.value) === 3750, JSON.stringify(v));

  const d = await run('transfer of 20 to store 2 dispatched', async () => must(await api('POST', '/inventory/transfer', S, { from_warehouse_id: w1, to_warehouse_id: w2, inventory_item_id: item, quantity: 20 }), 'dispatch'));
  check('the transfer carries the moving average 18.75 on its dispatch leg', Number(d.transfer.unit_cost) === 18.75 && Number(d.transfer_out.unit_cost) === 18.75, `${d.transfer?.unit_cost} / ${d.transfer_out?.unit_cost}`);
  const loss = must(await tx({ transaction_type: 'adjustment', quantity: -10, reason: 'Count loss - torn bags (fixture)' }), 'loss');
  check('a negative adjustment is valued at the moving average', Number(loss.unit_cost) === 18.75, String(loss.unit_cost));
  const gain = must(await tx({ transaction_type: 'adjustment', quantity: 5, reason: 'Count surplus (fixture)' }), 'gain');
  check('a positive adjustment without a stated cost takes the moving average', Number(gain.unit_cost) === 18.75, String(gain.unit_cost));
  const after = await val(w1);
  check('average unchanged by outflows and average-cost surplus: 175 bags at 18.75 = 3,281.25', Number(after.quantity) === 175 && Number(after.moving_average) === 18.75 && Number(after.value) === 3281.25, JSON.stringify(after));
  await expectStatus('a positive adjustment of an item with no valued stock needs a cost', () => tx({ inventory_item_id: empty, transaction_type: 'adjustment', quantity: 5, reason: 'Found item without price (fixture)' }), 422);

  if (OWNER) {
    const probe = (name, text) => { const r = sql(OWNER, text); check(name, !r.ok, r.out.split('\n').find(l => /ERROR/.test(l)) ?? r.out.slice(0, 120)); };
    probe('DB: a receipt without cost is refused', `insert into inventory_transactions(org_id, warehouse_id, inventory_item_id, transaction_type, quantity, transaction_date) values (1, ${w1}, ${item}, 'receipt', 10, current_date)`);
    const forced = sql(OWNER, `insert into inventory_transactions(org_id, warehouse_id, inventory_item_id, transaction_type, quantity, unit_cost, transaction_date, cost_code_id, project_id) values (1, ${w1}, ${item}, 'issue', -1, 1, current_date, 2, ${project}) returning unit_cost`);
    check('DB: an issue written directly with a made-up cost is valued at the average instead', forced.ok && /^18\.75/m.test(forced.out), forced.out.slice(0, 120));
  } else check('DB probes (OWNER_PSQL_URL required)', false);

  const tb = await login(ADMIN_B);
  const bVal = await api('GET', '/inventory/valuation', tb);
  check('tenant B valuation shows no tenant A stores', bVal.status === 403 || (bVal.ok && !bVal.body.data.some(x => String(x.warehouse_code ?? '').endsWith(TAG))), `HTTP ${bVal.status}`);
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('sweep_inventory_valuation');
