// G-017 / Stage 11: failed sign-ins lock the account key temporarily (same answer for real and unknown emails),
// a per-address failure limit, admin unlock within the tenant, append-only login events, no timing signal for
// unknown accounts, and throttle state unreachable for the API role. Gate config (TEST FIXTURE values):
// LOGIN_MAX_FAILED_ATTEMPTS=5, LOGIN_FAILURE_WINDOW_MINUTES=15, LOGIN_LOCKOUT_MINUTES=15, LOGIN_ADDRESS_MAX_FAILURES=20, TRUST_PROXY=1.
import { ADMIN, ADMIN_B, TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL, APP = process.env.APP_PSQL_URL;
const from = (ip) => ({ 'X-Forwarded-For': ip });
const attempt = (email, password, ip, org_id = 1) => api('POST', '/auth/login', null, { email, password, org_id }, from(ip));
try {
  const admin = await login(ADMIN);
  const role = must(await api('POST', '/roles', admin, { role_name: `LT Viewer ${TAG}`, permissions: [{ module: 'projects', action: 'view', scope: 'all' }] }), 'role').id;
  const mk = async (key) => {
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: 1 };
    u.id = must(await api('POST', '/users', admin, { role_id: role, full_name: `LT ${key}`, email: u.email, password: u.password }), `user ${key}`).id;
    return u;
  };
  const U = await mk('ltu'), V = await mk('ltv'), W = await mk('ltw');
  const ipA = '198.51.100.11', ipB = '198.51.100.12', ipC = '203.0.113.50', ipD = '198.51.100.13';

  // --- Account lockout after 5 failures within the window.
  const fails = [];
  for (let i = 0; i < 5; i++) fails.push((await attempt(U.email, 'wrong-password-1', ipA)).status);
  check('five wrong passwords answer 401 (the 5th locks the account key)', fails.every(s => s === 401), fails.join(','));
  const locked = await attempt(U.email, U.password, ipA);
  check('correct password refused while locked: 429 with Retry-After', locked.status === 429 && /Too many failed sign-in attempts/.test(locked.body?.error ?? ''), `HTTP ${locked.status} ${JSON.stringify(locked.body?.error)}`);
  await expectStatus('lockout follows the account, not the address', () => attempt(U.email, U.password, ipB), 429);

  // --- Unknown emails get exactly the same treatment (no account enumeration).
  const ghost = `ghost.${TAG}@test.local`;
  for (let i = 0; i < 5; i++) await attempt(ghost, 'wrong-password-1', ipD);
  const g = await attempt(ghost, 'wrong-password-1', ipD);
  check('unknown email locks the same way with the same message', g.status === 429 && g.body?.error === locked.body?.error, `HTTP ${g.status}`);
  const t0 = Date.now(); await attempt(`nobody.${TAG}@test.local`, 'wrong-password-1', ipD); const tUnknown = Date.now() - t0;
  const t1 = Date.now(); await attempt(W.email, 'wrong-password-1', ipD); const tKnown = Date.now() - t1;
  check('unknown email takes comparable time to a wrong password (bcrypt work done)', tUnknown >= tKnown * 0.5, `unknown=${tUnknown}ms known=${tKnown}ms`);

  // --- Admin unlock (own tenant only).
  const tb = await login(ADMIN_B);
  await expectStatus('tenant B admin cannot unlock a tenant A user', () => api('POST', `/users/${U.id}/unlock-login`, tb), 404);
  await run('tenant A admin unlocks the user', async () => must(await api('POST', `/users/${U.id}/unlock-login`, admin), 'unlock'));
  await run('user signs in after unlock', async () => must(await attempt(U.email, U.password, ipA), 'login after unlock'));

  // --- A success resets the failure count.
  for (let i = 0; i < 4; i++) await attempt(V.email, 'wrong-password-1', ipB);
  must(await attempt(V.email, V.password, ipB), 'success resets');
  for (let i = 0; i < 4; i++) await attempt(V.email, 'wrong-password-1', ipB);
  await run('4 + success + 4 failures does not lock', async () => must(await attempt(V.email, V.password, ipB), 'not locked'));

  // --- Lock expiry (time moved by the owner role; the lockout is temporary).
  for (let i = 0; i < 5; i++) await attempt(W.email, 'wrong-password-1', ipB);
  await expectStatus('W locked', () => attempt(W.email, W.password, ipB), 429);
  if (OWNER) sql(OWNER, `update login_account_throttle set locked_until = now() - interval '1 second' where email_key = '${W.email}'`);
  await run('sign-in allowed again once the lockout has expired', async () => must(await attempt(W.email, W.password, ipB), 'after expiry'));

  // --- Per-address failure limit (20 failures from one address, spread over different emails).
  for (let i = 0; i < 20; i++) await attempt(`spray${i}.${TAG}@test.local`, 'wrong-password-1', ipC);
  const blocked = await attempt(V.email, V.password, ipC);
  check('address over its failure limit is refused even with a correct password', blocked.status === 429, `HTTP ${blocked.status}`);
  await run('same user from another address still signs in', async () => must(await attempt(V.email, V.password, ipB), 'other address'));

  // --- Login events.
  const ev = must(await api('GET', '/users/login-events?limit=500', admin), 'events');
  const mine = ev.filter(e => e.email_key === U.email).map(e => e.outcome);
  check('events record failures, lockout, blocked attempt, unlock and success for the account', ['failure', 'locked_out', 'blocked_locked', 'unlocked', 'success'].every(o => mine.includes(o)), mine.join(','));
  const evB = must(await api('GET', '/users/login-events?limit=500', tb), 'events B');
  check('tenant B sees no tenant A login events', !evB.some(e => e.email_key === U.email));
  await expectStatus('non-admin cannot read login events', async () => api('GET', '/users/login-events', await login(V)), 403);

  if (APP && OWNER) {
    const denied = (name, url, text) => { const r = sql(url, text); check(name, !r.ok, r.out.split('\n').find(l => /ERROR/.test(l)) ?? r.out.slice(0, 120)); };
    denied('DB: API role cannot read throttle state', APP, `select count(*) from login_account_throttle`);
    denied('DB: API role cannot reset address throttle', APP, `delete from login_address_throttle`);
    denied('DB: API role cannot forge login events', APP, `insert into login_events(org_id,email_key,outcome) values(1,'x','success')`);
    denied('DB: login events are append-only', OWNER, `delete from login_events where email_key = '${U.email}'`);
  } else check('DB probes (APP_PSQL_URL and OWNER_PSQL_URL required)', false);
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('sweep_login_throttling');
