import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '../lib/api';

type ApiResponse<T> = { success: boolean; data: T };
type RefData = {
  users: any[];
  clients: any[];
  projects: any[];
  vendors: any[];
  subcontracts: any[];
};

export function Portals() {
  const [clientAccess, setClientAccess] = useState<any[]>([]);
  const [subAccess, setSubAccess] = useState<any[]>([]);
  const [refs, setRefs] = useState<RefData>({ users: [], clients: [], projects: [], vendors: [], subcontracts: [] });
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [clientForm, setClientForm] = useState({ user_id: 0, client_id: 0, project_id: 0, is_active: true });
  const [subForm, setSubForm] = useState({ user_id: 0, vendor_id: 0, subcontract_id: 0, is_active: true });

  const clientUsers = useMemo(() => refs.users.filter(x => x.user_type === 'client_portal'), [refs.users]);
  const subcontractorUsers = useMemo(() => refs.users.filter(x => x.user_type === 'subcontractor_portal'), [refs.users]);
  const clientProjects = useMemo(
    () => refs.projects.filter(x => !clientForm.client_id || x.client_id == null || Number(x.client_id) === clientForm.client_id),
    [refs.projects, clientForm.client_id]
  );
  const vendorSubcontracts = useMemo(
    () => refs.subcontracts.filter(x => !subForm.vendor_id || Number(x.vendor_id) === subForm.vendor_id),
    [refs.subcontracts, subForm.vendor_id]
  );

  async function load() {
    setError(null);
    const [c, s, r] = await Promise.all([
      apiGet<ApiResponse<any[]>>('/portals/client-access'),
      apiGet<ApiResponse<any[]>>('/portals/subcontractor-access'),
      apiGet<ApiResponse<RefData>>('/portals/reference-data')
    ]);
    setClientAccess(c.data);
    setSubAccess(s.data);
    setRefs(r.data);
  }

  useEffect(() => { load().catch(err => setError(err.message)); }, []);

  async function grantClient() {
    if (!clientForm.user_id || !clientForm.client_id || !clientForm.project_id) {
      setError('Client portal user, client and project are required.');
      return;
    }
    setBusy(true); setError(null); setMessage(null);
    try {
      await apiPost('/portals/client-access', clientForm);
      setMessage('Client portal access saved.');
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function grantSubcontractor() {
    if (!subForm.user_id || !subForm.vendor_id) {
      setError('Subcontractor portal user and vendor are required.');
      return;
    }
    setBusy(true); setError(null); setMessage(null);
    try {
      await apiPost('/portals/subcontractor-access', {
        ...subForm,
        subcontract_id: subForm.subcontract_id || null
      });
      setMessage('Subcontractor portal access saved.');
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function toggleClient(row: any) {
    setBusy(true); setError(null); setMessage(null);
    try {
      await apiPatch(`/portals/client-access/${row.id}/status`, { is_active: !row.is_active });
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function toggleSubcontractor(row: any) {
    setBusy(true); setError(null); setMessage(null);
    try {
      await apiPatch(`/portals/subcontractor-access/${row.id}/status`, { is_active: !row.is_active });
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <section className="page-stack">
      <header className="page-header">
        <div><p className="eyebrow">Phase 6</p><h1>Client / Subcontractor Portals</h1><p>Tenant-safe access grants and package-level portal control.</p></div>
        <span className="status-pill">Operational Access Control</span>
      </header>
      {error && <div className="alert">{error}</div>}
      {message && <div className="notice">{message}</div>}

      <div className="panel">
        <h2>Grant Client Portal Access</h2>
        <div className="form-row">
          <select value={clientForm.user_id} onChange={e => setClientForm({ ...clientForm, user_id: Number(e.target.value) })}>
            <option value={0}>Client portal user</option>
            {clientUsers.map(x => <option key={x.id} value={x.id}>{x.full_name} — {x.email}</option>)}
          </select>
          <select value={clientForm.client_id} onChange={e => setClientForm({ ...clientForm, client_id: Number(e.target.value), project_id: 0 })}>
            <option value={0}>Client</option>
            {refs.clients.map(x => <option key={x.id} value={x.id}>{x.client_name}</option>)}
          </select>
          <select value={clientForm.project_id} onChange={e => setClientForm({ ...clientForm, project_id: Number(e.target.value) })}>
            <option value={0}>Project</option>
            {clientProjects.map(x => <option key={x.id} value={x.id}>{x.project_code} — {x.project_name}</option>)}
          </select>
          <button disabled={busy} onClick={grantClient}>Save Access</button>
        </div>
      </div>

      <div className="panel">
        <h2>Client Portal Access</h2>
        <div className="table-wrap"><table><thead><tr><th>User</th><th>Client</th><th>Project</th><th>Status</th><th>Action</th></tr></thead><tbody>
          {clientAccess.map(x => <tr key={x.id}><td>{x.full_name}<br/><small>{x.email}</small></td><td>{x.client_name}</td><td>{x.project_name}</td><td>{x.is_active ? 'Active' : 'Inactive'}</td><td><button disabled={busy} onClick={() => toggleClient(x)}>{x.is_active ? 'Deactivate' : 'Activate'}</button></td></tr>)}
        </tbody></table></div>
      </div>

      <div className="panel">
        <h2>Grant Subcontractor Portal Access</h2>
        <div className="form-row">
          <select value={subForm.user_id} onChange={e => setSubForm({ ...subForm, user_id: Number(e.target.value) })}>
            <option value={0}>Subcontractor portal user</option>
            {subcontractorUsers.map(x => <option key={x.id} value={x.id}>{x.full_name} — {x.email}</option>)}
          </select>
          <select value={subForm.vendor_id} onChange={e => setSubForm({ ...subForm, vendor_id: Number(e.target.value), subcontract_id: 0 })}>
            <option value={0}>Vendor / subcontractor</option>
            {refs.vendors.map(x => <option key={x.id} value={x.id}>{x.vendor_name}</option>)}
          </select>
          <select value={subForm.subcontract_id} onChange={e => setSubForm({ ...subForm, subcontract_id: Number(e.target.value) })}>
            <option value={0}>All packages for vendor</option>
            {vendorSubcontracts.map(x => <option key={x.id} value={x.id}>SC-{x.id} — {x.package_name}</option>)}
          </select>
          <button disabled={busy} onClick={grantSubcontractor}>Save Access</button>
        </div>
      </div>

      <div className="panel">
        <h2>Subcontractor Portal Access</h2>
        <div className="table-wrap"><table><thead><tr><th>User</th><th>Vendor</th><th>Package</th><th>Status</th><th>Action</th></tr></thead><tbody>
          {subAccess.map(x => <tr key={x.id}><td>{x.full_name}<br/><small>{x.email}</small></td><td>{x.vendor_name}</td><td>{x.package_name || 'All vendor packages'}</td><td>{x.is_active ? 'Active' : 'Inactive'}</td><td><button disabled={busy} onClick={() => toggleSubcontractor(x)}>{x.is_active ? 'Deactivate' : 'Activate'}</button></td></tr>)}
        </tbody></table></div>
      </div>
    </section>
  );
}
