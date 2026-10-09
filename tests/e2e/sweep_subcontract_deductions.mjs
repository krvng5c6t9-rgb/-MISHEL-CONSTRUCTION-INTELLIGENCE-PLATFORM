// Stage 20 / GC-12 steps 4-5: subcontract advance payments and recovery, back-charges, "less previous", net never
// negative. Subcontract value, advance %, recovery rate, retention and amounts are TEST FIXTURES (no policy values).
// Runs after wave1_subcontract_ipc (reuses its DOA fixture, approver and vendor-approver users).
import { ADMIN, ADMIN_B, TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
try {
  const admin = await login(ADMIN);
  const mkRole = async (name, perms) => must(await api('POST', '/roles', admin, { role_name: `${name} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), `role ${name}`).id;
  const mkUser = async (key, role_id) => {
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    must(await api('POST', '/users', admin, { role_id, full_name: `SD ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return login(u);
  };
  const existing = (key) => login({ email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id });
  const maker = await mkUser('sdmaker', await mkRole('SD Maker', [['contracts', 'view'], ['contracts', 'create']]));
  const qsRole = await mkRole('SD QS', [['contracts', 'view'], ['contracts', 'create'], ['contracts', 'approve']]);
  const qs = await mkUser('sdqs', qsRole), qs2 = await mkUser('sdqs2', qsRole);
  const site = await mkUser('sdsite', await mkRole('SD Site', [['contracts', 'view'], ['site', 'approve']]));
  const appr = await existing('scappr'), vend = await existing('scvend');

  const project = must(await api('POST', '/projects', admin, { project_code: `SD-${TAG}`, project_name: `SD ${TAG}`, currency_id: 1 }), 'project').id;
  const vendor = must(await api('POST', '/vendors', admin, { vendor_name: `SD Sub ${TAG}`, vendor_type: 'subcontractor' }), 'vendor').id;
  must(await api('POST', `/vendors/${vendor}/prequalification`, vend, { decision: 'approved', reason: 'fixture prequalification' }), 'preq');
  const sc = must(await api('POST', '/subcontracts', admin, { project_id: project, vendor_id: vendor, package_name: `SD pkg ${TAG}`, contract_value: 200000, currency_id: 1, cost_code_id: 2, retention_percent: 10, advance_payment_percent: 10 }), 'sc');
  must(await api('POST', `/approvals/${must(await api('POST', `/subcontracts/${sc.id}/submit-approval`, admin), 'sc submit').approval.id}/actions`, appr, { action: 'approved', comment: 'sd' }), 'sc approve');

  // --- Advances.
  const noAdv = must(await api('GET', '/subcontracts', admin), 'list').find(s => s.package_name === `SC pkg ${TAG}`);
  await expectStatus('advance refused where the subcontract provides none', () => api('POST', '/subcontracts/advances', maker, { subcontract_id: noAdv.id, amount: 1000 }), 422);
  await expectStatus('advance above the subcontract advance % refused (25,000 > 10% of 200,000)', () => api('POST', '/subcontracts/advances', maker, { subcontract_id: sc.id, amount: 25000 }), 422);
  const adv = await run('maker records the advance (20,000, recovery 25% of gross, guarantee ref)', async () => must(await api('POST', '/subcontracts/advances', maker, { subcontract_id: sc.id, amount: 20000, recovery_percent: 25, guarantee_ref: `APG-${TAG}` }), 'adv'));
  await expectStatus('a further advance beyond the limit is refused', () => api('POST', '/subcontracts/advances', maker, { subcontract_id: sc.id, amount: 1 }), 422);
  await expectStatus('preparer cannot approve own advance (SoD)', () => api('POST', `/subcontracts/advances/${adv.id}/approve`, maker), 403);
  await expectStatus('an unapproved advance cannot be paid', () => api('POST', `/subcontracts/advances/${adv.id}/paid`, qs, { payment_reference: `PAY-${TAG}` }), 409);
  must(await api('POST', `/subcontracts/advances/${adv.id}/approve`, qs), 'approve adv');
  await expectStatus('payment needs a payment reference', () => api('POST', `/subcontracts/advances/${adv.id}/paid`, qs2, {}), 400);
  await run('advance recorded as paid with its payment reference', async () => must(await api('POST', `/subcontracts/advances/${adv.id}/paid`, qs2, { payment_reference: `PAY-${TAG}` }), 'paid'));

  // --- Certificates: helper creates a draft and returns its id.
  let n = 0;
  const cert = async (body) => must(await api('POST', '/subcontracts/certificates', maker, { subcontract_id: sc.id, project_id: project, certificate_no: `SD${++n}-${TAG}`, period_from: day(-30), period_to: day(-1), ...body }), `cert ${n}`).id;
  const verify = (cid) => api('POST', `/subcontracts/certificates/${cid}/verify`, site);
  const expectVerify = async (name, cid, pattern) => {
    const r = await verify(cid);
    check(name, r.status === 422 && pattern.test(r.body?.error ?? ''), `HTTP ${r.status} ${r.body?.error ?? ''}`);
  };
  const approveCert = async (cid) => {
    must(await api('POST', `/subcontracts/certificates/${cid}/qs-certify`, qs), 'qs certify');
    const a = must(await api('POST', `/subcontracts/certificates/${cid}/submit-approval`, qs), 'submit').approval;
    must(await api('POST', `/approvals/${a.id}/actions`, appr, { action: 'approved', comment: 'sd cert' }), 'approve cert');
  };

  await expectVerify('recovery different from the recorded rate refused (9,000 vs 25% of 40,000)', await cert({ gross_work_done: 40000, less_retention: 4000, less_advance_recovery: 9000 }), /recovery due 10000/);

  // --- Back-charges.
  const bc1 = await run('back-charge raised with cause and amount', async () => must(await api('POST', '/subcontracts/backcharges', maker, { subcontract_id: sc.id, reference: `BC1-${TAG}`, cause: 'Debris left in zone B cleared by main contractor after instruction (fixture)', amount: 3000 }), 'bc1'));
  await expectStatus('cause needs substance', () => api('POST', '/subcontracts/backcharges', maker, { subcontract_id: sc.id, reference: `BCX-${TAG}`, cause: 'cleanup', amount: 10 }), 400);
  await expectStatus('back-charge not approved before the subcontractor is notified', () => api('POST', `/subcontracts/backcharges/${bc1.id}/approve`, qs), 422);
  await expectStatus('a notice date in the future is refused', () => api('POST', `/subcontracts/backcharges/${bc1.id}/notify`, maker, { notified_on: day(3) }), 422);
  must(await api('POST', `/subcontracts/backcharges/${bc1.id}/notify`, maker, { notified_on: day(-2) }), 'notify');
  const bcQ = must(await api('POST', '/subcontracts/backcharges', qs, { subcontract_id: sc.id, reference: `BCQ-${TAG}`, cause: 'Damaged kerbs replaced by main contractor (fixture)', amount: 500, notified_on: day(-1) }), 'bcq');
  await expectStatus('raiser cannot approve own back-charge (SoD)', () => api('POST', `/subcontracts/backcharges/${bcQ.id}/approve`, qs), 403);
  await run('second person approves the notified back-charge', async () => must(await api('POST', `/subcontracts/backcharges/${bc1.id}/approve`, qs), 'approve bc1'));

  await expectVerify('a deduction without an applied back-charge is refused', await cert({ gross_work_done: 40000, less_retention: 4000, less_advance_recovery: 10000, penalties_deductions: 1500 }), /must equal the back-charges/);
  const cB = await cert({ gross_work_done: 40000, less_retention: 4000, less_advance_recovery: 10000, penalties_deductions: 3000 });
  await expectStatus('a back-charge not yet approved cannot be applied', () => api('POST', `/subcontracts/backcharges/${bcQ.id}/apply`, maker, { certificate_id: cB }), 409);
  const other = await cert({ gross_work_done: 1000 });
  must(await api('POST', `/subcontracts/backcharges/${bc1.id}/apply`, maker, { certificate_id: other }), 'apply to other');
  must(await api('POST', `/subcontracts/backcharges/${bc1.id}/detach`, maker), 'detach while draft');
  await run('approved back-charge applied to the certificate', async () => must(await api('POST', `/subcontracts/backcharges/${bc1.id}/apply`, maker, { certificate_id: cB }), 'apply'));
  const vB = await verify(cB);
  check('certificate verified: recovery at the recorded rate, deduction equal to applied back-charges', vB.status === 200 && Number(vB.body.data.net_amount_due) === 23000, `HTTP ${vB.status} net=${vB.body?.data?.net_amount_due} ${vB.body?.error ?? ''}`);
  await expectStatus('a back-charge on a verified certificate cannot be detached', () => api('POST', `/subcontracts/backcharges/${bc1.id}/detach`, maker), 422);
  await approveCert(cB);
  await run('subcontractor dispute recorded against the back-charge', async () => must(await api('POST', `/subcontracts/backcharges/${bc1.id}/response`, maker, { response: 'disputed', note: 'Subcontractor letter: debris belonged to others (fixture)' }), 'dispute'));

  // --- Less previous and net never negative.
  await expectVerify('less previous above the net certified on earlier approved certificates refused (30,000 > 23,000)', await cert({ gross_work_done: 20000, less_retention: 2000, less_advance_recovery: 5000, less_previous_paid: 30000 }), /exceeds the net certified/);
  const cE = await cert({ gross_work_done: 20000, less_retention: 2000, less_advance_recovery: 5000 });
  check('second certificate verified with recovery 5,000 (outstanding then 5,000)', (await verify(cE)).status === 200);
  await expectVerify('recovery above the outstanding advance refused', await cert({ gross_work_done: 40000, less_advance_recovery: 10000 }), /exceeds the outstanding paid advance|differs from the recovery due 5000/);
  // Race: two certificates both recovering the last 5,000; exactly one may be verified.
  const f1 = await cert({ gross_work_done: 40000, less_advance_recovery: 5000 }), f2 = await cert({ gross_work_done: 40000, less_advance_recovery: 5000 });
  const race = await Promise.all([verify(f1), verify(f2)]);
  check('concurrent verifications cannot both recover the last 5,000 (one 200, one 422)', race.map(r => r.status).sort().join(',') === '200,422', race.map(r => `${r.status} ${r.body?.error ?? ''}`).join(' | '));
  const neg = await cert({ gross_work_done: 1000, less_previous_paid: 1500 });
  await expectVerify('negative net refused (defect: the 043 check read an uncomputed generated column)', neg, /cannot be negative/);

  // --- Withdrawal and position.
  await expectStatus('withdrawal needs a reason', () => api('POST', `/subcontracts/backcharges/${bcQ.id}/withdraw`, qs2, {}), 400);
  must(await api('POST', `/subcontracts/backcharges/${bcQ.id}/withdraw`, qs2, { reason: 'Kerbs were damaged by others (fixture)' }), 'withdraw');
  await expectStatus('a withdrawn back-charge cannot be approved', () => api('POST', `/subcontracts/backcharges/${bcQ.id}/approve`, qs2), 409);
  const pos = must(await api('GET', `/subcontracts/${sc.id}/deductions-position`, maker), 'position');
  check('position: 20,000 paid, 20,000 recovered, 0 outstanding, 3,000 applied and disputed, 23,000 approved net', Number(pos.advances_paid) === 20000 && Number(pos.advance_recovered) === 20000 && Number(pos.advance_outstanding) === 0 && Number(pos.backcharges.applied) === 3000 && Number(pos.backcharges_disputed) === 3000 && Number(pos.net_certified_approved) === 23000, JSON.stringify(pos));

  if (OWNER) {
    const probe = (name, text) => { const r = sql(OWNER, text); check(name, !r.ok, r.out.split('\n').find(l => /ERROR/.test(l)) ?? r.out.slice(0, 120)); };
    probe('DB: a paid advance is immutable', `update subcontract_advances set amount = 1 where id = ${adv.id}`);
    probe('DB: back-charges are never deleted', `delete from subcontract_backcharges where id = ${bc1.id}`);
    probe('DB: approved back-charge amount frozen', `update subcontract_backcharges set amount = 1 where id = ${bc1.id}`);
    const audit = sql(OWNER, `select count(*) from (with g as (select table_name t, column_name c from information_schema.columns where is_generated='ALWAYS' and table_schema='public'),
      tr as (select c.relname t, p.prosrc src from pg_trigger x join pg_class c on c.oid=x.tgrelid join pg_proc p on p.oid=x.tgfoid where not x.tgisinternal and (x.tgtype & 2) = 2)
      select 1 from tr join g on g.t = tr.t where tr.src ~* ('NEW\\.' || g.c || '\\M')) z`);
    check('DB audit: no BEFORE trigger reads a generated column of its own table from NEW', audit.ok && /^\s*0\s*$/m.test(audit.out), audit.out.trim().slice(0, 120));
  } else check('DB probes (OWNER_PSQL_URL required)', false);

  const tb = await login(ADMIN_B);
  const bList = must(await api('GET', `/subcontracts/advances?subcontract_id=${sc.id}`, tb), 'b list');
  check('tenant B sees no tenant A advances', bList.length === 0);
  await expectStatus('tenant B cannot approve a tenant A back-charge', () => api('POST', `/subcontracts/backcharges/${bcQ.id}/approve`, tb), 404);
  await expectStatus('tenant B cannot read a tenant A deductions position', () => api('GET', `/subcontracts/${sc.id}/deductions-position`, tb), 404);
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('sweep_subcontract_deductions');
