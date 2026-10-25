import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { ar, en, statusLabels, type LabelKey } from './labels.js';

// CC-085 (R1.5, MP-03 §1): printed documents as self-contained HTML (fonts embedded), the source of both the print view
// and the PDF. Every figure is the database value as text (never re-computed); amounts are only grouped by thousands.
// A document whose record is not approved carries a DRAFT watermark; the approval block comes from the workflow
// records, never from typed names; the export number links the copy to its entry in document_exports.
export type Lang = 'ar' | 'en';
export type ExportInfo = { id: number; at: string; by: string };
type Row = Record<string, any>;
type Labels = Record<LabelKey, string>;

const require = createRequire(import.meta.url);
let fontCss: string | null = null;
function fonts(): string {
  if (fontCss) return fontCss;
  const dir = require.resolve('@fontsource/cairo/package.json').replace(/package\.json$/, 'files/');
  const face = (subset: string, weight: number) => {
    const data = readFileSync(`${dir}cairo-${subset}-${weight}-normal.woff2`).toString('base64');
    return `@font-face{font-family:Cairo;font-weight:${weight};src:url(data:font/woff2;base64,${data}) format('woff2');}`;
  };
  fontCss = [face('arabic', 400), face('arabic', 700), face('latin', 400), face('latin', 700)].join('');
  return fontCss;
}

export const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
// "1234567.50" -> "1,234,567.50": grouping of the database text, no arithmetic.
export const money = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  const m = /^(-?)(\d+)(\.\d+)?$/.exec(String(v));
  return m ? `${m[1]}${m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${m[3] ?? ''}` : esc(v);
};
const day = (v: unknown) => (v ? esc(String(v).slice(0, 10)) : '—');
const num = (s: string) => `<span class="num" dir="ltr">${s}</span>`;

function layout(lang: Lang, title: string, draft: boolean, body: string, exp: ExportInfo, org: Row): string {
  const L = lang === 'ar' ? ar : en;
  return `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
${fonts()}
@page{size:A4;margin:16mm 14mm 20mm}
body{font-family:Cairo,sans-serif;font-size:10.5pt;color:#1B2A41;margin:0}
.num{unicode-bidi:isolate;font-variant-numeric:tabular-nums}
header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1B2A41;padding-bottom:6px;margin-bottom:10px}
header .org strong{font-size:13pt;display:block}
h1{font-size:15pt;margin:4px 0}
table{width:100%;border-collapse:collapse;margin:6px 0 10px}
th,td{border:1px solid #c9ced6;padding:4px 6px;text-align:start;vertical-align:top}
th{background:#eef1f5}
td.amount{text-align:end;white-space:nowrap}
tr.total td{font-weight:700;background:#f6f7f9}
.meta td:first-child{width:32%;background:#f6f7f9;font-weight:700}
.watermark{position:fixed;top:38%;left:0;right:0;text-align:center;font-size:90pt;font-weight:700;color:rgba(200,30,30,.13);transform:rotate(-28deg);z-index:0;pointer-events:none}
.draftnote{border:1px solid #c81e1e;color:#c81e1e;padding:4px 8px;margin-bottom:8px;font-weight:700}
.trace{margin-top:14px;font-size:8.5pt;color:#4a5566;border-top:1px solid #c9ced6;padding-top:6px}
h2{font-size:11.5pt;margin:12px 0 4px}
</style></head><body>
${draft ? `<div class="watermark">${esc(L.draft)}</div><div class="draftnote">${esc(L.draftNote)}</div>` : ''}
<header><div class="org"><strong>${esc(org.legal_name || org.name)}</strong>${org.address ? `<div>${esc(org.address)}</div>` : ''}${org.tax_id ? `<div>${esc(L.taxId)}: ${num(esc(org.tax_id))}</div>` : ''}</div>
<div><h1>${esc(title)}</h1></div></header>
${body}
<div class="trace">${esc(L.exportNo)} ${num(String(exp.id))} · ${esc(L.exportedAt)} ${num(esc(exp.at))} ${esc(L.exportedBy)} ${esc(exp.by)}<br>${esc(L.verify)}</div>
</body></html>`;
}

const metaTable = (rows: [string, string][]) => `<table class="meta">${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join('')}</table>`;
const amountTable = (L: Labels, currency: string, rows: [LabelKey, unknown, boolean?][]) =>
  `<h2>${esc(L.valuation)} (${esc(currency)})</h2><table>${rows.filter(([, v]) => v !== null && v !== undefined).map(([k, v, total]) =>
    `<tr${total ? ' class="total"' : ''}><td>${esc(L[k])}</td><td class="amount">${num(money(v))}</td></tr>`).join('')}</table>`;

function approvalBlock(L: Labels, steps: Row[]): string {
  if (!steps.length) return `<h2>${esc(L.approvals)}</h2><p>${esc(L.noApprovals)}</p>`;
  return `<h2>${esc(L.approvals)}</h2><table><thead><tr><th>${esc(L.colAction)}</th><th>${esc(L.colName)}</th><th>${esc(L.colRole)}</th><th>${esc(L.colDate)}</th></tr></thead><tbody>${steps.map(s =>
    `<tr><td>${esc((L as any)[s.label] ?? s.label)}</td><td>${esc(s.name ?? '—')}</td><td>${esc(s.role ?? '—')}</td><td>${num(day(s.at))}</td></tr>`).join('')}</tbody></table>`;
}

export function renderIpc(lang: Lang, d: { ipc: Row; org: Row; lines: Row[]; steps: Row[] }, draft: boolean, exp: ExportInfo): string {
  const L = lang === 'ar' ? ar : en, i = d.ipc;
  const meta = metaTable([
    [L.ipcNo, num(esc(i.ipc_no))], [L.status, esc(statusLabels[lang][i.status] ?? i.status)],
    [L.project, `${num(esc(i.project_code))} — ${esc(i.project_name)}`], [L.contract, num(`#${esc(i.contract_id)}`)], [L.client, esc(i.client_name)],
    [L.period, `${esc(L.from)} ${num(day(i.period_from))} ${esc(L.to)} ${num(day(i.period_to))}`], [L.currency, esc(i.currency)],
    ...(i.client_reference ? [[L.clientReference, esc(i.client_reference)] as [string, string]] : [])
  ]);
  const amounts = amountTable(L, i.currency, [
    ['grossThisPeriod', i.gross_work_done_this_period], ['grossCumulative', i.cumulative_gross_work_done], ['materialsOnSite', i.materials_on_site_value],
    ['lessRetention', i.less_retention], ['lessAdvance', i.less_advance_recovery], ['lessPrevious', i.less_previous_certified],
    ['outputTax', i.output_tax_amount], ['netDue', i.net_amount_due, true], ['clientCertified', i.client_certified_amount]
  ]);
  const lines = d.lines.length ? `<h2>${esc(L.lines)}</h2><table><thead><tr><th>${esc(L.colItem)}</th><th>${esc(L.colDescription)}</th><th>${esc(L.colUnit)}</th><th>${esc(L.colQtyPeriod)}</th><th>${esc(L.colQtyCumulative)}</th><th>${esc(L.colRate)}</th><th>${esc(L.colAmountPeriod)}</th><th>${esc(L.colAmountCumulative)}</th></tr></thead><tbody>${d.lines.map(l =>
    `<tr><td>${num(esc(l.item_no ?? '—'))}</td><td>${esc(l.description ?? '—')}</td><td>${esc(l.unit ?? '—')}</td><td class="amount">${num(money(l.quantity_this_period))}</td><td class="amount">${num(money(l.cumulative_quantity))}</td><td class="amount">${num(money(l.unit_rate))}</td><td class="amount">${num(money(l.amount_this_period))}</td><td class="amount">${num(money(l.cumulative_amount))}</td></tr>`).join('')}</tbody></table>`
    : `<h2>${esc(L.lines)}</h2><p>${esc(L.noLines)}</p>`;
  return layout(lang, `${L.ipcTitle} ${i.ipc_no}`, draft, meta + amounts + lines + approvalBlock(L, d.steps), exp, d.org);
}

export function renderSubcontractCertificate(lang: Lang, d: { cert: Row; org: Row; lines: Row[]; steps: Row[] }, draft: boolean, exp: ExportInfo): string {
  const L = lang === 'ar' ? ar : en, c = d.cert;
  const meta = metaTable([
    [L.scNo, num(esc(c.certificate_no))], [L.status, esc(statusLabels[lang][c.status] ?? c.status)],
    [L.project, `${num(esc(c.project_code))} — ${esc(c.project_name)}`], [L.subcontractor, esc(c.vendor_name)], [L.package, esc(c.package_name)],
    [L.period, `${esc(L.from)} ${num(day(c.period_from))} ${esc(L.to)} ${num(day(c.period_to))}`], [L.currency, esc(c.currency)]
  ]);
  const amounts = amountTable(L, c.currency, [
    ['grossThisPeriod', c.gross_work_done], ['previousCumulative', c.previous_cumulative_gross], ['grossCumulative', c.cumulative_gross_to_date],
    ['lessRetention', c.less_retention], ['lessAdvance', c.less_advance_recovery], ['lessPreviousPaid', c.less_previous_paid],
    ['lessPenalties', c.penalties_deductions], ['inputTax', c.input_tax_amount], ['netDue', c.net_amount_due, true]
  ]);
  const lines = d.lines.length ? `<h2>${esc(L.lines)}</h2><table><thead><tr><th>${esc(L.colDescription)}</th><th>${esc(L.colQtyPeriod)}</th><th>${esc(L.colQtyCumulative)}</th><th>${esc(L.colRate)}</th><th>${esc(L.colAmount)}</th></tr></thead><tbody>${d.lines.map(l =>
    `<tr><td>${esc(l.description)}</td><td class="amount">${num(money(l.quantity_this_period))}</td><td class="amount">${num(money(l.cumulative_quantity))}</td><td class="amount">${num(money(l.unit_rate))}</td><td class="amount">${num(money(l.amount))}</td></tr>`).join('')}</tbody></table>`
    : `<h2>${esc(L.lines)}</h2><p>${esc(L.noLines)}</p>`;
  return layout(lang, `${L.scTitle} ${c.certificate_no}`, draft, meta + amounts + lines + approvalBlock(L, d.steps), exp, d.org);
}

// The PDF footer is drawn by Chromium apart from the page and cannot use the embedded font, so it carries only digits
// and symbols (export number, page / pages) - no words that could render without glyphs.
export const pageFooter = (exportId: number) =>
  `<div style="font-family:sans-serif;font-size:8px;width:100%;padding:0 14mm;color:#4a5566;display:flex;justify-content:space-between" dir="ltr"><span>MARC #${exportId}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
