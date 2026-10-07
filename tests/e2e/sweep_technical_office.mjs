// RK-003 sweep / GC-03..05 Technical Office: drawings register, submittals, RFIs and method statements - first runtime
// execution. Users hold all technical-office permissions so that only integrity and SoD rules can stop them. TEST FIXTURES.
import { ADMIN, ADMIN_B, TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const day = (o) => new Date(Date.now() + o * 86400000).toISOString().slice(0, 10);
try {
  const admin = await login(ADMIN);
  const s1 = await login({ email: `w1s1.${TAG}@test.local`, password: 'Passw0rd!w1s1', org_id: 1 });
  const s2 = await login({ email: `w1s2.${TAG}@test.local`, password: 'Passw0rd!w1s2', org_id: 1 });
  const mkRole = async (name, perms) => must(await api('POST', '/roles', admin, { role_name: `${name} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), `role ${name}`).id;
  const mkUser = async (key, role_id) => {
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    must(await api('POST', '/users', admin, { role_id, full_name: `TO ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return login(u);
  };
  const all = await mkRole('TO All', [['technical_office', 'view'], ['technical_office', 'manage'], ['contracts', 'view'], ['contracts', 'create']]);
  const T = { a: await mkUser('toa', all), b: await mkUser('tob', all) };
  const me = async (tok) => must(await api('GET', '/auth/me', tok), 'me');
  const bId = Number((await me(T.b)).id ?? (await me(T.b)).user?.id);
  const client = must(await api('POST', '/clients', admin, { client_name: `TO Client ${TAG}`, client_type: 'private' }), 'client').id;
  const project = must(await api('POST', '/projects', admin, { project_code: `TO-${TAG}`, project_name: `TO ${TAG}`, currency_id: 1, client_id: client }), 'project').id;
  const contract = must(await api('POST', '/contracts', admin, { project_id: project, client_id: client, contract_type: 'lump_sum', contract_value: 500000, currency_id: 1 }), 'contract').id;
  const ca = must(await api('POST', `/contracts/${contract}/submit-approval`, admin), 'csub').approval;
  must(await api('POST', `/approvals/${ca.id}/actions`, s1, { action: 'approved', comment: 'ok' }), 's1');
  must(await api('POST', `/approvals/${ca.id}/actions`, s2, { action: 'approved', comment: 'ok' }), 's2');

  // --- Drawings register: review decisions, comments, one approved current revision.
  const dA = must(await api('POST', '/technical-office/drawings', T.a, { project_id: project, drawing_no: `S-101-${TAG}`, title: 'Slab L1 (fixture)', discipline: 'structural', revision: 'A' }), 'dA');
  await expectStatus('issuer cannot review own drawing (SoD)', () => api('PATCH', `/technical-office/drawings/${dA.id}/status`, T.a, { status: 'approved' }), 403);
  await expectStatus('rejection of a drawing needs comments', () => api('PATCH', `/technical-office/drawings/${dA.id}/status`, T.b, { status: 'rejected' }), 400);
  const apA = await run('reviewer approves rev A', async () => must(await api('PATCH', `/technical-office/drawings/${dA.id}/status`, T.b, { status: 'approved' }), 'apA'));
  check('reviewer and time recorded', Number(apA.reviewed_by) === bId && !!apA.reviewed_at);
  const dB = must(await api('POST', '/technical-office/drawings', T.a, { project_id: project, drawing_no: `S-101-${TAG}`, title: 'Slab L1 (fixture)', discipline: 'structural', revision: 'B' }), 'dB');
  await run('reviewer approves rev B with comments', async () => must(await api('PATCH', `/technical-office/drawings/${dB.id}/status`, T.b, { status: 'approved_with_comments', comment: 'Add cover note to grid C (fixture)' }), 'apB'));
  const reg = must(await api('GET', `/technical-office/drawings?project_id=${project}`, T.a), 'reg');
  check('approving rev B supersedes approved rev A (one current approved revision)', reg.find(x => x.id === dA.id)?.status === 'superseded' && reg.find(x => x.id === dB.id)?.status === 'approved_with_comments', reg.map(x => `${x.revision}:${x.status}`).join(','));
  await expectStatus('duplicate drawing revision refused', () => api('POST', '/technical-office/drawings', T.a, { project_id: project, drawing_no: `S-101-${TAG}`, title: 'dup', revision: 'B' }), 409);

  // --- Submittals: review cycle history kept across resubmission.
  await expectStatus('submittal due date before submission refused', () => api('POST', '/technical-office/submittals', T.a, { project_id: project, submittal_no: `SB-0-${TAG}`, type: 'material', description: 'Rebar (fixture)', due_date: day(-3) }), 422);
  const sb = must(await api('POST', '/technical-office/submittals', T.a, { project_id: project, submittal_no: `SB-1-${TAG}`, type: 'material', description: 'Waterproofing membrane (fixture)', due_date: day(14) }), 'sb');
  await expectStatus('submitter cannot review own submittal (SoD)', () => api('PATCH', `/technical-office/submittals/${sb.id}/review`, T.a, { status: 'under_review' }), 403);
  await run('reviewer starts review', async () => must(await api('PATCH', `/technical-office/submittals/${sb.id}/review`, T.b, { status: 'under_review' }), 'ur'));
  await expectStatus('resubmit-required without comments refused', () => api('PATCH', `/technical-office/submittals/${sb.id}/review`, T.b, { status: 'resubmit_required' }), 400);
  must(await api('PATCH', `/technical-office/submittals/${sb.id}/review`, T.b, { status: 'resubmit_required', comment: 'Provide manufacturer test certificate (fixture)' }), 'rr');
  await run('submitter resubmits (cycle 2)', async () => must(await api('PATCH', `/technical-office/submittals/${sb.id}/review`, T.a, { status: 'submitted' }), 'resub'));
  must(await api('PATCH', `/technical-office/submittals/${sb.id}/review`, T.b, { status: 'under_review' }), 'ur2');
  must(await api('PATCH', `/technical-office/submittals/${sb.id}/review`, T.b, { status: 'approved_as_noted', comment: 'Approved; follow lap detail (fixture)' }), 'aan');
  const hist = must(await api('GET', `/technical-office/submittals/${sb.id}`, T.a), 'history');
  check('review history keeps both cycles with decisions and comments', hist.reviews?.length === 2 && hist.reviews[0].decision === 'resubmit_required' && /certificate/.test(hist.reviews[0].comment) && hist.reviews[1].decision === 'approved_as_noted' && hist.cycle === 2, JSON.stringify(hist.reviews ?? null).slice(0, 200));

  // --- RFIs: response immutable; impact-flagged RFI closes only with a contract-event link or a stated no-impact reason.
  const r1 = must(await api('POST', '/technical-office/rfis', T.a, { project_id: project, rfi_no: `RFI-1-${TAG}`, subject: 'Slab edge detail (fixture)', question: 'Confirm edge thickening at grid C (fixture)', time_impact_flag: true, response_due: day(7) }), 'r1');
  await expectStatus('raiser cannot answer own RFI (SoD)', () => api('PATCH', `/technical-office/rfis/${r1.id}/respond`, T.a, { response: 'self answer' }), 403);
  await run('designer answers RFI', async () => must(await api('PATCH', `/technical-office/rfis/${r1.id}/respond`, T.b, { response: 'Thicken to 300 mm per SK-12 (fixture)' }), 'ans'));
  await expectStatus('impact-flagged RFI cannot close without a contract-event link or no-impact reason', () => api('POST', `/technical-office/rfis/${r1.id}/close`, T.a, {}), 422);
  const ev = must(await api('POST', `/contract-admin/contracts/${contract}/events`, T.a, { title: 'RFI-1 design clarification (fixture)', description: 'Edge thickening instructed via RFI answer (fixture)', occurred_on: day(0), became_aware_on: day(0), source_type: 'rfi', source_reference: `RFI-1-${TAG}` }), 'event').event;
  must(await api('POST', `/contract-admin/events/${ev.id}/links`, T.a, { link_type: 'rfi', linked_id: r1.id }), 'link');
  const cl = await run('raiser closes RFI after linking it to the contract event', async () => must(await api('POST', `/technical-office/rfis/${r1.id}/close`, T.a, {}), 'close'));
  check('closer recorded', Number(cl.closed_by) > 0 && !!cl.closed_at);
  const r2 = must(await api('POST', '/technical-office/rfis', T.a, { project_id: project, rfi_no: `RFI-2-${TAG}`, subject: 'Paint colour (fixture)', question: 'Confirm RAL code (fixture)', cost_impact_flag: true, response_due: day(-2) }), 'r2');
  const list = must(await api('GET', `/technical-office/rfis?project_id=${project}`, T.a), 'rfis');
  check('unanswered RFI past its response date is flagged overdue', list.find(x => x.id === r2.id)?.overdue === true && list.find(x => x.id === r1.id)?.overdue === false);
  must(await api('PATCH', `/technical-office/rfis/${r2.id}/respond`, T.b, { response: 'RAL 9010 (fixture)' }), 'ans2');
  await run('impact-flagged RFI closed with a stated no-impact reason', async () => must(await api('POST', `/technical-office/rfis/${r2.id}/close`, T.a, { no_impact_reason: 'Colour already in specification; no cost (fixture)' }), 'close2'));

  // --- Method statements.
  const ms = must(await api('POST', '/technical-office/method-statements', T.a, { project_id: project, activity_name: 'Slab pour L1 (fixture)' }), 'ms');
  must(await api('POST', `/technical-office/method-statements/${ms.id}/submit`, T.a), 'ms submit');
  await expectStatus('method statement rejection needs comments', () => api('POST', `/technical-office/method-statements/${ms.id}/review`, T.b, { action: 'rejected' }), 400);
  await run('method statement approved by reviewer', async () => must(await api('POST', `/technical-office/method-statements/${ms.id}/review`, T.b, { action: 'approved' }), 'ms appr'));
  await expectStatus('approved method statement cannot be resubmitted', () => api('POST', `/technical-office/method-statements/${ms.id}/submit`, T.a), 409);

  if (OWNER) {
    const probe = (name, text) => { const r = sql(OWNER, text); check(name, !r.ok, r.out.split('\n').find(l => /ERROR/.test(l)) ?? r.out.slice(0, 120)); };
    probe('DB: RFI answer immutable once given', `update rfis set response='rewritten' where id=${r1.id}`);
    probe('DB: submittal review history append-only', `delete from submittal_reviews where submittal_id=${sb.id}`);
    probe('DB: reviewed drawing content immutable', `update drawings set title='changed', document_id=null where id=${dB.id}`);
    probe('DB: approved method statement immutable', `update method_statements set activity_name='changed' where id=${ms.id}`);
  } else check('DB probes (OWNER_PSQL_URL required)', false);

  const tb = await login(ADMIN_B);
  await expectStatus('tenant B cannot answer tenant A RFI', () => api('PATCH', `/technical-office/rfis/${r2.id}/respond`, tb, { response: 'x' }), 404);
  await expectStatus('tenant B cannot read tenant A submittal', () => api('GET', `/technical-office/submittals/${sb.id}`, tb), 404);
  const lb = must(await api('GET', '/technical-office/rfis', tb), 'rfis B');
  check('tenant B does not see tenant A RFIs', !lb.some(x => Number(x.id) === Number(r1.id)));
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('sweep_technical_office');
