import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { Num } from '../components/RecordTable';

// R1.2: labels from messages/approvals.ts; module and status codes through tv().
// CC-072: a refused action (e.g. separation of duties) is shown on screen; it used to fail silently.
type Approval = {
  id: number;
  module: string;
  record_id: number;
  amount?: string | null;
  current_step: number;
  status: string;
  initiated_by_name: string;
  initiated_at: string;
};

type ApiList<T> = { success: boolean; data: T[] };
type Done = { id: number; action: string } | null;

export function Approvals() {
  const { t, tv } = useI18n();
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [message, setMessage] = useState('');
  const [done, setDone] = useState<Done>(null);

  async function load() {
    const response = await apiGet<ApiList<Approval>>('/approvals');
    setApprovals(response.data);
  }

  useEffect(() => {
    load().catch((error) => setMessage(error.message));
  }, []);

  async function act(id: number, action: 'approved' | 'rejected' | 'returned') {
    try {
      setMessage(''); setDone(null);
      // A rejection or return must state its reason (server rule, CC-027).
      const comment = action === 'approved' ? undefined : window.prompt(t(action === 'rejected' ? 'apr.askRejectReason' : 'apr.askReturnReason'))?.trim();
      if (action !== 'approved' && !comment) return;
      await apiPost(`/approvals/${id}/actions`, comment ? { action, comment } : { action });
      setDone({ id, action });
      await load();
    } catch (error: any) {
      setMessage(error.message);
    }
  }

  return (
    <section className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">{t('apr.eyebrow')}</p>
          <h1>{t('apr.title')}</h1>
          <p>{t('apr.intro')}</p>
        </div>
      </header>
      {message && <div className="notice" role="alert">{message}</div>}
      {done && <div className="notice" role="status">{t('apr.done', { id: done.id, action: tv(done.action) })}</div>}
      <div className="panel" data-section="approvals">
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t('apr.colId')}</th><th>{t('apr.colModule')}</th><th>{t('apr.colRecord')}</th><th>{t('apr.colAmount')}</th><th>{t('apr.colStep')}</th><th>{t('apr.colStatus')}</th><th>{t('apr.colInitiatedBy')}</th><th>{t('apr.colAction')}</th></tr></thead>
            <tbody>
              {approvals.map((approval) => (
                <tr key={approval.id}>
                  <td>{approval.id}</td><td>{tv(approval.module)}</td><td>{approval.record_id}</td>
                  <td>{approval.amount ? <Num text={Number(approval.amount).toLocaleString('en-US')} /> : '-'}</td><td>{approval.current_step}</td><td>{tv(approval.status)}</td><td>{approval.initiated_by_name}</td>
                  <td>{approval.status === 'pending' ? <div className="action-row"><button onClick={() => act(approval.id, 'approved')}>{t('apr.approve')}</button><button onClick={() => act(approval.id, 'returned')}>{t('apr.return')}</button><button onClick={() => act(approval.id, 'rejected')}>{t('apr.reject')}</button></div> : '-'}</td>
                </tr>
              ))}
              {approvals.length === 0 && <tr><td colSpan={8}>{t('apr.none')}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
