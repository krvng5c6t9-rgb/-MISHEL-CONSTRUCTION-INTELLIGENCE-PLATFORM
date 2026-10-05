// RK-003 sweep / cross-cutting approval engine: rejection and return paths (CC-027). Before the fix only the approval
// instance changed; the business record stayed in its under-review state and could never be corrected or resubmitted.
// Reuses DOA fixtures of chain.mjs (MR/PO), wave1_boq_handover (contract signing) and sweep_variations (variation).
// All data are TEST FIXTURES.
import { ADMIN, TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const user = (key) => login({ email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id });
try {
  const admin = await login(ADMIN);
  const [pm, proc, s1, s2, qs, appr] = await Promise.all(['pm', 'proc', 'w1s1', 'w1s2', 'vaqs', 'vaappr'].map(user));
  const act = (tok, id, action, comment) => api('POST', `/approvals/${id}/actions`, tok, comment === undefined ? { action } : { action, comment });

  // --- Reason is mandatory for rejection / return.
  const client = must(await api('POST', '/clients', admin, { client_name: `AR Client ${TAG}`, client_type: 'private' }), 'client').id;
  const project = must(await api('POST', '/projects', admin, { project_code: `AR-${TAG}`, project_name: `AR ${TAG}`, currency_id: 1, client_id: client }), 'project').id;
  const contract = must(await api('POST', '/contracts', admin, { project_id: project, client_id: client, contract_type: 'lump_sum', contract_value: 20000, currency_id: 1 }), 'contract').id;
  const ca = must(await api('POST', `/contracts/${contract}/submit-approval`, admin), 'csub').approval;
  await expectStatus('rejection without a reason refused', () => act(s1, ca.id, 'rejected'), 400);

  // --- Contract: returned -> back to draft, resubmittable, then signed on a fresh approval instance.
  const ret = await run('signer returns the contract for correction', async () => must(await act(s1, ca.id, 'returned', 'Payment terms clause missing (fixture)'), 'return'));
  check('returned contract is back in draft with no live approval', ret.finalization?.record?.contract_status === 'draft' && ret.finalization.record.approval_instance_id === null, JSON.stringify(ret.finalization?.record ?? null).slice(0, 160));
  await expectStatus('a returned approval cannot be acted on again', () => act(s1, ca.id, 'approved', 'late'), 409);
  const ca2 = await run('corrected contract resubmitted', async () => must(await api('POST', `/contracts/${contract}/submit-approval`, admin), 'resub').approval);
  check('resubmission opens a new approval instance', ca2.id !== ca.id && ca2.status === 'pending');
  must(await act(s1, ca2.id, 'approved', 'ok'), 'a1');
  const signed = await run('contract signed on the second instance', async () => must(await act(s2, ca2.id, 'approved', 'ok'), 'a2'));
  check('contract status signed', signed.finalization?.record?.contract_status === 'signed');

  // --- Contract: rejected at step 2 -> draft (contracts have no rejected state; rejection kept in the log).
  const c2 = must(await api('POST', '/contracts', admin, { project_id: project, client_id: client, contract_type: 'lump_sum', contract_value: 1000, currency_id: 1 }), 'contract2').id;
  const c2a = must(await api('POST', `/contracts/${c2}/submit-approval`, admin), 'c2sub').approval;
  must(await act(s1, c2a.id, 'approved', 'ok'), 'c2 s1');
  const c2r = await run('second signer rejects', async () => must(await act(s2, c2a.id, 'rejected', 'Commercially unacceptable (fixture)'), 'rej'));
  check('rejected contract released to draft', c2r.finalization?.record?.contract_status === 'draft');

  // --- Variation: rejected is terminal; returned goes back to proposed with editable lines.
  const vContract = contract;
  const v1 = must(await api('POST', '/contracts/variations', qs, { project_id: project, contract_id: vContract, variation_no: `AR-V1-${TAG}`, description: 'rejected path (fixture)', cost_impact: 100 }), 'v1');
  const v1a = must(await api('POST', `/contracts/variations/${v1.id}/submit-approval`, qs), 'v1 submit').approval;
  const v1r = await run('approver rejects variation', async () => must(await act(appr, v1a.id, 'rejected', 'Not instructed by the Engineer (fixture)'), 'v1 rej'));
  check('rejected variation is in terminal rejected state', v1r.finalization?.record?.status === 'rejected');
  await expectStatus('rejected variation cannot be resubmitted', () => api('POST', `/contracts/variations/${v1.id}/submit-approval`, qs), 409);
  const v2 = must(await api('POST', '/contracts/variations', qs, { project_id: project, contract_id: vContract, variation_no: `AR-V2-${TAG}`, description: 'returned path (fixture)', cost_impact: 200 }), 'v2');
  const v2a = must(await api('POST', `/contracts/variations/${v2.id}/submit-approval`, qs), 'v2 submit').approval;
  const v2r = await run('approver returns variation', async () => must(await act(appr, v2a.id, 'returned', 'Attach supporting quantities (fixture)'), 'v2 ret'));
  check('returned variation is proposed again', v2r.finalization?.record?.status === 'proposed');
  await run('lines can be added again after return', async () => must(await api('POST', `/contracts/variations/${v2.id}/lines`, qs, { description: 'Supporting item (fixture)', unit_of_measure: 'm', quantity: 4, unit_rate: 50, action: 'add' }), 'v2 line'));
  const v2b = must(await api('POST', `/contracts/variations/${v2.id}/submit-approval`, qs), 'v2 resubmit').approval;
  const v2ok = await run('resubmitted variation approved', async () => must(await act(appr, v2b.id, 'approved', 'ok'), 'v2 appr'));
  check('variation approved after correction', v2ok.finalization?.record?.status === 'approved');

  // --- Material requisition and purchase order (records that stay draft while under approval).
  const mr = must(await api('POST', '/procurement/material-requisitions', admin, { project_id: project, mr_no: `AR-MR-${TAG}`, lines: [{ item_description: 'AR material', unit_of_measure: 'm2', quantity: 5 }] }), 'mr').id;
  const mra = must(await api('POST', `/procurement/material-requisitions/${mr}/submit-approval`, admin), 'mr submit').approval;
  const mrr = await run('PM returns MR', async () => must(await act(pm, mra.id, 'returned', 'Quantity to be confirmed (fixture)'), 'mr ret'));
  check('returned MR stays draft with approval link cleared', mrr.finalization?.record?.status === 'draft' && mrr.finalization.record.approval_instance_id === null);
  const mra2 = must(await api('POST', `/procurement/material-requisitions/${mr}/submit-approval`, admin), 'mr resubmit').approval;
  await run('MR approved on resubmission', async () => must(await act(pm, mra2.id, 'approved', 'ok'), 'mr appr'));
  await expectStatus('approved MR cannot be submitted again', () => api('POST', `/procurement/material-requisitions/${mr}/submit-approval`, admin), 409);

  const vendors = must(await api('GET', '/vendors', admin), 'vendors');
  const vendor = (Array.isArray(vendors) ? vendors : vendors.vendors ?? []).find(v => v.vendor_name === `E2E Vendor ${TAG}`);
  const po = must(await api('POST', '/procurement/purchase-orders', admin, { project_id: project, vendor_id: vendor.id, mr_id: mr, cost_code_id: 2, po_ref: `AR-PO-${TAG}`, currency_id: 1, lines: [{ item_description: 'AR material', unit_of_measure: 'm2', quantity: 5, unit_rate: 10 }] }), 'po');
  const poa = must(await api('POST', `/procurement/purchase-orders/${po.id}/submit-approval`, admin), 'po submit').approval;
  const por = await run('procurement manager rejects PO', async () => must(await act(proc, poa.id, 'rejected', 'Price above budget (fixture)'), 'po rej'));
  check('rejected PO stays draft, no committed cost', por.finalization?.record?.status === 'draft' && !por.finalization?.cost_transaction);
  const poa2 = must(await api('POST', `/procurement/purchase-orders/${po.id}/submit-approval`, admin), 'po resubmit').approval;
  const poOk = await run('PO approved on resubmission', async () => must(await act(proc, poa2.id, 'approved', 'ok'), 'po appr'));
  check('committed cost posted once on approval', poOk.finalization?.cost_transaction?.transaction_type === 'committed');
  await run('PO issued', async () => must(await api('POST', `/procurement/purchase-orders/${po.id}/issue`, admin), 'issue'));
  await expectStatus('issued PO cannot be resubmitted (would reset it to approved)', () => api('POST', `/procurement/purchase-orders/${po.id}/submit-approval`, admin), 409);

  if (OWNER) {
    const r = sql(OWNER, `select count(*) from approval_actions_log where approval_instance_id in (${ca.id},${c2a.id},${v1a.id},${v2a.id},${mra.id},${poa.id}) and action in ('rejected','returned') and length(comment) >= 5`);
    check('every rejection/return is kept in the action log with its reason', r.ok && /\b6\b/.test(r.out), r.out.trim().slice(0, 80));
  } else check('DB check (OWNER_PSQL_URL required)', false);
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('sweep_approval_rejection');
