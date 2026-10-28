import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { ar, en, statusLabels, type LabelKey } from './labels.js';
import { amountInWords, type CurrencyWords } from './words.js';

// CC-085 (R1.5, MP-03 §1): printed documents as self-contained HTML (fonts embedded), the source of both the print view
// and the PDF. Every figure is the database value as text (never re-computed); amounts are only grouped by thousands.
// A document whose record is not approved carries a DRAFT watermark; the approval block comes from the workflow
// records, never from typed names; the export number links the copy to its entry in document_exports.
export type Lang = 'ar' | 'en';
export type ExportInfo = { id: number; at: string; by: string };
// DRAFT: not yet final; VOID: rejected or cancelled (CC-086: a rejected certificate printed as DRAFT before).
export type Mark = 'draft' | 'void' | null;
type Row = Record<string, any>;
type Labels = Record<LabelKey, string>;
// CC-088: the currency's minor units and the company's names for amounts in words (null when not set).
export type Words = { minor_units: number; names: CurrencyWords | null };

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

// The document number is isolated left-to-right after the title (a date or a code would otherwise be reordered in Arabic).
function layout(lang: Lang, title: string, no: string, mark: Mark, body: string, exp: ExportInfo, org: Row): string {
  const L = lang === 'ar' ? ar : en;
  return `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${esc(title)} ${esc(no)}</title><style>
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
.words{margin:-4px 0 10px;font-weight:700}
.trace{margin-top:14px;font-size:8.5pt;color:#4a5566;border-top:1px solid #c9ced6;padding-top:6px}
h2{font-size:11.5pt;margin:12px 0 4px}
</style></head><body>
${mark ? `<div class="watermark">${esc(mark === 'draft' ? L.draft : L.void)}</div><div class="draftnote">${esc(mark === 'draft' ? L.draftNote : L.voidNote)}</div>` : ''}
<header><div class="org"><strong>${esc(org.legal_name || org.name)}</strong>${org.address ? `<div>${esc(org.address)}</div>` : ''}${org.tax_id ? `<div>${esc(L.taxId)}: ${num(esc(org.tax_id))}</div>` : ''}</div>
<div><h1>${esc(title)} ${num(esc(no))}</h1></div></header>
${body}
<div class="trace">${esc(L.exportNo)} ${num(String(exp.id))} · ${esc(L.exportedAt)} ${num(esc(exp.at))} ${esc(L.exportedBy)} ${esc(exp.by)}<br>${esc(L.verify)}</div>
</body></html>`;
}

// The amount in words, from the database text (F-64); no line when the amount cannot be written exactly.
const wordsLine = (lang: Lang, L: Labels, value: unknown, currency: string, w?: Words) => {
  const text = w ? amountInWords(lang, value, currency, w.minor_units, w.names) : null;
  return text ? `<p class="words">${esc(L.inWords)}: <span data-words>${esc(text)}</span></p>` : '';
};
const metaTable = (rows: [string, string][]) => `<table class="meta">${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join('')}</table>`;
const amountTable = (L: Labels, currency: string, rows: [LabelKey, unknown, boolean?][]) =>
  `<h2>${esc(L.valuation)} (${esc(currency)})</h2><table>${rows.filter(([, v]) => v !== null && v !== undefined).map(([k, v, total]) =>
    `<tr${total ? ' class="total"' : ''}><td>${esc(L[k])}</td><td class="amount">${num(money(v))}</td></tr>`).join('')}</table>`;

function approvalBlock(L: Labels, steps: Row[]): string {
  if (!steps.length) return `<h2>${esc(L.approvals)}</h2><p>${esc(L.noApprovals)}</p>`;
  return `<h2>${esc(L.approvals)}</h2><table><thead><tr><th>${esc(L.colAction)}</th><th>${esc(L.colName)}</th><th>${esc(L.colRole)}</th><th>${esc(L.colDate)}</th></tr></thead><tbody>${steps.map(s =>
    `<tr><td>${esc((L as any)[s.label] ?? s.label)}</td><td>${esc(s.name ?? '—')}</td><td>${esc(s.role ?? '—')}</td><td>${num(day(s.at))}</td></tr>`).join('')}</tbody></table>`;
}

export function renderIpc(lang: Lang, d: { ipc: Row; org: Row; lines: Row[]; steps: Row[]; words?: Words }, mark: Mark, exp: ExportInfo): string {
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
  ]) + wordsLine(lang, L, i.net_amount_due, i.currency, d.words);
  const lines = d.lines.length ? `<h2>${esc(L.lines)}</h2><table><thead><tr><th>${esc(L.colItem)}</th><th>${esc(L.colDescription)}</th><th>${esc(L.colUnit)}</th><th>${esc(L.colQtyPeriod)}</th><th>${esc(L.colQtyCumulative)}</th><th>${esc(L.colRate)}</th><th>${esc(L.colAmountPeriod)}</th><th>${esc(L.colAmountCumulative)}</th></tr></thead><tbody>${d.lines.map(l =>
    `<tr><td>${num(esc(l.item_no ?? '—'))}</td><td>${esc(l.description ?? '—')}</td><td>${esc(l.unit ?? '—')}</td><td class="amount">${num(money(l.quantity_this_period))}</td><td class="amount">${num(money(l.cumulative_quantity))}</td><td class="amount">${num(money(l.unit_rate))}</td><td class="amount">${num(money(l.amount_this_period))}</td><td class="amount">${num(money(l.cumulative_amount))}</td></tr>`).join('')}</tbody></table>`
    : `<h2>${esc(L.lines)}</h2><p>${esc(L.noLines)}</p>`;
  return layout(lang, L.ipcTitle, String(i.ipc_no), mark, meta + amounts + lines + approvalBlock(L, d.steps), exp, d.org);
}

export function renderSubcontractCertificate(lang: Lang, d: { cert: Row; org: Row; lines: Row[]; steps: Row[]; words?: Words }, mark: Mark, exp: ExportInfo): string {
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
  ]) + wordsLine(lang, L, c.net_amount_due, c.currency, d.words);
  const lines = d.lines.length ? `<h2>${esc(L.lines)}</h2><table><thead><tr><th>${esc(L.colDescription)}</th><th>${esc(L.colQtyPeriod)}</th><th>${esc(L.colQtyCumulative)}</th><th>${esc(L.colRate)}</th><th>${esc(L.colAmount)}</th></tr></thead><tbody>${d.lines.map(l =>
    `<tr><td>${esc(l.description)}</td><td class="amount">${num(money(l.quantity_this_period))}</td><td class="amount">${num(money(l.cumulative_quantity))}</td><td class="amount">${num(money(l.unit_rate))}</td><td class="amount">${num(money(l.amount))}</td></tr>`).join('')}</tbody></table>`
    : `<h2>${esc(L.lines)}</h2><p>${esc(L.noLines)}</p>`;
  return layout(lang, L.scTitle, String(c.certificate_no), mark, meta + amounts + lines + approvalBlock(L, d.steps), exp, d.org);
}

// CC-086 (R1.5 second part): purchase order, goods received note, payment / receipt voucher, journal voucher, daily diary.
const lbl = (L: Labels, k: LabelKey) => esc(L[k]);
const code = (lang: Lang, v: unknown) => esc(statusLabels[lang][String(v)] ?? v ?? '—');
const text = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : esc(v).replace(/\n/g, '<br>'));
const isZero = (v: unknown) => v === null || v === undefined || /^-?0+(\.0+)?$/.test(String(v));
type Col = [LabelKey, (r: Row) => string, boolean?];
const grid = (L: Labels, heading: LabelKey, cols: Col[], rows: Row[], foot?: string) => `<h2>${lbl(L, heading)}</h2>${rows.length
  ? `<table><thead><tr>${cols.map(([k]) => `<th>${lbl(L, k)}</th>`).join('')}</tr></thead><tbody>${rows.map(r =>
    `<tr>${cols.map(([, f, amount]) => `<td${amount ? ' class="amount"' : ''}>${f(r)}</td>`).join('')}</tr>`).join('')}${foot ?? ''}</tbody></table>`
  : `<p>${lbl(L, 'none')}</p>`}`;
const amt = (v: unknown) => num(money(v));
const project = (r: Row) => (r.project_code ? `${num(esc(r.project_code))} — ${esc(r.project_name)}` : '—');

export function renderPurchaseOrder(lang: Lang, d: { po: Row; org: Row; lines: Row[]; steps: Row[]; words?: Words }, mark: Mark, exp: ExportInfo): string {
  const L = lang === 'ar' ? ar : en, p = d.po;
  const meta = metaTable([
    [L.poNo, num(esc(p.po_ref))], [L.date, num(day(p.po_date))], [L.status, code(lang, p.status)], [L.project, project(p)],
    [L.supplier, esc(p.vendor_name)], ...(p.vendor_tax_id ? [[L.supplierTaxId, num(esc(p.vendor_tax_id))] as [string, string]] : []),
    ...(p.cost_code ? [[L.costCode, `${num(esc(p.cost_code))} — ${esc(p.cost_code_description)}`] as [string, string]] : []),
    [L.currency, esc(p.currency)], [L.paymentTerms, text(p.payment_terms)], [L.deliveryTerms, text(p.delivery_terms)]
  ]);
  const lines = grid(L, 'poLines', [['colItem', r => num(esc(r.item_no ?? '—'))], ['colDescription', r => text(r.item_description)], ['colUnit', r => text(r.unit_of_measure)],
    ['colQty', r => amt(r.quantity), true], ['colRate', r => amt(r.unit_rate), true], ['colAmount', r => amt(r.amount), true]], d.lines,
    `<tr class="total"><td colspan="5">${lbl(L, 'total')} (${esc(p.currency)})</td><td class="amount">${amt(p.total_amount)}</td></tr>`) + wordsLine(lang, L, p.total_amount, p.currency, d.words);
  return layout(lang, L.poTitle, String(p.po_ref), mark, meta + lines + approvalBlock(L, d.steps), exp, d.org);
}

export function renderGoodsReceipt(lang: Lang, d: { grn: Row; org: Row; lines: Row[]; steps: Row[] }, mark: Mark, exp: ExportInfo): string {
  const L = lang === 'ar' ? ar : en, g = d.grn;
  const meta = metaTable([
    [L.grnNo, num(esc(g.grn_no))], [L.receivedOn, num(day(g.received_date))], [L.status, code(lang, g.status)], [L.poNo, num(esc(g.po_ref))],
    [L.supplier, esc(g.vendor_name)], [L.project, project(g)], [L.warehouse, g.warehouse_code ? `${num(esc(g.warehouse_code))} — ${esc(g.warehouse_name)}` : '—']
  ]);
  const lines = grid(L, 'grnLines', [['colDescription', r => text(r.item_description)], ['colStockItem', r => (r.item_code ? num(esc(r.item_code)) : '—')], ['colUnit', r => text(r.unit_of_measure)],
    ['colOrdered', r => amt(r.quantity_ordered), true], ['colReceived', r => amt(r.quantity_received), true], ['colAccepted', r => amt(r.quantity_accepted), true],
    ['colRejected', r => amt(r.quantity_rejected), true], ['colReason', r => text(r.rejection_reason)]], d.lines);
  return layout(lang, L.grnTitle, String(g.grn_no), mark, meta + lines + approvalBlock(L, d.steps), exp, d.org);
}

export function renderPaymentVoucher(lang: Lang, d: { pay: Row; org: Row; steps: Row[]; words?: Words }, mark: Mark, exp: ExportInfo): string {
  const L = lang === 'ar' ? ar : en, p = d.pay, out = p.payment_type === 'outgoing';
  const meta = metaTable([
    [L.voucherNo, num(esc(String(p.id)))], [L.date, num(day(p.payment_date))], [L.status, code(lang, p.status)],
    [out ? L.payee : L.payer, esc(p.party_name)], ...(p.project_code ? [[L.project, project(p)] as [string, string]] : []),
    [out ? L.settlesPayable : L.settlesReceivable, num(`#${esc(p.related_id)}`)],
    [L.bankAccount, `${esc(p.bank_name)} — ${num(esc(p.account_no))}`], [L.method, code(lang, p.method)], [L.reference, text(p.reference_no)]
  ]);
  const rows: [string, string, boolean][] = [[L.amount, amt(p.amount), true]];
  if (!isZero(p.withheld_tax_amount)) rows.push([L.withheldTax, amt(p.withheld_tax_amount), false]);
  const amounts = `<h2>${lbl(L, 'amount')} (${esc(p.currency)})</h2><table>${rows.map(([k, v, total]) => `<tr${total ? ' class="total"' : ''}><td>${esc(k)}</td><td class="amount">${v}</td></tr>`).join('')}</table>` + wordsLine(lang, L, p.amount, p.currency, d.words)
    + (p.withholding_certificate_ref ? metaTable([[L.withholdingCertificate, esc(p.withholding_certificate_ref)]]) : '');
  return layout(lang, out ? L.pvTitle : L.rvTitle, String(p.id), mark, meta + amounts + approvalBlock(L, d.steps), exp, d.org);
}

export function renderJournalVoucher(lang: Lang, d: { mj: Row; org: Row; lines: Row[]; totals: Row[]; steps: Row[] }, mark: Mark, exp: ExportInfo): string {
  const L = lang === 'ar' ? ar : en, m = d.mj;
  const meta = metaTable([
    [L.jvNo, num(esc(String(m.id)))], [L.date, num(day(m.entry_date))], [L.status, code(lang, m.status)], [L.reason, code(lang, m.reason_category)],
    [L.description, text(m.description)], ...(m.project_code ? [[L.project, project(m)] as [string, string]] : []),
    ...(m.fx_side ? [[L.fxSide, code(lang, m.fx_side)] as [string, string]] : []),
    ...(m.posted_journal_batch_id ? [[L.postedBatch, num(`#${esc(m.posted_journal_batch_id)}`)] as [string, string]] : [])
  ]);
  const lines = grid(L, 'jvLines', [['colAccount', r => `${num(esc(r.account_code))} — ${esc(r.account_name)}`], ['colDescription', r => text(r.description)],
    ['colCurrency', r => esc(r.currency)], ['colDebit', r => amt(r.debit), true], ['colCredit', r => amt(r.credit), true]], d.lines,
    d.totals.map(t => `<tr class="total"><td colspan="2">${lbl(L, 'total')}</td><td>${esc(t.currency)}</td><td class="amount">${amt(t.debit)}</td><td class="amount">${amt(t.credit)}</td></tr>`).join(''));
  return layout(lang, L.jvTitle, String(m.id), mark, meta + lines + approvalBlock(L, d.steps), exp, d.org);
}

export function renderDailyDiary(lang: Lang, d: { diary: Row; org: Row; manpower: Row[]; equipment: Row[]; amendments: Row[]; steps: Row[] }, mark: Mark, exp: ExportInfo): string {
  const L = lang === 'ar' ? ar : en, s = d.diary;
  const meta = metaTable([
    [L.diaryDate, num(day(s.diary_date))], [L.status, code(lang, s.status)], [L.project, project(s)], [L.weather, text(s.weather)],
    [L.workPerformed, text(s.work_performed)], [L.workFronts, text(s.work_fronts)], [L.delays, text(s.delays_notes)], [L.constraints, text(s.constraints_noted)],
    [L.instructions, text(s.instructions_received)], [L.partiesPresent, text(s.parties_present)], [L.visitors, text(s.visitors)], [L.safety, text(s.safety_notes)],
    [L.impact, s.impact_flag ? `${lbl(L, 'yes')}${s.impact_description ? ` — ${text(s.impact_description)}` : ''}` : lbl(L, 'no')]
  ]);
  const manpower = grid(L, 'manpower', [['colTrade', r => text(r.trade)], ['subcontractor', r => text(r.subcontractor_name)], ['colHeadcount', r => amt(r.headcount), true], ['colHours', r => amt(r.hours), true]], d.manpower);
  const equipment = grid(L, 'equipment', [['colDescription', r => text(r.equipment_description)], ['colHoursUsed', r => amt(r.hours_used), true], ['colIdle', r => amt(r.idle_hours), true]], d.equipment);
  const amendments = d.amendments.length ? grid(L, 'amendments', [['colDate', r => num(day(r.created_at))], ['colAuthor', r => text(r.author)], ['colNote', r => text(r.note)]], d.amendments) : '';
  return layout(lang, L.diaryTitle, String(s.diary_date ?? '').slice(0, 10), mark, meta + manpower + equipment + amendments + approvalBlock(L, d.steps), exp, d.org);
}

// The PDF footer is drawn by Chromium apart from the page and cannot use the embedded font, so it carries only digits
// and symbols (export number, page / pages) - no words that could render without glyphs.
export const pageFooter = (exportId: number) =>
  `<div style="font-family:sans-serif;font-size:8px;width:100%;padding:0 14mm;color:#4a5566;display:flex;justify-content:space-between" dir="ltr"><span>MARC #${exportId}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
