import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../lib/api';

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

export function Approvals() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [message, setMessage] = useState('');

  async function load() {
    const response = await apiGet<ApiList<Approval>>('/approvals');
    setApprovals(response.data);
  }

  useEffect(() => {
    load().catch((error) => setMessage(error.message));
  }, []);

  async function act(id: number, action: 'approved' | 'rejected' | 'returned') {
    // A rejection or return must state its reason (server rule, CC-027).
    const comment = action === 'approved' ? undefined : window.prompt(`Reason for ${action === 'rejected' ? 'rejection' : 'return'} (at least 5 characters)`)?.trim();
    if (action !== 'approved' && !comment) return;
    await apiPost(`/approvals/${id}/actions`, comment ? { action, comment } : { action });
    setMessage(`Approval #${id}: ${action}`);
    await load();
  }

  return (
    <section className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">DOA Workflow</p>
          <h1>Approvals</h1>
          <p>Actions are locked to the logged-in user. The screen cannot send approver_id.</p>
        </div>
      </header>
      {message && <div className="notice">{message}</div>}
      <div className="panel">
        <div className="table-wrap">
          <table>
            <thead><tr><th>ID</th><th>Module</th><th>Record</th><th>Amount</th><th>Step</th><th>Status</th><th>Initiated By</th><th>Action</th></tr></thead>
            <tbody>
              {approvals.map((approval) => (
                <tr key={approval.id}>
                  <td>{approval.id}</td><td>{approval.module}</td><td>{approval.record_id}</td>
                  <td>{approval.amount ? Number(approval.amount).toLocaleString() : '-'}</td><td>{approval.current_step}</td><td>{approval.status}</td><td>{approval.initiated_by_name}</td>
                  <td>{approval.status === 'pending' ? <div className="action-row"><button onClick={() => act(approval.id, 'approved')}>Approve</button><button onClick={() => act(approval.id, 'returned')}>Return</button><button onClick={() => act(approval.id, 'rejected')}>Reject</button></div> : '-'}</td>
                </tr>
              ))}
              {approvals.length === 0 && <tr><td colSpan={8}>No approval instances.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
