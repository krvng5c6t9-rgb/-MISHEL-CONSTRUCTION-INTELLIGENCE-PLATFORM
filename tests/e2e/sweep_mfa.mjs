// Stage 32 / DEC-015: multi-factor sign-in (TOTP, RFC 6238) for privileged users, run against a second API server with
// the production setting MFA_ENFORCEMENT=required. Setup goes through the main (test) server. The TOTP generator below is
// written independently of the API's, so the two cross-check each other. Users and roles are TEST FIXTURES.
import { createHmac, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ADMIN, ADMIN_B, TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const MFA = process.env.MFA_API_BASE;
const mfa = async (method, path, token, body) => {
  const r = await fetch(`${MFA}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, body: j, data: j.data };
};
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const b32dec = (s) => { let bits = 0, v = 0; const out = []; for (const c of s) { v = (v << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };
const totp = (secret, offset = 0) => {
  const step = Math.floor(Date.now() / 30000) + offset, buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', b32dec(secret)).update(buf).digest(), o = h[19] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0');
};

try {
  if (!MFA) throw new Error('MFA_API_BASE not set');
  const admin = await login(ADMIN);
  const mkRole = async (name, perms) => must(await api('POST', '/roles', admin, { role_name: `${name} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), `role ${name}`).id;
  const mkUser = async (key, role_id) => { const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id }; const r = must(await api('POST', '/users', admin, { role_id, full_name: `MF ${key}`, email: u.email, password: u.password }), `user ${key}`); return { ...u, id: r.id }; };
  const fin = await mkUser('mffin', await mkRole('MF Finance', [['finance', 'view'], ['finance', 'post']]));
  const viewer = await mkUser('mfview', await mkRole('MF Viewer', [['projects', 'view']]));
  const doaRole = await mkRole('MF DOA', [['approvals', 'view'], ['approvals', 'approve']]);
  const approver = await mkUser('mfdoa', doaRole);
  const locked = await mkUser('mflock', await mkRole('MF Admin', [['admin', 'view']]));
  const conf = await login({ email: `asconf.${TAG}@test.local`, password: 'Passw0rd!asconf', org_id: ADMIN.org_id });
  const doa = must(await api('POST', '/approvals/configuration/doa', admin, { module: 'equipment_usage', min_amount: 999999999, approval_level: 9, approver_role_id: doaRole, notes: 'TEST FIXTURE (MF approver)' }), 'doa');
  must(await api('POST', `/approvals/configuration/doa/${doa.id}/confirm`, conf), 'doa confirm');
  const signIn = (u) => mfa('POST', '/auth/login', null, { email: u.email, password: u.password, org_id: u.org_id });

  // --- Who must use MFA.
  const v = await signIn(viewer);
  check('a user without privileged rights signs in with the password only', v.status === 200 && !!v.data?.token && !v.data?.challenge_token, JSON.stringify(Object.keys(v.data ?? {})));
  const d = await signIn(approver);
  check('a DOA approver (approvals rights only) must set up MFA', d.status === 200 && d.data?.mfa_enrollment_required === true && !d.data?.token, JSON.stringify(d.data ?? {}).slice(0, 80));
  const f1 = await signIn(fin);
  check('a finance user who posts must set up MFA: the password step returns a challenge, never a session', f1.data?.mfa_enrollment_required === true && !!f1.data?.challenge_token && !f1.data?.token, JSON.stringify(Object.keys(f1.data ?? {})));
  await expectStatus('a challenge token is not a session (refused by the API)', () => mfa('GET', '/auth/me', f1.data.challenge_token), 401);
  await expectStatus('wrong password still refused before any challenge', () => mfa('POST', '/auth/login', null, { email: fin.email, password: 'WrongPassw0rd!', org_id: fin.org_id }), 401);

  // --- Enrolment.
  const en = await run('enrolment returns a secret and an authenticator URI', async () => { const r = await mfa('POST', '/auth/mfa/enroll', null, { challenge_token: f1.data.challenge_token }); if (!r.ok) throw new Error(JSON.stringify(r.body)); return r.data; });
  check('authenticator URI is a standard otpauth TOTP URI (SHA1, 6 digits, 30 s)', /^otpauth:\/\/totp\/.+secret=[A-Z2-7]+.*digits=6&period=30/.test(en.otpauth_uri), en.otpauth_uri);
  await expectStatus('a wrong code does not complete the set-up', () => mfa('POST', '/auth/mfa/enroll/confirm', null, { challenge_token: f1.data.challenge_token, code: totp(en.secret, 5) }), 401);
  const done = await run('the code from the authenticator completes the set-up', async () => { const r = await mfa('POST', '/auth/mfa/enroll/confirm', null, { challenge_token: f1.data.challenge_token, code: totp(en.secret) }); if (!r.ok) throw new Error(JSON.stringify(r.body)); return r.data; });
  check('set-up returns a session and ten one-time recovery codes', !!done.token && Array.isArray(done.recovery_codes) && done.recovery_codes.length === 10, String(done.recovery_codes?.length));
  const st = await mfa('GET', '/auth/mfa/status', done.token);
  check('status: MFA enabled and required, enforcement on, 10 codes left', st.data?.enabled === true && st.data?.required === true && st.data?.enforcement === 'required' && st.data?.recovery_codes_remaining === 10, JSON.stringify(st.data));
  await expectStatus('set-up cannot be repeated with an old challenge', () => mfa('POST', '/auth/mfa/enroll', null, { challenge_token: f1.data.challenge_token }), 409);

  // --- Sign-in with the second factor.
  const f2 = await signIn(fin);
  check('an enrolled user is asked for the code', f2.data?.mfa_required === true && !f2.data?.token);
  await expectStatus('the code just used cannot be replayed', () => mfa('POST', '/auth/mfa/verify', null, { challenge_token: f2.data.challenge_token, code: totp(en.secret) }), 401);
  const ok2 = await mfa('POST', '/auth/mfa/verify', null, { challenge_token: f2.data.challenge_token, code: totp(en.secret, 1) });
  check('the next code signs in', ok2.status === 200 && !!ok2.data?.token, `HTTP ${ok2.status} ${JSON.stringify(ok2.body?.error ?? '')}`);
  await expectStatus('the session works', () => mfa('GET', '/auth/me', ok2.data?.token), 200);
  const f3 = await signIn(fin);
  const rc = done.recovery_codes[0];
  const rec = await mfa('POST', '/auth/mfa/verify', null, { challenge_token: f3.data.challenge_token, recovery_code: rc });
  check('a recovery code signs in once (9 left)', rec.status === 200 && !!rec.data?.token && rec.data?.recovery_codes_remaining === 9, `HTTP ${rec.status} ${rec.data?.recovery_codes_remaining}`);
  const f4 = await signIn(fin);
  await expectStatus('the same recovery code is refused the second time', () => mfa('POST', '/auth/mfa/verify', null, { challenge_token: f4.data.challenge_token, recovery_code: rc }), 401);
  await expectStatus('a verify challenge cannot be used to enrol again', () => mfa('POST', '/auth/mfa/enroll', null, { challenge_token: f4.data.challenge_token }), 401);

  // --- Lockout: wrong codes count as failed sign-ins (5 in the window -> locked).
  const l1 = await signIn(locked);
  const len = (await mfa('POST', '/auth/mfa/enroll', null, { challenge_token: l1.data.challenge_token })).data;
  must(await mfa('POST', '/auth/mfa/enroll/confirm', null, { challenge_token: l1.data.challenge_token, code: totp(len.secret) }), 'enrol locked user');
  const l2 = await signIn(locked);
  for (let i = 0; i < 5; i++) await mfa('POST', '/auth/mfa/verify', null, { challenge_token: l2.data.challenge_token, code: '000000' });
  await expectStatus('after 5 wrong codes even the right code is refused (locked)', () => mfa('POST', '/auth/mfa/verify', null, { challenge_token: l2.data.challenge_token, code: totp(len.secret, 1) }), 429);

  // --- Administrator reset (lost device).
  await expectStatus('a reset needs a reason', () => api('POST', `/users/${fin.id}/mfa-reset`, admin, { reason: 'short' }), 400);
  const adminId = must(await api('GET', '/auth/me', admin), 'me').id;
  await expectStatus('an administrator cannot reset their own MFA', () => api('POST', `/users/${adminId}/mfa-reset`, admin, { reason: 'Lost my own phone (fixture)' }), 403);
  await run('administrator resets the finance user MFA with a reason', async () => must(await api('POST', `/users/${fin.id}/mfa-reset`, admin, { reason: 'Phone lost - identity confirmed by HR (fixture)' }), 'reset'));
  await expectStatus('the reset ends the user sessions', () => mfa('GET', '/auth/me', ok2.data.token), 401);
  const f5 = await signIn(fin);
  check('after the reset the user must set up MFA again', f5.data?.mfa_enrollment_required === true, JSON.stringify(f5.data ?? {}).slice(0, 80));
  await expectStatus('a challenge issued before the reset is dead', () => mfa('POST', '/auth/mfa/verify', null, { challenge_token: f4.data.challenge_token, code: totp(en.secret, 1) }), 401);

  if (OWNER) {
    const q = (t) => sql(OWNER, t).out.trim();
    check('DB: the TOTP secret is stored encrypted, never in clear', q(`select count(*) from users where id = ${locked.id} and mfa_secret_enc like 'v1:%' and position('${len.secret}' in mfa_secret_enc) = 0`) === '1');
    check('DB: recovery codes are stored as SHA-256 only', q(`select count(*) from mfa_recovery_codes where user_id = ${fin.id} and code_sha256 = '${createHash('sha256').update(rc).digest('hex')}' and used_at is not null`) === '1');
    check('DB: the reset revoked the unused recovery codes', q(`select count(*) from mfa_recovery_codes where user_id = ${fin.id} and used_at is null and revoked_at is null`) === '0');
    check('DB: the reset is recorded with the administrator and the reason', q(`select count(*) from mfa_events where user_id = ${fin.id} and event = 'reset' and actor_id = ${adminId}`) === '1');
    const probe = (name, text) => { const r = sql(OWNER, text); check(name, !r.ok, r.out.split('\n').find(l => /ERROR/.test(l)) ?? r.out.slice(0, 120)); };
    probe('DB: MFA events are append-only', `delete from mfa_events where user_id = ${fin.id}`);
    probe('DB: a used recovery code cannot be reused', `update mfa_recovery_codes set used_at = null where user_id = ${fin.id} and used_at is not null`);
  } else check('DB probes (OWNER_PSQL_URL required)', false);

  const tb = await login(ADMIN_B);
  await expectStatus('tenant B cannot reset a tenant A user MFA', () => api('POST', `/users/${fin.id}/mfa-reset`, tb, { reason: 'cross tenant attempt (fixture)' }), 404);

  // --- Production never runs with MFA off.
  if (process.env.BACKEND_DIR) {
    const p = spawnSync('node', ['dist/server.js'], { cwd: process.env.BACKEND_DIR, timeout: 15000, encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'production', MFA_ENFORCEMENT: 'off', MFA_ENCRYPTION_KEY: 'k'.repeat(40), PORT: '4199' } });
    check('the API refuses to start in production with MFA off', p.status !== 0 && /MFA_ENFORCEMENT must be required/.test(p.stderr + p.stdout), `exit ${p.status} ${(p.stderr || '').split('\n').find(l => /Error/.test(l)) ?? ''}`);
  } else check('production start check (BACKEND_DIR required)', false);
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('sweep_mfa');
