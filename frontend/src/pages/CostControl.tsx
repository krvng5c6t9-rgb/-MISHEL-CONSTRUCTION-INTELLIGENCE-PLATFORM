import { useEffect, useState } from 'react';
import { apiGet } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { Num } from '../components/RecordTable';

// R1.2: labels from messages/costControl.ts; source table and transaction type through tv().
// CC-072: committed / actual / variance are totalled per currency — amounts in different currencies are never added.
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
  const { t, tv } = useI18n();
  const [rows, setRows] = useState<CostTransaction[]>([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    apiGet<ApiList<CostTransaction>>('/cost-transactions')
      .then((response) => setRows(response.data))
      .catch((error) => setMessage(error.message));
  }, []);

  const totals = new Map<string, { committed: number; actual: number }>();
  for (const r of rows) {
    const x = totals.get(r.currency_code) ?? { committed: 0, actual: 0 };
    if (r.transaction_type === 'committed') x.committed += Number(r.amount);
    if (r.transaction_type === 'actual') x.actual += Number(r.amount);
    totals.set(r.currency_code, x);
  }
  const money = (v: number) => v.toLocaleString('en-US');

  return (
    <section className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">{t('cost.eyebrow')}</p>
          <h1>{t('cost.title')}</h1>
          <p>{t('cost.intro')}</p>
        </div>
      </header>
      {message && <div className="notice" role="alert">{message}</div>}
      {[...totals].map(([currency, x]) => (
        <div className="kpi-grid" key={currency} data-section="totals">
          <div className="kpi-card"><span>{t('cost.committed', { currency })}</span><strong><Num text={money(x.committed)} /></strong></div>
          <div className="kpi-card"><span>{t('cost.actual', { currency })}</span><strong><Num text={money(x.actual)} /></strong></div>
          <div className="kpi-card"><span>{t('cost.variance', { currency })}</span><strong><Num text={money(x.committed - x.actual)} /></strong></div>
        </div>
      ))}
      <div className="panel" data-section="transactions">
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t('cost.colDate')}</th><th>{t('cost.colProject')}</th><th>{t('cost.colCostCode')}</th><th>{t('cost.colSource')}</th><th>{t('cost.colType')}</th><th>{t('cost.colAmount')}</th><th>{t('cost.colDescription')}</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td><Num v={row.transaction_date} /></td><td>{row.project_code}</td><td>{row.cost_code}</td><td>{tv(row.source_table)}</td><td>{tv(row.transaction_type)}</td><td><Num text={Number(row.amount).toLocaleString('en-US')} /> {row.currency_code}</td><td>{row.description ?? '-'}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={7}>{t('cost.none')}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
