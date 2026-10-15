import { useEffect, useState } from 'react';
import { apiGet } from '../lib/api';
import { dictionaries, useI18n, type MessageKey } from '../lib/i18n';

type ApiResponse<T> = { success: boolean; data: T };
type Project = { id: number; project_code: string; project_name: string; status: string; current_contract_value: string | null; currency_code: string };

// Landing page. R1.2: translated, and limited to figures the data supports: the project count, projects by status, and
// current contract value totalled per currency (values in different currencies are never added together).
// The owner portfolio dashboard is R1.6 (MP-06).
export function Dashboard() {
  const { t } = useI18n();
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<ApiResponse<Project[]>>('/projects')
      .then((res) => setProjects(res.data))
      .catch((err) => setError(err.message));
  }, []);

  const totals = new Map<string, number>();
  const byStatus = new Map<string, number>();
  for (const p of projects) {
    totals.set(p.currency_code, (totals.get(p.currency_code) ?? 0) + Number(p.current_contract_value ?? 0));
    byStatus.set(p.status, (byStatus.get(p.status) ?? 0) + 1);
  }
  const statusLabel = (s: string) => { const key = `projectStatus.${s}` as MessageKey; return key in dictionaries.en ? t(key) : s; };

  return (
    <section>
      <header className="page-header">
        <div>
          <p className="eyebrow">{t('dashboard.eyebrow')}</p>
          <h1>{t('dashboard.title')}</h1>
        </div>
      </header>
      {error && <div className="alert">{t('dashboard.loadError', { error })}</div>}
      <div className="kpi-grid" data-section="kpis">
        <article className="kpi-card"><small>{t('dashboard.projects')}</small><strong>{projects.length}</strong></article>
        {[...totals].map(([currency, total]) => (
          <article className="kpi-card" key={currency}><small>{t('dashboard.contractValue', { currency })}</small><strong>{total.toLocaleString()}</strong></article>
        ))}
      </div>
      <div className="panel" data-section="by-status">
        <h2>{t('dashboard.byStatus')}</h2>
        {projects.length === 0 ? <p className="muted">{t('dashboard.noProjects')}</p> : (
          <div className="table-wrap"><table><tbody>
            {[...byStatus].map(([s, n]) => <tr key={s}><td>{statusLabel(s)}</td><td>{n}</td></tr>)}
          </tbody></table></div>
        )}
        {totals.size > 1 && <p className="muted">{t('dashboard.contractValueNote')}</p>}
      </div>
    </section>
  );
}

