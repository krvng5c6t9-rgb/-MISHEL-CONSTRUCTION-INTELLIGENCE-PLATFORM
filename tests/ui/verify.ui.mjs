// Stage 60 / CC-090 browser verification of the "Verify a Document" screen, in Arabic, by a user who holds only the
// finance view right: an IPC exported through the API is verified on the screen by a photo of its QR code (decoded on
// the device), by the code's text (and a forged text is reported as not genuine), by its export number (a draft copy
// is flagged), and as a digital copy by the fingerprint of its file (a file changed by one byte matches nothing); an
// image without a code is reported. Run by tests/e2e/run_from_zero.sh when UI_CHECK=1 (CI does); needs UI_API.
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const BASE = process.env.UI_BASE ?? 'http://localhost:4173';
const API = process.env.UI_API;
const RUN = process.env.RUN_ID ?? '';
const TAG = /^[A-Za-z0-9]{1,8}$/.test(RUN) ? RUN : createHash('sha256').update(RUN).digest('hex').slice(0, 8); // as harness.mjs
const OUT = process.env.OUT_DIR ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`); };
const call = async (method, path, token, body) => {
  const r = await fetch(`${API}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${j.error ?? ''}`);
  return j.data;
};
const exportDoc = async (path, token) => {
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
  return { id: Number(r.headers.get('x-export-id')), bytes: Buffer.from(await r.arrayBuffer()) };
};

let browser;
try {
  const admin = (await call('POST', '/auth/login', null, { org_id: 1, email: 'admin.a@test.local', password: 'Passw0rd!A' })).token;
  const role = await call('POST', '/roles', admin, { role_name: `VF UI Finance ${TAG}`, permissions: [{ module: 'finance', action: 'view', scope: 'all' }] });
  const user = { org_id: 1, email: `vfui.${TAG}@test.local`, password: 'Passw0rd!vfui' };
  await call('POST', '/users', admin, { role_id: role.id, full_name: `VF UI user ${TAG}`, email: user.email, password: user.password });
  const token = (await call('POST', '/auth/login', null, user)).token;
  const ipcs = await call('GET', '/finance/ipcs', token);
  const final = ipcs.find(i => i.status !== 'draft'), draft = ipcs.find(i => i.status === 'draft');
  if (!final || !draft) throw new Error('fixture: a final and a draft IPC are needed');
  const copy = await exportDoc(`/documents/ipc/${final.id}?format=html&lang=ar`, token);
  const draftCopy = await exportDoc(`/documents/ipc/${draft.id}?format=html&lang=en`, token);

  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addInitScript(([tk]) => { try { localStorage.setItem('mishel.lang', 'ar'); localStorage.setItem('construction_erp_token', tk); } catch {} }, [token]);
  // A photo of the printed code: the copy rendered at print size, its QR code captured as an image.
  const shot = await ctx.newPage();
  await shot.setContent(copy.bytes.toString('utf8'));
  const qrPng = await shot.locator('.qr').screenshot();
  const blankPng = await shot.locator('header').screenshot();
  await shot.close();

  const page = await ctx.newPage();
  const consoleErrors = [], serverErrors = [];
  page.on('console', m => { if (m.type() === 'error' && !/status of 40[034]|status of 422/.test(m.text())) consoleErrors.push(m.text()); });
  page.on('response', r => { if (r.status() >= 500) serverErrors.push(`${r.status()} ${r.url()}`); });
  const section = (n) => page.locator(`[data-section="${n}"]`);
  const alert = async () => (await page.locator('[role="alert"]').count()) ? (await page.locator('[role="alert"]').innerText()).trim() : '';
  const verdict = async () => { await section('result').waitFor({ timeout: 10000 }); return { text: (await page.locator('[data-verdict]').innerText()).trim(), genuine: await section('result').getAttribute('data-genuine'), notes: (await section('result').locator('.verdict-notes').count()) ? (await section('result').locator('.verdict-notes').innerText()).trim() : '' }; };
  const settle = () => page.waitForTimeout(700);

  await page.goto(`${BASE}/`); await settle();
  const navLink = page.getByRole('link', { name: 'التحقق من مستند' });
  check('the screen is in the navigation of a finance-only user, in Arabic', await navLink.count() === 1);
  await navLink.click(); await page.waitForURL(/\/verify/); await settle();
  check('title in Arabic, right to left', (await page.locator('h1').innerText()).trim() === 'التحقق من مستند' && await page.locator('html').getAttribute('dir') === 'rtl');

  await section('by-qr').getByLabel('صورة الرمز').setInputFiles({ name: 'qr.png', mimeType: 'image/png', buffer: qrPng });
  const v1 = await verdict();
  check('a photo of the QR code is read on the device and verified: genuine, export number named, record unchanged',
    v1.genuine === 'yes' && v1.text === `سليمة: الرمز مطابق تمامًا للرمز المسجل مع التصدير رقم ${copy.id}.` && /لم يتغيّر السجل/.test(v1.notes), `${v1.text} || ${v1.notes}`);
  await page.screenshot({ path: `${OUT}/verify_result_ar_${RUN}.png`, fullPage: true });
  const qrText = await section('by-qr').getByLabel('نص الرمز').inputValue();
  check('the text read from the photo is placed in the field (a MARC code of that export)', qrText.startsWith('MARC-DOC/1?') && qrText.includes(`exp=${copy.id}&`), qrText);
  const rows = (await section('result').locator('tbody tr').allInnerTexts()).map(x => x.replace(/\s+/g, ' ').trim());
  check('the result lists the document, record, statuses, export, exporter, language and the file fingerprint',
    rows.some(r => r.startsWith('المستند') && r.includes('مستخلص جاري (العميل)')) && rows.some(r => r.includes(`#${final.id}`)) && rows.some(r => r.includes(`#${copy.id}`))
      && rows.some(r => r.includes(`VF UI user ${TAG}`)) && rows.some(r => r.includes('العربية / HTML')) && rows.some(r => r.includes(createHash('sha256').update(copy.bytes).digest('hex'))), rows.join(' | '));

  await section('by-qr').getByLabel('نص الرمز').fill(qrText.replace(/amount=[^&]+/, 'amount=1.00'));
  await section('by-qr').getByRole('button', { name: 'تحقق', exact: true }).click(); await settle();
  const v2 = await verdict();
  check('a forged code text (amount changed) is reported as not genuine', v2.genuine === 'no' && v2.text.startsWith('غير سليمة') && v2.notes === '', `${v2.text} || ${v2.notes}`);

  await section('by-number').getByLabel('رقم التصدير').fill(String(draftCopy.id));
  await section('by-number').getByRole('button', { name: 'تحقق', exact: true }).click(); await settle();
  const v3 = await verdict();
  check('verify by export number; a draft copy is flagged as not final', v3.text === `التصدير رقم ${draftCopy.id} مسجل. طابِق النسخة مع البيانات أدناه.` && /طُبعت هذه النسخة كمسودة/.test(v3.notes), `${v3.text} || ${v3.notes}`);

  await section('by-file').getByLabel('ملف النسخة').setInputFiles({ name: `IPC_${copy.id}.html`, mimeType: 'text/html', buffer: copy.bytes }); await settle();
  const v4 = await verdict();
  check('a digital copy is verified by the fingerprint of its file, computed on the device', v4.genuine === 'yes' && v4.text === `سليمة: هذا الملف هو ملف التصدير رقم ${copy.id} نفسه دون أي تعديل.`, v4.text);
  await section('by-file').getByLabel('ملف النسخة').setInputFiles({ name: 'changed.html', mimeType: 'text/html', buffer: Buffer.concat([copy.bytes, Buffer.from(' ')]) }); await settle();
  check('a file changed by one byte matches no export (refusal in Arabic, no result shown)', (await alert()) === 'لا يوجد تصدير لهذه الشركة يطابق هذا الملف' && await section('result').count() === 0, await alert());
  await section('by-qr').getByLabel('صورة الرمز').setInputFiles({ name: 'blank.png', mimeType: 'image/png', buffer: blankPng }); await settle();
  check('an image without a code is reported in Arabic', (await alert()) === 'تعذّرت قراءة رمز من هذه الصورة. جرّب صورة أوضح وأقرب إلى الرمز.', await alert());

  const texts = await page.locator('main').evaluate(m => [...m.querySelectorAll('h1, h2, th, button, label')].map(e => e.matches('label') ? e.firstChild?.textContent ?? '' : e.textContent ?? '')
    .concat([...m.querySelectorAll('[aria-label], input[placeholder]')].map(e => e.getAttribute('aria-label') ?? e.getAttribute('placeholder') ?? '')).map(s => s.trim()).filter(Boolean));
  check('Arabic: no Latin letters in headings, buttons, field labels and placeholders', texts.length > 10 && !texts.some(s => /[A-Za-z]/.test(s)), texts.filter(s => /[A-Za-z]/.test(s)).slice(0, 5).join(' | ') || `${texts.length} texts`);
  await page.screenshot({ path: `${OUT}/verify_ar_${RUN}.png`, fullPage: true });
  check('no 5xx from the API', serverErrors.length === 0, serverErrors.join(' | '));
  check('no browser console errors besides refusals', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} catch (e) {
  check('verify browser check completed', false, e.message.slice(0, 300));
} finally {
  await browser?.close();
}
const fail = results.filter(r => !r.ok).length;
console.log(`\nSUMMARY verify_ui PASS=${results.length - fail} FAIL=${fail}`);
process.exitCode = fail ? 1 : 0;
