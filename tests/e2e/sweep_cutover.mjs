// Stage 34 / GC-24 / DEC-019: go-live cut-over in a fresh tenant (opening balances are imported only before any
// posting): cut-over date on a fiscal period start, opening trial balance, opening receivables / payables, in-flight
// contract and subcontract positions, reconciliation that refuses differences, preparer / approver separation, the
// opening journal as one balanced batch on the cut-over date, opening items collectable / payable against their own
// control accounts, everything frozen once opened. Accounts, rules, amounts and DOA bands are TEST FIXTURES.
import { TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';
import { BASE } from './lib.mjs';

const BT = process.env.BOOTSTRAP_ADMIN_TOKEN, OWNER = process.env.OWNER_PSQL_URL;
const now = new Date();
const first = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
try {
  const boot = await fetch(`${BASE}/auth/bootstrap-admin`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-bootstrap-token': BT },
    body: JSON.stringify({ organization: { name: `Tenant E ${TAG}`, base_currency_code: 'EGP' }, full_name: 'Admin E', email: `admin.e.${TAG}@test.local`, password: 'Passw0rd!E' }) }).then(r => r.json());
  if (!boot.success) throw new Error(`bootstrap: ${JSON.stringify(boot.error)}`);
  const E = boot.data.token, org = boot.data.organization.id;
  const user = async (key, roleName, perms) => {
    const role = must(await api('POST', '/roles', E, { role_name: roleName, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), `role ${roleName}`).id;
    must(await api('POST', '/users', E, { role_id: role, full_name: `${key} E`, email: `${key}.e.${TAG}@test.local`, password: `Passw0rd!${key}` }), `user ${key}`);
    return { role, token: await login({ email: `${key}.e.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: org }) };
  };
  const chk = await user('chk', 'Checker', [['admin', 'view'], ['admin', 'approve'], ['vendors', 'view'], ['vendors', 'approve'], ['approvals', 'view'], ['approvals', 'approve'], ['contracts', 'view']]);
  const fin = await user('fin2', 'Finance approver', [['finance', 'view'], ['finance', 'manage'], ['finance', 'approve'], ['finance', 'post'], ['approvals', 'view'], ['approvals', 'approve']]);
  const acc = {};
  for (const [k, code, name, type] of [['bank', '1010', 'Bank', 'asset'], ['ar', '1200', 'Receivables', 'asset'], ['ret', '1250', 'Retention receivable', 'asset'], ['sadv', '1150', 'Advances to subcontractors', 'asset'],
    ['ap', '2100', 'Payables', 'liability'], ['sap', '2110', 'Subcontractors payable', 'liability'], ['sret', '2120', 'Retention payable to subcontractors', 'liability'], ['cadv', '2200', 'Advances from clients', 'liability'],
    ['eq', '3000', 'Opening balance equity', 'equity'], ['bill', '4100', 'Contract billings', 'revenue'], ['cost', '5300', 'Subcontract cost', 'expense']]) {
    acc[k] = must(await api('POST', '/finance/chart-of-accounts', E, { account_code: code, account_name: `${name} (fixture)`, account_type: type }), `coa ${code}`).id;
  }
  for (const [m, sub, d, c] of [['ipc', null, 'ar', 'bill'], ['ipc', 'retention_receivable', 'ret', 'bill'], ['ipc', 'client_advance', 'cadv', 'bill'], ['cost_transaction', 'subcontract', 'cost', 'sap'],
    ['cost_transaction', 'subcontract_retention', 'cost', 'sret'], ['cost_transaction', 'subcontract_advance', 'cost', 'sadv'], ['payment', 'incoming', 'bank', 'ar'], ['payment', 'outgoing', 'ap', 'bank']]) {
    must(await api('POST', '/finance/gl-posting-rules', E, { source_module: m, source_subtype: sub, debit_account_id: acc[d], credit_account_id: acc[c], notes: 'TEST FIXTURE' }), `rule ${m}/${sub}`);
  }
  must(await api('POST', '/finance/fiscal-periods', E, { fiscal_year: now.getUTCFullYear(), period_no: now.getUTCMonth() + 1, start_date: first, end_date: last }), 'period');
  for (const [module, role] of [['contract_signing', chk.role], ['subcontract_signing', chk.role], ['payment', fin.role]]) {
    const d = must(await api('POST', '/approvals/configuration/doa', E, { module, min_amount: 0, approval_level: 1, approver_role_id: role, notes: 'TEST FIXTURE' }), `doa ${module}`);
    must(await api('POST', `/approvals/configuration/doa/${d.id}/confirm`, chk.token), `doa confirm ${module}`);
  }
  const approve = (tok, id) => api('POST', `/approvals/${id}/actions`, tok, { action: 'approved', comment: 'fixture' });
  const client = must(await api('POST', '/clients', E, { client_name: `E Client ${TAG}`, client_type: 'private' }), 'client').id;
  const project = must(await api('POST', '/projects', E, { project_code: `E1-${TAG}`, project_name: `E Tower ${TAG}`, currency_id: 1, client_id: client }), 'project').id;
  const contract = must(await api('POST', '/contracts', E, { project_id: project, client_id: client, contract_type: 'lump_sum', contract_value: 1200000, currency_id: 1, retention_percent: 5, advance_payment_percent: 10 }), 'contract').id;
  must(await approve(chk.token, must(await api('POST', `/contracts/${contract}/submit-approval`, E), 'sign').approval.id), 'signed');
  const vendor = must(await api('POST', '/vendors', E, { vendor_name: `E Sub ${TAG}`, vendor_type: 'subcontractor' }), 'vendor').id;
  must(await api('POST', `/vendors/${vendor}/prequalification`, chk.token, { decision: 'approved', reason: 'fixture prequalification' }), 'preq');
  const supplier = must(await api('POST', '/vendors', E, { vendor_name: `E Supplier ${TAG}`, vendor_type: 'supplier' }), 'supplier').id;
  const sc = must(await api('POST', '/subcontracts', E, { project_id: project, vendor_id: vendor, package_name: `E pkg ${TAG}`, contract_value: 400000, currency_id: 1, cost_code_id: 2, retention_percent: 5, advance_payment_percent: 10 }), 'sc').id;
  must(await approve(chk.token, must(await api('POST', `/subcontracts/${sc}/submit-approval`, E), 'sc submit').approval.id), 'sc active');

  // --- Plan.
  await expectStatus('the cut-over date must be the first day of a fiscal period', () => api('POST', '/finance/cutover-plans', E, { cutover_date: last }), 422);
  const plan = await run('cut-over plan prepared on the first day of the period', async () => must(await api('POST', '/finance/cutover-plans', E, { cutover_date: first }), 'plan'));
  await expectStatus('one live plan per organisation', () => api('POST', '/finance/cutover-plans', E, { cutover_date: first }), 409);
  const ta = await login({ email: 'admin.a@test.local', password: 'Passw0rd!A', org_id: 1 });
  const orgA = await api('POST', '/finance/cutover-plans', ta, { cutover_date: first });
  check('an organisation that already has postings cannot import opening balances', orgA.status === 422 && /before any GL posting/.test(orgA.body?.error ?? ''), `HTTP ${orgA.status} ${orgA.body?.error ?? ''}`);
  const load = (path, rows) => api('POST', `/finance/cutover-plans/${plan.id}/${path}`, E, { rows });

  // --- Opening trial balance (debits 658,000 = credits 658,000) and detail.
  const tb = [['bank', 500000, 0], ['ar', 120000, 0], ['ret', 30000, 0], ['sadv', 8000, 0], ['ap', 0, 40000], ['sap', 0, 25000], ['sret', 0, 15000], ['cadv', 0, 60000], ['eq', 0, 518000]];
  await run('opening trial balance loaded (9 lines)', async () => must(await load('tb-lines', tb.map(([a, debit, credit]) => ({ account_id: acc[a], debit, credit, note: `Opening ${a} (fixture)` }))), 'tb'));
  await expectStatus('a trial balance line with both debit and credit is refused', () => load('tb-lines', [{ account_id: acc.bank, debit: 1, credit: 1 }]), 422);
  must(await load('receivables', [{ client_id: client, project_id: project, contract_id: contract, reference: `INV-OLD-17-${TAG}`, amount: 70000, due_date: last, gl_account_id: acc.ar }]), 'rec 1');
  must(await load('payables', [{ vendor_id: supplier, project_id: project, reference: `SUP-OLD-9-${TAG}`, amount: 40000, gl_account_id: acc.ap },
    { vendor_id: vendor, project_id: project, subcontract_id: sc, reference: `SUB-CERT-6-${TAG}`, amount: 25000, gl_account_id: acc.sap }]), 'payables');
  await expectStatus('a payable naming a subcontract of another vendor is refused', () => load('payables', [{ vendor_id: supplier, subcontract_id: sc, reference: `BAD-${TAG}`, amount: 1, gl_account_id: acc.sap }]), 422);
  must(await load('contract-positions', [{ contract_id: contract, certified_gross_to_date: 600000, retention_held: 30000, advances_received: 100000, advance_recovered: 40000,
    cost_to_date: 450000, eac: 900000, revenue_recognised_to_date: 560000, source_reference: `Legacy IPC 6 + cost report (fixture)` }]), 'contract position');
  must(await load('subcontract-positions', [{ subcontract_id: sc, certified_gross_to_date: 300000, retention_held: 15000, advance_paid: 20000, advance_recovered: 12000, source_reference: 'Legacy certificate 6 (fixture)' }]), 'sc position');
  await expectStatus('a position recovering more advance than received is refused', () => load('subcontract-positions', [{ subcontract_id: sc, advance_paid: 1, advance_recovered: 2, source_reference: 'bad fixture' }]), 422);

  // --- Reconciliation refuses a difference: receivables control 120,000 vs detail 70,000.
  const r1 = await api('POST', `/finance/cutover-plans/${plan.id}/reconcile`, E);
  const recLine = r1.body?.data?.report?.lines?.find(l => l.check === 'receivables');
  check('reconciliation refuses the plan: receivables control 120,000 vs detail 70,000 (difference 50,000)', r1.status === 422 && Number(recLine?.difference) === 50000, JSON.stringify(recLine));
  const others = r1.body?.data?.report?.lines?.filter(l => l.check !== 'receivables');
  check('every other control account agrees (TB, payables x2, retention, advances both sides)', others?.length === 7 && others.every(l => Number(l.difference) === 0), JSON.stringify(others?.map(l => `${l.check}:${l.difference}`)));
  must(await load('receivables', [{ client_id: client, project_id: project, contract_id: contract, reference: `INV-OLD-18-${TAG}`, amount: 50000, gl_account_id: acc.ar }]), 'rec 2');
  const r2 = await run('reconciliation clean after the missing receivable is loaded', async () => must(await api('POST', `/finance/cutover-plans/${plan.id}/reconcile`, E), 'reconcile'));
  check('plan reconciled, report frozen with SHA-256', r2.plan.status === 'reconciled' && /^[0-9a-f]{64}$/.test(r2.plan.reconciliation_sha256), r2.plan.status);
  await expectStatus('lines cannot change while reconciled', () => load('tb-lines', [{ account_id: acc.bank, debit: 1 }]), 422);
  await expectStatus('the preparer cannot approve the opening balances (SoD)', () => api('POST', `/finance/cutover-plans/${plan.id}/approve`, E), 403);
  const ap = await run('a second person approves: opening journal posted, items created', async () => must(await api('POST', `/finance/cutover-plans/${plan.id}/approve`, fin.token), 'approve'));
  check('opening receivables (2) and payables (2) created', ap.receivables_created === 2 && ap.payables_created === 2, JSON.stringify(ap));
  if (OWNER) {
    const g = sql(OWNER, `select count(*) || '|' || sum(debit) || '|' || sum(credit) || '|' || count(distinct journal_batch_id) || '|' || min(transaction_date) from general_ledger where org_id = ${org} and source_module = 'opening_balance'`).out.trim();
    check(`GL: one balanced batch of 9 lines, 658,000 each side, on the cut-over date ${first}`, g === `9|658000.00|658000.00|1|${first}`, g);
  }
  await expectStatus('an opened plan cannot be reopened', () => api('POST', `/finance/cutover-plans/${plan.id}/reopen`, E), 409);

  // --- Opening subcontract payable paid: clears the subcontractors payable it was loaded in, not the payment rule account.
  const apList = must(await api('GET', '/finance/ap', E), 'ap list');
  const subAp = apList.find(x => x.source_type === 'opening' && Number(x.amount) === 25000);
  const bank = must(await api('POST', '/finance/bank-accounts', E, { bank_name: 'E Bank', account_no: `E-ACC-${TAG}`, currency_id: 1 }), 'bank').id;
  const pay = must(await api('POST', '/finance/payments', E, { payment_type: 'outgoing', party_type: 'vendor', party_id: vendor, related_ap_id: subAp.id, amount: 25000, currency_id: 1, bank_account_id: bank, method: 'transfer', reference_no: `EP-${TAG}` }), 'pay');
  must(await approve(fin.token, must(await api('POST', `/finance/payments/${pay.id}/submit-approval`, E), 'submit').approval.id), 'approve pay');
  await run('opening subcontract payable paid', async () => must(await api('POST', `/finance/payments/${pay.id}/post-gl`, E), 'post'));
  if (OWNER) {
    const d = sql(OWNER, `select coalesce(sum(debit) filter (where account_id = ${acc.sap}), 0) || '|' || coalesce(sum(debit) filter (where account_id = ${acc.ap}), 0) from general_ledger where source_table = 'payments' and source_record_id = ${pay.id}`).out.trim();
    check('GL: the payment debits subcontractors payable 25,000 (the item\'s control account), not the generic payables', d === '25000.00|0', d);
    const probe = (name, text) => { const r = sql(OWNER, text); check(name, !r.ok, r.out.split('\n').find(l => /ERROR/.test(l)) ?? r.out.slice(0, 120)); };
    probe('DB: an opened plan is immutable', `update cutover_plans set status = 'draft' where id = ${plan.id}`);
    probe('DB: opening lines of an opened plan cannot be deleted', `delete from cutover_tb_lines where plan_id = ${plan.id}`);
    probe('DB: the opening journal cannot be posted twice', `insert into general_ledger(org_id, account_id, transaction_date, debit, credit, currency_id, source_module, source_table, source_record_id, journal_batch_id, description) values (${org}, ${acc.bank}, '${first}', 1, 0, 1, 'opening_balance', 'cutover_plans', ${plan.id}, nextval('gl_journal_batch_seq'), 'replay')`);
    probe('DB: an opening receivable must equal its cut-over item', `update accounts_receivable set amount = 1 where source_type = 'opening' and org_id = ${org}`);
    probe('DB: a second plan cannot be created once postings exist', `insert into cutover_plans(org_id, cutover_date, prepared_by) select ${org}, '${first}', prepared_by from cutover_plans where id = ${plan.id}`);
  } else check('DB probes (OWNER_PSQL_URL required)', false);

  await expectStatus('tenant A cannot read tenant E cut-over plan', () => api('GET', `/finance/cutover-plans/${plan.id}`, ta), 404);
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('sweep_cutover');
