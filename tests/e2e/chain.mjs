// R0-4 runtime E2E chain: Lead -> Tender -> Project -> BOQ -> MR -> RFQ -> PO -> GRN -> Invoice
// -> Cost -> GL -> Contract -> IPC -> AR/GL -> Payment -> GL, executed through the HTTP API only.
//
// EVERY amount, DOA threshold, account code and permission grant below is a TEST FIXTURE chosen to
// exercise code paths. None of them is an owner-approved business value.
//
// Exception to "API only": vendors_subcontractors has no create endpoint in v0.2, so the harness
// inserts one vendor row via SQL (see seedVendor). That gap is itself a finding (F-R0-VENDOR-API).
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { api, must, log } from './lib.mjs';

const RUN = process.env.RUN_ID ?? String(Date.now()).slice(-6);
const ADMIN = { email: process.env.ADMIN_EMAIL ?? 'admin.a@test.local', password: process.env.ADMIN_PASSWORD ?? 'Passw0rd!A', org_id: Number(process.env.ORG_ID ?? 1) };
const PSQL = process.env.PSQL_URL;
const steps = [];
function step(name, outcome, detail = '') { steps.push({ name, outcome, detail }); console.log(`${outcome.padEnd(5)} ${name}${detail ? ' :: ' + detail : ''}`); }
async function run(name, fn) { try { const v = await fn(); step(name, 'PASS'); return v; } catch (e) { step(name, 'FAIL', e.message.slice(0, 300)); throw e; } }
async function expectFail(name, fn, status) {
  const r = await fn();
  if (r.ok) step(name, 'FAIL', `expected HTTP ${status ?? '4xx'} but got ${r.status}`);
  else if (status && r.status !== status) step(name, 'WARN', `expected ${status} got ${r.status} ${JSON.stringify(r.body?.error)}`);
  else step(name, 'PASS', `rejected ${r.status} ${JSON.stringify(r.body?.error)}`);
  return r;
}
const login = async (email, password, org_id = ADMIN.org_id) => must(await api('POST', '/auth/login', null, { email, password, org_id }), `login ${email}`).token;

function seedVendor(orgId, name) {
  // PSQL_URL: a connection string for a role allowed to write vendors_subcontractors.
  if (!PSQL) throw new Error('PSQL_URL not set; cannot seed vendor (no vendor create API exists)');
  const sql = `insert into vendors_subcontractors(org_id,vendor_name,vendor_type) values(${Number(orgId)},$v$${name}$v$,'supplier') returning id`;
  const out = execFileSync('psql', [PSQL, '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql]).toString().trim();
  const vid = Number(out.split('\n')[0]);
  if (!Number.isInteger(vid) || vid <= 0) throw new Error(`vendor seed returned ${JSON.stringify(out)}`);
  return vid;
}

const today = new Date().toISOString().slice(0, 10);
const ids = {};
let finished = false;
try {
  const admin = await run('login admin', () => login(ADMIN.email, ADMIN.password));
  const roles = must(await api('GET', '/roles', admin), 'roles');
  const roleId = n => { const r = roles.find(x => x.role_name === n); if (!r) throw new Error(`role ${n} missing`); return Number(r.id); };
  const R = { tender: roleId('Tendering Manager'), pm: roleId('Project Manager'), proc: roleId('Procurement Manager'), fin: roleId('Finance Manager') };

  // Seeded Procurement Manager / Finance Manager roles lack approvals.approve (F-R0-DOA-PERM).
  // TEST FIXTURE grant so the chain can run; does not represent an approved permission matrix.
  for (const rid of [R.proc, R.fin]) {
    await run(`grant fixture permissions to role ${rid}`, async () => must(await api('PUT', `/roles/${rid}/permissions`, admin, { permissions: [
      { module: 'approvals', action: 'view', scope: 'all' }, { module: 'approvals', action: 'approve', scope: 'all' },
      { module: 'procurement', action: 'view', scope: 'all' }, { module: 'finance', action: 'view', scope: 'all' }] }), 'perm'));
  }

  const mkUser = async (key, role_id) => {
    const email = `${key}.${RUN}@test.local`, password = `Passw0rd!${key}`;
    await run(`create user ${key}`, async () => must(await api('POST', '/users', admin, { role_id, full_name: `Test ${key}`, email, password }), 'user'));
    return login(email, password);
  };
  const U = { tender: await mkUser('tender', R.tender), pm: await mkUser('pm', R.pm), proc: await mkUser('proc', R.proc), fin: await mkUser('fin', R.fin) };

  // Confirm TEST FIXTURE DOA rows (one per module used) via the only DOA write API (PATCH).
  const doa = must(await api('GET', '/approvals/configuration/doa', admin), 'doa');
  const fixtureDoa = { tender_submission: R.tender, material_requisition: R.pm, purchase_order: R.proc, vendor_invoice: R.fin, ipc_submission: R.pm, payment: R.fin };
  for (const [module, role] of Object.entries(fixtureDoa)) {
    const row = doa.find(d => d.module === module && d.approval_level === 1 && Number(d.min_amount) === 0);
    await run(`confirm fixture DOA ${module}`, async () => must(await api('PATCH', `/approvals/configuration/doa/${row.id}`, admin, {
      min_amount: 0, max_amount: null, currency_id: null, approval_level: 1, approver_role_id: role, is_active: true,
      notes: `TEST FIXTURE ${RUN} - not owner-approved`, confirm: true }), 'doa'));
  }
  const approve = async (token, approvalId, label) => run(`approve ${label}`, async () => must(await api('POST', `/approvals/${approvalId}/actions`, token, { action: 'approved', comment: 'e2e' }), label));
  const cur = 1;

  // --- CRM / Tender
  ids.client = await run('create client', async () => must(await api('POST', '/clients', admin, { client_name: `E2E Client ${RUN}`, client_type: 'private' }), 'client').id);
  ids.lead = await run('create lead', async () => must(await api('POST', '/crm/leads', admin, { lead_name: `E2E Lead ${RUN}`, client_id: ids.client, estimated_value: 1000000, currency_id: cur }), 'lead').id);
  ids.opp = await run('create opportunity', async () => must(await api('POST', `/crm/leads/${ids.lead}/opportunities`, admin, { opportunity_name: `E2E Opp ${RUN}`, estimated_value: 1000000, currency_id: cur, probability_percent: 50 }), 'opp').id);
  ids.tender = await run('convert opportunity to tender', async () => must(await api('POST', `/crm/opportunities/${ids.opp}/convert-to-tender`, admin, { tender_ref: `TD-${RUN}`, tender_title: 'E2E Tender', currency_id: cur }), 'tender').id);
  const ta = await run('submit tender for approval', async () => must(await api('POST', `/tendering/tenders/${ids.tender}/submit-approval`, admin), 'tsub').approval);
  await expectFail('SoD: initiator cannot approve own tender', () => api('POST', `/approvals/${ta.id}/actions`, admin, { action: 'approved' }), 403);
  await approve(U.tender, ta.id, 'tender (Tendering Manager)');

  // --- Project / BOQ
  ids.project = await run('create project', async () => must(await api('POST', '/projects', admin, { project_code: `P-${RUN}`, project_name: `E2E Project ${RUN}`, currency_id: cur, client_id: ids.client, original_contract_value: 1000000, current_contract_value: 1000000, retention_percent: 5 }), 'project').id);
  ids.boq = await run('create BOQ item', async () => must(await api('POST', '/boq/master', admin, { project_id: ids.project, item_no: '1.1', description: 'E2E BOQ item', unit_of_measure: 'm2', quantity: 100, unit_rate_material: 200, cost_code_id: 2 }), 'boq').id);
  await run('add rate build-up', async () => must(await api('POST', `/boq/master/${ids.boq}/rate-buildup`, admin, { resource_type: 'material', quantity_per_unit: 1, unit_cost: 200 }), 'rb'));

  // --- Procurement
  ids.vendor = await run('seed vendor via SQL (no API exists)', async () => seedVendor(ADMIN.org_id, `E2E Vendor ${RUN}`));
  ids.wh = await run('create warehouse', async () => must(await api('POST', '/inventory/warehouses', admin, { project_id: ids.project, code: `WH-${RUN}`, name: 'E2E WH' }), 'wh').id);
  ids.item = await run('create inventory item', async () => must(await api('POST', '/inventory/items', admin, { item_code: `IT-${RUN}`, description: 'E2E item', unit_of_measure: 'm2', cost_code_id: 2 }), 'item').id);
  ids.mr = await run('create MR', async () => must(await api('POST', '/procurement/material-requisitions', admin, { project_id: ids.project, mr_no: `MR-${RUN}`, lines: [{ item_description: 'E2E material', unit_of_measure: 'm2', quantity: 100 }] }), 'mr').id);
  const mra = await run('submit MR', async () => must(await api('POST', `/procurement/material-requisitions/${ids.mr}/submit-approval`, admin), 'mrs').approval);
  await approve(U.pm, mra.id, 'MR (Project Manager)');
  ids.rfq = await run('create RFQ', async () => must(await api('POST', '/procurement/rfqs', admin, { project_id: ids.project, mr_id: ids.mr, rfq_ref: `RFQ-${RUN}`, vendor_ids: [ids.vendor] }), 'rfq').id);
  await run('record vendor quotation', async () => must(await api('POST', `/procurement/rfqs/${ids.rfq}/vendor-quotations`, admin, { vendor_id: ids.vendor, total_amount: 20000, currency_id: cur }), 'vq'));
  await run('create comparative statement', async () => must(await api('POST', '/procurement/comparative-statements', admin, { rfq_id: ids.rfq, recommended_vendor_id: ids.vendor, justification: 'single bidder (fixture)' }), 'cs'));
  const po = await run('create PO', async () => must(await api('POST', '/procurement/purchase-orders', admin, { project_id: ids.project, vendor_id: ids.vendor, mr_id: ids.mr, cost_code_id: 2, po_ref: `PO-${RUN}`, currency_id: cur, lines: [{ item_description: 'E2E material', unit_of_measure: 'm2', quantity: 100, unit_rate: 200 }] }), 'po'));
  ids.po = po.id;
  step('PO total computed in DB', String(po.total_amount) === '20000.00' ? 'PASS' : 'FAIL', `total_amount=${po.total_amount}`);
  await expectFail('issue PO before approval rejected', () => api('POST', `/procurement/purchase-orders/${ids.po}/issue`, admin), 409);
  const poa = await run('submit PO', async () => must(await api('POST', `/procurement/purchase-orders/${ids.po}/submit-approval`, admin), 'pos').approval);
  await expectFail('wrong role cannot approve PO', () => api('POST', `/approvals/${poa.id}/actions`, U.pm, { action: 'approved' }), 403);
  const poApproved = await approve(U.proc, poa.id, 'PO (Procurement Manager)');
  step('PO approval created committed cost', poApproved.finalization?.cost_transaction?.transaction_type === 'committed' ? 'PASS' : 'FAIL', JSON.stringify(poApproved.finalization?.cost_transaction ?? null).slice(0, 160));
  ids.ctCommitted = poApproved.finalization?.cost_transaction?.id;
  await run('issue PO', async () => must(await api('POST', `/procurement/purchase-orders/${ids.po}/issue`, admin), 'issue'));
  const poLines = must(await api('GET', `/procurement/purchase-orders/${ids.po}/details`, admin), 'pod').lines;
  ids.grn = await run('create GRN', async () => must(await api('POST', `/procurement/purchase-orders/${ids.po}/grns`, admin, { project_id: ids.project, warehouse_id: ids.wh, grn_no: `GRN-${RUN}`, lines: [{ po_line_id: poLines[0].id, inventory_item_id: ids.item, quantity_received: 100, quantity_accepted: 100 }] }), 'grn').id);
  await run('confirm GRN', async () => must(await api('POST', `/procurement/grns/${ids.grn}/confirm`, admin), 'grnc'));
  await expectFail('confirm GRN twice rejected', () => api('POST', `/procurement/grns/${ids.grn}/confirm`, admin), 409);
  ids.inv = await run('create vendor invoice', async () => must(await api('POST', '/procurement/vendor-invoices', admin, { vendor_id: ids.vendor, project_id: ids.project, po_id: ids.po, invoice_no: `INV-${RUN}`, invoice_date: today, amount: 20000, tax_amount: 0, currency_id: cur, matched_grn_id: ids.grn }), 'vi').id);
  const match = await run('3-way match invoice', async () => must(await api('POST', `/procurement/vendor-invoices/${ids.inv}/match`, admin, { tolerance_amount: 0 }), 'match'));
  step('3-way match result', JSON.stringify(match).includes('matched') ? 'PASS' : 'FAIL', JSON.stringify(match).slice(0, 200));
  const via = await run('submit invoice', async () => must(await api('POST', `/procurement/vendor-invoices/${ids.inv}/submit-approval`, admin), 'vis').approval);
  const viApproved = await approve(U.fin, via.id, 'invoice (Finance Manager)');
  ids.ctActual = viApproved.finalization?.cost_transaction?.id;
  step('invoice approval created actual cost', viApproved.finalization?.cost_transaction?.transaction_type === 'actual' ? 'PASS' : 'FAIL');

  // --- Finance configuration (fixtures)
  const coa = {};
  for (const [k, code, name, type] of [['exp', '5100', 'Material cost (fixture)', 'expense'], ['ap', '2100', 'Accounts payable (fixture)', 'liability'], ['ar', '1200', 'Accounts receivable (fixture)', 'asset'], ['rev', '4100', 'Contract revenue (fixture)', 'revenue'], ['bank', '1010', 'Bank (fixture)', 'asset']]) {
    coa[k] = await run(`create CoA ${code}`, async () => must(await api('POST', '/finance/chart-of-accounts', admin, { account_code: `${code}-${RUN}`, account_name: name, account_type: type }), 'coa').id);
  }
  for (const [m, sub, d, c] of [['cost_transaction', 'procurement', coa.exp, coa.ap], ['ipc', null, coa.ar, coa.rev], ['payment', 'outgoing', coa.ap, coa.bank]]) {
    await run(`create GL rule ${m}/${sub}`, async () => must(await api('POST', '/finance/gl-posting-rules', admin, { source_module: m, source_subtype: sub, debit_account_id: d, credit_account_id: c, notes: 'TEST FIXTURE' }), 'rule'));
  }
  const d = new Date(); const y = d.getUTCFullYear(), mth = d.getUTCMonth() + 1;
  const fp = await api('POST', '/finance/fiscal-periods', admin, { fiscal_year: y, period_no: mth, start_date: `${y}-${String(mth).padStart(2, '0')}-01`, end_date: new Date(Date.UTC(y, mth, 0)).toISOString().slice(0, 10) });
  step('create fiscal period', fp.ok || fp.status === 409 ? 'PASS' : 'WARN', `${fp.status} ${JSON.stringify(fp.body?.error ?? '')}`);

  // --- Cost -> GL
  await run('post actual cost to GL', async () => must(await api('POST', `/finance/cost-transactions/${ids.ctActual}/post-gl`, admin), 'ctgl'));
  await expectFail('post same cost twice rejected', () => api('POST', `/finance/cost-transactions/${ids.ctActual}/post-gl`, admin), 409);
  const committedPost = await api('POST', `/finance/cost-transactions/${ids.ctCommitted}/post-gl`, admin);
  step('committed (non-accounting) cost must NOT post to GL', committedPost.ok ? 'FAIL' : 'PASS', `${committedPost.status} ${JSON.stringify(committedPost.body?.error ?? '')}`);

  // --- Contract -> IPC -> AR
  ids.contract = await run('create contract', async () => must(await api('POST', '/contracts', admin, { project_id: ids.project, client_id: ids.client, contract_type: 'lump_sum', contract_value: 1000000, currency_id: cur, retention_percent: 5 }), 'contract').id);
  ids.ipc = await run('create IPC', async () => must(await api('POST', '/finance/ipcs', admin, { project_id: ids.project, contract_id: ids.contract, ipc_no: `IPC-${RUN}`, period_from: today, period_to: today, gross_work_done_this_period: 100000, cumulative_gross_work_done: 100000, less_retention: 5000 }), 'ipc').id);
  const ipca = await run('submit IPC', async () => must(await api('POST', `/finance/ipcs/${ids.ipc}/submit-to-client`, admin), 'ipcs').approval);
  await approve(U.pm, ipca.id, 'IPC (Project Manager)');
  await run('client approves IPC', async () => must(await api('POST', `/finance/ipcs/${ids.ipc}/client-approve`, admin), 'ipcca'));
  await run('post IPC to AR/GL', async () => must(await api('POST', `/finance/ipcs/${ids.ipc}/post-ar-gl`, admin), 'ipcgl'));

  // --- Payment
  ids.bank = await run('create bank account', async () => must(await api('POST', '/finance/bank-accounts', admin, { bank_name: 'Fixture Bank', account_no: `ACC-${RUN}`, currency_id: cur }), 'bank').id);
  const ap = must(await api('GET', '/finance/ap', admin), 'ap').find(a => Number(a.source_record_id) === Number(ids.inv));
  step('AP created from approved invoice', ap ? 'PASS' : 'FAIL', ap ? `amount=${ap.amount}` : '');
  ids.pay = await run('create payment', async () => must(await api('POST', '/finance/payments', admin, { payment_type: 'outgoing', party_type: 'vendor', party_id: ids.vendor, related_ap_id: ap?.id ?? null, amount: 20000, currency_id: cur, bank_account_id: ids.bank, method: 'transfer', reference_no: `PAY-${RUN}` }), 'pay').id);
  const paya = await run('submit payment', async () => must(await api('POST', `/finance/payments/${ids.pay}/submit-approval`, admin), 'pays').approval);
  await approve(U.fin, paya.id, 'payment (Finance Manager)');
  await run('post payment to GL', async () => must(await api('POST', `/finance/payments/${ids.pay}/post-gl`, admin), 'paygl'));

  // --- Ledger integrity
  const gl = must(await api('GET', '/finance/gl', admin), 'gl');
  const mine = gl.filter(g => Number(g.project_id) === Number(ids.project) || [ids.pay].includes(Number(g.source_record_id)) && g.source_module === 'payment');
  const dr = mine.reduce((s, g) => s + Math.round(Number(g.debit) * 100), 0), cr = mine.reduce((s, g) => s + Math.round(Number(g.credit) * 100), 0);
  step('GL balanced for this run', dr === cr && dr > 0 ? 'PASS' : 'FAIL', `lines=${mine.length} debit=${dr / 100} credit=${cr / 100}`);
  finished = true;
} catch (e) {
  console.error('CHAIN STOPPED:', e.message);
} finally {
  const out = { run: RUN, finished, ids, steps, http: log };
  writeFileSync(new URL(`./out/chain_${RUN}.json`, import.meta.url), JSON.stringify(out, null, 2));
  const c = s => steps.filter(x => x.outcome === s).length;
  console.log(`\nSUMMARY run=${RUN} finished=${finished} PASS=${c('PASS')} FAIL=${c('FAIL')} WARN=${c('WARN')}`);
  process.exitCode = finished && c('FAIL') === 0 ? 0 : 1;
}
