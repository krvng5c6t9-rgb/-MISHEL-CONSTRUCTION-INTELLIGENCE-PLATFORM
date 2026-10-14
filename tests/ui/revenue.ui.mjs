// Stage 33 browser verification of the Revenue & Contract Position screen against the gate's data (same RUN_ID): the
// revenue runs of sweep_revenue_recognition shown with their asset/liability; a run moving backwards refused on screen;
// a price estimate added, its author's approval refused (SoD), approved and retired by a second person; client
// retention of the chain IPC released by someone other than the IPC preparer; F-48 obsolete advance buttons gone.
// Run by tests/e2e/run_from_zero.sh when UI_CHECK=1 (CI does).
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const BASE = process.env.UI_BASE ?? 'http://localhost:4173';
const API = process.env.UI_API;
const RUN = process.env.RUN_ID ?? '';
const TAG = /^[A-Za-z0-9]{1,8}$/.test(RUN) ? RUN : createHash('sha256').update(RUN).digest('hex').slice(0, 8); // as harness.mjs
const OUT = process.env.OUT_DIR ?? '.';
const today = new Date().toISOString().slice(0, 10);
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`); };
const user = (key) => ({ org_id: 1, email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}` });

let browser;
try {
  // Contract ids from the API (the screen lists contracts by label; the test selects by id).
  const tok = (await (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(user('cifm1')) })).json()).data.token;
  const ipcs = (await (await fetch(`${API}/finance/ipcs`, { headers: { authorization: `Bearer ${tok}` } })).json()).data;
  const rv = ipcs.find(i => i.ipc_no === `RV1-${TAG}`)?.contract_id, chain = ipcs.find(i => i.ipc_no === `IPC-${TAG}`)?.contract_id;
  if (!rv || !chain) throw new Error(`gate contracts not found (RV ${rv}, chain ${chain})`);

  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleErrors = [], serverErrors = [];
  page.on('console', m => { if (m.type() === 'error' && !/status of 40[34]|status of 422/.test(m.text())) consoleErrors.push(m.text()); });
  page.on('response', r => { if (r.url().includes('/api/') && r.status() >= 500) serverErrors.push(`${r.status()} ${r.url()}`); });
  const answers = [];
  page.on('dialog', d => d.accept(d.type() === 'prompt' ? (answers.length ? answers.shift() : '') : undefined));
  const settle = () => page.waitForTimeout(1500);
  const alert = async () => (await page.locator('[role="alert"]').count()) ? await page.locator('[role="alert"]').innerText() : '';
  const click = async (scope, name, ...prompts) => { answers.length = 0; answers.push(...prompts); await scope.getByRole('button', { name, exact: true }).first().click(); await settle(); };
  const signIn = async (key) => {
    await page.goto(`${BASE}/login`);
    const inputs = page.locator('input'), u = user(key);
    await inputs.nth(0).fill('1'); await inputs.nth(1).fill(u.email); await inputs.nth(2).fill(u.password);
    await page.getByRole('button', { name: 'Login' }).click();
    await page.waitForURL(x => !x.pathname.startsWith('/login'), { timeout: 15000 });
    await page.getByRole('link', { name: 'Revenue & Contract Position' }).click();
    await page.waitForURL(/revenue-position/); await settle();
  };
  const pick = async (id) => { await page.getByLabel('Contract').selectOption(String(id)); await settle(); };
  const section = (n) => page.locator(`[data-section="${n}"]`);

  await signIn('cifm1');
  await pick(rv);
  const runsText = await section('revenue-runs').locator('tbody').innerText();
  check('revenue runs of the contract listed: two approved, asset then liability', (runsText.match(/approved/g) ?? []).length === 2 && /asset/.test(runsText) && /liability/.test(runsText), runsText.replace(/\s+/g, ' ').slice(0, 220));
  check('run figures shown: revenue to date 255,000 with onerous provision 135,000', /255000\.00/.test(runsText) && /135000\.00/.test(runsText));
  const posText = await section('position').innerText();
  check('contract position shown: billed 300,000 gross', /Billed \(gross\)\s*300,000\.00/.test(posText), posText.replace(/\s+/g, ' ').slice(0, 160));
  await click(section('revenue-runs'), 'Prepare run', today, today);
  check('a run overlapping the approved period is refused on screen', /Revenue runs move forward/.test(await alert()), await alert());

  await click(section('price-estimates'), 'Add estimate', 'claim', '10000', today, 'Client letter accepts the extra foundation works in principle (UI fixture)', `UIEV-${TAG}`);
  const estRow = () => section('price-estimates').locator('tr', { hasText: `UIEV-${TAG}` });
  check('estimate recorded as draft', /draft/.test(await estRow().innerText()), await estRow().innerText());
  await click(estRow(), 'Approve');
  check('the estimate author approving it is refused on screen (SoD)', /Segregation of duties/.test(await alert()), await alert());

  await pick(chain);
  const retRow = section('retentions').locator('tr', { hasText: `IPC-${TAG}` });
  check('chain IPC retention held', /held/.test(await retRow.innerText()), await retRow.innerText());
  await click(retRow, 'Release', 'Taking-over certificate issued for the works (UI fixture)', `UITOC-${TAG}`);
  check('retention released from the screen with its certificate', /released/.test(await retRow.innerText()) && (await retRow.innerText()).includes(`UITOC-${TAG}`), await retRow.innerText());
  check('position shows the released retention', !/Retention released\s*0\.00/.test(await section('position').innerText()), (await section('position').innerText()).replace(/\s+/g, ' ').slice(0, 200));

  await page.getByRole('button', { name: 'Logout' }).click(); await page.waitForURL(/\/login/);
  await signIn('cifm2');
  await pick(rv);
  await click(estRow(), 'Approve');
  check('a second person approves the estimate', /approved/.test(await estRow().innerText()), await estRow().innerText());
  await click(estRow(), 'Retire', today, 'Superseded by the agreed variation (UI fixture)');
  check('the approved estimate is retired with a reason', /retired/.test(await estRow().innerText()), await estRow().innerText());

  await page.getByRole('link', { name: 'Payments & Certification' }).click(); await page.waitForURL(/payments-certification/); await settle();
  check('F-48: no typed "Received"/"Paid" advance buttons on the Payments screen', await page.getByRole('button', { name: 'Received', exact: true }).count() === 0 && await page.getByRole('button', { name: 'Paid', exact: true }).count() === 0);
  await page.goto(`${BASE}/revenue-position`); await settle();
  await page.screenshot({ path: `${OUT}/revenue_${RUN}.png`, fullPage: true });
  check('no 5xx from the API', serverErrors.length === 0, serverErrors.join(' | '));
  check('no browser console errors besides permission refusals and refused actions', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} catch (e) {
  check('revenue browser check completed', false, e.message.slice(0, 200));
} finally {
  await browser?.close();
}
const fail = results.filter(r => !r.ok).length;
console.log(`\nSUMMARY revenue_ui PASS=${results.length - fail} FAIL=${fail}`);
process.exitCode = fail ? 1 : 0;
