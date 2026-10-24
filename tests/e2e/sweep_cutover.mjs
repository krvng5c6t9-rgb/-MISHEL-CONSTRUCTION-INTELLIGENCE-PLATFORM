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

  // --- F-51 (CC-080): the cut-over screen's names come from one lookup under the finance permission, so a finance user
  // who may not read clients / projects / subcontracts still sees names (not #id); the lookup is the organisation's only.
  const noClients = await api('GET', '/clients', fin.token);
  const lk = await api('GET', '/finance/cutover-lookups', fin.token), d = lk.body?.data ?? {};
  check('F-51: a finance-only user gets client, project, contract, vendor, subcontract and account names for the cut-over',
    noClients.status === 403 && lk.status === 200 && d.clients?.some(x => x.id === client && x.client_name === `E Client ${TAG}`)
    && d.projects?.some(x => x.id === project && x.project_code === `E1-${TAG}`) && d.contracts?.some(x => x.id === contract && x.project_code === `E1-${TAG}`)
    && d.vendors?.some(x => x.id === vendor) && d.subcontracts?.some(x => x.id === sc && x.package_name === `E pkg ${TAG}`) && d.accounts?.some(x => x.id === acc.ar && x.account_code === '1200'),
    `clients HTTP ${noClients.status}, lookups HTTP ${lk.status}`);
  const lkA = (await api('GET', '/finance/cutover-lookups', ta)).body?.data ?? {};
  check('F-51: the cut-over lookup of another organisation does not include this one\'s records', Array.isArray(lkA.clients) && !lkA.clients.some(x => x.id === client) && !lkA.projects.some(x => x.id === project));
  const noFin = await user('nofin', 'No finance', [['projects', 'view']]);
  await expectStatus('F-51: the cut-over lookup needs the finance permission', () => api('GET', '/finance/cutover-lookups', noFin.token), 403);

  // --- Opening trial balance (debits 658,000 = credits 658,000) and detail.
  const tb = [['bank', 500000, 0], ['ar', 120000, 0], ['ret', 30000, 0], ['sadv', 8000, 0], ['ap', 0, 40000], ['sap', 0, 25000], ['sret', 0, 15000], ['cadv', 0, 60000], ['eq', 0, 518000]];
  await run('opening trial balance loaded (9 lines)', async () => must(await load('tb-lines', tb.map(([a, debit, credit]) => ({ account_id: acc[a], debit, credit, note: `Opening ${a} (fixture)` }))), 'tb'));
  await expectStatus('a trial balance line with both debit and credit is refused', () => load('tb-lines', [{ account_id: acc.bank, debit: 1, credit: 1 }]), 422);
  const dry = await api('POST', `/finance/cutover-plans/${plan.id}/tb-lines?dry_run=1`, E, { rows: [{ account_id: acc.bank, debit: 5, credit: 0 }, { account_id: acc.bank, debit: 1, credit: 1 }, { debit: 'x' }] });
  const after = must(await api('GET', `/finance/cutover-plans/${plan.id}`, E), 'plan detail')['tb-lines'].length;
  check('dry run checks every row (1 accepted, 2 refused with their reasons) and saves nothing', dry.status === 200 && dry.body?.data?.accepted === 1 && dry.body?.data?.refused === 2
    && dry.body.data.rows[1].ok === false && /check constraint/.test(dry.body.data.rows[1].error) && after === 9, `HTTP ${dry.status} ${JSON.stringify(dry.body?.data ?? dry.body).slice(0, 200)} lines ${after}`);
  const partial = await api('POST', `/finance/cutover-plans/${plan.id}/tb-lines`, E, { rows: [{ account_id: acc.bank, debit: 5, credit: 0 }, { account_id: acc.bank, debit: 1, credit: 1 }] });
  check('a load with any refused row loads nothing', partial.status === 422 && /1 of 2 rows refused/.test(partial.body?.error ?? '') && must(await api('GET', `/finance/cutover-plans/${plan.id}`, E), 'detail')['tb-lines'].length === 9, `HTTP ${partial.status} ${partial.body?.error ?? ''}`);
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

  // ===== Stage 35 / F-49: live engines continue from the opening positions. =====
  const maker = await user('mkr', 'Subcontract maker', [['contracts', 'view'], ['contracts', 'create']]);
  const site = await user('site', 'Site verifier', [['contracts', 'view'], ['site', 'approve']]);
  const ccRole = must(await api('POST', '/roles', E, { role_name: 'Cost control', permissions: ['view', 'manage', 'approve'].map(action => ({ module: 'cost_control', action, scope: 'all' })) }), 'cc role').id;
  const ccUser = async (key) => { must(await api('POST', '/users', E, { role_id: ccRole, full_name: `${key} E`, email: `${key}.e.${TAG}@test.local`, password: `Passw0rd!${key}` }), key); return login({ email: `${key}.e.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: org }); };
  const qs = await ccUser('ccqs'), cm = await ccUser('cccm');
  const today = new Date().toISOString().slice(0, 10);

  // Client side: advance outstanding and "less previous" start from the opening position.
  const advPos = must(await api('GET', `/finance/contracts/${contract}/advance-position`, E), 'advance position');
  check('client advance position includes the opening: received 100,000, recovered 40,000, outstanding 60,000, net certified 530,000',
    Number(advPos.advances_received) === 100000 && Number(advPos.advance_recovered) === 40000 && Number(advPos.advance_outstanding) === 60000 && Number(advPos.net_certified) === 530000, JSON.stringify(advPos));
  const ipc = (n, body) => api('POST', '/finance/ipcs', E, { project_id: project, contract_id: contract, ipc_no: `E-IPC${n}-${TAG}`, period_from: first, period_to: today, gross_work_done_this_period: 100000, cumulative_gross_work_done: 700000, less_retention: 5000, ...body });
  await expectStatus('IPC recovering more than the opening advance outstanding (60,001 > 60,000) is refused', () => ipc(1, { less_advance_recovery: 60001 }), 422);
  await expectStatus('IPC "less previous" above the net certified before cut-over (530,001 > 530,000) is refused', () => ipc(2, { less_advance_recovery: 10000, less_previous_certified: 530001 }), 422);
  // Cumulative valuation: gross to date 700,000 (600,000 before cut-over + 100,000), retention 5 % = 35,000, less previous 530,000.
  await expectStatus('IPC within the opening figures accepted (cumulative 700,000, recovery 10,000, less previous 530,000)', () => ipc(3, { gross_work_done_this_period: 700000, less_retention: 35000, less_advance_recovery: 10000, less_previous_certified: 530000 }), 201);
  await expectStatus('a new client advance counts the opening advance toward the limit (100,000 + 20,001 > 10% of 1,200,000)', () => api('POST', '/finance/client-advances', E, { contract_id: contract, amount: 20001 }), 422);

  // Subcontract side: the next certificate measures cumulatively from the opening certified gross.
  const cert = async (no, recovery) => {
    const c = must(await api('POST', '/subcontracts/certificates', maker.token, { subcontract_id: sc, project_id: project, certificate_no: `E-SC${no}-${TAG}`, period_from: first, period_to: today, gross_work_done: 50000, less_retention: 2500, less_advance_recovery: recovery }), 'cert');
    must(await api('POST', `/subcontracts/certificates/${c.id}/lines`, maker.token, { description: 'Formwork m2 (fixture)', quantity_this_period: 50, cumulative_quantity: 350, unit_rate: 1000 }), 'line');
    return api('POST', `/subcontracts/certificates/${c.id}/verify`, site.token);
  };
  const v1 = await cert(1, 8001);
  check('certificate recovering more than the opening advance outstanding (8,001 > 8,000) is refused', v1.status === 422 && /outstanding paid advance 8000/.test(v1.body?.error ?? ''), `HTTP ${v1.status} ${v1.body?.error ?? ''}`);
  const v2 = await cert(2, 8000);
  check('next certificate continues from the opening cumulative: previous 300,000, to date 350,000 (lines 350 x 1,000)',
    v2.status === 200 && Number(v2.body.data.previous_cumulative_gross) === 300000 && Number(v2.body.data.cumulative_gross_to_date) === 350000, `HTTP ${v2.status} ${v2.body?.error ?? JSON.stringify({ p: v2.body?.data?.previous_cumulative_gross, c: v2.body?.data?.cumulative_gross_to_date })}`);

  // Revenue: the first run continues from the revenue recognised before cut-over.
  const rev = must(await api('POST', '/finance/chart-of-accounts', E, { account_code: '4110', account_name: 'Contract revenue recognised (fixture)', account_type: 'revenue' }), 'rev acct').id;
  must(await api('POST', '/finance/gl-posting-rules', E, { source_module: 'revenue_recognition', debit_account_id: acc.bill, credit_account_id: rev, notes: 'TEST FIXTURE' }), 'rev rule');
  const snap = must(await api('POST', '/cost-transactions/snapshots', qs, { project_id: project, cost_code_id: 2, as_of: today, etc_method: 'manual', etc_amount: 450000, etc_basis: 'Remaining works after cut-over (fixture)' }), 'snapshot');
  must(await api('POST', `/cost-transactions/snapshots/${snap.id}/approve`, cm), 'approve snapshot');
  const before = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).toISOString().slice(0, 10);
  const early = await api('POST', '/finance/revenue-runs', E, { contract_id: contract, period_start: before, period_end: today });
  check('a revenue run starting before the cut-over date is refused', early.status === 422 && /start on or after/.test(early.body?.error ?? ''), `HTTP ${early.status} ${early.body?.error ?? ''}`);
  const runE = await run('first revenue run after cut-over prepared', async () => must(await api('POST', '/finance/revenue-runs', E, { contract_id: contract, period_start: first, period_end: today }), 'run'));
  check('run: cost 450,000 (before cut-over) / EAC 900,000 = 0.5; revenue to date 600,000; previous = opening 560,000; period 40,000; billed 600,000 -> position 0',
    Number(runE.cost_to_date) === 450000 && Number(runE.eac) === 900000 && Number(runE.progress) === 0.5 && Number(runE.cumulative_revenue) === 600000 && Number(runE.previous_revenue) === 560000
      && Number(runE.period_revenue) === 40000 && Number(runE.billings_to_date) === 600000 && Number(runE.contract_position) === 0,
    JSON.stringify({ c: runE.cost_to_date, e: runE.eac, g: runE.progress, r: runE.cumulative_revenue, p: runE.previous_revenue, d: runE.period_revenue, b: runE.billings_to_date }));
  must(await api('POST', `/finance/revenue-runs/${runE.id}/approve`, fin.token), 'approve run');
  if (OWNER) check('GL: only the period revenue 40,000 is recognised (not the 600,000 to date)', sql(OWNER, `select coalesce(sum(credit),0) from general_ledger where source_module='revenue_recognition' and source_record_id=${runE.id} and account_id=${rev}`).out.trim() === '40000.00');

  // Opening retention release.
  const held = must(await api('GET', '/finance/opening-retentions', E), 'opening retentions');
  const cPos = held.find(h => h.kind === 'client'), sPos = held.find(h => h.kind === 'subcontract');
  check('opening retention listed: client 30,000 and subcontract 15,000 held', Number(cPos?.retention_held) === 30000 && Number(sPos?.retention_held) === 15000, JSON.stringify(held));
  const rel = (tok, kind, position_id, amount) => api('POST', '/finance/opening-retentions/release', tok, { kind, position_id, amount, reason: 'Taking-over certificate issued for the tower (fixture)', reference: `TOC-E-${TAG}` });
  const selfRel = await rel(E, 'client', cPos.position_id, 10000);
  check('the cut-over preparer cannot release the opening retention (SoD)', selfRel.status === 422 && /Segregation of duties/.test(selfRel.body?.error ?? ''), `HTTP ${selfRel.status} ${selfRel.body?.error ?? ''}`);
  const cr = await run('half the client retention released in part (10,000 of 30,000)', async () => must(await rel(fin.token, 'client', cPos.position_id, 10000), 'client release'));
  check('client release becomes a receivable of 10,000 for the contract client', cr.accounts_receivable?.source_type === 'opening_retention' && Number(cr.accounts_receivable.amount) === 10000 && Number(cr.accounts_receivable.client_id) === client, JSON.stringify(cr.accounts_receivable));
  await expectStatus('a release above what remains held is refused (25,000 > 20,000)', () => rel(fin.token, 'client', cPos.position_id, 25000), 422);
  const sr = must(await rel(fin.token, 'subcontract', sPos.position_id, 15000), 'sub release');
  check('subcontract release becomes a payable of 15,000 to the subcontractor', sr.accounts_payable?.source_type === 'opening_retention' && Number(sr.accounts_payable.amount) === 15000 && Number(sr.accounts_payable.vendor_id) === vendor, JSON.stringify(sr.accounts_payable));
  const rp = must(await api('POST', '/finance/payments', E, { payment_type: 'outgoing', party_type: 'vendor', party_id: vendor, related_ap_id: sr.accounts_payable.id, amount: 15000, currency_id: 1, bank_account_id: bank, method: 'transfer', reference_no: `ERP-${TAG}` }), 'ret pay');
  must(await approve(fin.token, must(await api('POST', `/finance/payments/${rp.id}/submit-approval`, E), 'submit').approval.id), 'approve ret pay');
  must(await api('POST', `/finance/payments/${rp.id}/post-gl`, E), 'post ret pay');
  if (OWNER) {
    const q = (t) => sql(OWNER, t).out.trim();
    check('GL: client release reclassified Dr receivables 10,000 / Cr retention receivable 10,000',
      q(`select coalesce(sum(debit) filter (where account_id=${acc.ar}),0) || '|' || coalesce(sum(credit) filter (where account_id=${acc.ret}),0) from general_ledger where source_table='opening_retention_releases' and source_record_id=${cr.release.id}`) === '10000.00|10000.00');
    check('GL: paying the released subcontract retention debits retention payable 15,000', q(`select coalesce(sum(debit),0) from general_ledger where source_table='payments' and source_record_id=${rp.id} and account_id=${acc.sret}`) === '15000.00');
    const probe = (name, text) => { const r = sql(OWNER, text); check(name, !r.ok, r.out.split('\n').find(l => /ERROR/.test(l)) ?? r.out.slice(0, 120)); };
    probe('DB: a retention release is frozen', `update opening_retention_releases set amount = 1 where id = ${cr.release.id}`);
    probe('DB: retention releases are never deleted', `delete from opening_retention_releases where id = ${cr.release.id}`);
  }
  const pos = must(await api('GET', `/finance/contracts/${contract}/receivable-position`, E), 'position');
  check('contract position continues from cut-over: billed 600,000, retention held 20,000 / released 10,000, advance liability 60,000',
    Number(pos.billed_gross) === 600000 && Number(pos.retention_held) === 20000 && Number(pos.retention_released) === 10000 && Number(pos.advance_liability) === 60000, JSON.stringify({ b: pos.billed_gross, h: pos.retention_held, r: pos.retention_released, a: pos.advance_liability }));
  const sPosition = must(await api('GET', `/subcontracts/${sc}/deductions-position`, E), 'sc position');
  // Certificate 2 left draft (site-verified), so its 8,000 recovery is committed: the opening advance 20,000 - 12,000 - 8,000 = 0.
  check('subcontract position: opening advance paid 20,000, recovered 12,000 + 8,000, outstanding 0; opening retention unreleased 0',
    Number(sPosition.advances_paid) === 20000 && Number(sPosition.advance_recovered) === 20000 && Number(sPosition.advance_outstanding) === 0 && Number(sPosition.opening_retention_unreleased) === 0,
    JSON.stringify({ p: sPosition.advances_paid, c: sPosition.advance_recovered, o: sPosition.advance_outstanding, r: sPosition.opening_retention_unreleased }));
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('sweep_cutover');
