import { useI18n } from '../lib/i18n';

// Shared by the control screens: a plain table of API rows with optional per-row actions, and prompt helpers.
// Column headings and prompt labels are passed in already translated by the calling screen.
export type Row = Record<string, any>;
export const ask = (label: string) => window.prompt(label)?.trim() ?? '';
export const fmt = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));
// A number, amount, percentage or date is always laid out left-to-right and kept on one line, so that in Arabic a negative
// amount reads "-45000.00" (not "45000.00-"), "25.00 %" does not wrap, and a date or a period
// "2026-10-01 → 2026-10-31" keeps its order (CC-068).
const NUMERIC = /^[-+]?[\d,]+(\.\d+)?( ?%)?$|^\d{4}-\d{2}-\d{2}( → \d{4}-\d{2}-\d{2})?$/;
export function Num({ v, text }: { v?: unknown; text?: string }) {
  const s = text ?? fmt(v);
  return NUMERIC.test(s) ? <span className="num" dir="ltr">{s}</span> : <>{s}</>;
}

export function Table({ rows, cols, actions }: { rows: Row[]; cols: [string, string][]; actions?: (r: Row) => JSX.Element | null }) {
  const { t } = useI18n();
  if (!rows.length) return <p className="muted">{t('table.empty')}</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{cols.map(([, h]) => <th key={h}>{h}</th>)}{actions && <th />}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={r.id ?? i}>{cols.map(([k]) => <td key={k}><Num v={r[k]} /></td>)}{actions && <td>{actions(r)}</td>}</tr>)}</tbody>
      </table>
    </div>
  );
}
