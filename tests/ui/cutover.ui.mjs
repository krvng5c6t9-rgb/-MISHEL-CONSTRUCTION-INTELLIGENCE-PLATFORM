// Stage 36 / F-50 browser verification of the Go-live cut-over screen in a fresh tenant F (opening balances are loaded
// only before any posting): rows pasted as copied from Excel / CSV with automatic column mapping; the preview flags a
// reference that does not resolve and a row the server refuses, and nothing is saved until every row is OK; a
// receivables difference is shown per control account and blocks reconciliation; the preparer's approval is refused
// (SoD); a second person approves and the plan opens. Accounts and amounts are TEST FIXTURES.
// Run by tests/e2e/run_from_zero.sh when UI_CHECK=1 (CI does); needs UI_API and BOOTSTRAP_ADMIN_TOKEN.
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const BASE = process.env.UI_BASE ?? 'http://localhost:4173';
const API = process.env.UI_API;
const RUN = process.env.RUN_ID ?? '';
const TAG = /^[A-Za-z0-9]{1,8}$/.test(RUN) ? RUN : createHash('sha256').update(RUN).digest('hex').slice(0, 8); // as harness.mjs
const OUT = process.env.OUT_DIR ?? '.';
const now = new Date();
const first = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`); };
const call = async (method, path, token, body, extra = {}) => {
  const r = await fetch(`${API}${path}`, { method, headers: { 'content-type': 'application/json', ...extra, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(j.error ?? j)}`);
  return j.data;
};

let browser;
try {
  // --- Tenant F set-up through the API (the screen under test is the cut-over screen, not these).
  const boot = await call('POST', '/auth/bootstrap-admin', null, { organization: { name: `Tenant F ${TAG}`, base_currency_code: 'EGP' }, full_name: 'Admin F', email: `admin.f.${TAG}@test.local`, password: 'Passw0rd!F' }, { 'x-bootstrap-token': process.env.BOOTSTRAP_ADMIN_TOKEN ?? '' });
  const F = boot.token, org = boot.organization.id;
  const role = (await call('POST', '/roles', F, { role_name: 'Finance approver', permissions: [['finance', 'view'], ['finance', 'manage'], ['finance', 'approve'], ['finance', 'post']].map(([module, action]) => ({ module, action, scope: 'all' })) })).id;
  await call('POST', '/users', F, { role_id: role, full_name: 'fin F', email: `fin.f.${TAG}@test.local`, password: 'Passw0rd!fin' });
  for (const [code, name, type] of [['1010', 'Bank', 'asset'], ['1200', 'Receivables', 'asset'], ['3000', 'Opening balance equity', 'equity']]) {
    await call('POST', '/finance/chart-of-accounts', F, { account_code: code, account_name: `${name} (fixture)`, account_type: type });
  }
  await call('POST', '/finance/fiscal-periods', F, { fiscal_year: now.getUTCFullYear(), period_no: now.getUTCMonth() + 1, start_date: first, end_date: last });
  const client = (await call('POST', '/clients', F, { client_name: `F Client ${TAG}`, client_type: 'private' })).id;
  await call('POST', '/projects', F, { project_code: `F1-${TAG}`, project_name: `F Tower ${TAG}`, currency_id: 1, client_id: client });

  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(() => { try { localStorage.setItem('mishel.lang', 'en'); } catch {} }); // R1.1: these checks run in English
  const consoleErrors = [], serverErrors = [];
  page.on('console', m => { if (m.type() === 'error' && !/status of 40[39]|status of 422/.test(m.text())) consoleErrors.push(m.text()); });
  page.on('response', r => { if (r.url().includes('/api/') && r.status() >= 500) serverErrors.push(`${r.status()} ${r.url()}`); });
  const answers = [];
  page.on('dialog', d => d.accept(d.type() === 'prompt' ? (answers.length ? answers.shift() : '') : undefined));
  const settle = () => page.waitForTimeout(1500);
  const alert = async () => (await page.locator('[role="alert"]').count()) ? await page.locator('[role="alert"]').first().innerText() : '';
  const click = async (scope, name, ...prompts) => { answers.length = 0; answers.push(...prompts); await scope.getByRole('button', { name, exact: true }).first().click(); await settle(); };
  const section = (n) => page.locator(`[data-section="${n}"]`);
  const status = async () => (await section('plan').locator('[data-status]').count()) ? await section('plan').locator('[data-status]').getAttribute('data-status') : '';
  const signIn = async (email, password) => {
    await page.goto(`${BASE}/login`);
    const inputs = page.locator('input');
    await inputs.nth(0).fill(String(org)); await inputs.nth(1).fill(email); await inputs.nth(2).fill(password);
    await page.getByRole('button', { name: 'Login' }).click();
    await page.waitForURL(x => !x.pathname.startsWith('/login'), { timeout: 15000 });
    await page.getByRole('link', { name: 'Go-live cut-over' }).click();
    await page.waitForURL(/\/cutover/); await settle();
  };
  const paste = async (path, text) => { await section(path).getByRole('textbox').fill(text); await settle(); };
  const previewText = async (path) => section(path).locator('[data-section="preview"]').innerText();

  await signIn(`admin.f.${TAG}@test.local`, 'Passw0rd!F');
  await click(section('plan'), 'Create plan', first);
  check('cut-over plan created from the screen as draft', await status() === 'draft', await alert());

  // --- R1.2: the same draft screen in Arabic. Arabic column names are mapped automatically, the row checks are shown in
  // Arabic, and no heading, column heading, button or field label shows Latin letters. Then back to English.
  await page.getByRole('button', { name: 'Language' }).click(); await settle();
  check('Arabic: page title and plan status translated (status attribute unchanged)', await page.getByRole('heading', { name: 'الانتقال للتشغيل' }).count() === 1
    && await section('plan').locator('[data-status="draft"]').innerText() === 'مسودة');
  await paste('tb-lines', ['الحساب\tمدين\tدائن\tبيان', '9999\t5\t0\tحساب غير معروف', '1010\t1\t0\tالبنك'].join('\n'));
  const arMapped = await section('tb-lines').getByLabel('العمود الخاص بـ مدين').inputValue();
  check('Arabic: Arabic column names mapped automatically', arMapped === '1', `debit column ${arMapped}`);
  await click(section('tb-lines'), 'معاينة الصفوف (2)');
  const arPv = await previewText('tb-lines');
  check('Arabic: row check shown in Arabic (unknown account)', /الحساب "9999" غير موجود/.test(arPv) && /عدد الصفوف التي بها أخطاء: 1 /.test(arPv), arPv.replace(/\s+/g, ' ').slice(0, 300));
  const arTexts = await page.locator('main').evaluate(m => [...m.querySelectorAll('h1, h2, th, button, label')].map(e => e.matches('label') ? e.firstChild?.textContent ?? '' : e.textContent ?? '')
    .concat([...m.querySelectorAll('[aria-label]')].map(e => e.getAttribute('aria-label') ?? '')).map(s => s.trim()).filter(Boolean));
  const latin = arTexts.filter(s => /[A-Za-z]/.test(s.replace(/\b(Excel|CSV)\b/g, ''))); // product names only
  check('Arabic: no Latin letters in headings, column headings, buttons and field labels', arTexts.length > 20 && latin.length === 0, latin.slice(0, 5).join(' | ') || `${arTexts.length} texts`);
  await paste('tb-lines', '');
  await page.getByRole('button', { name: 'اللغة' }).click(); await settle();
  check('back to English: same screen in English', await page.getByRole('heading', { name: 'Go-live cut-over' }).count() === 1 && await section('plan').locator('[data-status="draft"]').innerText() === 'draft');

  // --- Opening trial balance pasted as copied from Excel (tab-separated), with two bad rows.
  const tbBad = ['Account code\tDebit\tCredit\tNote', '1010\t100000\t0\tBank (fixture)', '1200\t30000\t0\tReceivables (fixture)', '9999\t5\t0\tUnknown account', '3000\t7\t7\tBoth sides', '3000\t0\t130000\tEquity (fixture)'].join('\n');
  await paste('tb-lines', tbBad);
  const mapped = await section('tb-lines').getByLabel('Column for Debit').inputValue();
  check('columns mapped automatically from the pasted header', mapped === '1', `debit column ${mapped}`);
  await click(section('tb-lines'), 'Preview 5 rows');
  const pv = await previewText('tb-lines');
  check('preview flags the unknown account code on its row', /Account "9999" not found/.test(pv), pv.replace(/\s+/g, ' ').slice(0, 300));
  check('preview flags the row the server refuses (debit and credit both)', /check constraint/.test(pv), pv.replace(/\s+/g, ' ').slice(0, 300));
  check('two rows marked in error, three OK', await section('tb-lines').locator('tr.row-error').count() === 2 && await section('tb-lines').locator('[data-section="preview"] tbody tr:not(.row-error)').count() === 3);
  check('Load is disabled while any row has an error', await section('tb-lines').getByRole('button', { name: /^Load / }).isDisabled());
  const plan = (await call('GET', '/finance/cutover-plans', F)).find(p => p.status === 'draft');
  check('the preview saved nothing', (await call('GET', `/finance/cutover-plans/${plan.id}`, F))['tb-lines'].length === 0);
  await paste('tb-lines', tbBad.split('\n').filter(l => !/^9999|^3000\t7/.test(l)).join('\n'));
  await click(section('tb-lines'), 'Preview 3 rows');
  check('corrected paste previews clean', /All 3 rows OK/.test(await previewText('tb-lines')));
  await click(section('tb-lines'), 'Load 3 rows');
  check('trial balance loaded and listed (3 lines)', await section('tb-lines').locator('tbody tr').count() === 3, await alert());

  // --- Receivables pasted as CSV; the detail is 10,000 short of the control account.
  await paste('receivables', `Client,Project,Reference,Amount,Due date,Account\n"F Client ${TAG}",F1-${TAG},INV-F-1-${TAG},"20,000",${last},1200`);
  await click(section('receivables'), 'Preview 1 rows');
  check('receivable resolved by client name, project code and account code', /All 1 rows OK/.test(await previewText('receivables')), (await previewText('receivables')).replace(/\s+/g, ' ').slice(0, 200));
  await click(section('receivables'), 'Load 1 rows');
  await click(section('plan'), 'Reconcile');
  check('reconcile with a difference is refused on screen', /do not reconcile/.test(await alert()), await alert());
  const rec = await section('reconciliation').locator('tr.row-error').innerText().catch(() => '');
  check('the difference is shown on the receivables control account (1200: 10,000)', /receivables/.test(rec) && /1200/.test(rec) && /\b10,?000(\.00)?\b/.test(rec), rec.replace(/\s+/g, ' '));
  check('plan stays draft', await status() === 'draft');
  await paste('receivables', `Client,Project,Reference,Amount,Account\nF Client ${TAG},F1-${TAG},INV-F-2-${TAG},10000,1200`);
  await click(section('receivables'), 'Preview 1 rows');
  await click(section('receivables'), 'Load 1 rows');
  await click(section('plan'), 'Reconcile');
  check('reconciles clean once the detail is complete', await status() === 'reconciled' && await section('reconciliation').locator('tr.row-error').count() === 0, await alert());
  check('loaders are closed once reconciled', await page.getByRole('textbox').count() === 0);
  await click(section('plan'), 'Approve & post opening journal');
  check('the preparer approving is refused on screen (SoD)', /Segregation of duties/.test(await alert()), await alert());

  await page.getByRole('button', { name: 'Logout' }).dispatchEvent('click'); await page.waitForURL(/\/login/);
  await signIn(`fin.f.${TAG}@test.local`, 'Passw0rd!fin');
  await click(section('plan'), 'Approve & post opening journal');
  check('a second person approves; the plan opens', await status() === 'opened', await alert());
  const opened = (await call('GET', '/finance/cutover-plans', F)).find(p => p.id === plan.id);
  check('opening journal posted on the cut-over date', Boolean(opened?.gl_batch_id) && String(opened?.status) === 'opened', JSON.stringify({ status: opened?.status, gl_batch_id: opened?.gl_batch_id }));
  await page.screenshot({ path: `${OUT}/cutover_${RUN}.png`, fullPage: true });

  // --- R1.2: the opened plan in Arabic: status, reconciliation checks, section tables and the retention panel.
  await page.getByRole('button', { name: 'Language' }).click(); await settle();
  check('Arabic: opened plan status and reconciliation checks translated', await section('plan').locator('[data-status="opened"]').innerText() === 'مفتوحة للتشغيل'
    && /العملاء \(المدينون\)/.test(await section('reconciliation').innerText()) && /توازن ميزان المراجعة/.test(await section('reconciliation').innerText()));
  check('Arabic: section and retention panels translated', await page.getByRole('heading', { name: 'ميزان المراجعة الافتتاحي' }).count() === 1
    && await page.getByRole('heading', { name: 'المحتجزات الافتتاحية' }).count() === 1 && /لا توجد سجلات بعد/.test(await section('opening-retention').innerText()));
  const arOpened = await page.locator('main').evaluate(m => [...m.querySelectorAll('h1, h2, th, button')].map(e => (e.textContent ?? '').trim()).filter(Boolean));
  check('Arabic: no Latin letters in headings, column headings and buttons of the opened plan', arOpened.length > 20 && !arOpened.some(s => /[A-Za-z]/.test(s)),
    arOpened.filter(s => /[A-Za-z]/.test(s)).slice(0, 5).join(' | ') || `${arOpened.length} texts`);
  await page.screenshot({ path: `${OUT}/cutover_ar_${RUN}.png`, fullPage: true });
  check('no 5xx from the API', serverErrors.length === 0, serverErrors.join(' | '));
  check('no browser console errors besides refused actions', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} catch (e) {
  check('cut-over browser check completed', false, e.message.slice(0, 200));
} finally {
  await browser?.close();
}
const fail = results.filter(r => !r.ok).length;
console.log(`\nSUMMARY cutover_ui PASS=${results.length - fail} FAIL=${fail}`);
process.exitCode = fail ? 1 : 0;
