import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPost, apiPut } from '../lib/api';
import { useI18n, type MessageKey } from '../lib/i18n';
import { Num } from '../components/RecordTable';

// R1.4 / CC-083 (MP-06 §6): the user's notifications and, for users who may see them, the company's alert settings.
// Alert texts are built in the user's language from the values the database recorded; notifications written before
// CC-083 have only their stored (English) text, shown isolated.
type Notice = { key: MessageKey; vars?: Record<string, string | number> } | null;
const TEXT: Record<string, MessageKey> = { 'AL-01': 'alert.approvalPending', 'AL-02': 'alert.approvalOverdue', 'AL-03': 'alert.timeBar', 'AL-11': 'alert.ncrOpen',
  'AL-12': 'alert.incident', 'AL-14': 'alert.paymentDue', 'AL-15': 'alert.receivableOverdue',
  'AL-06': 'alert.permitExpiry', 'AL-07': 'alert.eacBreach', 'AL-18': 'alert.aiReview', 'AL-20': 'alert.agentSuspended', 'AL-22': 'alert.supersededInUse', 'AL-23': 'alert.dlpEnd' };
const PERMIT: Record<string, MessageKey> = { hot_work: 'hse.optHotWork', confined_space: 'hse.optConfinedSpace', height: 'hse.optHeight', other: 'hse.optOther' };
export const NAME: Record<string, MessageKey> = { 'AL-01': 'alert.nameApprovalPending', 'AL-02': 'alert.nameApprovalOverdue', 'AL-03': 'alert.nameTimeBar', 'AL-11': 'alert.nameNcrOpen',
  'AL-12': 'alert.nameIncident', 'AL-14': 'alert.namePaymentDue', 'AL-15': 'alert.nameReceivableOverdue', 'AL-25': 'alert.nameResponseOverdue',
  'AL-06': 'alert.namePermitExpiry', 'AL-07': 'alert.nameEacBreach', 'AL-18': 'alert.nameAiReview', 'AL-20': 'alert.nameAgentSuspended', 'AL-22': 'alert.nameSupersededInUse', 'AL-23': 'alert.nameDlpEnd' };
const day = (v: unknown) => (v ? String(v).slice(0, 10) : '—');

export function Notifications() {
  const { t, tv } = useI18n();
  const [rows, setRows] = useState<any[]>([]), [unreadOnly, setUnreadOnly] = useState(true), [evalError, setEvalError] = useState('');
  const [rules, setRules] = useState<any[] | null>(null), [roles, setRoles] = useState<any[]>([]), [edit, setEdit] = useState<Record<string, any>>({});
  const [error, setError] = useState(''), [notice, setNotice] = useState<Notice>(null);

  async function load() {
    const r = await apiGet<any>(`/notifications?unread=${unreadOnly}`);
    setRows(r.data ?? []); setEvalError(r.meta?.error ?? '');
    const ar = await apiGet<any>('/notifications/alert-rules').catch(() => null);
    setRules(ar?.data ?? null);
    if (ar?.data) {
      setEdit(Object.fromEntries(ar.data.map((x: any) => [x.alert_code, { enabled: !!x.enabled, threshold: x.threshold ?? '', roles: (x.recipient_role_ids ?? []).map(String) }])));
      setRoles((await apiGet<any>('/roles').catch(() => ({ data: [] }))).data ?? []);
    }
  }
  useEffect(() => { load().catch(e => setError(e.message)); }, [unreadOnly]);
  async function act(fn: () => Promise<any>, done: Notice) { try { setError(''); setNotice(null); await fn(); await load(); setNotice(done); } catch (e: any) { setError(e.message); } }

  const text = (n: any): JSX.Element => {
    const p = n.params ?? {};
    if (n.alert_code === 'AL-25') return <>{t(p.kind === 'submittal' ? 'alert.submittalOverdue' : 'alert.rfiOverdue', { no: p.no ?? '', due: day(p.due) })}</>;
    const key = TEXT[n.alert_code];
    if (!key) return <bdi>{n.message}</bdi>;
    return <>{t(key, { module: tv(p.module), record: p.record ?? '', hours: p.hours ?? '', deadline: day(p.deadline), title: p.title ?? '', no: p.no ?? '', days: p.days ?? '',
      severity: tv(p.severity), date: day(p.date ?? p.dlp_end), due: day(p.due), amount: p.amount ?? '', currency: p.currency ?? '', party: p.party ?? '',
      type: PERMIT[p.type] ? t(PERMIT[p.type]) : tv(p.type), expiry: day(p.expiry), eac: p.eac ?? '', budget: p.budget ?? '', percent: p.percent ?? '', project: p.project ?? '', code: p.code ?? '',
      run: p.run ?? '', agent: p.agent ?? '', transmittal: p.transmittal ?? '', document: p.document ?? '', certificate: p.certificate ?? '' })}</>;
  };
  const save = (code: string) => {
    const e = edit[code], r = rules!.find(x => x.alert_code === code);
    return act(() => apiPut(`/notifications/alert-rules/${code}`, { enabled: e.enabled, threshold: r.threshold_unit ? (e.threshold === '' ? null : Number(e.threshold)) : null, recipient_role_ids: r.needs_roles ? e.roles.map(Number) : [] }),
      { key: 'ntf.saved', vars: { code } });
  };
  const evaluate = async () => {
    try { setError(''); setNotice(null); const r = await apiPost<any>('/notifications/evaluate', {}); await load(); setNotice({ key: 'ntf.evaluated', vars: { count: r.data?.written ?? 0 } }); } catch (e: any) { setError(e.message); }
  };
  const set = (code: string, patch: any) => setEdit({ ...edit, [code]: { ...edit[code], ...patch } });

  return <section className="page-stack">
    <header className="page-header"><div><h1>{t('ntf.title')}</h1><p>{t('ntf.intro')}</p></div></header>
    {error && <div className="notice" role="alert"><bdi>{error}</bdi></div>}
    {notice && <div className="notice" role="status">{t(notice.key, notice.vars)}</div>}
    {evalError && <div className="notice" role="alert">{t('ntf.evalError', { error: '' })}<bdi>{evalError}</bdi></div>}

    <div className="panel" data-section="inbox">
      <div className="form-row">
        <button aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}>{t('ntf.unread')}</button>
        <button aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>{t('ntf.all')}</button>
        <button onClick={() => act(() => apiPost('/notifications/read-all', {}), null)}>{t('ntf.markAllRead')}</button>
      </div>
      {rows.length ? <div className="table-wrap"><table><thead><tr><th>{t('ntf.colWhen')}</th><th>{t('ntf.colAlert')}</th><th>{t('ntf.colMessage')}</th><th>{t('ntf.colRead')}</th><th></th></tr></thead><tbody>
        {rows.map(n => <tr key={n.id} data-alert={n.alert_code ?? ''} className={n.is_read ? '' : 'unread'}>
          <td><Num text={String(n.created_at).slice(0, 16).replace('T', ' ')} /></td>
          <td>{n.alert_code && NAME[n.alert_code] ? t(NAME[n.alert_code]) : '—'}</td>
          <td>{text(n)}</td>
          <td>{n.is_read ? t('ntf.yes') : t('ntf.no')}</td>
          <td>{n.link && n.link.startsWith('/') && !n.link.startsWith('//') && <Link to={n.link} onClick={() => { if (!n.is_read) apiPost(`/notifications/${n.id}/read`, {}).catch(() => null); }}>{t('ntf.open')}</Link>}
            {!n.is_read && <button onClick={() => act(() => apiPost(`/notifications/${n.id}/read`, {}), null)}>{t('ntf.markRead')}</button>}</td>
        </tr>)}
      </tbody></table></div> : <p className="muted">{t('ntf.none')}</p>}
    </div>

    {rules && <div className="panel" data-section="alert-settings"><h2>{t('ntf.settings')}</h2><p className="muted">{t('ntf.settingsNote')}</p>
      <div className="form-row"><button onClick={evaluate}>{t('ntf.evaluate')}</button></div>
      <div className="table-wrap"><table><thead><tr><th>{t('ntf.colCode')}</th><th>{t('ntf.colName')}</th><th>{t('ntf.colEnabled')}</th><th>{t('ntf.colThreshold')}</th><th>{t('ntf.colRoles')}</th><th>{t('ntf.colActive')}</th><th></th></tr></thead><tbody>
        {rules.map(r => { const e = edit[r.alert_code] ?? { enabled: false, threshold: '', roles: [] }; const name = t(NAME[r.alert_code]); return <tr key={r.alert_code} data-alert={r.alert_code}>
          <td><bdi>{r.alert_code}</bdi></td><td id={`al-${r.alert_code}`}>{name}</td>
          <td><input type="checkbox" aria-label={`${name} — ${t('ntf.colEnabled')}`} checked={e.enabled} onChange={x => set(r.alert_code, { enabled: x.target.checked })} /></td>
          <td>{r.threshold_unit ? <><input type="number" min="0" max="3650" aria-label={`${name} — ${t('ntf.colThreshold')}`} value={e.threshold} onChange={x => set(r.alert_code, { threshold: x.target.value })} /> {t(r.threshold_unit === 'hours' ? 'ntf.unitHours' : r.threshold_unit === 'percent' ? 'ntf.unitPercent' : 'ntf.unitDays')}</> : t('ntf.noThreshold')}</td>
          <td>{r.needs_roles ? <select multiple aria-label={`${name} — ${t('ntf.colRoles')}`} value={e.roles} onChange={x => set(r.alert_code, { roles: Array.from(x.target.selectedOptions).map(o => o.value) })}>
            {roles.map(ro => <option key={ro.id} value={String(ro.id)}>{ro.role_name}</option>)}</select> : t('ntf.approvers')}</td>
          <td>{r.active ? t('ntf.yes') : t('ntf.no')}</td>
          <td><button onClick={() => save(r.alert_code)}>{t('ntf.save')}</button></td>
        </tr>; })}
      </tbody></table></div>
    </div>}
  </section>;
}
