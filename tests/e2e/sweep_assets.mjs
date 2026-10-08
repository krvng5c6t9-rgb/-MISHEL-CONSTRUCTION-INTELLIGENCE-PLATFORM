// RK-003 sweep / plant & equipment (GC-30s): asset register, usage, approval, cost posting, maintenance - first runtime
// execution. Users hold all relevant permissions so that only integrity and SoD rules can stop them. TEST FIXTURES.
import { ADMIN, ADMIN_B, TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const day = (o) => new Date(Date.now() + o * 86400000).toISOString().slice(0, 10);
try {
  const admin = await login(ADMIN);
  const mkRole = async (name, perms) => must(await api('POST', '/roles', admin, { role_name: `${name} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), `role ${name}`).id;
  const mkUser = async (key, role_id) => {
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    must(await api('POST', '/users', admin, { role_id, full_name: `AS ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return login(u);
  };
  const all = await mkRole('Plant All', [['assets', 'view'], ['assets', 'create'], ['assets', 'edit'], ['assets', 'approve'], ['finance', 'view'], ['finance', 'create'], ['approvals', 'view'], ['approvals', 'approve'], ['hr', 'view'], ['hr', 'create'], ['hr', 'edit']]);
  const P = { a: await mkUser('asa', all), b: await mkUser('asb', all) };
  const conf = await mkUser('asconf', await mkRole('AS DOA Conf', [['admin', 'view'], ['admin', 'approve']]));
  if (!must(await api('GET', '/approvals/configuration/doa', admin), 'doa').some(d => d.module === 'equipment_usage' && d.is_active && d.is_confirmed && Number(d.approver_role_id) === all)) {
    const d = must(await api('POST', '/approvals/configuration/doa', admin, { module: 'equipment_usage', min_amount: 0, approval_level: 1, approver_role_id: all, notes: 'TEST FIXTURE' }), 'doa');
    must(await api('POST', `/approvals/configuration/doa/${d.id}/confirm`, conf), 'doa confirm');
  }
  const mkProject = async (code) => must(await api('POST', '/projects', admin, { project_code: `${code}-${TAG}`, project_name: `${code} ${TAG}`, currency_id: 1 }), 'project').id;
  const p1 = await mkProject('AS1'), p2 = await mkProject('AS2');
  const op = must(await api('POST', '/hr/employees', P.a, { employee_code: `OP-${TAG}`, full_name: 'Operator (fixture)', hire_date: '2025-01-01' }), 'operator');
  const gone = must(await api('POST', '/hr/employees', P.a, { employee_code: `OPX-${TAG}`, full_name: 'Former operator (fixture)', hire_date: '2025-01-01' }), 'op2');
  must(await api('PATCH', `/hr/employees/${gone.id}/status`, P.a, { employment_status: 'terminated', termination_date: day(-30) }), 'terminate');

  // --- Asset register and lifecycle.
  const ex = await run('excavator registered', async () => must(await api('POST', '/assets/equipment', P.a, { asset_code: `EX-${TAG}`, asset_name: 'Excavator 20t (fixture)', category: 'earthmoving', ownership_type: 'owned' }), 'ex'));
  await expectStatus('duplicate asset code refused', () => api('POST', '/assets/equipment', P.a, { asset_code: `EX-${TAG}`, asset_name: 'dup', ownership_type: 'owned' }), 409);
  await expectStatus('asset put in use without a project refused', () => api('PATCH', `/assets/equipment/${ex.id}/status`, P.a, { status: 'in_use' }), 422);
  await run('asset mobilised to project 1', async () => must(await api('PATCH', `/assets/equipment/${ex.id}/status`, P.a, { status: 'in_use', current_project_id: p1 }), 'mob'));
  await expectStatus('missing asset returns 404', () => api('PATCH', '/assets/equipment/999999999/status', P.a, { status: 'available' }), 404);

  // --- Usage eligibility.
  const use = (body) => api('POST', '/assets/equipment-usage', P.a, { asset_id: ex.id, project_id: p1, usage_date: day(-1), hours_used: 8, operator_id: op.id, cost_code_id: 2, currency_id: 1, hourly_rate: 150, ...body });
  const u1 = await run('usage 8 h x 150 on project 1', async () => must(await use({}), 'u1'));
  check('usage cost computed in DB = 1,200', Number(u1.cost_amount) === 1200, String(u1.cost_amount));
  await expectStatus('usage on a project where the asset is not mobilised refused', () => use({ project_id: p2 }), 422);
  await expectStatus('more than 24 machine-hours on one day refused', () => use({ hours_used: 17 }), 422);
  await expectStatus('terminated operator refused', () => use({ usage_date: day(-2), operator_id: gone.id }), 422);
  await expectStatus('usage dated in the future refused', () => use({ usage_date: day(3) }), 422);

  // --- Approval and posting (maker != approver via the DOA engine).
  const ap = await run('usage submitted for approval', async () => must(await api('PATCH', `/assets/equipment-usage/${u1.id}/approve`, P.a), 'submit').approval);
  if (OWNER) {
    const r = sql(OWNER, `update equipment_usage set hours_used=1 where id=${u1.id}`);
    check('DB: usage under approval cannot be edited', !r.ok, r.out.split('\n').find(l => /ERROR/.test(l)) ?? r.out.slice(0, 120));
  }
  await expectStatus('submitter cannot approve own usage (SoD)', () => api('POST', `/approvals/${ap.id}/actions`, P.a, { action: 'approved', comment: 'self' }), 403);
  await expectStatus('posting before approval refused', () => api('POST', `/assets/equipment-usage/${u1.id}/post-cost`, P.a), 409);
  await run('second user approves usage', async () => must(await api('POST', `/approvals/${ap.id}/actions`, P.b, { action: 'approved', comment: 'ok' }), 'appr'));
  const ct = await run('approved usage posted to project cost', async () => must(await api('POST', `/assets/equipment-usage/${u1.id}/post-cost`, P.b), 'post'));
  check('cost transaction = 1,200 actual on project 1', Number(ct.amount) === 1200 && ct.transaction_type === 'actual' && Number(ct.project_id) === p1);
  await expectStatus('usage cannot be posted twice', () => api('POST', `/assets/equipment-usage/${u1.id}/post-cost`, P.b), 409);

  // --- Maintenance and retirement.
  await expectStatus('next maintenance due before the maintenance date refused', () => api('POST', '/assets/maintenance', P.a, { asset_id: ex.id, maintenance_date: day(-1), type: 'preventive', cost: 500, next_due_date: day(-10) }), 422);
  await run('preventive maintenance recorded', async () => must(await api('POST', '/assets/maintenance', P.a, { asset_id: ex.id, maintenance_date: day(-1), type: 'preventive', cost: 500, next_due_date: day(60) }), 'maint'));
  must(await api('PATCH', `/assets/equipment/${ex.id}/status`, P.a, { status: 'maintenance' }), 'to maint');
  await expectStatus('usage while the asset is under maintenance refused', () => use({ usage_date: day(0), hours_used: 2 }), 422);
  must(await api('PATCH', `/assets/equipment/${ex.id}/status`, P.a, { status: 'retired' }), 'retire');
  await expectStatus('retired asset cannot be returned to service', () => api('PATCH', `/assets/equipment/${ex.id}/status`, P.a, { status: 'available' }), 422);
  await expectStatus('maintenance on a retired asset refused', () => api('POST', '/assets/maintenance', P.a, { asset_id: ex.id, type: 'breakdown', cost: 10 }), 422);

  const tb = await login(ADMIN_B);
  await expectStatus('tenant B cannot change tenant A asset', () => api('PATCH', `/assets/equipment/${ex.id}/status`, tb, { status: 'available' }), 404);
  const mB = must(await api('GET', '/assets/maintenance', tb), 'maint B');
  check('tenant B does not see tenant A maintenance', !mB.some(x => Number(x.asset_id) === Number(ex.id)));
  await expectStatus('tenant B cannot book usage on tenant A asset', () => api('POST', '/assets/equipment-usage', tb, { asset_id: ex.id, project_id: p1, hours_used: 1, currency_id: 1, hourly_rate: 1 }), 422);
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('sweep_assets');
