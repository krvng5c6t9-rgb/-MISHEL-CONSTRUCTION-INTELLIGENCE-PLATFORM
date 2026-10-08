// G-013 (CC-037): session revocation - logout, logout everywhere, password change, admin revoke, deactivation and
// reactivation, forged/legacy tokens, cross-tenant revoke. Passwords are TEST FIXTURES.
import { createHmac } from 'node:crypto';
import { ADMIN, ADMIN_B, TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
try {
  const admin = await login(ADMIN);
  const role = must(await api('POST', '/roles', admin, { role_name: `Sess ${TAG}`, permissions: [{ module: 'projects', action: 'view', scope: 'all' }] }), 'role').id;
  const u = { email: `sess.${TAG}@test.local`, password: 'Passw0rd!sess', org_id: ADMIN.org_id };
  const created = must(await api('POST', '/users', admin, { role_id: role, full_name: 'Session fixture', email: u.email, password: u.password }), 'user');
  const uid = created.id ?? created.user?.id;
  const me = (t) => api('GET', '/auth/me', t);

  // --- Per-session logout.
  const s1 = await login(u), s2 = await login(u);
  check('two independent sessions are valid', (await me(s1)).status === 200 && (await me(s2)).status === 200);
  await run('session 1 logs out', async () => must(await api('POST', '/auth/logout', s1), 'logout'));
  check('logged-out session refused', (await me(s1)).status === 401);
  check('other session unaffected by a single logout', (await me(s2)).status === 200);

  // --- Logout everywhere.
  const s3 = await login(u);
  must(await api('POST', '/auth/logout-all', s2), 'logout-all');
  check('logout-all revokes every session', (await me(s2)).status === 401 && (await me(s3)).status === 401);
  const s4 = await login(u);
  check('a fresh login works after logout-all', (await me(s4)).status === 200);

  // --- Password change.
  await expectStatus('password change with a wrong current password refused', () => api('POST', '/auth/change-password', s4, { current_password: 'wrong-one', new_password: 'N3wPassw0rd!sess' }), 403);
  await expectStatus('new password equal to the current one refused', () => api('POST', '/auth/change-password', s4, { current_password: u.password, new_password: u.password }), 400);
  const s5 = await login(u);
  await run('password changed', async () => must(await api('POST', '/auth/change-password', s4, { current_password: u.password, new_password: 'N3wPassw0rd!sess' }), 'change'));
  check('password change revokes all existing sessions', (await me(s4)).status === 401 && (await me(s5)).status === 401);
  check('old password no longer logs in', (await api('POST', '/auth/login', null, { ...u })).status === 401);
  u.password = 'N3wPassw0rd!sess';
  const s6 = await login(u);

  // --- Administrator actions.
  await run('admin revokes the user\'s sessions', async () => must(await api('POST', `/users/${uid}/revoke-sessions`, admin), 'revoke'));
  check('admin revoke invalidates the session', (await me(s6)).status === 401);
  const s7 = await login(u);
  must(await api('PATCH', `/users/${uid}/status`, admin, { is_active: false }), 'deactivate');
  check('deactivation refuses the session', (await me(s7)).status === 401);
  must(await api('PATCH', `/users/${uid}/status`, admin, { is_active: true }), 'reactivate');
  check('a session issued before deactivation stays dead after reactivation', (await me(s7)).status === 401);
  const tb = await login(ADMIN_B);
  await expectStatus('tenant B admin cannot revoke tenant A sessions', () => api('POST', `/users/${uid}/revoke-sessions`, tb), 404);

  // --- Forged and legacy tokens.
  const s8 = await login(u);
  const [h, p] = s8.split('.');
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
  const forged = `${h}.${b64({ ...payload, tv: payload.tv + 5 })}.${s8.split('.')[2]}`;
  check('token with a tampered session epoch refused (signature)', (await me(forged)).status === 401);
  if (OWNER) {
    const r = sql(OWNER, `delete from revoked_sessions where user_id=${uid}`);
    check('DB: live revocations cannot be purged', !r.ok, r.out.split('\n').find(l => /ERROR/.test(l)) ?? r.out.slice(0, 120));
    const r2 = sql(OWNER, `update users set token_version = 0 where id=${uid}`);
    check('DB: session epoch can never move backwards', !r2.ok, r2.out.split('\n').find(l => /ERROR/.test(l)) ?? r2.out.slice(0, 120));
  } else check('DB probes (OWNER_PSQL_URL required)', false);
  check('current session still valid at the end', (await me(s8)).status === 200);
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('sweep_sessions');
