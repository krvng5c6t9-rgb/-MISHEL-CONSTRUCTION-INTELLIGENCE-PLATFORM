import { useEffect, useState } from 'react';
import { apiGet } from '../lib/api';

type ApiResponse<T> = { success: boolean; data: T };
type Project = { id: number; project_code: string; project_name: string; status: string; current_contract_value: string | null };

export function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<ApiResponse<Project[]>>('/projects')
      .then((res) => setProjects(res.data))
      .catch((err) => setError(err.message));
  }, []);

  const totalContractValue = projects.reduce((sum, project) => sum + Number(project.current_contract_value ?? 0), 0);

  return (
    <section>
      <header className="page-header">
        <div>
          <p className="eyebrow">Code Phase 1</p>
          <h1>Executive Dashboard</h1>
        </div>
        <span className="status-pill">MVP Starter</span>
      </header>
      {error && <div className="alert">API Error: {error}</div>}
      <div className="kpi-grid">
        <article className="kpi-card"><small>Projects</small><strong>{projects.length}</strong></article>
        <article className="kpi-card"><small>Current Contract Value</small><strong>{totalContractValue.toLocaleString()}</strong></article>
        <article className="kpi-card"><small>Approval Engine</small><strong>Skeleton</strong></article>
        <article className="kpi-card"><small>Cost Ledger</small><strong>Read Only</strong></article>
      </div>
      <div className="panel">
        <h2>Starter Scope</h2>
        <p>هذه النسخة تثبت هيكل المشروع والربط مع PostgreSQL وتفتح أول APIs للـ Projects / BOQ / Cost Control / Approvals.</p>
      </div>
    </section>
  );
}
