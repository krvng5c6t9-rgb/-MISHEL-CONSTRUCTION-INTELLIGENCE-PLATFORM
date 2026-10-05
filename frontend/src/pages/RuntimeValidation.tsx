import { useEffect, useState } from 'react';
import { apiGet } from '../lib/api';

type ApiResponse<T> = { success: boolean; data: T };

export function RuntimeValidation() {
  const [schema, setSchema] = useState<any | null>(null);
  const [posting, setPosting] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([
      apiGet<ApiResponse<any>>('/runtime-validation/schema-health'),
      apiGet<ApiResponse<any[]>>('/runtime-validation/posting-readiness')
    ]).then(([s,p]) => { setSchema(s.data); setPosting(p.data); }).catch((err) => setError(err.message));
  }, []);
  return (
    <section>
      <header className="page-header"><div><p className="eyebrow">Phase 6</p><h1>Runtime Validation</h1></div><span className="status-pill">Checklist</span></header>
      {error && <div className="alert">API Error: {error}</div>}
      <div className="kpi-grid">
        <article className="kpi-card"><small>Schema Status</small><strong>{schema?.status ?? '—'}</strong></article>
        <article className="kpi-card"><small>Missing Tables</small><strong>{schema?.missing_tables?.length ?? '—'}</strong></article>
        <article className="kpi-card"><small>Missing Views</small><strong>{schema?.missing_views?.length ?? '—'}</strong></article>
        <article className="kpi-card"><small>Projects Checked</small><strong>{posting.length}</strong></article>
      </div>
      <div className="panel"><h2>Schema Health</h2><pre>{JSON.stringify(schema, null, 2)}</pre></div>
      <div className="panel"><h2>Posting Readiness</h2><pre>{JSON.stringify(posting, null, 2)}</pre></div>
    </section>
  );
}
