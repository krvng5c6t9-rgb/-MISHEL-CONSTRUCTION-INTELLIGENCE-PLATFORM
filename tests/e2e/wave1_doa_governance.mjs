// Wave 1 / G-004: DOA lifecycle - draft -> independent confirmation -> immutable -> supersede/retire.
// Amount bands below are TEST FIXTURES; real bands are owner decisions (DEC: DOA configurable, no invented values).
import { ADMIN, ADMIN_B, TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
try {
  const admin = await login(ADMIN);
  const mkRole = async (name, perms) => must(await api('POST', '/roles', admin, { role_name: `${name} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), `role ${name}`).id;
  const mkUser = async (key, role_id) => {
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    must(await api('POST', '/users', admin, { role_id, full_name: `DOA ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return login(u);
  };
  const editorRole = await mkRole('DOA Editor', [['admin', 'view'], ['admin', 'manage'], ['admin', 'approve']]);
  const manageOnly = await mkRole('DOA Manage Only', [['admin', 'view'], ['admin', 'manage']]);
  const confRole = await mkRole('DOA Conf', [['admin', 'view'], ['admin', 'approve']]);
  const approverRole = await mkRole('DOA Approver Role', [['approvals', 'view'], ['approvals', 'approve']]);
  const T = { ed: await mkUser('doaed', editorRole), mo: await mkUser('doamo', manageOnly), c1: await mkUser('doac1', confRole), c2: await mkUser('doac2', confRole) };
  const MOD = `w1_test_module_${TAG}`.slice(0, 60);

  await expectStatus('confirm-in-PATCH is refused (separate step)', () => api('PATCH', '/approvals/configuration/doa/1', T.ed, { notes: 'x', confirm: true }), 422);
  await expectStatus('max <= min refused', () => api('POST', '/approvals/configuration/doa', T.ed, { module: MOD, min_amount: 100, max_amount: 50, approval_level: 1, approver_role_id: approverRole }), 400);
  await expectStatus('confirmer without admin.manage cannot draft', () => api('POST', '/approvals/configuration/doa', T.c1, { module: MOD, min_amount: 0, approval_level: 1, approver_role_id: approverRole }), 403);
  const d1 = await run('editor creates draft band 0-1000 (fixture)', async () => must(await api('POST', '/approvals/configuration/doa', T.ed, { module: MOD, min_amount: 0, max_amount: 1000, approval_level: 1, approver_role_id: approverRole, notes: 'TEST FIXTURE' }), 'd1'));
  check('draft is unconfirmed', d1.is_confirmed === false);
  await run('editor revises draft upper bound to 2000', async () => must(await api('PATCH', `/approvals/configuration/doa/${d1.id}`, T.ed, { max_amount: 2000 }), 'edit'));
  await expectStatus('editor cannot confirm own draft (SoD)', () => api('POST', `/approvals/configuration/doa/${d1.id}/confirm`, T.ed), 403);
  await expectStatus('user without admin.approve cannot confirm', () => api('POST', `/approvals/configuration/doa/${d1.id}/confirm`, T.mo), 403);
  await run('independent confirmer confirms', async () => must(await api('POST', `/approvals/configuration/doa/${d1.id}/confirm`, T.c1), 'confirm'));
  await expectStatus('confirmed rule cannot be edited', () => api('PATCH', `/approvals/configuration/doa/${d1.id}`, T.ed, { max_amount: 5000 }), 409);
  await expectStatus('confirmed rule cannot be confirmed twice', () => api('POST', `/approvals/configuration/doa/${d1.id}/confirm`, T.c2), 409);

  // Overlapping confirmed band refused (migration 021 guard).
  const d2 = must(await api('POST', '/approvals/configuration/doa', T.ed, { module: MOD, min_amount: 1500, max_amount: 3000, approval_level: 1, approver_role_id: approverRole }), 'd2');
  await expectStatus('overlapping band cannot be confirmed', () => api('POST', `/approvals/configuration/doa/${d2.id}/confirm`, T.c1), 422);

  // Supersession: new version replaces the old one atomically on confirmation.
  await expectStatus('superseding draft must be same module', () => api('POST', '/approvals/configuration/doa', T.ed, { module: 'other_module', supersedes_id: d1.id, min_amount: 0, max_amount: 3000, approval_level: 1, approver_role_id: approverRole }), 422);
  const d3 = await run('editor drafts version 2 (0-3000) superseding v1', async () => must(await api('POST', '/approvals/configuration/doa', T.ed, { module: MOD, supersedes_id: d1.id, min_amount: 0, max_amount: 3000, approval_level: 1, approver_role_id: approverRole }), 'd3'));
  await run('confirmer confirms version 2', async () => must(await api('POST', `/approvals/configuration/doa/${d3.id}/confirm`, T.c2), 'c3'));
  const list = must(await api('GET', '/approvals/configuration/doa', admin), 'list').filter(d => d.module === MOD);
  const v1 = list.find(d => d.id === d1.id), v2 = list.find(d => d.id === d3.id);
  check('v1 retired with reason and retired_by, v2 active+confirmed', !v1.is_active && /superseded by DOA rule/.test(v1.retired_reason) && v1.retired_by && v2.is_active && v2.is_confirmed, JSON.stringify({ v1a: v1.is_active, r: v1.retired_reason, v2a: v2.is_active }));

  // Retirement.
  await expectStatus('retire needs a reason', () => api('POST', `/approvals/configuration/doa/${d3.id}/retire`, T.c1, {}), 400);
  await run('retire version 2 with reason', async () => must(await api('POST', `/approvals/configuration/doa/${d3.id}/retire`, T.c1, { reason: 'fixture: policy withdrawn' }), 'retire'));
  await expectStatus('retired rule cannot be retired again', () => api('POST', `/approvals/configuration/doa/${d3.id}/retire`, T.c1, { reason: 'again again' }), 409);

  // Cross-tenant: role from another tenant cannot be used; B cannot act on A rules.
  const tb = await login(ADMIN_B);
  const bRole = must(await api('POST', '/roles', tb, { role_name: `B approver ${TAG}`, permissions: [{ module: 'approvals', action: 'approve', scope: 'all' }] }), 'b role').id;
  await expectStatus('A cannot use a tenant-B role as approver', () => api('POST', '/approvals/configuration/doa', T.ed, { module: MOD, min_amount: 5000, approval_level: 1, approver_role_id: bRole }), 422);
  await expectStatus('tenant B cannot confirm tenant A draft', () => api('POST', `/approvals/configuration/doa/${d2.id}/confirm`, tb), 404);
  await expectStatus('tenant B cannot retire tenant A rule', () => api('POST', `/approvals/configuration/doa/${d1.id}/retire`, tb, { reason: 'cross tenant' }), 404);

  if (OWNER) {
    const probe = (name, text) => { const r = sql(OWNER, text); check(name, !r.ok, r.out.split('\n').find(l => /ERROR/.test(l)) ?? r.out.slice(0, 120)); };
    probe('DB: confirmed rule amounts immutable even as owner', `update delegation_of_authority set max_amount=999999 where id=${d3.id}`);
    probe('DB: DOA rules cannot be deleted', `delete from delegation_of_authority where id=${d2.id}`);
    probe('DB: rule cannot be inserted pre-confirmed', `insert into delegation_of_authority(org_id,module,min_amount,approval_level,approver_role_id,is_confirmed) values(${ADMIN.org_id},'x',0,1,${approverRole},true)`);
    probe('DB: retired rule cannot be reactivated', `update delegation_of_authority set is_active=true where id=${d1.id}`);
  } else check('DB probes (OWNER_PSQL_URL required)', false);
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('wave1_doa_governance');
