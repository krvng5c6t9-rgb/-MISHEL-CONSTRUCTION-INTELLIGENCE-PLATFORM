import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '../lib/api';
import { useI18n, type MessageKey } from '../lib/i18n';

// R1.2: labels from messages/portals.ts; validation and success notices kept as keys so they follow the language.

type ApiResponse<T> = { success: boolean; data: T };
type RefData = {
  users: any[];
  clients: any[];
  projects: any[];
  vendors: any[];
  subcontracts: any[];
};

export function Portals() {
  const { t } = useI18n();
  const [clientAccess, setClientAccess] = useState<any[]>([]);
  const [subAccess, setSubAccess] = useState<any[]>([]);
  const [refs, setRefs] = useState<RefData>({ users: [], clients: [], projects: [], vendors: [], subcontracts: [] });
  const [error, setError] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  const [message, setMessage] = useState<MessageKey | null>(null);
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
      setErrorKey('po.needClientFields');
      return;
    }
    setBusy(true); setError(null); setErrorKey(null); setMessage(null);
    try {
      await apiPost('/portals/client-access', clientForm);
      setMessage('po.clientSaved');
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function grantSubcontractor() {
    if (!subForm.user_id || !subForm.vendor_id) {
      setErrorKey('po.needSubFields');
      return;
    }
    setBusy(true); setError(null); setErrorKey(null); setMessage(null);
    try {
      await apiPost('/portals/subcontractor-access', {
        ...subForm,
        subcontract_id: subForm.subcontract_id || null
      });
      setMessage('po.subSaved');
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function toggleClient(row: any) {
    setBusy(true); setError(null); setErrorKey(null); setMessage(null);
    try {
      await apiPatch(`/portals/client-access/${row.id}/status`, { is_active: !row.is_active });
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function toggleSubcontractor(row: any) {
    setBusy(true); setError(null); setErrorKey(null); setMessage(null);
    try {
      await apiPatch(`/portals/subcontractor-access/${row.id}/status`, { is_active: !row.is_active });
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <section className="page-stack">
      <header className="page-header">
        <div><h1>{t('po.title')}</h1><p>{t('po.intro')}</p></div>
      </header>
      {(error || errorKey) && <div className="notice" role="alert">{errorKey ? t(errorKey) : <bdi>{error}</bdi>}</div>}
      {message && <div className="notice" role="status">{t(message)}</div>}

      <div className="panel" data-section="grant-client">
        <h2>{t('po.grantClient')}</h2>
        <div className="form-row">
          <select aria-label={t('po.clientUser')} value={clientForm.user_id} onChange={e => setClientForm({ ...clientForm, user_id: Number(e.target.value) })}>
            <option value={0}>{t('po.clientUser')}</option>
            {clientUsers.map(x => <option key={x.id} value={x.id}>{x.full_name} — {x.email}</option>)}
          </select>
          <select aria-label={t('po.client')} value={clientForm.client_id} onChange={e => setClientForm({ ...clientForm, client_id: Number(e.target.value), project_id: 0 })}>
            <option value={0}>{t('po.client')}</option>
            {refs.clients.map(x => <option key={x.id} value={x.id}>{x.client_name}</option>)}
          </select>
          <select aria-label={t('po.project')} value={clientForm.project_id} onChange={e => setClientForm({ ...clientForm, project_id: Number(e.target.value) })}>
            <option value={0}>{t('po.project')}</option>
            {clientProjects.map(x => <option key={x.id} value={x.id}>{x.project_code} — {x.project_name}</option>)}
          </select>
          <button disabled={busy} onClick={grantClient}>{t('po.saveAccess')}</button>
        </div>
      </div>

      <div className="panel" data-section="client-access">
        <h2>{t('po.clientAccess')}</h2>
        <div className="table-wrap"><table><thead><tr><th>{t('po.colUser')}</th><th>{t('po.colClient')}</th><th>{t('po.colProject')}</th><th>{t('po.colStatus')}</th><th>{t('po.colAction')}</th></tr></thead><tbody>
          {clientAccess.map(x => <tr key={x.id}><td>{x.full_name}<br/><small>{x.email}</small></td><td>{x.client_name}</td><td>{x.project_name}</td><td>{x.is_active ? t('po.active') : t('po.inactive')}</td><td><button disabled={busy} onClick={() => toggleClient(x)}>{x.is_active ? t('po.deactivate') : t('po.activate')}</button></td></tr>)}
        </tbody></table></div>
      </div>

      <div className="panel" data-section="grant-sub">
        <h2>{t('po.grantSub')}</h2>
        <div className="form-row">
          <select aria-label={t('po.subUser')} value={subForm.user_id} onChange={e => setSubForm({ ...subForm, user_id: Number(e.target.value) })}>
            <option value={0}>{t('po.subUser')}</option>
            {subcontractorUsers.map(x => <option key={x.id} value={x.id}>{x.full_name} — {x.email}</option>)}
          </select>
          <select aria-label={t('po.vendor')} value={subForm.vendor_id} onChange={e => setSubForm({ ...subForm, vendor_id: Number(e.target.value), subcontract_id: 0 })}>
            <option value={0}>{t('po.vendor')}</option>
            {refs.vendors.map(x => <option key={x.id} value={x.id}>{x.vendor_name}</option>)}
          </select>
          <select aria-label={t('po.allPackagesOption')} value={subForm.subcontract_id} onChange={e => setSubForm({ ...subForm, subcontract_id: Number(e.target.value) })}>
            <option value={0}>{t('po.allPackagesOption')}</option>
            {vendorSubcontracts.map(x => <option key={x.id} value={x.id}>SC-{x.id} — {x.package_name}</option>)}
          </select>
          <button disabled={busy} onClick={grantSubcontractor}>{t('po.saveAccess')}</button>
        </div>
      </div>

      <div className="panel" data-section="sub-access">
        <h2>{t('po.subAccess')}</h2>
        <div className="table-wrap"><table><thead><tr><th>{t('po.colUser')}</th><th>{t('po.colVendor')}</th><th>{t('po.colPackage')}</th><th>{t('po.colStatus')}</th><th>{t('po.colAction')}</th></tr></thead><tbody>
          {subAccess.map(x => <tr key={x.id}><td>{x.full_name}<br/><small>{x.email}</small></td><td>{x.vendor_name}</td><td>{x.package_name || t('po.allVendorPackages')}</td><td>{x.is_active ? t('po.active') : t('po.inactive')}</td><td><button disabled={busy} onClick={() => toggleSubcontractor(x)}>{x.is_active ? t('po.deactivate') : t('po.activate')}</button></td></tr>)}
        </tbody></table></div>
      </div>
    </section>
  );
}
