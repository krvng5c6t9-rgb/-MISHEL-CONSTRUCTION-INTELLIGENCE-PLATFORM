// RK-003 sweep / inventory transfers, issues and adjustments: first runtime execution. Users hold all relevant
// permissions so that only integrity rules can stop them. Quantities and costs are TEST FIXTURES.
import { ADMIN, ADMIN_B, TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const day = (o) => new Date(Date.now() + o * 86400000).toISOString().slice(0, 10);
try {
  const admin = await login(ADMIN);
  const mkRole = async (name, perms) => must(await api('POST', '/roles', admin, { role_name: `${name} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), `role ${name}`).id;
  const mkUser = async (key, role_id) => {
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    must(await api('POST', '/users', admin, { role_id, full_name: `IN ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return login(u);
  };
  const clerk = await mkUser('inclerk', await mkRole('Store Clerk', [['procurement', 'view'], ['procurement', 'edit'], ['procurement', 'manage']]));
  const mgr = await mkUser('inmgr', await mkRole('Store Manager', [['procurement', 'view'], ['procurement', 'edit'], ['procurement', 'manage'], ['procurement', 'approve']]));
  const p1 = must(await api('POST', '/projects', admin, { project_code: `IN1-${TAG}`, project_name: `IN1 ${TAG}`, currency_id: 1 }), 'p1').id;
  const p2 = must(await api('POST', '/projects', admin, { project_code: `IN2-${TAG}`, project_name: `IN2 ${TAG}`, currency_id: 1 }), 'p2').id;
  const w1 = must(await api('POST', '/inventory/warehouses', clerk, { project_id: p1, code: `W1-${TAG}`, name: 'Site 1 store' }), 'w1').id;
  const w2 = must(await api('POST', '/inventory/warehouses', clerk, { project_id: p2, code: `W2-${TAG}`, name: 'Site 2 store' }), 'w2').id;
  const item = must(await api('POST', '/inventory/items', clerk, { item_code: `CEM-${TAG}`, description: 'Cement bag (fixture)', unit_of_measure: 'bag', cost_code_id: 2 }), 'item').id;
  const stock = async (w) => Number((must(await api('GET', '/inventory/stock', mgr), 'stock').find(r => Number(r.warehouse_id) === w && Number(r.inventory_item_id) === item) ?? { quantity_on_hand: 0 }).quantity_on_hand);
  const tx = (tok, body) => api('POST', '/inventory/transactions', tok, { inventory_item_id: item, ...body });

  // --- Adjustments are controlled (they create or destroy stock without a source document).
  await expectStatus('store clerk cannot post a stock adjustment', () => tx(clerk, { warehouse_id: w1, transaction_type: 'adjustment', quantity: 100, unit_cost: 5, reason: 'Opening balance (fixture)' }), 403);
  await expectStatus('adjustment without a reason refused', () => tx(mgr, { warehouse_id: w1, transaction_type: 'adjustment', quantity: 100, unit_cost: 5 }), 400);
  await run('store manager posts opening balance 100 bags with reason', async () => must(await tx(mgr, { warehouse_id: w1, transaction_type: 'adjustment', quantity: 100, unit_cost: 5, reason: 'Opening balance count sheet 1 (fixture)' }), 'adj'));
  check('W1 holds 100', await stock(w1) === 100);

  // --- Transfers.
  const tr = await run('transfer 40 bags W1 -> W2', async () => must(await api('POST', '/inventory/transfer', clerk, { from_warehouse_id: w1, to_warehouse_id: w2, inventory_item_id: item, quantity: 40, project_id: p2 }), 'transfer'));
  check('transfer legs balance (-40 / +40) and are linked', Number(tr.transfer_out.quantity) === -40 && Number(tr.transfer_in.quantity) === 40 && Number(tr.transfer_in.source_record_id) === Number(tr.transfer_out.id));
  check('transfer carries the source valuation (5.00) on both legs', Number(tr.transfer_out.unit_cost) === 5 && Number(tr.transfer_in.unit_cost) === 5, `${tr.transfer_out.unit_cost}/${tr.transfer_in.unit_cost}`);
  check('balances W1 60 / W2 40', await stock(w1) === 60 && await stock(w2) === 40);
  await expectStatus('transfer at a made-up unit cost refused', () => api('POST', '/inventory/transfer', clerk, { from_warehouse_id: w1, to_warehouse_id: w2, inventory_item_id: item, quantity: 1, unit_cost: 99 }), 422);
  await expectStatus('transfer more than available refused', () => api('POST', '/inventory/transfer', clerk, { from_warehouse_id: w2, to_warehouse_id: w1, inventory_item_id: item, quantity: 41 }), 409);
  await expectStatus('future-dated transfer refused', () => api('POST', '/inventory/transfer', clerk, { from_warehouse_id: w1, to_warehouse_id: w2, inventory_item_id: item, quantity: 1, transaction_date: day(5) }), 422);
  await expectStatus('transfer tagged to a project other than the destination store refused', () => api('POST', '/inventory/transfer', clerk, { from_warehouse_id: w1, to_warehouse_id: w2, inventory_item_id: item, quantity: 1, project_id: p1 }), 422);

  // --- Issues.
  await expectStatus('issue without a project refused', () => tx(clerk, { warehouse_id: w2, transaction_type: 'issue', quantity: -5 }), 400);
  await run('issue 5 bags from W2 to project 2', async () => must(await tx(clerk, { warehouse_id: w2, transaction_type: 'issue', quantity: -5, project_id: p2 }), 'issue'));
  await expectStatus('issue beyond stock refused', () => tx(clerk, { warehouse_id: w2, transaction_type: 'issue', quantity: -36, project_id: p2 }), 409);

  // --- Concurrency: 6 parallel transfers of 15 from W1 (60 on hand) -> exactly 4 succeed, never negative.
  const res = await Promise.all(Array.from({ length: 6 }, () => api('POST', '/inventory/transfer', clerk, { from_warehouse_id: w1, to_warehouse_id: w2, inventory_item_id: item, quantity: 15 })));
  const okN = res.filter(r => r.status === 201).length;
  check('parallel transfers: exactly 4 of 6 succeed and W1 ends at 0', okN === 4 && await stock(w1) === 0, `ok=${okN} w1=${await stock(w1)}`);

  if (OWNER) {
    const probe = (name, text) => { const r = sql(OWNER, text); check(name, !r.ok, r.out.split('\n').find(l => /ERROR/.test(l)) ?? r.out.slice(0, 120)); };
    probe('DB: stock ledger rows cannot be edited', `update inventory_transactions set quantity=1000 where id=${tr.transfer_in.id}`);
    probe('DB: stock ledger rows cannot be deleted', `delete from inventory_transactions where id=${tr.transfer_out.id}`);
    probe('DB: an unpaired transfer leg cannot be inserted', `insert into inventory_transactions(org_id,warehouse_id,inventory_item_id,transaction_type,quantity,unit_cost,source_table) values(1,${w2},${item},'transfer_in',500,5,'warehouse_transfer')`);
  } else check('DB probes (OWNER_PSQL_URL required)', false);

  const tb = await login(ADMIN_B);
  await expectStatus('tenant B cannot transfer from tenant A store', () => api('POST', '/inventory/transfer', tb, { from_warehouse_id: w2, to_warehouse_id: w1, inventory_item_id: item, quantity: 1 }), 422);
  const sB = must(await api('GET', '/inventory/stock', tb), 'stock B');
  check('tenant B does not see tenant A stock', !sB.some(r => Number(r.warehouse_id) === w1 || Number(r.warehouse_id) === w2));
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('sweep_inventory');
