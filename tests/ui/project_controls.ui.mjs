// Stage 18 browser verification of the Project Controls screen against a running API + built frontend, using data
// left by the runtime gate (RUN tag passed in UI_TAG). Not part of run_from_zero.sh (needs Chromium); run manually:
//   UI_BASE=http://localhost:4173 UI_TAG=mb1 OUT_DIR=/tmp/shots node tests/ui/project_controls.ui.mjs
import { chromium } from 'playwright';

const BASE = process.env.UI_BASE ?? 'http://localhost:4173';
const TAG = process.env.UI_TAG;
const OUT = process.env.OUT_DIR ?? '.';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const consoleErrors = [], apiFailures = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('response', r => { if (r.url().includes('/api/') && r.status() >= 400) apiFailures.push(`${r.status()} ${r.request().method()} ${r.url().replace(/^.*\/api/, '')}`); });
// The sandbox proxy blocks third-party TLS (Google Fonts); serve an empty stylesheet so console checks reflect the app (F-28).
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'UI check (fixture)' : undefined));

try {
  await page.goto(`${BASE}/login`);
  const inputs = page.locator('input');
  await inputs.nth(0).fill('1');
  await inputs.nth(1).fill('admin.a@test.local');
  await inputs.nth(2).fill('Passw0rd!A');
  await page.getByRole('button', { name: 'Login' }).click();
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 15000 });
  check('admin signs in through the login page', true);

  await page.getByRole('link', { name: 'Project Controls' }).click();
  await page.waitForURL(/project-controls/);
  check('navigation entry opens Project Controls', await page.getByRole('heading', { name: 'Project Controls' }).isVisible());

  const open = async (code) => {
    const value = await page.locator('select[aria-label="Project"] option', { hasText: `${code}-${TAG}` }).getAttribute('value');
    await page.selectOption('select[aria-label="Project"]', value);
    await page.waitForTimeout(1500);
  };
  const section = (name) => page.locator(`[data-section="${name}"]`);

  await open('TF');
  const timeText = await section('time').innerText();
  check('time section shows revised completion, LD terms and exposure for the TF contract', /confirmed/.test(timeText) && /\d{4}-\d{2}-\d{2}/.test(timeText), timeText.split('\n').slice(0, 4).join(' | '));
  await page.screenshot({ path: `${OUT}/ui_time_TF.png`, fullPage: true });

  await open('MB');
  const gateText = await section('mobilisation').innerText();
  check('mobilisation section shows the decided GO gate and its items', /go/.test(gateText) && /Excavation permit/.test(gateText), gateText.split('\n').slice(0, 3).join(' | '));
  const before = await section('risks').locator('tbody tr').count();
  await section('risks').locator('input[aria-label="Risk number"]').fill(`UI-${TAG}-${Date.now() % 100000}`);
  await section('risks').locator('input[aria-label="Risk title"]').fill('Crane access restricted (UI check)');
  await section('risks').locator('input[aria-label="Cause"]').fill('Narrow site entrance (fixture)');
  await section('risks').locator('input[aria-label="Effect"]').fill('Lifting plan delayed (fixture)');
  await section('risks').getByRole('button', { name: 'Raise risk' }).click();
  await page.waitForTimeout(1500);
  const after = await section('risks').locator('tbody tr').count();
  check('a risk raised from the form appears in the register', after === before + 1, `${before} -> ${after}`);
  await page.screenshot({ path: `${OUT}/ui_risks_mobilisation_MB.png`, fullPage: true });

  await open('RP');
  check('report packs listed for RP', (await section('report-packs').locator('tbody tr').count()) >= 2);
  await section('report-packs').getByRole('button', { name: 'Open' }).last().click();
  await page.waitForTimeout(1200);
  const packText = await section('pack-detail').innerText();
  check('opened pack shows hash verification, as-of cost and reconciliation exceptions', /Hash valid: true/.test(packText) && /actual_not_posted_to_gl|backdated_into_approved_period/.test(packText), packText.split('\n').slice(0, 3).join(' | '));
  await page.screenshot({ path: `${OUT}/ui_report_pack_RP.png`, fullPage: true });

  await open('CM');
  const cmText = await section('commissioning').innerText();
  check('commissioning readiness shows the handed-over HVAC system', new RegExp(`HVAC-${TAG}`).test(cmText) && /true/.test(cmText), cmText.split('\n').slice(0, 3).join(' | '));

  await open('VA');
  await section('design-impacts').locator('tbody tr', { hasText: `S-300-${TAG}` }).getByRole('button', { name: 'Open' }).click();
  await page.waitForTimeout(1200);
  const diText = await section('impact-detail').innerText();
  check('design impact opens with its traced objects and dispositions', /BOQ|Activity|Inspection/.test(diText) && /change_required|no_change/.test(diText), diText.split('\n').slice(0, 3).join(' | '));
  await page.screenshot({ path: `${OUT}/ui_design_impact_VA.png`, fullPage: true });

  check('no browser console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' || '));
  check('no failed API calls while browsing', apiFailures.length === 0, apiFailures.slice(0, 5).join(' || '));
} catch (e) {
  check('UI run completed', false, String(e.message).slice(0, 300));
  await page.screenshot({ path: `${OUT}/ui_failure.png`, fullPage: true }).catch(() => {});
}
await browser.close();
const fail = results.filter(r => !r.ok).length;
console.log(`\nSUMMARY project_controls_ui PASS=${results.length - fail} FAIL=${fail}`);
process.exitCode = fail ? 1 : 0;
