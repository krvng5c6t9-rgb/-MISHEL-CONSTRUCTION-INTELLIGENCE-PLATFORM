// R1.1 (MP-06 §1) browser verification of the bilingual shell: Arabic is the default with right-to-left direction;
// the language switch changes language and direction on the sign-in screen and in the application shell, persists
// across reloads, every one of the 37 navigation items is translated in both languages and shown in its group (R1.3) only to users with
// view rights on it, and the landing dashboard is in
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

// R1.3 (CC-081): grouped navigation (MP-06 §3), in group order.
const EN_NAV = ['Dashboard', 'Notifications', 'Approvals', 'Owner Portfolio', 'Executive Dashboard', 'CRM', 'Tendering', 'BOQ', 'Contracts', 'Claims / EOT', 'Subcontracts',
  'Payments & Certification', 'Projects', 'Project Controls', 'Planning', 'Cost Control', 'Reports', 'Technical Office', 'EDMS', 'Site Execution',
  'QA/QC', 'HSE', 'Procurement', 'Inventory', 'Assets', 'Finance', 'Exchange Rates', 'Revenue & Contract Position', 'Go-live cut-over', 'HR / Payroll',
  'Users / Roles / DOA', 'Portals', 'Runtime Validation', 'AI Platform', 'Automation / Integrations', 'Knowledge / RAG', 'Commercial SaaS'];
const EN_GROUPS = ['Home, tasks and approvals', 'Business development and tendering', 'Contracts and commercial', 'Projects and planning',
  'Engineering and technical office', 'Site execution', 'Quality and HSE', 'Supply chain, stores and plant', 'Finance and tax', 'People and administration',
  'System, data and AI'];
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

// F-55 (CC-080): every fixed refusal text of a translated API module has an exact Arabic entry in lib/serverMessages.ts
// (the "… not found" and "Invalid … id" families are translated by pattern); a new message in that module fails here
// until it is translated. Messages built from values must have a pattern for their fixed words.
const TRANSLATED_MODULES = ['finance', 'notifications', 'documents'];
const sm = readFileSync(new URL('../../frontend/src/lib/serverMessages.ts', import.meta.url), 'utf8');
const exactKeys = new Set([...sm.slice(sm.indexOf('const EXACT'), sm.indexOf('};', sm.indexOf('const EXACT'))).matchAll(/^\s*'((?:[^'\\]|\\.)*)': '/gm)].map(m => m[1]));
const untranslated = [];
for (const mod of TRANSLATED_MODULES) {
  const mdir = new URL(`../../backend/src/modules/${mod}/`, import.meta.url);
  for (const f of readdirSync(mdir).filter(x => x.endsWith('.ts'))) {
    const src = readFileSync(new URL(f, mdir), 'utf8');
    for (const m of src.matchAll(/AppError\(\d+, ?'((?:[^'\\]|\\.)*)'/g)) {
      if (!exactKeys.has(m[1]) && !/ not found( in current organization| or inactive)?$/.test(m[1]) && !/^Invalid( [a-z ]+)? id$/i.test(m[1])) untranslated.push(`${f}: ${m[1]}`);
    }
    for (const m of src.matchAll(/AppError\(\d+, ?`([^`$]+)\$\{/g)) if (!sm.includes(`[/^${m[1].replace(/[.]/g, '\\.')}`)) untranslated.push(`${f}: ${m[1]}…`);
  }
}
check('server messages: every fixed refusal of the translated API modules has an Arabic translation (F-55)', exactKeys.size > 50 && !untranslated.length,
  untranslated.slice(0, 5).join(' | ') || `${TRANSLATED_MODULES.join(', ')}; ${exactKeys.size} exact entries`);

const backendSrc = new URL('../../backend/src/', import.meta.url);
const walk = (u) => readdirSync(u, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(new URL(e.name + '/', u)) : e.name.endsWith('.ts') ? [readFileSync(new URL(e.name, u), 'utf8')] : []);
const enforced = new Set(walk(backendSrc).flatMap(src => [...src.matchAll(/authorize\('([a-z_]+)'/g)].map(m => m[1])));
const listOf = (src, re) => new Set([...(src.match(re)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map(m => m[1]));
const grantable = listOf(readFileSync(new URL('../../frontend/src/pages/Admin.tsx', import.meta.url), 'utf8'), /const MODULES=\[([^\]]+)\]/);
const bootstrap = listOf(readFileSync(new URL('modules/auth/auth.routes.ts', backendSrc), 'utf8'), /const modules = \[([^\]]+)\]/);
const navPerms = new Set([...readFileSync(new URL('../../frontend/src/components/Layout.tsx', import.meta.url), 'utf8').matchAll(/perms: \[([^\]]+)\]/g)].flatMap(m => [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1])));
const diff = (a, b) => [...a].filter(x => !b.has(x));
check('permissions: every module the API enforces can be granted on the Roles screen and is given to the first administrator (F-57)', enforced.size >= 28
  && !diff(enforced, grantable).length && !diff(enforced, bootstrap).length && !diff(grantable, enforced).length,
  `not grantable: ${diff(enforced, grantable).join(',') || '-'}; not given: ${diff(enforced, bootstrap).join(',') || '-'}; unknown: ${diff(grantable, enforced).join(',') || '-'}`);
check('navigation: every item is guarded by a permission module the API enforces', navPerms.size > 20 && !diff(navPerms, enforced).length, diff(navPerms, enforced).join(',') || `${navPerms.size} modules`);

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
  check('all 37 navigation items translated to Arabic (Arabic text, no Latin letters)', ar.length === 37 && ar.every(t => ARABIC.test(t) && !LATIN.test(t)),
    ar.filter(t => !ARABIC.test(t) || LATIN.test(t)).join(' | ') || `${ar.length} items`);
  check('Arabic navigation labels are distinct', new Set(ar).size === ar.length);
  const groupTexts = async () => (await page.locator('nav .nav-group-toggle').allInnerTexts()).map(s => s.trim());
  const arGroups = await groupTexts();
  check('navigation in 11 groups with Arabic headings (R1.3)', arGroups.length === 11 && arGroups.every(g => ARABIC.test(g) && !LATIN.test(g)) && new Set(arGroups).size === 11, arGroups.join(' | '));
  check('logout labelled in Arabic', await page.getByRole('button', { name: 'تسجيل الخروج' }).count() === 1);
  // Brand MARC (owner decision DEC-020): Latin letters in both languages; the descriptor follows the language.
  const brand = async () => page.evaluate(() => ({ name: document.querySelector('.brand strong')?.textContent, tagline: document.querySelector('.brand small')?.textContent, title: document.title }));
  const arBrand = await brand();
  check('brand in Arabic: MARC with the Arabic descriptor, page title likewise', arBrand.name === 'MARC' && arBrand.tagline === 'المنظومة المتكاملة لشركات المقاولات'
    && arBrand.title === 'MARC — المنظومة المتكاملة لشركات المقاولات', JSON.stringify(arBrand));
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
  check('all 37 navigation items in English, in order', JSON.stringify(en) === JSON.stringify(EN_NAV),
    en.filter((t, i) => t !== EN_NAV[i]).join(' | ') || `${en.length} items`);
  check('logout labelled in English', await page.getByRole('button', { name: 'Logout' }).count() === 1);
  const enBrand = await brand();
  check('brand in English: MARC with the English descriptor, page title likewise', enBrand.name === 'MARC' && enBrand.tagline === 'Integrated Construction Enterprise System'
    && enBrand.title === 'MARC — Integrated Construction Enterprise System', JSON.stringify(enBrand));
  const enSide = await side();
  check('English layout: navigation on the left, content and navigation left-to-right', enSide.nav < enSide.main && enSide.contentDir === 'ltr' && enSide.navDir === 'ltr', JSON.stringify(enSide));
  await page.getByRole('link', { name: 'Go-live cut-over' }).click(); await page.waitForURL(/\/cutover/);
  check('navigation works after switching language', /\/cutover$/.test(new URL(page.url()).pathname));
  check('11 navigation groups in English, in order (R1.3)', JSON.stringify(await groupTexts()) === JSON.stringify(EN_GROUPS), (await groupTexts()).join(' | '));
  // A group folds and unfolds; the group holding the current screen stays open.
  const bd = page.getByRole('button', { name: 'Business development and tendering' });
  await bd.click(); await page.waitForTimeout(200);
  const folded = await bd.getAttribute('aria-expanded') === 'false' && !(await page.getByRole('link', { name: 'CRM' }).isVisible());
  await bd.click(); await page.waitForTimeout(200);
  const unfolded = await bd.getAttribute('aria-expanded') === 'true' && await page.getByRole('link', { name: 'CRM' }).isVisible();
  const fin = page.getByRole('button', { name: 'Finance and tax' });
  await fin.click(); await page.waitForTimeout(200);
  check('a navigation group folds and unfolds; the group of the current screen stays open', folded && unfolded && await fin.getAttribute('aria-expanded') === 'true'
    && await page.getByRole('link', { name: 'Go-live cut-over' }).isVisible(), `folded ${folded}, unfolded ${unfolded}`);
  await fin.click();
  // Only what the user may see: a user with view rights on CRM and Finance only gets the home dashboard and those screens.
  const token = await page.evaluate(() => localStorage.getItem('construction_erp_token'));
  const meUrl = await page.evaluate(() => performance.getEntriesByType('resource').map(e => e.name).find(n => n.endsWith('/auth/me')));
  const apiBase = meUrl.replace(/\/auth\/me$/, '');
  const post = async (path, data) => (await page.request.post(`${apiBase}${path}`, { headers: { Authorization: `Bearer ${token}` }, data })).json();
  const role = await post('/roles', { role_name: `Nav CRM finance ${RUN}`, permissions: [['crm', 'view'], ['finance', 'view']].map(([module, action]) => ({ module, action, scope: 'all' })) });
  const email = `nav.${RUN.toLowerCase().replace(/[^a-z0-9]/g, '')}@test.local`;
  await post('/users', { role_id: role.data?.id, full_name: 'Nav limited user', email, password: 'Passw0rd!Nav' });
  await page.getByRole('button', { name: 'Logout' }).click(); await page.waitForURL(/\/login/);
  const li = page.locator('input');
  await li.nth(0).fill('1'); await li.nth(1).fill(email); await li.nth(2).fill('Passw0rd!Nav');
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL(x => !x.pathname.startsWith('/login'), { timeout: 15000 }); await page.waitForTimeout(1000);
  const limited = await navTexts();
  check('a user with CRM and Finance view rights sees only the home dashboard and those screens, in their groups (R1.3)',
    JSON.stringify(limited) === JSON.stringify(['Dashboard', 'Notifications', 'CRM', 'Payments & Certification', 'Finance', 'Exchange Rates', 'Revenue & Contract Position', 'Go-live cut-over'])
    && JSON.stringify(await groupTexts()) === JSON.stringify(['Home, tasks and approvals', 'Business development and tendering', 'Contracts and commercial', 'Finance and tax']),
    `${limited.join(' | ')} || ${(await groupTexts()).join(' | ')}`);
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
