import { useEffect, useState } from 'react';
import { apiGet } from '../lib/api';

type ApiResponse<T> = { success: boolean; data: T };

export function Reports() {
  const [cost, setCost] = useState<any[]>([]);
  const [weekly, setWeekly] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([
      apiGet<ApiResponse<any[]>>('/reports/cost-summary'),
      apiGet<ApiResponse<any[]>>('/reports/weekly-executive')
    ]).then(([a,b]) => { setCost(a.data); setWeekly(b.data); }).catch((err) => setError(err.message));
  }, []);
  return (
    <section>
      <header className="page-header"><div><p className="eyebrow">Phase 6</p><h1>Reports Center</h1></div><span className="status-pill">Views</span></header>
      {error && <div className="alert">API Error: {error}</div>}
      <div className="panel"><h2>Weekly Executive</h2><pre>{JSON.stringify(weekly, null, 2)}</pre></div>
      <div className="panel"><h2>Cost Summary</h2><pre>{JSON.stringify(cost, null, 2)}</pre></div>
    </section>
  );
}
