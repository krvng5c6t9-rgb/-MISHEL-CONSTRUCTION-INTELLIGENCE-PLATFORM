// Browser verification of the Project Controls screen against a running API + built frontend, using data left by the
// runtime gate (same RUN_ID). Stage 18 browsing checks; Stage 19 (F-29) decision flows driven through the screen by two
// people (risk close, design-impact disposition and close, mobilisation gate open/close/submit/GO, report pack
// freeze/submit/approve) with separation of duties visible in the UI, and no third-party host contacted (F-28).
// Run by tests/e2e/run_from_zero.sh when UI_CHECK=1 (CI does); manually:
//   UI_BASE=http://localhost:4173 UI_API=http://localhost:4100/api RUN_ID=<gate run> OUT_DIR=/tmp/shots node tests/ui/project_controls.ui.mjs
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const BASE = process.env.UI_BASE ?? 'http://localhost:4173';
const API = process.env.UI_API ?? 'http://localhost:4100/api';
const RUN = process.env.RUN_ID ?? '';
const TAG = /^[A-Za-z0-9]{1,8}$/.test(RUN) ? RUN : createHash('sha256').update(RUN).digest('hex').slice(0, 8); // as harness.mjs
const OUT = process.env.OUT_DIR ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`); };
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

// Fixture: a second person (approver) for the SoD flows. TEST FIXTURE role, created through the API by the admin.
const ADMIN = { org_id: 1, email: 'admin.a@test.local', password: 'Passw0rd!A' };
const APPROVER = { org_id: 1, email: `uiap.${TAG}@test.local`, password: 'Passw0rd!uiap' };
const call = async (method, path, token, body) => {
  const r = await fetch(`${API}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${j.error ?? ''}`);
  return j.data;
};
const adminTok = (await call('POST', '/auth/login', null, ADMIN)).token;
const role = await call('POST', '/roles', adminTok, { role_name: `UI Approver ${TAG}`, permissions: [['projects', 'view'], ['projects', 'approve'], ['reports', 'view'], ['reports', 'approve']].map(([module, action]) => ({ module, action, scope: 'all' })) });
await call('POST', '/users', adminTok, { role_id: role.id, full_name: `UI Approver ${TAG}`, email: APPROVER.email, password: APPROVER.password });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
let phase = 'admin';
const consoleErrors = [], apiFailures = [], foreignHosts = new Set();
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of 403/.test(m.text())) consoleErrors.push(m.text()); });
page.on('response', r => { if (r.url().includes('/api/') && r.status() >= 400) apiFailures.push({ phase, status: r.status(), method: r.request().method(), path: r.url().replace(/^.*\/api/, '') }); });
page.on('request', r => { const h = new URL(r.url()).hostname; if (!['localhost', '127.0.0.1'].includes(h) && !r.url().startsWith('data:')) foreignHosts.add(h); });
const answers = []; // queued answers for window.prompt; confirm() is accepted
page.on('dialog', d => d.accept(d.type() === 'prompt' ? (answers.length ? answers.shift() : 'UI check (fixture)') : undefined));

const settleUi = () => page.waitForTimeout(1500);
const section = (name) => page.locator(`[data-section="${name}"]`);
const alertText = async () => (await page.locator('[role="alert"]').count()) ? await page.locator('[role="alert"]').innerText() : '';
const signIn = async (u) => {
  await page.goto(`${BASE}/login`);
  const inputs = page.locator('input');
  await inputs.nth(0).fill(String(u.org_id));
  await inputs.nth(1).fill(u.email);
  await inputs.nth(2).fill(u.password);
  await page.getByRole('button', { name: 'Login' }).click();
  await page.waitForURL(x => !x.pathname.startsWith('/login'), { timeout: 15000 });
  await page.getByRole('link', { name: 'Project Controls' }).click();
  await page.waitForURL(/project-controls/);
};
const open = async (code) => {
  const value = await page.locator('select[aria-label="Project"] option').evaluateAll((os, want) => os.find(o => o.textContent.startsWith(`${want} —`))?.value, `${code}-${TAG}`);
  if (!value) throw new Error(`project ${code}-${TAG} not in the list`);
  await page.selectOption('select[aria-label="Project"]', value);
  await settleUi();
};
const click = async (scope, name, ...prompts) => { answers.push(...prompts); await scope.getByRole('button', { name, exact: true }).first().click(); await settleUi(); };

try {
  await signIn(ADMIN);
  check('admin signs in and opens Project Controls from the navigation', await page.getByRole('heading', { name: 'Project Controls' }).isVisible());

  // --- Stage 18 browsing checks.
  await open('TF');
  const timeText = await section('time').innerText();
  check('time section shows revised completion, LD terms and exposure for the TF contract', /confirmed/.test(timeText) && /\d{4}-\d{2}-\d{2}/.test(timeText), timeText.split('\n').slice(0, 4).join(' | '));
  await page.screenshot({ path: `${OUT}/ui_time_TF.png`, fullPage: true });

  await open('MB');
  const gateText = await section('mobilisation').innerText();
  check('mobilisation section shows the decided GO gate and its items', /go/.test(gateText) && /Excavation permit/.test(gateText), gateText.split('\n').slice(0, 3).join(' | '));
  const riskNo = `UI-${TAG}-${Date.now() % 100000}`;
  const before = await section('risks').locator('tbody tr').count();
  await section('risks').locator('input[aria-label="Risk number"]').fill(riskNo);
  await section('risks').locator('input[aria-label="Risk title"]').fill('Crane access restricted (UI check)');
  await section('risks').locator('input[aria-label="Cause"]').fill('Narrow site entrance (fixture)');
  await section('risks').locator('input[aria-label="Effect"]').fill('Lifting plan delayed (fixture)');
  await click(section('risks'), 'Raise risk');
  check('a risk raised from the form appears in the register', (await section('risks').locator('tbody tr').count()) === before + 1);

  // --- Decision: the person who raised the risk cannot close it (SoD); the approver closes it later.
  const riskRow = () => section('risks').locator('tbody tr', { hasText: riskNo });
  await click(riskRow(), 'Close', 'mitigated', 'Crane route agreed with the municipality (fixture)', 'Survey the site entrance before tender (fixture)');
  check('raiser closing own risk is refused on screen (SoD)', /raised it|Segregation/i.test(await alertText()) && /open/.test(await riskRow().innerText()), await alertText());
  await page.screenshot({ path: `${OUT}/ui_risks_mobilisation_MB.png`, fullPage: true });

  await open('RP');
  check('report packs listed for RP', (await section('report-packs').locator('tbody tr').count()) >= 2);
  await section('report-packs').getByRole('button', { name: 'Open' }).last().click();
  await settleUi();
  const packText = await section('pack-detail').innerText();
  check('opened pack shows hash verification, as-of cost and reconciliation exceptions', /Hash valid: true/.test(packText) && /actual_not_posted_to_gl|backdated_into_approved_period/.test(packText), packText.split('\n').slice(0, 3).join(' | '));

  // --- Decision: freeze a new pack, write the narrative, submit; the preparer's own approval is refused (SoD).
  await click(section('report-packs'), 'Freeze pack', 'weekly', day(-27), day(-21));
  const packRow = () => section('report-packs').locator('tbody tr', { hasText: day(-27) });
  check('pack frozen from the screen for the requested period', (await packRow().count()) === 1, (await packRow().first().innerText().catch(() => '')).replace(/\s+/g, ' '));
  await packRow().getByRole('button', { name: 'Open' }).click(); await settleUi();
  await click(section('pack-detail'), 'Write narrative', 'Quiet week: no site activity recorded (UI fixture)');
  await click(section('pack-detail'), 'Submit');
  check('pack submitted from the screen', /submitted/.test(await section('pack-detail').innerText()));
  await click(section('pack-detail'), 'Approve');
  check('preparer approving own pack is refused on screen (SoD)', /prepar|own|same person|segregat/i.test(await alertText()) && /submitted/.test(await section('pack-detail').innerText()), await alertText());
  await page.screenshot({ path: `${OUT}/ui_report_pack_RP.png`, fullPage: true });

  await open('CM');
  const cmText = await section('commissioning').innerText();
  check('commissioning readiness shows the handed-over HVAC system', new RegExp(`HVAC-${TAG}`).test(cmText) && /true/.test(cmText), cmText.split('\n').slice(0, 3).join(' | '));

  // --- Decision: mobilisation gate opened, item added and closed with a note, submitted; preparer's GO refused (SoD).
  await click(section('mobilisation'), 'Open gate');
  await click(section('mobilisation'), 'Add item', 'permit', 'Hoarding permit (UI fixture)');
  const itemRow = () => section('mobilisation').locator('tbody tr', { hasText: 'Hoarding permit' });
  check('readiness item added from the screen as mandatory and open', /open/.test(await itemRow().innerText()) && /true|yes/i.test(await itemRow().innerText()), (await itemRow().innerText()).replace(/\s+/g, ' '));
  await click(itemRow(), 'Close', 'Permit HP-77 received and filed (UI fixture)');
  check('item closed with an evidence note', /closed/.test(await itemRow().innerText()));
  await click(section('mobilisation'), 'Submit gate');
  await click(section('mobilisation'), 'Decide GO', '');
  check('preparer deciding own gate is refused on screen (SoD)', /prepar|own|same person|segregat/i.test(await alertText()) && /submitted/.test(await section('mobilisation').innerText()), await alertText());

  // --- Decision: AR design impact (purchase-order line) dispositioned and closed without entitlement.
  await open('AR');
  await section('design-impacts').locator('tbody tr', { hasText: `M-500-${TAG}` }).getByRole('button', { name: 'Open' }).click(); await settleUi();
  await click(section('impact-detail'), 'No change', 'Pump duty unchanged; PO line stands (UI fixture)');
  check('impact item dispositioned from the screen', /no_change/.test(await section('impact-detail').innerText()));
  await click(section('impact-detail'), 'Close impact', '', '');
  check('impact closed from the screen once every object is assessed', /closed/.test(await section('impact-detail').locator('h3').innerText()), await section('impact-detail').locator('h3').innerText());
  await page.screenshot({ path: `${OUT}/ui_design_impact_AR.png`, fullPage: true });

  // --- Second person: sign out (session revoked), sign in as the approver, decide.
  await page.getByRole('button', { name: 'Logout' }).click();
  await page.waitForURL(/\/login/);
  phase = 'approver';
  await signIn(APPROVER);
  await open('CM');
  check('sections the approver may not read are named on screen, not shown as empty tables', /contracts \(Missing permission/.test(await section('unloaded').innerText().catch(() => '')), (await section('unloaded').innerText().catch(() => '(no notice)')).slice(0, 160));
  await click(section('mobilisation'), 'Decide GO', 'Mobilise; hoarding permit in place (UI fixture)');
  check('second person decides GO on screen', /Gate \d+: go/.test(await section('mobilisation').innerText()), (await section('mobilisation').innerText()).split('\n')[1]);
  await open('MB');
  await click(riskRow(), 'Close', 'mitigated', 'Crane route agreed with the municipality (fixture)', 'Survey the site entrance before tender (fixture)');
  check('second person closes the risk with reason and lesson learned', /closed/.test(await riskRow().innerText()) && !(await alertText()), (await riskRow().innerText()).replace(/\s+/g, ' '));
  await open('RP');
  await section('report-packs').locator('tbody tr', { hasText: day(-27) }).getByRole('button', { name: 'Open' }).click(); await settleUi();
  await click(section('pack-detail'), 'Approve');
  check('second person approves the pack on screen', /approved/.test(await section('pack-detail').innerText()) && !(await alertText()), await alertText());
  await page.screenshot({ path: `${OUT}/ui_approver_decisions.png`, fullPage: true });

  // --- Hygiene.
  const sod = apiFailures.filter(f => f.phase === 'admin' && f.status === 403 && f.method === 'POST' && /\/(decision|close)$/.test(f.path));
  const unexpected = apiFailures.filter(f => !sod.includes(f) && !(f.phase === 'approver' && f.status === 403 && f.method === 'GET'));
  check('only the three SoD refusals failed for the admin; the approver saw only read 403s; no 5xx', sod.length === 3 && unexpected.length === 0, JSON.stringify(unexpected.slice(0, 5)));
  check('no browser console errors besides permission refusals', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' || '));
  check('no third-party host contacted (fonts bundled, F-28)', foreignHosts.size === 0, [...foreignHosts].join(', '));
} catch (e) {
  check('UI run completed', false, String(e.message).slice(0, 300));
  await page.screenshot({ path: `${OUT}/ui_failure.png`, fullPage: true }).catch(() => {});
}
await browser.close();
const fail = results.filter(r => !r.ok).length;
console.log(`\nSUMMARY project_controls_ui PASS=${results.length - fail} FAIL=${fail}`);
process.exitCode = fail ? 1 : 0;
