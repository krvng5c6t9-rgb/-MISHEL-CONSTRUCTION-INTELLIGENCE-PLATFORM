// Shared by the control screens: a plain table of API rows with optional per-row actions, and prompt helpers.
export type Row = Record<string, any>;
export const ask = (label: string) => window.prompt(label)?.trim() ?? '';
export const fmt = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

export function Table({ rows, cols, actions }: { rows: Row[]; cols: [string, string][]; actions?: (r: Row) => JSX.Element | null }) {
  if (!rows.length) return <p className="muted">Nothing recorded yet.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{cols.map(([, h]) => <th key={h}>{h}</th>)}{actions && <th />}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={r.id ?? i}>{cols.map(([k]) => <td key={k}>{fmt(r[k])}</td>)}{actions && <td>{actions(r)}</td>}</tr>)}</tbody>
      </table>
    </div>
  );
}
