import { useEffect, useState } from 'react';
import { apiGet } from '../lib/api';

type CostTransaction = {
  id: number;
  project_code: string;
  cost_code: string;
  source_module: string;
  source_table: string;
  transaction_type: string;
  amount: string;
  currency_code: string;
  transaction_date: string;
  description?: string;
};

type ApiList<T> = { success: boolean; data: T[] };

export function CostControl() {
  const [rows, setRows] = useState<CostTransaction[]>([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    apiGet<ApiList<CostTransaction>>('/cost-transactions')
      .then((response) => setRows(response.data))
      .catch((error) => setMessage(error.message));
  }, []);

  const committed = rows.filter((r) => r.transaction_type === 'committed').reduce((sum, r) => sum + Number(r.amount), 0);
  const actual = rows.filter((r) => r.transaction_type === 'actual').reduce((sum, r) => sum + Number(r.amount), 0);

  return (
    <section className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Cost Ledger</p>
          <h1>Cost Control</h1>
          <p>Append-only committed and actual cost transactions from approved procurement records.</p>
        </div>
      </header>
      {message && <div className="notice">{message}</div>}
      <div className="kpi-grid">
        <div className="kpi-card"><span>Committed</span><strong>{committed.toLocaleString()}</strong></div>
        <div className="kpi-card"><span>Actual</span><strong>{actual.toLocaleString()}</strong></div>
        <div className="kpi-card"><span>Variance</span><strong>{(committed - actual).toLocaleString()}</strong></div>
      </div>
      <div className="panel">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Project</th><th>Cost Code</th><th>Source</th><th>Type</th><th>Amount</th><th>Description</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.transaction_date}</td><td>{row.project_code}</td><td>{row.cost_code}</td><td>{row.source_table}</td><td>{row.transaction_type}</td><td>{Number(row.amount).toLocaleString()} {row.currency_code}</td><td>{row.description ?? '-'}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={7}>No cost transactions yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
