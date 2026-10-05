import { useEffect, useState } from 'react';
import { apiGet } from '../lib/api';

type ApiResponse<T> = { success: boolean; data: T };
type ExecutiveData = {
  portfolio: any[];
  approvals: any[];
  financial: any[];
  quality: any[];
  hse: any[];
  schedule: any[];
};

export function ExecutiveDashboard() {
  const [data, setData] = useState<ExecutiveData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<ApiResponse<ExecutiveData>>('/dashboards/executive')
      .then((res) => setData(res.data))
      .catch((err) => setError(err.message));
  }, []);

  const projects = data?.portfolio?.length ?? 0;
  const pendingApprovals = data?.approvals?.find((x) => x.status === 'pending')?.count ?? 0;
  const totalCommitted = data?.financial?.reduce((sum, r) => sum + Number(r.committed ?? 0), 0) ?? 0;
  const totalActual = data?.financial?.reduce((sum, r) => sum + Number(r.actual ?? 0), 0) ?? 0;

  return (
    <section>
      <header className="page-header"><div><p className="eyebrow">Phase 6</p><h1>Executive Dashboard</h1></div><span className="status-pill">Live API</span></header>
      {error && <div className="alert">API Error: {error}</div>}
      <div className="kpi-grid">
        <article className="kpi-card"><small>Projects</small><strong>{projects}</strong></article>
        <article className="kpi-card"><small>Pending Approvals</small><strong>{pendingApprovals}</strong></article>
        <article className="kpi-card"><small>Committed Cost</small><strong>{totalCommitted.toLocaleString()}</strong></article>
        <article className="kpi-card"><small>Actual Cost</small><strong>{totalActual.toLocaleString()}</strong></article>
      </div>
      <div className="panel"><h2>Portfolio Health</h2><pre>{JSON.stringify(data?.portfolio ?? [], null, 2)}</pre></div>
    </section>
  );
}
