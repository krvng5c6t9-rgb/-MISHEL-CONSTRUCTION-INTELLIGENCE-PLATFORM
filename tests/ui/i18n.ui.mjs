// R1.1 (MP-06 §1) browser verification of the bilingual shell: Arabic is the default with right-to-left direction;
// the language switch changes language and direction on the sign-in screen and in the application shell, persists
// across reloads, and every one of the 34 navigation items is translated in both languages. Also checks that the
// Arabic and English dictionaries in frontend/src/lib/i18n.tsx have exactly the same keys.
// Run by tests/e2e/run_from_zero.sh when UI_CHECK=1 (CI does).
import { readFileSync } from 'node:fs';
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

// Static: both dictionaries have the same keys, no duplicates.
const src = readFileSync(new URL('../../frontend/src/lib/i18n.tsx', import.meta.url), 'utf8');
const block = (start, end) => src.slice(src.indexOf(start), src.indexOf(end, src.indexOf(start)));
const keys = (b) => [...b.matchAll(/^\s*'([a-zA-Z]+\.[a-zA-Z]+)':/gm)].map(m => m[1]);
const enKeys = keys(block('const en = {', '} as const;')), arKeys = keys(block('const ar: Record<MessageKey, string> = {', '};'));
const dup = (a) => a.filter((k, i) => a.indexOf(k) !== i);
check('dictionaries: same keys in Arabic and English, no duplicates', enKeys.length > 0 && enKeys.length === arKeys.length
  && enKeys.every(k => arKeys.includes(k)) && !dup(enKeys).length && !dup(arKeys).length, `en ${enKeys.length}, ar ${arKeys.length}`);

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

  await page.getByRole('button', { name: 'اللغة' }).click(); await page.waitForTimeout(400);
  h = await html();
  const en = await navTexts();
  check('switching in the shell turns it to English (ltr)', h.lang === 'en' && h.dir === 'ltr', JSON.stringify(h));
  check('all 34 navigation items in English, in order', JSON.stringify(en) === JSON.stringify(EN_NAV),
    en.filter((t, i) => t !== EN_NAV[i]).join(' | ') || `${en.length} items`);
  check('logout labelled in English', await page.getByRole('button', { name: 'Logout' }).count() === 1);
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
