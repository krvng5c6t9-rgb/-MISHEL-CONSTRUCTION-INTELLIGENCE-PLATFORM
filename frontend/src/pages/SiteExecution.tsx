import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export function SiteExecution() {
  const [diaries, setDiaries] = useState<any[]>([]);
  const [punch, setPunch] = useState<any[]>([]);
  const [qs, setQs] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([api.get('/site/diaries'), api.get('/site/punch-list'), api.get('/site/quantity-sheets')]).then(([d, p, q]) => {
      setDiaries(d.data.slice(0, 8));
      setPunch(p.data.slice(0, 8));
      setQs(q.data.slice(0, 8));
    });
  }, []);

  return (
    <section className="page">
      <h1>Site Execution</h1>
      <p className="muted">Daily diaries, manpower, equipment, site instructions, verified quantities, and punch list.</p>
      <div className="cards-grid">
        <div className="metric-card"><span>Daily Reports</span><strong>{diaries.length}</strong></div>
        <div className="metric-card"><span>Quantity Sheets</span><strong>{qs.length}</strong></div>
        <div className="metric-card"><span>Open Punch Items</span><strong>{punch.filter((x) => x.status !== 'closed').length}</strong></div>
      </div>
      <div className="panel">
        <h2>Recent Site Diaries</h2>
        <table><thead><tr><th>Date</th><th>Weather</th><th>Work Performed</th><th>Delays</th></tr></thead><tbody>
          {diaries.map((d) => <tr key={d.id}><td>{d.diary_date}</td><td>{d.weather || '-'}</td><td>{d.work_performed || '-'}</td><td>{d.delays_notes || '-'}</td></tr>)}
        </tbody></table>
      </div>
      <div className="panel">
        <h2>Punch List</h2>
        <table><thead><tr><th>Location</th><th>Description</th><th>Status</th><th>Due</th></tr></thead><tbody>
          {punch.map((p) => <tr key={p.id}><td>{p.location || '-'}</td><td>{p.description}</td><td>{p.status}</td><td>{p.due_date || '-'}</td></tr>)}
        </tbody></table>
      </div>
    </section>
  );
}
