// R1.1 (MP-06 §1) browser verification of the bilingual shell: Arabic is the default with right-to-left direction;
// the language switch changes language and direction on the sign-in screen and in the application shell, persists
// across reloads, every one of the 34 navigation items is translated in both languages, and the landing dashboard is in
// Arabic (R1.2). Also checks that the
// Arabic and English dictionaries in frontend/src/lib/messages/*.ts have the same keys and placeholders.
// Run by tests/e2e/run_from_zero.sh when UI_CHECK=1 (CI does).
import { readdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.UI_BASE ?? 'http://localhost:4173';
const RUN = process.env.RUN_ID ?? '';
const OUT = process.env.OUT_DIR ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`); };

const EN_NAV = ['Dashboard', 'Projects', 'Project Controls', 'Payments & Certification', 'Revenue & Contract Position', 'Go-live cut-over',
  'Users / Roles / DOA', 'CRM', 'Tendering', 'BOQ', 'Contracts', 'Claims / EOT', 'Subcontracts', 'Cost Control', 'Procurement', 'Inventory',
  'Approvals', 'Finance', 'Technical Office', 'Planning', 'Site Execution', 'HR / Payroll', 'Assets', 'QA/QC', 'HSE', 'EDMS',
  'Executive Dashboard', 'Reports', 'Portals', 'Runtime Validation', 'AI Platform', 'Automation / Integrations', 'Knowledge / RAG', 'Commercial SaaS'];
const ARABIC = /[؀-ۿ]/, LATIN = /[A-Za-z]/;

// Static: in every dictionary file the Arabic and English keys are the same, each key has the same {placeholders} in both
// languages, and no key is defined twice or in two files (frontend/src/lib/messages/*.ts, merged by i18n.tsx).
const dir = new URL('../../frontend/src/lib/messages/', import.meta.url);
const files = readdirSync(dir).filter(f => f.endsWith('.ts'));
const parse = (b) => [...b.matchAll(/^\s*'([a-zA-Z]+\.[a-zA-Z]+)': '((?:[^'\\]|\\.)*)',?$/gm)].map(m => [m[1], m[2]]);
const allKeys = [], issues = [];
for (const f of files) {
  const src = readFileSync(new URL(f, dir), 'utf8');
  const enStart = src.indexOf('export const en = {'), arStart = src.indexOf('export const ar: Record<keyof typeof en, string> = {');
  const enSrc = src.slice(enStart, src.indexOf('} as const;', enStart)), arSrc = src.slice(arStart, src.indexOf('\n};', arStart));
  const en = parse(enSrc), ar = new Map(parse(arSrc));
  const entries = (b) => (b.match(/^\s*'/gm) ?? []).length;   // every entry line must be parsed
  if (entries(enSrc) !== en.length || entries(arSrc) !== ar.size) issues.push(`${f}: unparsed entry lines`);
  const holes = (s) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
  if (enStart < 0 || arStart < 0 || !en.length) issues.push(`${f}: dictionaries not found`);
  if (en.length !== ar.size) issues.push(`${f}: en ${en.length} keys, ar ${ar.size}`);
  for (const [k, v] of en) {
    if (!ar.has(k)) issues.push(`${f}: ${k} missing in Arabic`);
    else if (holes(v) !== holes(ar.get(k))) issues.push(`${f}: ${k} placeholders differ`);
    else if (!/[؀-ۿ]/.test(ar.get(k)) && !/^[A-Za-z0-9 ]+$/.test(ar.get(k))) issues.push(`${f}: ${k} Arabic text has no Arabic letters`);
    allKeys.push(k);
  }
}
const dup = allKeys.filter((k, i) => allKeys.indexOf(k) !== i);
check('dictionaries: same keys and placeholders in Arabic and English, no key defined twice', files.length >= 4 && !issues.length && !dup.length,
  issues.concat(dup.map(k => `duplicate ${k}`)).slice(0, 5).join(' | ') || `${files.length} files, ${allKeys.length} keys`);

let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error' && !/status of 40[13]/.test(m.text())) consoleErrors.push(m.text()); });
  const html = async () => page.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir }));
  const navTexts = async () => (await page.locator('nav a').allInnerTexts()).map(s => s.trim());

  await page.goto(`${BASE}/login`); await page.waitForTimeout(500);
  let h = await html();
  check('default language is Arabic, right-to-left', h.lang === 'ar' && h.dir === 'rtl', JSON.stringify(h));
  check('sign-in screen in Arabic', await page.getByRole('heading', { name: 'تسجيل الدخول' }).count() === 1
    && await page.getByRole('button', { name: 'دخول', exact: true }).count() === 1 && await page.getByText('رقم المؤسسة').count() === 1);

  await page.getByRole('button', { name: 'اللغة' }).click(); await page.waitForTimeout(300);
  h = await html();
  check('switch to English: language and direction change', h.lang === 'en' && h.dir === 'ltr', JSON.stringify(h));
  check('sign-in screen in English', await page.getByRole('heading', { name: 'Sign in' }).count() === 1
    && await page.getByRole('button', { name: 'Login', exact: true }).count() === 1 && await page.getByText('Organization ID').count() === 1);
  await page.reload(); await page.waitForTimeout(500);
  h = await html();
  check('choice persists after reload', h.lang === 'en' && h.dir === 'ltr' && await page.getByRole('heading', { name: 'Sign in' }).count() === 1, JSON.stringify(h));

  await page.getByRole('button', { name: 'Language' }).click(); await page.waitForTimeout(300);
  const inputs = page.locator('input');
  await inputs.nth(0).fill('1'); await inputs.nth(1).fill('admin.a@test.local'); await inputs.nth(2).fill('Passw0rd!A');
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await page.waitForURL(x => !x.pathname.startsWith('/login'), { timeout: 15000 }); await page.waitForTimeout(800);
  h = await html();
  const ar = await navTexts();
  check('application shell in Arabic after sign-in (rtl)', h.lang === 'ar' && h.dir === 'rtl', JSON.stringify(h));
  check('all 34 navigation items translated to Arabic (Arabic text, no Latin letters)', ar.length === 34 && ar.every(t => ARABIC.test(t) && !LATIN.test(t)),
    ar.filter(t => !ARABIC.test(t) || LATIN.test(t)).join(' | ') || `${ar.length} items`);
  check('Arabic navigation labels are distinct', new Set(ar).size === ar.length);
  check('logout labelled in Arabic', await page.getByRole('button', { name: 'تسجيل الخروج' }).count() === 1);
  // Layout follows the language (CC-068): in Arabic the navigation is on the right and the content right-to-left.
  const side = async () => page.evaluate(() => ({ nav: document.querySelector('aside').getBoundingClientRect().left, main: document.querySelector('main').getBoundingClientRect().left,
    contentDir: getComputedStyle(document.querySelector('main')).direction, navDir: getComputedStyle(document.querySelector('aside')).direction }));
  const arSide = await side();
  check('Arabic layout: navigation on the right, content and navigation right-to-left', arSide.nav > arSide.main && arSide.contentDir === 'rtl' && arSide.navDir === 'rtl', JSON.stringify(arSide));
  // R1.2: the landing dashboard in Arabic; contract value is totalled per currency (never added across currencies).
  const dash = page.locator('main');
  await dash.locator('[data-section="kpis"] .kpi-card').first().waitFor();
  const kpis = await dash.locator('[data-section="kpis"] small').allInnerTexts();
  check('landing dashboard in Arabic (title, KPI labels, by-status panel)', await page.getByRole('heading', { name: 'لوحة التحكم' }).count() === 1
    && await page.getByRole('heading', { name: 'المشروعات حسب الحالة' }).count() === 1 && kpis[0] === 'المشروعات'
    && kpis.slice(1).every(s => /^قيمة العقود الحالية \([A-Z]{3}\)$/.test(s)), kpis.join(' | '));
  const statusCells = await dash.locator('[data-section="by-status"] td:first-child').allInnerTexts();
  check('project statuses shown in Arabic', statusCells.length > 0 && statusCells.every(s => ARABIC.test(s) && !LATIN.test(s)), statusCells.join(' | '));
  check('one contract-value figure per currency', new Set(kpis.slice(1)).size === kpis.length - 1 && kpis.length >= 2, kpis.join(' | '));

  await page.getByRole('button', { name: 'اللغة' }).click(); await page.waitForTimeout(400);
  h = await html();
  const en = await navTexts();
  check('switching in the shell turns it to English (ltr)', h.lang === 'en' && h.dir === 'ltr', JSON.stringify(h));
  check('all 34 navigation items in English, in order', JSON.stringify(en) === JSON.stringify(EN_NAV),
    en.filter((t, i) => t !== EN_NAV[i]).join(' | ') || `${en.length} items`);
  check('logout labelled in English', await page.getByRole('button', { name: 'Logout' }).count() === 1);
  const enSide = await side();
  check('English layout: navigation on the left, content and navigation left-to-right', enSide.nav < enSide.main && enSide.contentDir === 'ltr' && enSide.navDir === 'ltr', JSON.stringify(enSide));
  await page.getByRole('link', { name: 'Go-live cut-over' }).click(); await page.waitForURL(/\/cutover/);
  check('navigation works after switching language', /\/cutover$/.test(new URL(page.url()).pathname));
  await page.screenshot({ path: `${OUT}/i18n_${RUN}.png`, fullPage: false });
  check('no browser console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} catch (e) {
  check('i18n browser check completed', false, e.message.slice(0, 200));
} finally {
  await browser?.close();
}
const fail = results.filter(r => !r.ok).length;
console.log(`\nSUMMARY i18n_ui PASS=${results.length - fail} FAIL=${fail}`);
process.exitCode = fail ? 1 : 0;
