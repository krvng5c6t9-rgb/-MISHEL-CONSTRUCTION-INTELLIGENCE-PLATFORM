import { chromium } from 'playwright-core';
import { AppError } from '../../middleware/errors.js';

// CC-085 (MP-03 §5): HTML documents rendered to PDF by headless Chromium (Playwright, Apache-2.0). PDF_CHROMIUM_PATH
// may name the Chromium executable; otherwise Playwright's installed browser is used. A server without Chromium
// refuses PDF output and keeps the HTML print view (printable from the browser).
export async function htmlToPdf(html: string, footer: string): Promise<Buffer> {
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.PDF_CHROMIUM_PATH || undefined });
  } catch {
    throw new AppError(503, 'PDF output is not available on this server (no Chromium); use the print view');
  }
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    return await page.pdf({ format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: footer,
      margin: { top: '16mm', bottom: '20mm', left: '14mm', right: '14mm' } });
  } finally {
    await browser.close();
  }
}
