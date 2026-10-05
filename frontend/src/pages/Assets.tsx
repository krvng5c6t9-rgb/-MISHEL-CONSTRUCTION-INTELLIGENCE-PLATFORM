import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export function Assets() {
  const [equipment, setEquipment] = useState<any[]>([]);
  const [usage, setUsage] = useState<any[]>([]);
  const [maintenance, setMaintenance] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([api.get('/assets/equipment'), api.get('/assets/equipment-usage'), api.get('/assets/maintenance')]).then(([e, u, m]) => {
      setEquipment(e.data.slice(0, 8));
      setUsage(u.data.slice(0, 8));
      setMaintenance(m.data.slice(0, 8));
    });
  }, []);

  return (
    <section className="page">
      <h1>Assets / Equipment</h1>
      <p className="muted">Equipment register, utilization, maintenance log, and approved usage cost posting.</p>
      <div className="cards-grid">
        <div className="metric-card"><span>Equipment</span><strong>{equipment.length}</strong></div>
        <div className="metric-card"><span>Usage Logs</span><strong>{usage.length}</strong></div>
        <div className="metric-card"><span>Maintenance</span><strong>{maintenance.length}</strong></div>
      </div>
      <div className="panel">
        <h2>Equipment Register</h2>
        <table><thead><tr><th>Code</th><th>Name</th><th>Ownership</th><th>Status</th></tr></thead><tbody>
          {equipment.map((x) => <tr key={x.id}><td>{x.asset_code}</td><td>{x.asset_name}</td><td>{x.ownership_type}</td><td>{x.status}</td></tr>)}
        </tbody></table>
      </div>
      <div className="panel">
        <h2>Recent Usage</h2>
        <table><thead><tr><th>Date</th><th>Asset</th><th>Hours</th><th>Cost</th><th>Status</th></tr></thead><tbody>
          {usage.map((u) => <tr key={u.id}><td>{u.usage_date}</td><td>{u.asset_name}</td><td>{u.hours_used}</td><td>{u.cost_amount}</td><td>{u.status}</td></tr>)}
        </tbody></table>
      </div>
    </section>
  );
}
