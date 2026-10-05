// G-010 hostile runtime tests: concurrent duplicate requests, period lock, period reopen SoD, token replay.
// Runs after chain.mjs (reuses its fixture users/DOA via the shared RUN tag) and wave1 suites.
// Every amount is a TEST FIXTURE.
import { ADMIN, TAG, api, must, run, check, expectStatus, login, finish } from './harness.mjs';

const N = 8;
// Fire N identical requests at once; return the list of HTTP statuses.
const race = async (fn) => (await Promise.all(Array.from({ length: N }, () => fn()))).map(r => r.status);
const oneWins = (name, statuses) => check(name, statuses.filter(s => s >= 200 && s < 300).length === 1 && statuses.every(s => s < 500), statuses.join(','));

try {
  const admin = await login(ADMIN);
  const U = {
    pm: await login({ email: `pm.${TAG}@test.local`, password: 'Passw0rd!pm', org_id: 1 }),
    proc: await login({ email: `proc.${TAG}@test.local`, password: 'Passw0rd!proc', org_id: 1 }),
    fin: await login({ email: `fin.${TAG}@test.local`, password: 'Passw0rd!fin', org_id: 1 })
  };
  const vendor = must(await api('GET', '/vendors', admin), 'vendors').find(v => v.vendor_name === `E2E Vendor ${TAG}`).id;
  const project = must(await api('POST', '/projects', admin, { project_code: `HC-${TAG}`, project_name: `HC ${TAG}`, currency_id: 1 }), 'project').id;

  // --- PO approval race (same approver, N parallel approvals) -> one committed-cost row.
  const po = must(await api('POST', '/procurement/purchase-orders', admin, { project_id: project, vendor_id: vendor, cost_code_id: 2, po_ref: `HCPO-${TAG}`, currency_id: 1, lines: [{ item_description: 'race item', unit_of_measure: 'm2', quantity: 10, unit_rate: 100 }] }), 'po');
  const pa = must(await api('POST', `/procurement/purchase-orders/${po.id}/submit-approval`, admin), 'po submit').approval;
  oneWins(`${N} parallel PO approvals -> exactly one succeeds`, await race(() => api('POST', `/approvals/${pa.id}/actions`, U.proc, { action: 'approved', comment: 'race' })));
  const cts = must(await api('GET', '/cost-transactions', admin), 'cts').filter(c => c.source_table === 'purchase_orders' && Number(c.source_record_id) === po.id);
  check('exactly one committed cost row for the PO', cts.length === 1, `rows=${cts.length}`);
  oneWins(`${N} parallel PO issues -> exactly one succeeds`, await race(() => api('POST', `/procurement/purchase-orders/${po.id}/issue`, admin)));

  // --- GRN confirm race -> stock incremented once.
  const wh = must(await api('POST', '/inventory/warehouses', admin, { project_id: project, code: `HCW-${TAG}`, name: 'HC WH' }), 'wh').id;
  const item = must(await api('POST', '/inventory/items', admin, { item_code: `HCI-${TAG}`, description: 'HC item', unit_of_measure: 'm2', cost_code_id: 2 }), 'item').id;
  const poLine = must(await api('GET', `/procurement/purchase-orders/${po.id}/details`, admin), 'pod').lines[0].id;
  const grn = must(await api('POST', `/procurement/purchase-orders/${po.id}/grns`, admin, { project_id: project, warehouse_id: wh, grn_no: `HCG-${TAG}`, lines: [{ po_line_id: poLine, inventory_item_id: item, quantity_received: 10, quantity_accepted: 10 }] }), 'grn').id;
  oneWins(`${N} parallel GRN confirmations -> exactly one succeeds`, await race(() => api('POST', `/procurement/grns/${grn}/confirm`, admin)));
  const stock = must(await api('GET', '/inventory/stock', admin), 'stock').find(s => Number(s.inventory_item_id) === item && Number(s.warehouse_id) === wh);
  check('stock received once (10, not 10 x N)', stock && Number(stock.quantity_on_hand) === 10, JSON.stringify(stock));

  // --- Invoice approval -> actual cost; GL posting race -> one balanced batch.
  const inv = must(await api('POST', '/procurement/vendor-invoices', admin, { vendor_id: vendor, project_id: project, po_id: po.id, invoice_no: `HCINV-${TAG}`, invoice_date: new Date().toISOString().slice(0, 10), amount: 1000, tax_amount: 0, currency_id: 1, matched_grn_id: grn }), 'inv').id;
  must(await api('POST', `/procurement/vendor-invoices/${inv}/match`, admin, { tolerance_amount: 0 }), 'match');
  const ia = must(await api('POST', `/procurement/vendor-invoices/${inv}/submit-approval`, admin), 'inv submit').approval;
  const iaDone = must(await api('POST', `/approvals/${ia.id}/actions`, U.fin, { action: 'approved', comment: 'hc' }), 'inv appr');
  const ct = iaDone.finalization.cost_transaction.id;
  oneWins(`${N} parallel cost->GL postings -> exactly one succeeds`, await race(() => api('POST', `/finance/cost-transactions/${ct}/post-gl`, admin)));
  const gl = must(await api('GET', '/finance/gl', admin), 'gl').filter(g => g.source_module === 'cost_transaction' && Number(g.source_record_id) === ct);
  check('one balanced GL batch for the cost (2 lines, debit = credit)', gl.length === 2 && gl.reduce((s, g) => s + Number(g.debit) - Number(g.credit), 0) === 0, `lines=${gl.length}`);

  // --- Payment GL posting race.
  const bank = must(await api('GET', '/finance/bank-accounts', admin), 'banks')[0].id;
  const ap = must(await api('GET', '/finance/ap', admin), 'ap').find(a => Number(a.source_record_id) === inv);
  const pay = must(await api('POST', '/finance/payments', admin, { payment_type: 'outgoing', party_type: 'vendor', party_id: vendor, related_ap_id: ap.id, amount: 1000, currency_id: 1, bank_account_id: bank, method: 'transfer', reference_no: `HCPAY-${TAG}` }), 'pay').id;
  const pya = must(await api('POST', `/finance/payments/${pay}/submit-approval`, admin), 'pay submit').approval;
  must(await api('POST', `/approvals/${pya.id}/actions`, U.fin, { action: 'approved', comment: 'hc' }), 'pay appr');
  oneWins(`${N} parallel payment->GL postings -> exactly one succeeds`, await race(() => api('POST', `/finance/payments/${pay}/post-gl`, admin)));

  // --- Vendor bank-change approval race between two approvers.
  const mkRole = async (name, perms) => must(await api('POST', '/roles', admin, { role_name: `${name} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), `role ${name}`).id;
  const mkUser = async (key, role_id) => { const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: 1 }; must(await api('POST', '/users', admin, { role_id, full_name: `HC ${key}`, email: u.email, password: u.password }), `user ${key}`); return { ...u, token: await login(u) }; };
  const vr = await mkRole('HC Vendor Appr', [['vendors', 'view'], ['vendors', 'approve']]);
  const va1 = await mkUser('hcva1', vr), va2 = await mkUser('hcva2', vr);
  const br = must(await api('POST', `/vendors/${vendor}/bank-change-requests`, admin, { new_bank_name: 'Race Bank', new_bank_account_no: `HC${TAG}9999`, reason: 'race fixture' }), 'br');
  const body = { verification_method: 'callback_to_known_contact', verification_reference: 'race call log' };
  const st = (await Promise.all([va1, va2, va1, va2].map(u => api('POST', `/vendors/bank-change-requests/${br.id}/approve`, u.token, body)))).map(r => r.status);
  oneWins('parallel bank-change approvals by two approvers -> exactly one succeeds', st);

  // --- Period lock: posting into a closed period is refused; posting needs a defined period.
  const conf = await mkUser('hcconf', await mkRole('HC DOA Conf', [['admin', 'view'], ['admin', 'approve']]));
  const mjApprRole = await mkRole('HC MJ Approver', [['approvals', 'view'], ['approvals', 'approve']]);
  const mjAppr = await mkUser('hcmja', mjApprRole);
  const existing = must(await api('GET', '/approvals/configuration/doa', admin), 'doa').find(d => d.module === 'manual_journal_entry' && d.is_active && d.is_confirmed && Number(d.approval_level) === 1);
  if (!existing) { const d = must(await api('POST', '/approvals/configuration/doa', admin, { module: 'manual_journal_entry', min_amount: 0, approval_level: 1, approver_role_id: mjApprRole, notes: 'TEST FIXTURE' }), 'doa'); must(await api('POST', `/approvals/configuration/doa/${d.id}/confirm`, conf.token), 'doa confirm'); }
  const accts = must(await api('GET', '/finance/chart-of-accounts', admin), 'coa').filter(a => String(a.account_code).endsWith(`-${TAG}`));
  const [a1, a2] = [accts.find(a => a.account_code.startsWith('5100')).id, accts.find(a => a.account_code.startsWith('1010')).id];
  const fp = must(await api('POST', '/finance/fiscal-periods', admin, { fiscal_year: 2020, period_no: 1, start_date: '2020-01-01', end_date: '2020-01-31' }), 'fp');
  const mkMj = async (date) => {
    const mj = must(await api('POST', '/finance/manual-journals', admin, { entry_date: date, description: `HC journal ${date}`, reason_category: 'correction', lines: [{ account_id: a1, debit: 10, credit: 0, currency_id: 1 }, { account_id: a2, debit: 0, credit: 10, currency_id: 1 }] }), 'mj');
    const s = must(await api('POST', `/finance/manual-journals/${mj.id}/submit`, admin), 'mj submit');
    const apprId = s.approval?.id ?? s.approval_instance_id ?? s.data?.approval?.id;
    must(await api('POST', `/approvals/${apprId}/actions`, mjAppr.token, { action: 'approved', comment: 'hc' }), 'mj appr');
    return mj.id;
  };
  must(await api('POST', `/finance/fiscal-periods/${fp.id}/status`, admin, { status: 'closed' }), 'close');
  const mjClosed = await mkMj('2020-01-15');
  await expectStatus('posting a journal dated in a closed period is refused', () => api('POST', `/finance/manual-journals/${mjClosed}/post-gl`, admin), 422);
  const mjNoPeriod = await mkMj('2019-06-15');
  await expectStatus('posting a journal dated where no fiscal period is defined is refused', () => api('POST', `/finance/manual-journals/${mjNoPeriod}/post-gl`, admin), 422);
  await expectStatus('the user who closed a period cannot reopen it (SoD)', () => api('POST', `/finance/fiscal-periods/${fp.id}/status`, admin, { status: 'open', reason: 'attempted self reopen' }), 403);
  const ctrl = await mkUser('hcctrl', await mkRole('HC Controller', [['finance', 'view'], ['finance', 'manage'], ['finance', 'approve']]));
  await expectStatus('reopen without reason refused', () => api('POST', `/finance/fiscal-periods/${fp.id}/status`, ctrl.token, { status: 'open' }), 422);
  await run('a different controller reopens with a reason', async () => must(await api('POST', `/finance/fiscal-periods/${fp.id}/status`, ctrl.token, { status: 'open', reason: 'fixture: late supplier invoice correction' }), 'reopen'));
  await run('posting into the reopened period now succeeds', async () => must(await api('POST', `/finance/manual-journals/${mjClosed}/post-gl`, admin), 'post reopened'));

  // --- Token replay after deactivation.
  const victim = await mkUser('hcvictim', await mkRole('HC Victim', [['projects', 'view']]));
  check('token works before deactivation', (await api('GET', '/projects', victim.token)).status === 200);
  const victimId = must(await api('GET', '/users', admin), 'users').find(u => u.email === victim.email).id;
  must(await api('PATCH', `/users/${victimId}/status`, admin, { is_active: false }), 'deactivate');
  await expectStatus('token of a deactivated user is refused on next request', () => api('GET', '/projects', victim.token), 401);
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('hostile_concurrency');
