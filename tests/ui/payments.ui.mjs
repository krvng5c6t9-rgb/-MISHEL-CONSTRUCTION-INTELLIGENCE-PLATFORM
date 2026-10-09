// Stage 23 (F-38) browser verification of the Payments & Certification screen against the gate's data (same RUN_ID):
// client certification recorded through the screen (preparer refused, second person records a certified amount below
// the submitted net with a reason), client advance position, subcontract back-charge raised/noticed with the raiser's
// approval refused and a second person approving, sections a user may not read named on screen.
// Run by tests/e2e/run_from_zero.sh when UI_CHECK=1 (CI does).
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const BASE = process.env.UI_BASE ?? 'http://localhost:4173';
const RUN = process.env.RUN_ID ?? '';
const TAG = /^[A-Za-z0-9]{1,8}$/.test(RUN) ? RUN : createHash('sha256').update(RUN).digest('hex').slice(0, 8); // as harness.mjs
const OUT = process.env.OUT_DIR ?? '.';
const today = new Date().toISOString().slice(0, 10);
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`); };
const user = (key) => ({ org_id: 1, email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}` });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
let phase = '';
const consoleErrors = [], apiFailures = [], foreignHosts = new Set();
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of 403/.test(m.text())) consoleErrors.push(m.text()); });
page.on('response', r => { if (r.url().includes('/api/') && r.status() >= 400) apiFailures.push({ phase, status: r.status(), method: r.request().method(), path: r.url().replace(/^.*\/api/, '') }); });
page.on('request', r => { const h = new URL(r.url()).hostname; if (!['localhost', '127.0.0.1'].includes(h) && !r.url().startsWith('data:')) foreignHosts.add(h); });
const answers = [];
page.on('dialog', d => d.accept(d.type() === 'prompt' ? (answers.length ? answers.shift() : '') : undefined));

const settleUi = () => page.waitForTimeout(1500);
const section = (name) => page.locator(`[data-section="${name}"]`);
const alertText = async () => (await page.locator('[role="alert"]').count()) ? await page.locator('[role="alert"]').innerText() : '';
const click = async (scope, name, ...prompts) => { answers.length = 0; answers.push(...prompts); await scope.getByRole('button', { name, exact: true }).first().click(); await settleUi(); };
const signIn = async (key) => {
  phase = key;
  if (!page.url().endsWith('/login')) { await page.goto(`${BASE}/login`); }
  const inputs = page.locator('input');
  const u = user(key);
  await inputs.nth(0).fill(String(u.org_id)); await inputs.nth(1).fill(u.email); await inputs.nth(2).fill(u.password);
  await page.getByRole('button', { name: 'Login' }).click();
  await page.waitForURL(x => !x.pathname.startsWith('/login'), { timeout: 15000 });
  await page.getByRole('link', { name: 'Payments & Certification' }).click();
  await page.waitForURL(/payments-certification/);
  await settleUi();
};
const signOut = async () => { await page.getByRole('button', { name: 'Logout' }).click(); await page.waitForURL(/\/login/); };
const pick = async (label, contains) => {
  await page.waitForFunction(([l, c]) => [...document.querySelectorAll(`select[aria-label="${l}"] option`)].some(o => o.textContent.includes(c)), [label, contains], { timeout: 15000 }).catch(() => {});
  const value = await page.locator(`select[aria-label="${label}"] option`).evaluateAll((os, c) => os.find(o => o.textContent.includes(c))?.value, contains);
  if (!value) throw new Error(`${label} option containing "${contains}" not found`);
  await page.selectOption(`select[aria-label="${label}"]`, value); await settleUi();
};

try {
  // --- Client certification: the IPC preparer is refused; a second person records 45,000 against 47,500 submitted.
  await signIn('cifm1');
  check('finance preparer opens Payments & Certification from the navigation', await page.getByRole('heading', { name: 'Payments & Certification' }).isVisible());
  const ipcRow = () => section('ipcs').locator('tbody tr', { hasText: `CC3-${TAG}` });
  check('submitted IPC listed with its submitted net', /submitted_to_client/.test(await ipcRow().innerText()) && /47500/.test(await ipcRow().innerText()), (await ipcRow().innerText()).replace(/\s+/g, ' '));
  await click(ipcRow(), 'Record certification', '47500', `CC3-REF-${TAG}`, today);
  check('IPC preparer recording the client certification is refused on screen (SoD)', /preparer/i.test(await alertText()) && /submitted_to_client/.test(await ipcRow().innerText()), await alertText());
  await signOut();

  await signIn('cifm2');
  check('subcontract section the finance user may not read is named, not shown empty', /subcontracts \(Missing permission/.test(await section('unloaded').innerText().catch(() => '')), (await section('unloaded').innerText().catch(() => '(no notice)')).slice(0, 160));
  await click(ipcRow(), 'Record certification', '45000', `CC3-REF-${TAG}`, today, 'Client excluded 2,500 of unapproved materials (UI fixture)');
  const certified = (await ipcRow().innerText()).replace(/\s+/g, ' ');
  check('second person records certification: 45,000 certified, 2,500 difference, client reference shown', /client_approved/.test(certified) && /45000/.test(certified) && /2500\.00/.test(certified) && new RegExp(`CC3-REF-${TAG}`).test(certified) && !(await alertText()), certified);
  await pick('Contract', `— CI ${TAG}`);
  const advText = (await section('client-advances').innerText()).replace(/\s+/g, ' ');
  check('client advance position: 50,000 received and fully recovered', /Received 50,000\.00/.test(advText) && /Outstanding 0\.00/.test(advText), advText.slice(0, 200));
  await page.screenshot({ path: `${OUT}/ui_payments_certification.png`, fullPage: true });
  await signOut();

  // --- Subcontract back-charge: raised and noticed by one QS, own approval refused, approved by a second QS.
  await signIn('sdqs');
  check('client IPC section the QS may not read is named on screen', /client IPCs \(Missing permission/.test(await section('unloaded').innerText().catch(() => '')));
  await pick('Subcontract', `SD pkg ${TAG}`);
  const scText = (await section('subcontracts').innerText()).replace(/\s+/g, ' ');
  check('subcontract position: 20,000 paid and recovered, 3,000 disputed back-charges', /Paid 20,000\.00/.test(scText) && /Outstanding 0\.00/.test(scText) && /Disputed back-charges 3,000\.00/.test(scText), scText.slice(0, 220));
  await click(section('subcontracts'), 'Raise back-charge', `UIBC-${TAG}`, 'Scaffold left standing in zone D removed by main contractor (UI fixture)', '750', '');
  const bcRow = () => section('backcharges').locator('tbody tr', { hasText: `UIBC-${TAG}` });
  check('back-charge raised from the screen', /raised/.test(await bcRow().innerText()), (await bcRow().innerText()).replace(/\s+/g, ' '));
  await click(bcRow(), 'Notice sent', today);
  await click(bcRow(), 'Approve');
  check('raiser approving own back-charge is refused on screen (SoD)', /raised it|Segregation/i.test(await alertText()) && /raised/.test(await bcRow().innerText()), await alertText());
  await signOut();
  await signIn('sdqs2');
  await pick('Subcontract', `SD pkg ${TAG}`);
  await click(bcRow(), 'Approve');
  check('second person approves the noticed back-charge', /approved/.test(await bcRow().innerText()) && !(await alertText()), (await bcRow().innerText()).replace(/\s+/g, ' '));
  await page.screenshot({ path: `${OUT}/ui_payments_subcontract.png`, fullPage: true });

  const sod = apiFailures.filter(f => f.status === 403 && f.method === 'POST' && /(client-approve|\/approve)$/.test(f.path));
  const unexpected = apiFailures.filter(f => !sod.includes(f) && !(f.status === 403 && f.method === 'GET'));
  check('only the two SoD refusals failed; other failures are permission-scoped reads; no 5xx', sod.length === 2 && unexpected.length === 0, JSON.stringify(unexpected.slice(0, 5)));
  check('no browser console errors besides permission refusals', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' || '));
  check('no third-party host contacted', foreignHosts.size === 0, [...foreignHosts].join(', '));
} catch (e) {
  check('UI run completed', false, String(e.message).slice(0, 300));
  await page.screenshot({ path: `${OUT}/ui_payments_failure.png`, fullPage: true }).catch(() => {});
}
await browser.close();
const fail = results.filter(r => !r.ok).length;
console.log(`\nSUMMARY payments_ui PASS=${results.length - fail} FAIL=${fail}`);
process.exitCode = fail ? 1 : 0;
