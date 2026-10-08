// NDC-030 / Stage 10: two-step transfers with in-transit stock, receipt by another user, transit shortage accepted by a
// third person; physical stock count with variance reasons, approval by someone other than the counter, refusal when
// stock moved after submission; issues tagged to a cost code. Quantities and costs are TEST FIXTURES.
import { ADMIN, ADMIN_B, TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
try {
  const admin = await login(ADMIN);
  const mkRole = async (name, perms) => must(await api('POST', '/roles', admin, { role_name: `${name} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), `role ${name}`).id;
  const mkUser = async (key, role_id) => {
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    must(await api('POST', '/users', admin, { role_id, full_name: `IC ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return login(u);
  };
  // Everyone holds every procurement permission: only segregation rules can stop them.
  const all = await mkRole('IC All', [['procurement', 'view'], ['procurement', 'edit'], ['procurement', 'manage'], ['procurement', 'approve']]);
  const S1 = await mkUser('ics1', all), S2 = await mkUser('ics2', all), S3 = await mkUser('ics3', all);
  const p1 = must(await api('POST', '/projects', admin, { project_code: `IC1-${TAG}`, project_name: `IC1 ${TAG}`, currency_id: 1 }), 'p1').id;
  const p2 = must(await api('POST', '/projects', admin, { project_code: `IC2-${TAG}`, project_name: `IC2 ${TAG}`, currency_id: 1 }), 'p2').id;
  const w1 = must(await api('POST', '/inventory/warehouses', S1, { project_id: p1, code: `ICW1-${TAG}`, name: 'Site 1 store' }), 'w1').id;
  const w2 = must(await api('POST', '/inventory/warehouses', S1, { project_id: p2, code: `ICW2-${TAG}`, name: 'Site 2 store' }), 'w2').id;
  const item = must(await api('POST', '/inventory/items', S1, { item_code: `REB-${TAG}`, description: 'Rebar bundle (fixture)', unit_of_measure: 'bundle', cost_code_id: 2 }), 'item').id;
  const stock = async (w) => Number((must(await api('GET', '/inventory/stock', S2), 'stock').find(r => Number(r.warehouse_id) === w && Number(r.inventory_item_id) === item) ?? { quantity_on_hand: 0 }).quantity_on_hand);
  const transit = async () => Number((must(await api('GET', '/inventory/in-transit', S2), 'transit').find(r => Number(r.to_warehouse_id) === w2 && Number(r.inventory_item_id) === item) ?? { quantity_in_transit: 0 }).quantity_in_transit);
  must(await api('POST', '/inventory/transactions', S3, { warehouse_id: w1, inventory_item_id: item, transaction_type: 'adjustment', quantity: 100, unit_cost: 5, reason: 'Opening balance count sheet (fixture)' }), 'opening');

  // --- Two-step transfer with a short receipt.
  const d1 = await run('S1 dispatches 30 from W1 to W2', async () => must(await api('POST', '/inventory/transfer', S1, { from_warehouse_id: w1, to_warehouse_id: w2, inventory_item_id: item, quantity: 30 }), 'dispatch').transfer);
  check('dispatched stock leaves W1 and is in transit, not yet in W2', await stock(w1) === 70 && await stock(w2) === 0 && await transit() === 30);
  await expectStatus('dispatcher cannot confirm own receipt (SoD)', () => api('POST', `/inventory/transfers/${d1.id}/receive`, S1, { received_quantity: 30 }), 403);
  await expectStatus('receipt above the dispatched quantity refused', () => api('POST', `/inventory/transfers/${d1.id}/receive`, S2, { received_quantity: 31 }), 422);
  await expectStatus('short receipt without a discrepancy reason refused', () => api('POST', `/inventory/transfers/${d1.id}/receive`, S2, { received_quantity: 27 }), 422);
  const r1 = await run('S2 receives 27 with a discrepancy reason', async () => must(await api('POST', `/inventory/transfers/${d1.id}/receive`, S2, { received_quantity: 27, discrepancy_reason: '3 bundles missing on delivery note DN-55 (fixture)' }), 'receive'));
  check('short receipt recorded; W2 holds 27; nothing left in transit', r1.transfer.status === 'received_short' && Number(r1.transfer_in.quantity) === 27 && await stock(w2) === 27 && await transit() === 0);
  await expectStatus('a transfer cannot be received twice', () => api('POST', `/inventory/transfers/${d1.id}/receive`, S3, { received_quantity: 3 }), 409);
  await expectStatus('receiver cannot accept own shortage (SoD)', () => api('POST', `/inventory/transfers/${d1.id}/accept-shortage`, S2, { note: 'self acceptance' }), 403);
  await expectStatus('dispatcher cannot accept the shortage (SoD)', () => api('POST', `/inventory/transfers/${d1.id}/accept-shortage`, S1, { note: 'self acceptance' }), 403);
  await expectStatus('shortage acceptance needs a note', () => api('POST', `/inventory/transfers/${d1.id}/accept-shortage`, S3, {}), 400);
  await run('third person accepts the transit shortage', async () => must(await api('POST', `/inventory/transfers/${d1.id}/accept-shortage`, S3, { note: 'Carrier claim CL-9 raised (fixture)' }), 'accept'));
  const d2 = must(await api('POST', '/inventory/transfer', S1, { from_warehouse_id: w1, to_warehouse_id: w2, inventory_item_id: item, quantity: 10 }), 'dispatch2').transfer;
  const r2 = must(await api('POST', `/inventory/transfers/${d2.id}/receive`, S3, { received_quantity: 10 }), 'receive2');
  check('full receipt recorded as received', r2.transfer.status === 'received' && await stock(w2) === 37);
  check('quantity conserved: W1 60 + W2 37 + accepted shortage 3 = 100', await stock(w1) + await stock(w2) + 3 === 100);

  // --- Issue to a cost code.
  const iss = await run('issue 2 from W2 to project 2 against cost code 2', async () => must(await api('POST', '/inventory/transactions', S1, { warehouse_id: w2, inventory_item_id: item, transaction_type: 'issue', quantity: -2, project_id: p2, cost_code_id: 2 }), 'issue'));
  check('issue carries its cost code', Number(iss.cost_code_id) === 2);
  await expectStatus('issue against an unknown cost code refused', () => api('POST', '/inventory/transactions', S1, { warehouse_id: w2, inventory_item_id: item, transaction_type: 'issue', quantity: -1, project_id: p2, cost_code_id: 999999 }), 422);

  // --- Stock count: W2 system 35, counted 33.
  const c1 = must(await api('POST', '/inventory/stock-counts', S2, { warehouse_id: w2 }), 'count');
  must(await api('POST', `/inventory/stock-counts/${c1.id}/lines`, S2, { inventory_item_id: item, counted_quantity: 33 }), 'line');
  await expectStatus('only the counter records lines', () => api('POST', `/inventory/stock-counts/${c1.id}/lines`, S3, { inventory_item_id: item, counted_quantity: 35 }), 403);
  await expectStatus('submission refused while a variance is unexplained', () => api('POST', `/inventory/stock-counts/${c1.id}/submit`, S2), 422);
  must(await api('POST', `/inventory/stock-counts/${c1.id}/lines`, S2, { inventory_item_id: item, counted_quantity: 33, variance_reason: 'Two bundles damaged by rain, scrapped (fixture)' }), 'line2');
  const sub = await run('counter submits the count sheet', async () => must(await api('POST', `/inventory/stock-counts/${c1.id}/submit`, S2), 'submit'));
  check('system quantity snapshotted (35) and variance -2', Number(sub.lines[0].system_quantity) === 35 && Number(sub.lines[0].variance) === -2, JSON.stringify(sub.lines));
  await expectStatus('lines cannot change after submission', () => api('POST', `/inventory/stock-counts/${c1.id}/lines`, S2, { inventory_item_id: item, counted_quantity: 35 }), 409);
  await expectStatus('counter cannot approve own count (SoD)', () => api('POST', `/inventory/stock-counts/${c1.id}/decision`, S2, { decision: 'approved' }), 403);
  await run('another person approves the count', async () => must(await api('POST', `/inventory/stock-counts/${c1.id}/decision`, S3, { decision: 'approved' }), 'approve'));
  check('approved variance posted: W2 = 33', await stock(w2) === 33);

  // Stock moves after submission -> approval refused; rejection needs a reason.
  const c2 = must(await api('POST', '/inventory/stock-counts', S2, { warehouse_id: w2 }), 'count2');
  must(await api('POST', `/inventory/stock-counts/${c2.id}/lines`, S2, { inventory_item_id: item, counted_quantity: 33 }), 'c2 line');
  must(await api('POST', `/inventory/stock-counts/${c2.id}/submit`, S2), 'c2 submit');
  must(await api('POST', '/inventory/transactions', S1, { warehouse_id: w2, inventory_item_id: item, transaction_type: 'issue', quantity: -1, project_id: p2 }), 'issue after count');
  await expectStatus('approval refused when stock moved after submission (recount)', () => api('POST', `/inventory/stock-counts/${c2.id}/decision`, S3, { decision: 'approved' }), 409);
  await expectStatus('rejection needs a reason', () => api('POST', `/inventory/stock-counts/${c2.id}/decision`, S3, { decision: 'rejected' }), 400);
  await run('stale count rejected with reason', async () => must(await api('POST', `/inventory/stock-counts/${c2.id}/decision`, S3, { decision: 'rejected', reason: 'Stock moved after count; recount (fixture)' }), 'reject'));
  check('rejected count posted nothing: W2 = 32', await stock(w2) === 32);

  if (OWNER) {
    const probe = (name, text) => { const r = sql(OWNER, text); check(name, !r.ok, r.out.split('\n').find(l => /ERROR/.test(l)) ?? r.out.slice(0, 120)); };
    probe('DB: a received transfer cannot be re-quantified', `update stock_transfers set received_quantity=30 where id=${d1.id}`);
    probe('DB: transfers cannot be deleted', `delete from stock_transfers where id=${d2.id}`);
    probe('DB: one-step (instant) transfer legs refused', `insert into inventory_transactions(org_id,warehouse_id,inventory_item_id,transaction_type,quantity,unit_cost,source_table) values(1,${w1},${item},'transfer_out',-1,5,'warehouse_transfer')`);
    probe('DB: an approved count line cannot be posted twice', `insert into inventory_transactions(org_id,warehouse_id,inventory_item_id,transaction_type,quantity,unit_cost,source_table,source_record_id,reason) select 1,${w2},${item},'adjustment',variance,unit_cost,'stock_count',id,'replay of count' from stock_count_lines where stock_count_id=${c1.id}`);
    probe('DB: lines of a decided count are immutable', `update stock_count_lines set counted_quantity=99 where stock_count_id=${c1.id}`);
  } else check('DB probes (OWNER_PSQL_URL required)', false);

  const tb = await login(ADMIN_B);
  await expectStatus('tenant B cannot receive a tenant A transfer', () => api('POST', `/inventory/transfers/${d1.id}/receive`, tb, { received_quantity: 1 }), 404);
  const tB = must(await api('GET', '/inventory/transfers', tb), 'transfers B');
  check('tenant B sees no tenant A transfers', !tB.some(x => Number(x.id) === Number(d1.id)));
  await expectStatus('tenant B cannot count a tenant A store', () => api('POST', '/inventory/stock-counts', tb, { warehouse_id: w2 }), 422);
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('sweep_inventory_controls');
