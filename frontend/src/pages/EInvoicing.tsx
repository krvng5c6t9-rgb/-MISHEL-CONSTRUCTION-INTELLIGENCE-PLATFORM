import { useEffect, useState } from 'react';
import { apiGet, apiPost, apiPut } from '../lib/api';
import { useI18n, type MessageKey } from '../lib/i18n';
import { Num, type Row } from '../components/RecordTable';

// CC-096 (Stage 67; migration 101): electronic invoicing. The company enters its own registration, authority credentials
// and signing service (finance.manage), maps its output tax codes and clients, prepares a document from an IPC certified
// by the client (finance.create) and a different person signs and submits it (finance.approve). The server builds the
// document from the IPC's stored tax figures; this screen shows them as returned. First scheme: Egypt (ETA).
const SCHEME = 'eg_eta';
const STATUS: Record<string, MessageKey> = { prepared: 'ei.stPrepared', submitted: 'ei.stSubmitted', valid: 'ei.stValid', invalid: 'ei.stInvalid', rejected: 'ei.stRejected', failed: 'ei.stFailed', cancelled: 'ei.stCancelled' };
// Server codes of missing data -> label.
function missingKey(m: string): MessageKey {
  if (m === 'profile') return 'ei.mProfile';
  if (m === 'issuer.rin') return 'ei.mIssuerRin';
  if (m === 'issuer.name') return 'ei.mIssuerName';
  if (m === 'issuer.activity_code') return 'ei.mIssuerActivity';
  if (m === 'issuer.branch_id') return 'ei.mIssuerBranch';
  if (m.startsWith('issuer.address')) return 'ei.mIssuerAddress';
  if (m.startsWith('defaults.')) return 'ei.mItem';
  if (m === 'credentials') return 'ei.mCredentials';
  if (m === 'signer_url') return 'ei.mSigner';
  if (m.startsWith('ipc.output_tax')) return 'ei.mTaxProfile';
  if (m.startsWith('tax_code.')) return 'ei.mTaxMap';
  if (m.startsWith('currency')) return 'ei.mCurrency';
  if (m === 'client.einvoice_party_type') return 'ei.mParty';
  if (m === 'client.tax_id') return 'ei.mClientTaxId';
  return 'ei.mClientAddress';
}
const emptyProfile = { environment: 'test', client_id: '', client_secret: '', signer_url: '', enabled: false,
  issuer: { rin: '', name: '', activity_code: '', branch_id: '0', address: { country: 'EG', governate: '', region_city: '', street: '', building_number: '' } },
  defaults: { item_type: 'EGS', item_code: '', unit_type: 'EA', description: '' } };

export function EInvoicing() {
  const { t } = useI18n();
  const [p, setP] = useState<any>(emptyProfile), [last4, setLast4] = useState<string | null>(null);
  const [lk, setLk] = useState<any>({ tax_codes: [], clients: [] }), [ipcs, setIpcs] = useState<Row[]>([]), [docs, setDocs] = useState<Row[]>([]);
  const [edits, setEdits] = useState<Record<string, any>>({}), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  async function load() {
    const [a, b, c, d] = await Promise.all([apiGet<any>(`/einvoice/profiles/${SCHEME}`), apiGet<any>('/einvoice/lookups'), apiGet<any>(`/einvoice/${SCHEME}/ipcs`), apiGet<any>(`/einvoice/${SCHEME}/documents`)]);
    if (a.data) {
      setP({ ...emptyProfile, environment: a.data.environment, client_id: a.data.client_id ?? '', client_secret: '', signer_url: a.data.signer_url ?? '', enabled: a.data.enabled,
        issuer: { ...emptyProfile.issuer, ...a.data.issuer, address: { ...emptyProfile.issuer.address, ...(a.data.issuer?.address ?? {}) } }, defaults: { ...emptyProfile.defaults, ...a.data.defaults } });
      setLast4(a.data.secret_last4);
    }
    setLk(b.data); setIpcs(c.data); setDocs(d.data);
  }
  useEffect(() => { load().catch(e => setError(e.message)); }, []);
  async function act(fn: () => Promise<any>) { try { setError(''); setSaved(false); await fn(); await load(); } catch (e: any) { setError(e.message); } }
  const setIs = (k: string, v: string) => setP({ ...p, issuer: { ...p.issuer, [k]: v } });
  const setAd = (k: string, v: string) => setP({ ...p, issuer: { ...p.issuer, address: { ...p.issuer.address, [k]: v } } });
  const setDf = (k: string, v: string) => setP({ ...p, defaults: { ...p.defaults, [k]: v } });
  const save = () => act(async () => {
    await apiPut(`/einvoice/profiles/${SCHEME}`, { environment: p.environment, ...(p.client_id ? { client_id: p.client_id } : {}), ...(p.client_secret ? { client_secret: p.client_secret } : {}),
      signer_url: p.signer_url || null, issuer: p.issuer, defaults: p.defaults, enabled: p.enabled });
    setSaved(true);
  });
  const ed = (k: string, base: any) => edits[k] ?? base;
  const setEd = (k: string, v: any) => setEdits({ ...edits, [k]: v });
  const mapTax = (c: Row) => act(async () => {
    const v = ed(`t${c.id}`, { tax: c.einvoice_tax_type ?? '', sub: c.einvoice_sub_type ?? '' });
    await apiPut(`/einvoice/tax-codes/${c.id}`, { einvoice_tax_type: v.tax.trim().toUpperCase() || null, einvoice_sub_type: v.sub.trim().toUpperCase() || null });
  });
  const clientBase = (c: Row) => ({ party: c.einvoice_party_type ?? '', ...{ country: 'EG', governate: '', region_city: '', street: '', building_number: '' }, ...(c.einvoice_address ?? {}) });
  const saveClient = (c: Row) => act(async () => {
    const v = ed(`c${c.id}`, clientBase(c));
    await apiPut(`/einvoice/clients/${c.id}`, { party_type: v.party, address: v.party === 'person' && !v.street ? null
      : { country: v.country, governate: v.governate, region_city: v.region_city, street: v.street, building_number: v.building_number } });
  });
  const field = (k: string, c: Row, name: string, ltr = false) => { const v = ed(`c${c.id}`, clientBase(c));
    return <input value={v[name] ?? ''} dir={ltr ? 'ltr' : undefined} aria-label={t(({ country: 'ei.country', governate: 'ei.governate', region_city: 'ei.regionCity', street: 'ei.street', building_number: 'ei.building' } as Record<string, MessageKey>)[name])}
      onChange={e => setEd(k, { ...v, [name]: e.target.value })} />; };

  return <section className="page-stack">
    <header className="page-header"><div><p className="eyebrow">{t('ei.eyebrow')}</p><h1>{t('ei.title')}</h1><p>{t('ei.intro')}</p></div></header>
    {error && <div className="notice" role="alert"><bdi>{error}</bdi></div>}

    <div className="panel" data-section="profile"><h2>{t('ei.profile')} — {t('ei.schemeEgEta')}</h2><p className="muted">{t('ei.profileNote')}</p>
      <div className="form-grid">
        <label>{t('ei.environment')}<select value={p.environment} onChange={e => setP({ ...p, environment: e.target.value })}><option value="test">{t('ei.envTest')}</option><option value="production">{t('ei.envProduction')}</option></select></label>
        <label>{t('ei.clientId')}<input value={p.client_id} dir="ltr" autoComplete="off" onChange={e => setP({ ...p, client_id: e.target.value })} /></label>
        <label>{t('ei.clientSecret')}<input type="password" value={p.client_secret} dir="ltr" autoComplete="new-password" onChange={e => setP({ ...p, client_secret: e.target.value })} />
          {last4 && <span className="muted">{t('ei.secretKept')} <bdi>{last4}</bdi></span>}</label>
        <label>{t('ei.signerUrl')}<input value={p.signer_url} dir="ltr" inputMode="url" onChange={e => setP({ ...p, signer_url: e.target.value })} /></label>
      </div>
      <h3>{t('ei.issuer')}</h3>
      <div className="form-grid">
        <label>{t('ei.rin')}<input value={p.issuer.rin} dir="ltr" onChange={e => setIs('rin', e.target.value)} /></label>
        <label>{t('ei.issuerName')}<input value={p.issuer.name} onChange={e => setIs('name', e.target.value)} /></label>
        <label>{t('ei.activityCode')}<input value={p.issuer.activity_code} dir="ltr" onChange={e => setIs('activity_code', e.target.value)} /></label>
        <label>{t('ei.branchId')}<input value={p.issuer.branch_id} dir="ltr" onChange={e => setIs('branch_id', e.target.value)} /></label>
        <label>{t('ei.country')}<input value={p.issuer.address.country} dir="ltr" maxLength={2} onChange={e => setAd('country', e.target.value.toUpperCase())} /></label>
        <label>{t('ei.governate')}<input value={p.issuer.address.governate} onChange={e => setAd('governate', e.target.value)} /></label>
        <label>{t('ei.regionCity')}<input value={p.issuer.address.region_city} onChange={e => setAd('region_city', e.target.value)} /></label>
        <label>{t('ei.street')}<input value={p.issuer.address.street} onChange={e => setAd('street', e.target.value)} /></label>
        <label>{t('ei.building')}<input value={p.issuer.address.building_number} dir="ltr" onChange={e => setAd('building_number', e.target.value)} /></label>
      </div>
      <h3>{t('ei.defaults')}</h3>
      <div className="form-grid">
        <label>{t('ei.itemType')}<select value={p.defaults.item_type} onChange={e => setDf('item_type', e.target.value)}><option value="EGS">{t('ei.itemEgs')}</option><option value="GS1">{t('ei.itemGs')}</option></select></label>
        <label>{t('ei.itemCode')}<input value={p.defaults.item_code} dir="ltr" onChange={e => setDf('item_code', e.target.value)} /></label>
        <label>{t('ei.unitType')}<input value={p.defaults.unit_type} dir="ltr" onChange={e => setDf('unit_type', e.target.value)} /></label>
        <label>{t('ei.description')}<input value={p.defaults.description} onChange={e => setDf('description', e.target.value)} /></label>
        <label className="inline"><input type="checkbox" checked={p.enabled} onChange={e => setP({ ...p, enabled: e.target.checked })} /> {t('ei.enabled')}</label>
      </div>
      <button onClick={save}>{t('ei.save')}</button>{saved && <span className="muted" role="status"> {t('ei.saved')}</span>}</div>

    <div className="panel" data-section="tax-codes"><h2>{t('ei.taxMapping')}</h2><p className="muted">{t('ei.taxMappingNote')}</p>
      {lk.tax_codes.length ? <div className="table-wrap"><table><thead><tr><th>{t('ei.colCode')}</th><th>{t('ei.colName')}</th><th>{t('ei.colRate')}</th><th>{t('ei.taxType')}</th><th>{t('ei.subType')}</th><th>{t('ei.colActions')}</th></tr></thead>
        <tbody>{lk.tax_codes.map((c: Row) => { const v = ed(`t${c.id}`, { tax: c.einvoice_tax_type ?? '', sub: c.einvoice_sub_type ?? '' });
          return <tr key={c.id}><td><bdi>{c.code}</bdi></td><td>{c.name}</td><td><Num v={c.rate} /></td>
            <td><input value={v.tax} dir="ltr" size={6} aria-label={t('ei.taxType')} onChange={e => setEd(`t${c.id}`, { ...v, tax: e.target.value })} /></td>
            <td><input value={v.sub} dir="ltr" size={6} aria-label={t('ei.subType')} onChange={e => setEd(`t${c.id}`, { ...v, sub: e.target.value })} /></td>
            <td><button onClick={() => mapTax(c)}>{t('ei.map')}</button></td></tr>; })}</tbody></table></div> : <p>{t('ei.noneYet')}</p>}</div>

    <div className="panel" data-section="clients"><h2>{t('ei.clients')}</h2><p className="muted">{t('ei.clientsNote')}</p>
      {lk.clients.length ? <div className="table-wrap"><table><thead><tr><th>{t('ei.colClient')}</th><th>{t('ei.colTaxId')}</th><th>{t('ei.partyType')}</th><th>{t('ei.country')}</th><th>{t('ei.governate')}</th><th>{t('ei.regionCity')}</th><th>{t('ei.street')}</th><th>{t('ei.building')}</th><th>{t('ei.colActions')}</th></tr></thead>
        <tbody>{lk.clients.map((c: Row) => { const k = `c${c.id}`, v = ed(k, clientBase(c));
          return <tr key={c.id}><td>{c.client_name}</td><td><bdi>{c.tax_id ?? '—'}</bdi></td>
            <td><select value={v.party} aria-label={t('ei.partyType')} onChange={e => setEd(k, { ...v, party: e.target.value })}><option value="">{t('ei.choose')}</option><option value="business">{t('ei.partyBusiness')}</option><option value="person">{t('ei.partyPerson')}</option><option value="foreign">{t('ei.partyForeign')}</option></select></td>
            <td>{field(k, c, 'country', true)}</td><td>{field(k, c, 'governate')}</td><td>{field(k, c, 'region_city')}</td><td>{field(k, c, 'street')}</td><td>{field(k, c, 'building_number', true)}</td>
            <td><button disabled={!v.party} onClick={() => saveClient(c)}>{t('ei.map')}</button></td></tr>; })}</tbody></table></div> : <p>{t('ei.noneYet')}</p>}</div>

    <div className="panel" data-section="ipcs"><h2>{t('ei.ipcs')}</h2>
      {ipcs.length ? <div className="table-wrap"><table><thead><tr><th>{t('ei.colIpc')}</th><th>{t('ei.colProject')}</th><th>{t('ei.colClient')}</th><th>{t('ei.colBase')}</th><th>{t('ei.colTax')}</th><th>{t('ei.colTotal')}</th><th>{t('ei.colMissing')}</th><th>{t('ei.colDocument')}</th><th>{t('ei.colActions')}</th></tr></thead>
        <tbody>{ipcs.map(r => { const active = r.document && !['invalid', 'rejected', 'failed', 'cancelled'].includes(r.document.status);
          return <tr key={r.ipc_id} data-ipc={r.ipc_id}><td><bdi>{r.ipc_no}</bdi></td><td><bdi>{r.project_code}</bdi></td><td>{r.client_name}</td>
            <td><Num v={r.base} /> <bdi>{r.currency}</bdi></td><td><Num v={r.tax} /></td><td><Num v={r.total} /></td>
            <td>{r.missing.length ? [...new Set<MessageKey>(r.missing.map(missingKey))].map(k => t(k)).join('، ') : t('ei.ready')}</td>
            <td>{r.document ? t(STATUS[r.document.status]) : '—'}</td>
            <td>{!r.missing.length && !active && <button onClick={() => act(() => apiPost(`/einvoice/${SCHEME}/documents`, { ipc_id: r.ipc_id }))}>{t('ei.prepare')}</button>}</td></tr>; })}</tbody></table></div> : <p>{t('ei.noneYet')}</p>}</div>

    <div className="panel" data-section="documents"><h2>{t('ei.documents')}</h2><p className="muted">{t('ei.sod')}</p>
      {docs.length ? <div className="table-wrap"><table><thead><tr><th>{t('ei.colInternal')}</th><th>{t('ei.colStatus')}</th><th>{t('ei.colPrepared')}</th><th>{t('ei.colSubmitted')}</th><th>{t('ei.colUuid')}</th><th>{t('ei.colFingerprint')}</th><th>{t('ei.colError')}</th><th>{t('ei.colActions')}</th></tr></thead>
        <tbody>{docs.map(d => <tr key={d.id} data-document={d.id} data-status={d.status}><td><bdi>{d.internal_id}</bdi></td><td>{t(STATUS[d.status])}</td><td>{d.prepared_by_name}</td><td>{d.submitted_by_name ?? '—'}</td>
          <td><bdi>{d.provider_uuid ?? '—'}</bdi></td><td><bdi title={d.canonical_sha256}>{String(d.canonical_sha256).slice(0, 12)}…</bdi></td><td><bdi>{d.last_error ?? ''}</bdi></td>
          <td>{d.status === 'prepared' && <button onClick={() => act(() => apiPost(`/einvoice/${SCHEME}/documents/${d.id}/submit`, {}))}>{t('ei.submit')}</button>}
            {d.status === 'submitted' && <button onClick={() => act(() => apiPost(`/einvoice/${SCHEME}/documents/${d.id}/refresh`, {}))}>{t('ei.refresh')}</button>}</td></tr>)}</tbody></table></div> : <p>{t('ei.noneYet')}</p>}</div>
  </section>;
}
