// Stage 32 / DEC-015 browser verification of the sign-in screen against the API server running with MFA required:
// a finance user who posts sets up the authenticator on screen (key shown, code entered, recovery codes shown once),
// reaches the application, signs out, signs in again with a fresh code; a wrong code is refused on screen; a recovery
// code works once. The TOTP below is computed from the key the screen displays. Users are TEST FIXTURES.
// Run by tests/e2e/run_from_zero.sh when UI_CHECK=1 (CI does).
import { createHash, createHmac } from 'node:crypto';
import { chromium } from 'playwright';

const BASE = process.env.UI_BASE;
const MAIN_API = process.env.MAIN_API;
const RUN = process.env.RUN_ID ?? '';
const TAG = /^[A-Za-z0-9]{1,8}$/.test(RUN) ? RUN : createHash('sha256').update(RUN).digest('hex').slice(0, 8); // as harness.mjs
const OUT = process.env.OUT_DIR ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`); };
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const b32dec = (s) => { let bits = 0, v = 0; const out = []; for (const c of s) { v = (v << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };
const totp = (secret, offset = 0) => {
  const step = Math.floor(Date.now() / 30000) + offset, buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', b32dec(secret)).update(buf).digest(), o = h[19] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0');
};
const post = async (path, token, body) => {
  const r = await fetch(`${MAIN_API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const j = await r.json(); if (!r.ok) throw new Error(`${path} ${r.status} ${JSON.stringify(j.error)}`); return j.data;
};

let browser;
try {
  if (!BASE || !MAIN_API) throw new Error('UI_BASE and MAIN_API are required');
  const admin = (await post('/auth/login', null, { email: 'admin.a@test.local', password: 'Passw0rd!A', org_id: 1 })).token;
  const role = (await post('/roles', admin, { role_name: `MF UI Finance ${TAG}`, permissions: ['view', 'post'].map(action => ({ module: 'finance', action, scope: 'all' })) })).id;
  const u = { email: `mfui.${TAG}@test.local`, password: 'Passw0rd!mfui' };
  await post('/users', admin, { role_id: role, full_name: 'MF UI user', email: u.email, password: u.password });

  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  // 401 = refused codes; 403 = dashboard sections a finance-only user may not read (as in the other browser checks).
  page.on('console', m => { if (m.type() === 'error' && !/status of 40[13]/.test(m.text())) consoleErrors.push(m.text()); });
  const passwordStep = async () => {
    await page.goto(`${BASE}/login`);
    const inputs = page.locator('input');
    await inputs.nth(0).fill('1'); await inputs.nth(1).fill(u.email); await inputs.nth(2).fill(u.password);
    await page.getByRole('button', { name: 'Login' }).click();
  };

  // --- First sign-in: set-up.
  await passwordStep();
  await page.locator('[data-section="mfa-enroll"]').waitFor({ timeout: 15000 });
  check('a privileged user is taken to the authenticator set-up after the password', true);
  const secret = (await page.locator('.mfa-secret').innerText()).replace(/\s+/g, '');
  check('the set-up shows the key for the authenticator app', /^[A-Z2-7]{32}$/.test(secret), secret.length + ' chars');
  check('no session is stored before the second factor', await page.evaluate(() => Object.values(localStorage).every(v => !String(v).startsWith('eyJ'))));
  await page.locator('input').first().fill(totp(secret, 4));
  await page.getByRole('button', { name: 'Verify' }).click();
  await page.locator('.error-box').waitFor({ timeout: 10000 });
  check('a wrong code is refused on screen', /Invalid authentication code/.test(await page.locator('.error-box').innerText()));
  await page.locator('input').first().fill(totp(secret));
  await page.getByRole('button', { name: 'Verify' }).click();
  await page.locator('[data-section="mfa-recovery-codes"]').waitFor({ timeout: 15000 });
  const codes = await page.locator('.recovery-codes li').allInnerTexts();
  check('ten recovery codes are shown once after the set-up', codes.length === 10 && codes.every(c => /^[0-9a-f]{5}-[0-9a-f]{5}$/.test(c.trim())), codes.length + '');
  await page.getByRole('button', { name: 'حفظتها — متابعة' }).click();
  await page.waitForURL(x => !x.pathname.startsWith('/login'), { timeout: 15000 });
  await page.getByRole('button', { name: 'Logout' }).waitFor({ timeout: 15000 });
  check('after the set-up the user reaches the application', true);
  await page.getByRole('button', { name: 'Logout' }).click();
  await page.waitForURL(/\/login/);

  // --- Second sign-in: code.
  await passwordStep();
  await page.locator('[data-section="mfa-verify"]').waitFor({ timeout: 15000 });
  check('an enrolled user is asked for the authenticator code', true);
  await page.locator('input').first().fill(totp(secret, 1));
  await page.getByRole('button', { name: 'Verify' }).click();
  await page.getByRole('button', { name: 'Logout' }).waitFor({ timeout: 15000 });
  check('a fresh code signs in', !page.url().includes('/login'), page.url());
  await page.getByRole('button', { name: 'Logout' }).click();
  await page.waitForURL(/\/login/);

  // --- Recovery code.
  await passwordStep();
  await page.locator('[data-section="mfa-verify"]').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'فقدت الجهاز؟ استخدم رمز استرداد' }).click();
  await page.locator('input').first().fill(codes[0].trim());
  await page.getByRole('button', { name: 'Verify' }).click();
  await page.getByRole('button', { name: 'Logout' }).waitFor({ timeout: 15000 });
  check('a recovery code signs in when the device is lost', !page.url().includes('/login'), page.url());
  await page.screenshot({ path: `${OUT}/mfa_login_${RUN}.png` });
  check('no browser console errors besides refused codes and permission refusals',consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} catch (e) {
  check('mfa login browser check completed', false, e.message.slice(0, 200));
} finally {
  await browser?.close();
}
const fail = results.filter(r => !r.ok).length;
console.log(`\nSUMMARY mfa_login_ui PASS=${results.length - fail} FAIL=${fail}`);
process.exitCode = fail ? 1 : 0;
