// Wave 1 / G-003 + G-006 (F-03, F-08): tenant bootstrap hardening and go-live readiness (GC-31).
// Needs: BOOTSTRAP_ADMIN_TOKEN, DATABASE_URL, JWT_SECRET (exported by run_from_zero.sh), OWNER_PSQL_URL.
// Every configuration value created here (accounts, rules, DOA bands, periods) is a TEST FIXTURE.
import { spawn } from 'node:child_process';
import { TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';
import { BASE } from './lib.mjs';

const BT = process.env.BOOTSTRAP_ADMIN_TOKEN, OWNER = process.env.OWNER_PSQL_URL;
const boot = (body, base = BASE) => fetch(`${base}/auth/bootstrap-admin`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-bootstrap-token': BT }, body: JSON.stringify(body) })
  .then(async r => ({ status: r.status, ok: r.ok, body: await r.json().catch(() => null) }));

try {
  // --- A new tenant starts not ready, and sees none of tenant A's configuration.
  const c = await run('bootstrap tenant C (multi-tenant bootstrap enabled in this test server)', async () => {
    const r = await boot({ organization: { name: `Tenant C ${TAG}`, base_currency_code: 'EGP' }, full_name: 'Admin C', email: `admin.c.${TAG}@test.local`, password: 'Passw0rd!C' });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${JSON.stringify(r.body)}`); return r.body.data;
  });
  const C = { email: `admin.c.${TAG}@test.local`, password: 'Passw0rd!C', org_id: c.organization.id };
  const tc = c.token;
  const r0 = must(await api('GET', '/onboarding/readiness', tc), 'readiness');
  const st = k => r0.items.find(i => i.key === k);
  check('fresh tenant is not ready', r0.ready === false);
  check('fresh tenant: no accounts, rules, DOA, periods, banks, vendors (tenant A data not visible)',
    ['chart_of_accounts', 'gl_posting_rules', 'doa_rules', 'open_fiscal_period', 'bank_accounts', 'qualified_vendors', 'roles', 'users'].every(k => st(k).ready === false) && st('base_currency').ready,
    r0.items.filter(i => i.ready).map(i => i.key).join(','));

  // --- Tenant admin completes configuration (fixtures), with a second user for maker/checker.
  const mkRole = async (name, perms) => must(await api('POST', '/roles', tc, { role_name: `${name}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), `role ${name}`).id;
  const checkerRole = await mkRole('Checker', [['admin', 'view'], ['admin', 'approve'], ['vendors', 'view'], ['vendors', 'approve']]);
  must(await api('POST', '/users', tc, { role_id: checkerRole, full_name: 'Checker C', email: `checker.c.${TAG}@test.local`, password: 'Passw0rd!K' }), 'checker');
  const checker = await login({ email: `checker.c.${TAG}@test.local`, password: 'Passw0rd!K', org_id: C.org_id });
  const acct = async (code, name, type) => must(await api('POST', '/finance/chart-of-accounts', tc, { account_code: `${code}`, account_name: name, account_type: type }), `coa ${code}`).id;
  const exp = await acct('5100', 'Cost (fixture)', 'expense'), ap = await acct('2100', 'AP (fixture)', 'liability'), ar = await acct('1200', 'AR (fixture)', 'asset'), rev = await acct('4100', 'Revenue (fixture)', 'revenue'), bank = await acct('1010', 'Bank (fixture)', 'asset');
  for (const [m, sub, d, cr] of [['cost_transaction', 'procurement', exp, ap], ['ipc', null, ar, rev], ['payment', 'outgoing', ap, bank]]) {
    must(await api('POST', '/finance/gl-posting-rules', tc, { source_module: m, source_subtype: sub, debit_account_id: d, credit_account_id: cr, notes: 'TEST FIXTURE' }), `rule ${m}`);
  }
  const d = new Date(), y = d.getUTCFullYear(), mth = d.getUTCMonth() + 1;
  must(await api('POST', '/finance/fiscal-periods', tc, { fiscal_year: y, period_no: mth, start_date: `${y}-${String(mth).padStart(2, '0')}-01`, end_date: new Date(Date.UTC(y, mth, 0)).toISOString().slice(0, 10) }), 'period');
  must(await api('POST', '/finance/bank-accounts', tc, { bank_name: 'Fixture Bank', account_no: `C-${TAG}`, currency_id: 1 }), 'bank');
  const v = must(await api('POST', '/vendors', tc, { vendor_name: `C Vendor ${TAG}` }), 'vendor');
  must(await api('POST', `/vendors/${v.id}/prequalification`, checker, { decision: 'approved', reason: 'fixture prequalification' }), 'preq');
  const r1 = must(await api('GET', '/onboarding/readiness', tc), 'readiness');
  const missing = r1.items.find(i => i.key === 'doa_rules').missing;
  check('readiness lists every approval module still lacking a confirmed DOA rule', missing.length === 14, missing.join(','));
  for (const module of missing) {
    const row = must(await api('POST', '/approvals/configuration/doa', tc, { module, min_amount: 0, approval_level: 1, approver_role_id: checkerRole, notes: 'TEST FIXTURE' }), `doa ${module}`);
    must(await api('POST', `/approvals/configuration/doa/${row.id}/confirm`, checker), `confirm ${module}`);
  }
  const r2 = must(await api('GET', '/onboarding/readiness', tc), 'readiness');
  check('before cost codes, only cost_codes remains', r2.items.filter(i => !i.ready).map(i => i.key).join(',') === 'cost_codes');

  // --- G-014 cost-code management (tenant data, nothing defaulted).
  const cc1 = must(await api('POST', '/cost-codes', tc, { code: '01', description: 'Preliminaries (fixture)', cost_type: 'preliminaries' }), 'cc1');
  const cc2 = must(await api('POST', '/cost-codes', tc, { code: '01.01', description: 'Site setup (fixture)', cost_type: 'preliminaries', parent_code_id: cc1.id }), 'cc2');
  await expectStatus('duplicate global cost code refused', () => api('POST', '/cost-codes', tc, { code: '01', description: 'dup code', cost_type: 'overhead' }), 409);
  await expectStatus('cost-code hierarchy cycle refused', () => api('PATCH', `/cost-codes/${cc1.id}`, tc, { parent_code_id: cc2.id }), 422);
  await expectStatus('parent from another tenant refused', () => api('POST', '/cost-codes', tc, { code: '99', description: 'cross tenant parent', cost_type: 'overhead', parent_code_id: 2 }), 422);
  await run('unused code may be renamed', async () => must(await api('PATCH', `/cost-codes/${cc2.id}`, tc, { code: '01.02' }), 'rename'));
  const ta = await login({ email: 'admin.a@test.local', password: 'Passw0rd!A', org_id: 1 });
  await expectStatus('code carrying cost cannot be renamed (tenant A code 2 has chain cost)', () => api('PATCH', '/cost-codes/2', ta, { code: 'CHANGED' }), 422);
  await run('description of a used code stays editable', async () => must(await api('PATCH', '/cost-codes/2', ta, { description: 'Material (fixture description)' }), 'desc'));
  await expectStatus('tenant C cannot edit tenant A code', () => api('PATCH', '/cost-codes/2', tc, { description: 'cross tenant' }), 404);
  const r3 = must(await api('GET', '/onboarding/readiness', tc), 'readiness');
  check('tenant C fully ready after configuration', r3.ready === true, r3.items.filter(i => !i.ready).map(i => i.key).join(','));

  const viewerRole = await mkRole('No Admin', [['projects', 'view']]);
  must(await api('POST', '/users', tc, { role_id: viewerRole, full_name: 'Viewer C', email: `viewer.c.${TAG}@test.local`, password: 'Passw0rd!W' }), 'viewer');
  const viewer = await login({ email: `viewer.c.${TAG}@test.local`, password: 'Passw0rd!W', org_id: C.org_id });
  await expectStatus('readiness requires admin.view', () => api('GET', '/onboarding/readiness', viewer), 403);

  // --- F-08: an organization whose users were all deactivated cannot be re-claimed.
  const dOrg = await run('bootstrap tenant D', async () => { const r = await boot({ organization: { name: `Tenant D ${TAG}`, base_currency_code: 'EGP' }, full_name: 'Admin D', email: `admin.d.${TAG}@test.local`, password: 'Passw0rd!D' }); if (!r.ok) throw new Error(JSON.stringify(r.body)); return r.body.data.organization.id; });
  const deact = OWNER ? sql(OWNER, `update users set is_active=false where org_id=${dOrg}`) : { ok: false, out: 'OWNER_PSQL_URL missing' };
  check('fixture: all users of D deactivated', deact.ok, deact.out.slice(0, 80));
  const claim = await boot({ org_id: dOrg, full_name: 'Attacker', email: `attacker.${TAG}@test.local`, password: 'Passw0rd!X' });
  check('bootstrap cannot claim an org whose users are all inactive (F-08)', claim.status === 409, `HTTP ${claim.status} ${JSON.stringify(claim.body?.error ?? '')}`);
  const wrong = await fetch(`${BASE}/auth/bootstrap-admin`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-bootstrap-token': 'x'.repeat(64) }, body: JSON.stringify({ organization: { name: 'nope', base_currency_code: 'EGP' }, full_name: 'n', email: `n.${TAG}@test.local`, password: 'Passw0rd!N' }) });
  check('wrong bootstrap token refused', wrong.status === 403, `HTTP ${wrong.status}`);

  // --- Default (production) setting: a second server with multi-tenant bootstrap disabled.
  const port = Number(process.env.SECOND_API_PORT ?? 4199);
  const srv = spawn('node', ['dist/server.js'], { cwd: new URL('../../backend/', import.meta.url).pathname, env: { ...process.env, PORT: String(port), ALLOW_MULTI_TENANT_BOOTSTRAP: 'false' }, stdio: 'ignore' });
  try {
    let up = false;
    for (let i = 0; i < 40 && !up; i++) { await new Promise(r => setTimeout(r, 250)); up = await fetch(`http://localhost:${port}/api/health`).then(r => r.ok).catch(() => false); }
    check('second API (multi-tenant bootstrap off) started', up);
    const r = await boot({ organization: { name: `Tenant E ${TAG}`, base_currency_code: 'EGP' }, full_name: 'Admin E', email: `admin.e.${TAG}@test.local`, password: 'Passw0rd!E' }, `http://localhost:${port}/api`);
    check('with default setting, bootstrap cannot create another tenant once any user exists', r.status === 403, `HTTP ${r.status} ${JSON.stringify(r.body?.error ?? '')}`);
  } finally { srv.kill(); }
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('wave1_tenant_onboarding');
