// R1.2 batches 4-6 (CC-071, CC-072, CC-074) browser verification of translated screens in both languages: Projects, CRM,
// Tendering, BOQ, Contracts, Claims, Subcontracts, Cost Control, Approvals, Inventory, Procurement, Finance, Technical Office,
// Planning, Site Execution, QA/QC, HSE, EDMS, HR, Assets. For each screen and language: the title, the document direction, no
// Latin letters in the Arabic headings / column headings / buttons / field labels / placeholders / coded drop-down options,
// content within its column, no console errors and no 5xx. In Arabic, end to end: CRM client / lead / site-visit activity
// (CC-071); Finance manual journal and labelled ledger columns (CC-072); Technical Office RFI flagged for cost impact,
// Planning refusal shown and contractual milestone, HR employee tile = employees returned (CC-074).
// Run by tests/e2e/run_from_zero.sh when UI_CHECK=1 (CI does).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.UI_BASE ?? 'http://localhost:4173';
const RUN = process.env.RUN_ID ?? '';
const TAG = /^[A-Za-z0-9]{1,8}$/.test(RUN) ? RUN : createHash('sha256').update(RUN).digest('hex').slice(0, 8); // as harness.mjs
const OUT = process.env.OUT_DIR ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`); };

// CC-074: no screen takes "today" from the UTC date (a day early after midnight in Cairo); they use lib/date localDate().
const PAGES = new URL('../../frontend/src/pages/', import.meta.url);
const utcDated = readdirSync(PAGES).filter(f => /toISOString\(\)\.slice\(0, ?10\)/.test(readFileSync(new URL(f, PAGES), 'utf8')));
check('screens take today from the local date, not the UTC date', utcDated.length === 0, utcDated.join(', ') || 'none');

const SCREENS = [
  ['/projects', 'Projects', 'المشروعات'],
  ['/crm', 'CRM & Business Development', 'العملاء وتطوير الأعمال'],
  ['/tendering', 'Tendering', 'العطاءات'],
  ['/boq', 'BOQ & Rate Build-up', 'المقايسات وتحليل الأسعار'],
  ['/contracts', 'Contracts & Variations', 'العقود وأوامر التغيير'],
  ['/claims', 'Claims & EOT', 'المطالبات ومد المدة'],
  ['/subcontracts', 'Subcontracts', 'مقاولو الباطن'],
  ['/cost-control', 'Cost Control', 'ضبط التكاليف'],
  ['/approvals', 'Approvals', 'الاعتمادات'],
  ['/inventory', 'Inventory & Warehouses', 'المخازن والمستودعات'],
  ['/procurement', 'Procurement Control', 'ضبط المشتريات'],
  ['/finance', 'Finance / GL / IPC / Payments', 'المالية / الأستاذ العام / المستخلصات / المدفوعات'],
  ['/technical-office', 'Technical Office Control', 'ضبط المكتب الفني'],
  ['/planning', 'Planning & Scheduling', 'التخطيط والجدولة'],
  ['/site', 'Site Execution', 'تنفيذ الموقع'],
  ['/qaqc', 'Quality Control', 'ضبط الجودة'],
  ['/hse', 'HSE Control', 'ضبط السلامة والصحة المهنية'],
  ['/edms', 'Controlled Documents & Transmittals', 'الوثائق المضبوطة وخطابات التحويل'],
  ['/hr', 'HR / Payroll', 'الموارد البشرية / المرتبات'],
  ['/assets', 'Assets / Equipment', 'الأصول / المعدات']
];

let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  for (const lang of ['en', 'ar']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await ctx.addInitScript((l) => { try { localStorage.setItem('mishel.lang', l); } catch {} }, lang);
    const page = await ctx.newPage();
    const consoleErrors = [], serverErrors = [];
    page.on('console', m => { if (m.type() === 'error' && !/status of 40[349]|status of 422/.test(m.text())) consoleErrors.push(m.text()); });
    page.on('response', r => { if (r.url().includes('/api/') && r.status() >= 500) serverErrors.push(`${r.status()} ${r.url()}`); });
    await page.goto(`${BASE}/login`);
    const inputs = page.locator('input');
    await inputs.nth(0).fill('1'); await inputs.nth(1).fill('admin.a@test.local'); await inputs.nth(2).fill('Passw0rd!A');
    await page.getByRole('button', { name: lang === 'ar' ? 'دخول' : 'Login', exact: true }).click();
    await page.waitForURL(x => !x.pathname.startsWith('/login'), { timeout: 15000 });

    for (const [path, en, ar] of SCREENS) {
      await page.goto(`${BASE}${path}`); await page.waitForTimeout(1200);
      const title = lang === 'ar' ? ar : en;
      const state = await page.evaluate(() => {
        const m = document.querySelector('main'), mb = m.getBoundingClientRect();
        const texts = [...m.querySelectorAll('h1, h2, h3, th, button, label')].map(e => e.matches('label') ? e.firstChild?.textContent ?? '' : e.textContent ?? '')
          .concat([...m.querySelectorAll('[aria-label], [placeholder]')].map(e => e.getAttribute('aria-label') ?? e.getAttribute('placeholder') ?? ''))
          .concat([...m.querySelectorAll('select option')].filter(o => /^[a-z_]+$/.test(o.value)).map(o => o.textContent ?? ''))
          .map(s => s.trim()).filter(Boolean);
        const spill = [...m.querySelectorAll('*')].filter(e => !e.closest('.table-wrap')).map(e => e.getBoundingClientRect())
          .filter(b => b.width && (b.left < mb.left - 1 || b.right > mb.right + 1)).length;
        return { h1: m.querySelector('h1')?.textContent?.trim(), dir: document.documentElement.dir, texts, spill, page: document.documentElement.scrollWidth - innerWidth };
      });
      check(`${lang}: ${path} title and direction`, state.h1 === title && state.dir === (lang === 'ar' ? 'rtl' : 'ltr'), `${state.h1} / ${state.dir}`);
      if (lang === 'ar') {
        const latin = state.texts.filter(s => /[A-Za-z]/.test(s));
        check(`ar: ${path} no Latin letters in labels, placeholders and coded options`, state.texts.length >= 8 && latin.length === 0, latin.slice(0, 5).join(' | ') || `${state.texts.length} texts`);
      }
      check(`${lang}: ${path} content stays in its column`, state.spill === 0 && state.page <= 0, JSON.stringify({ spill: state.spill, page: state.page }));
    }

    if (lang === 'ar') {
      // CRM end to end in Arabic: the lead form now sends coded source / project type; the activity type is valid.
      await page.goto(`${BASE}/crm`); await page.waitForTimeout(1200);
      const alert = async () => (await page.locator('[role="alert"]').count()) ? await page.locator('[role="alert"]').innerText() : '';
      const clientName = `UI Client ${TAG}`, leadName = `UI Lead ${TAG}`;
      await page.locator('[data-section="clients"]').getByPlaceholder('اسم العميل').fill(clientName);
      await page.getByLabel('نوع العميل').selectOption('developer');
      await page.getByRole('button', { name: 'إنشاء عميل', exact: true }).click(); await page.waitForTimeout(1200);
      check('ar: CRM client created from the Arabic screen', !(await alert()), await alert());
      const lead = page.locator('[data-section="new-lead"]');
      await lead.getByPlaceholder('اسم الفرصة الأولية').fill(leadName);
      await lead.getByLabel('العميل').selectOption({ label: clientName });
      await lead.getByLabel('المصدر').selectOption('referral');
      await lead.getByLabel('نوع المشروع').selectOption('fit_out');
      await lead.getByRole('button', { name: 'إنشاء فرصة أولية', exact: true }).click(); await page.waitForTimeout(1200);
      const leadRow = page.locator('[data-section="leads"] tbody tr', { hasText: leadName });
      check('ar: CRM lead with source and project type accepted (was refused before CC-071)', !(await alert()) && await leadRow.count() === 1 && /جديد/.test(await leadRow.innerText()),
        (await alert()) || (await leadRow.innerText().catch(() => '(no row)')).replace(/\s+/g, ' '));
      const activity = page.locator('[data-section="activity"]');
      await activity.getByLabel('الفرصة الأولية').selectOption({ label: leadName });
      await activity.getByLabel('نوع النشاط').selectOption('site_visit');
      await activity.getByPlaceholder('ملاحظات').fill('Site walk with the client (UI fixture)');
      await activity.getByRole('button', { name: 'حفظ النشاط', exact: true }).click(); await page.waitForTimeout(1200);
      check('ar: CRM site-visit activity recorded', !(await alert()), await alert());
      await page.screenshot({ path: `${OUT}/screens_crm_ar_${RUN}.png`, fullPage: true });

      // Finance in Arabic (CC-072): a manual journal is created from the screen with a chosen reason category (the
      // screen used to send a category the API always refused); the General Ledger table has labelled debit AND credit.
      await page.goto(`${BASE}/finance`); await page.waitForTimeout(1500);
      const journal = page.locator('[data-section="journal"]');
      const jDesc = `UI journal ${TAG}`;
      await journal.getByPlaceholder('البيان').fill(jDesc);
      await journal.getByLabel('فئة السبب').selectOption('reclassification');
      await journal.getByLabel('الحساب المدين').selectOption({ index: 1 });
      await journal.getByLabel('الحساب الدائن').selectOption({ index: 2 });
      await journal.getByPlaceholder('المبلغ').fill('1');
      await journal.getByLabel('العملة').selectOption({ index: 1 });
      await journal.getByRole('button', { name: 'إنشاء القيد', exact: true }).click(); await page.waitForTimeout(1500);
      const jStatus = (await page.locator('[role="status"]').count()) ? (await page.locator('[role="status"]').innerText()).trim() : '';
      const jRow = page.locator('[data-section="table-fin.journals"] tbody tr', { hasText: jDesc });
      check('ar: Finance manual journal created from the screen with its reason category (was refused before CC-072)', jStatus === 'تم إنشاء القيد' && await jRow.count() === 1 && /إعادة تبويب/.test(await jRow.innerText()),
        (await alert()) || jStatus || '(no message)');
      const glHead = (await page.locator('[data-section="table-fin.gl"] thead th').allInnerTexts()).map(s => s.trim());
      check('ar: General Ledger table shows labelled debit and credit columns', glHead.includes('مدين') && glHead.includes('دائن') && !glHead.some(h => /_/.test(h)), glHead.join(' | '));
      await page.screenshot({ path: `${OUT}/screens_finance_ar_${RUN}.png`, fullPage: true });

      // Technical Office in Arabic (CC-074): an RFI flagged for cost impact from the screen (the screen always sent
      // false before, so the contract-event control on closing never applied).
      await page.goto(`${BASE}/technical-office`); await page.waitForTimeout(1200);
      const rfiSec = page.locator('[data-section="rfis"]');
      const rfiNo = `RFI-${TAG}`;
      await rfiSec.getByLabel('المشروع').selectOption({ index: 1 });
      await rfiSec.getByPlaceholder('رقم طلب الاستيضاح').fill(rfiNo);
      await rfiSec.getByPlaceholder('الموضوع').fill('UI fixture subject');
      await rfiSec.getByPlaceholder('السؤال').fill('UI fixture question');
      await rfiSec.getByLabel('أثر على التكلفة').check();
      await rfiSec.getByRole('button', { name: 'إنشاء', exact: true }).click(); await page.waitForTimeout(1200);
      const rfiRow = rfiSec.locator('tbody tr', { hasText: rfiNo });
      check('ar: Technical Office RFI flagged for cost impact from the screen (was always sent unflagged before CC-074)', !(await alert()) && await rfiRow.count() === 1 && /أثر على التكلفة/.test(await rfiRow.innerText()) && /مفتوح/.test(await rfiRow.innerText()),
        (await alert()) || (await rfiRow.innerText().catch(() => '(no row)')).replace(/\s+/g, ' '));

      // Planning in Arabic (CC-074): a refused action is shown (it failed silently before); a contractual milestone
      // with its planned date is recorded from the screen (the screen could not set either).
      await page.goto(`${BASE}/planning`); await page.waitForTimeout(1200);
      await page.locator('[data-section="scope"]').getByLabel('المشروع').selectOption({ index: 1 });
      await page.getByRole('button', { name: 'تحميل المشروع', exact: true }).click(); await page.waitForTimeout(1000);
      const act = page.locator('[data-section="activities"]');
      const addAct = async () => { await act.getByPlaceholder('كود النشاط').fill(`A-${TAG}`); await act.getByPlaceholder('اسم النشاط').fill(`UI activity ${TAG}`); await act.getByRole('button', { name: 'إضافة نشاط', exact: true }).click(); await page.waitForTimeout(1200); };
      await addAct();
      const firstOk = !(await alert()) && await act.locator('tbody tr', { hasText: `A-${TAG}` }).count() === 1;
      await addAct();
      check('ar: Planning shows the refusal of a duplicate activity code (failed silently before CC-074)', firstOk && !!(await alert()) && await act.locator('tbody tr', { hasText: `A-${TAG}` }).count() === 1, (await alert()) || '(no message)');
      const ms = page.locator('[data-section="milestones"]');
      await ms.getByPlaceholder('اسم المَعلَم').fill(`UI milestone ${TAG}`);
      await ms.getByLabel('التاريخ المخطط').fill('2027-03-31');
      await ms.getByLabel('تعاقدي').check();
      await ms.getByRole('button', { name: 'إضافة مَعلَم', exact: true }).click(); await page.waitForTimeout(1200);
      const msRow = ms.locator('tbody tr', { hasText: `UI milestone ${TAG}` });
      const msText = (await msRow.innerText().catch(() => '')).replace(/\s+/g, ' ');
      check('ar: Planning contractual milestone with planned date recorded from the screen', await msRow.count() === 1 && /2027-03-31/.test(msText) && /نعم/.test(msText), (await alert()) || msText || '(no row)');
      await page.screenshot({ path: `${OUT}/screens_planning_ar_${RUN}.png`, fullPage: true });

      // HR (CC-074): the tile counts every employee the API returned (it counted at most the first 8).
      // More than 8 employees are made first (through the API the screen uses) so the check can tell a cap from a count.
      let empResp = page.waitForResponse(r => r.url().includes('/api/hr/employees') && r.request().method() === 'GET');
      await page.goto(`${BASE}/hr`);
      const first = await empResp;
      const token = await page.evaluate(() => localStorage.getItem('construction_erp_token'));
      for (let i = (await first.json()).data.length; i <= 9; i++) {
        await page.request.post(first.url(), { headers: { Authorization: `Bearer ${token}` }, data: { employee_code: `E${TAG}${i}`, full_name: `UI Employee ${TAG} ${i}` } });
      }
      empResp = page.waitForResponse(r => r.url().includes('/api/hr/employees') && r.request().method() === 'GET');
      await page.reload();
      const apiCount = await empResp.then(async r => r.ok() ? (await r.json()).data.length : -1);
      await page.waitForTimeout(1200);
      const tile = (await page.locator('.metric-card').first().locator('strong').innerText()).trim();
      check('ar: HR employee tile equals the number of employees returned (was capped at 8)', apiCount > 8 && tile === String(apiCount), `tile ${tile}, API ${apiCount}`);
    }
    check(`${lang}: no 5xx from the API`, serverErrors.length === 0, serverErrors.slice(0, 3).join(' | '));
    check(`${lang}: no browser console errors`, consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
    await ctx.close();
  }
} catch (e) {
  check('screens browser check completed', false, e.message.replace(/\x1b\[[0-9;]*m/g, '').slice(0, 1200));
} finally {
  await browser?.close();
}
const fail = results.filter(r => !r.ok).length;
console.log(`\nSUMMARY screens_ui PASS=${results.length - fail} FAIL=${fail}`);
process.exitCode = fail ? 1 : 0;
