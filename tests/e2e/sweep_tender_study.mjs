// CC-095 / Stage 66 (MP-04 AG-04, migration 100): AI layer v1 and the tender study agent, against the local mock of the
// Anthropic API started by run_from_zero.sh (AI_PROVIDER_BASE_URL; no real key or paid request). Company settings
// (key stored encrypted, never returned; data-processing acceptance required; ai_platform.manage), a study requested on
// a tender's documents, what the server sends to the provider (model, rules against invented prices, structured output,
// fallback), the server's check of every quote against the documents, refusal and provider-key failure, review by a
// person other than the requester, permanence, AI run register, isolation and audit.
import { ADMIN, ADMIN_B, TAG, api, must, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const MOCK = process.env.MOCK_ANTHROPIC_URL;
const one = (text) => { const r = sql(OWNER, text); if (!r.ok) throw new Error(r.out.slice(0, 300)); return r.out; };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const DOCS = [
  'مناقصة إنشاء مبنى إداري - جدول الكميات',
  'البند 1: خرسانة مسلحة للأساسات بمقاومة 300 كجم/سم2 بالمتر المكعب',
  'البند 2: أعمال حفر في أرض عادية حتى منسوب التأسيس بالمتر المكعب',
  'يخصم 10% من قيمة كل مستخلص كتأمين نهائي يرد بعد الاستلام الابتدائي',
  'غرامة التأخير 0.1% عن كل يوم تأخير بحد أقصى 10% من قيمة العقد',
  'تصرف دفعة مقدمة 15% مقابل خطاب ضمان بنكي بنفس القيمة'
].join('\n');
try {
  const admin = await login(ADMIN);
  const mk = async (key, perms) => {
    const roleId = must(await api('POST', '/roles', admin, { role_name: `AI ${key} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), 'role').id;
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    must(await api('POST', '/users', admin, { role_id: roleId, full_name: `AI ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return login(u);
  };
  const aiAdmin = await mk('aiadm', [['ai_platform', 'view'], ['ai_platform', 'manage']]);
  const est = await mk('aiest', [['tendering', 'view'], ['tendering', 'create']]);
  const mgr = await mk('aimgr', [['tendering', 'view'], ['tendering', 'approve']]);
  const tenderId = Number(one(`select id from tenders where org_id = ${ADMIN.org_id} order by id limit 1`));
  const KEY = `sk-test-${TAG}-abcdefghijklmnop-1234`;

  // --- Settings.
  const s0 = await api('GET', '/ai/settings', aiAdmin);
  check('no settings yet; the models offered are the current Claude models', s0.body.data === null && s0.body.models.includes('claude-opus-5-5'), JSON.stringify(s0.body).slice(0, 200));
  await expectStatus('a study before AI is enabled is refused', () => api('POST', '/ai/tender-studies', est, { tender_id: tenderId, documents: DOCS }), 422);
  await expectStatus('AI settings need ai_platform.manage', () => api('PUT', '/ai/settings', est, { provider: 'anthropic', model: 'claude-opus-5-5', api_key: KEY, data_processing_accepted: true, enabled: true }), 403);
  await expectStatus('the first settings need the company key', () => api('PUT', '/ai/settings', aiAdmin, { provider: 'anthropic', model: 'claude-opus-5-5', data_processing_accepted: true, enabled: true }), 422);
  await expectStatus('AI cannot be enabled without accepting that documents are sent to the provider', () => api('PUT', '/ai/settings', aiAdmin, { provider: 'anthropic', model: 'claude-opus-5-5', api_key: KEY, data_processing_accepted: false, enabled: true }), 422);
  await expectStatus('a model outside the offered list is refused', () => api('PUT', '/ai/settings', aiAdmin, { provider: 'anthropic', model: 'gpt-x', api_key: KEY, data_processing_accepted: true, enabled: true }), 400);
  const set = must(await api('PUT', '/ai/settings', aiAdmin, { provider: 'anthropic', model: 'claude-opus-5-5', api_key: KEY, data_processing_accepted: true, enabled: true }), 'set');
  check('settings saved: only the last four characters of the key are returned', set.api_key_last4 === '1234' && !JSON.stringify(set).includes(KEY) && set.enabled === true);
  const enc = one(`select api_key_enc from ai_provider_settings where org_id = ${ADMIN.org_id}`);
  check('DB: the key is stored encrypted (AES-256-GCM), not in clear', enc.startsWith('v1:') && !enc.includes(KEY));
  check('the settings read never returns the key', !JSON.stringify((await api('GET', '/ai/settings', aiAdmin)).body).includes('api_key_enc'));

  // --- A study.
  await expectStatus('requesting a study needs tendering.create', () => api('POST', '/ai/tender-studies', mgr, { tender_id: tenderId, documents: DOCS }), 403);
  await expectStatus('a tender of another company is refused', async () => api('POST', '/ai/tender-studies', est, { tender_id: Number(one(`select coalesce((select id from tenders where org_id <> ${ADMIN.org_id} order by id limit 1), 999999)`)), documents: DOCS }), 422);
  const q = must(await api('POST', '/ai/tender-studies', est, { tender_id: tenderId, documents: DOCS, instructions: 'ركز على شروط الدفع' }), 'request');
  const done = async (id) => { for (let i = 0; i < 40; i++) { const s = must(await api('GET', `/ai/tender-studies/${id}`, est), 'poll'); if (!['queued', 'running'].includes(s.status)) return s; await wait(250); } return null; };
  const s1 = await done(q.id);
  check('the study is queued, then completed in the background by the company\'s model', q.status === 'queued' && s1?.status === 'completed' && s1.model === 'claude-opus-5-5', JSON.stringify(s1).slice(0, 200));
  check('structured result: summary, BOQ items, missing information, questions, risks, conditions, pricing notes, recommendation',
    s1 && s1.result.summary && s1.result.boq_items.length && s1.result.risks.length && s1.result.clarification_questions.length && ['go', 'no_go', 'needs_more_information'].includes(s1.result.recommendation.decision));
  check('every quote was checked against the submitted documents (all verified)', s1.quotes_checked === 6 && s1.quotes_verified === 6 && s1.result.risks.every(r => r.quote_verified === true));
  check('the documents are kept with their SHA-256', one(`select input_sha256 = encode(sha256(convert_to(input_text, 'UTF8')), 'hex') from tender_studies where id = ${q.id}`) === 't');
  const rec = await (await fetch(`${MOCK}/__requests`)).json();
  const sent = rec[rec.length - 1];
  check('sent to the provider: the company model and key, the documents, structured output, fallback, high effort',
    sent.body.model === 'claude-opus-5-5' && sent.headers['x-api-key-last4'] === '1234' && JSON.stringify(sent.body.messages).includes('غرامة التأخير')
      && sent.body.output_config?.format?.type === 'json_schema' && sent.body.output_config?.effort === 'high' && sent.body.fallbacks === 'default' && /server-side-fallback/.test(sent.headers['anthropic-beta'] ?? ''),
    JSON.stringify({ model: sent.body.model, fb: sent.body.fallbacks, beta: sent.headers['anthropic-beta'] }));
  check('the instructions to the model forbid invented prices and require exact quotes', /Never invent prices/.test(sent.body.system) && /copied exactly/.test(sent.body.system) && JSON.stringify(sent.body.messages).includes('ركز على شروط الدفع'));
  check('the run is entered in the AI register, waiting for human review', one(`select status from ai_runs where id = ${s1.ai_run_id}`) === 'waiting_approval');

  // --- A quote not in the documents; a refusal; a key the provider rejects.
  const f = await done(must(await api('POST', '/ai/tender-studies', est, { tender_id: tenderId, documents: `${DOCS}\nMOCK_FAKE_QUOTE marker line for the test` }), 'fake').id);
  check('a finding whose quote is not in the documents is marked unverified', f.status === 'completed' && f.quotes_verified === f.quotes_checked - 1 && f.result.risks[0].quote_verified === false, `${f.quotes_verified}/${f.quotes_checked}`);
  const r = await done(must(await api('POST', '/ai/tender-studies', est, { tender_id: tenderId, documents: `${DOCS}\nMOCK_REFUSE marker line for the test` }), 'refuse').id);
  check('a refusal by the model is recorded as refused, with no result', r.status === 'refused' && r.result === null && r.stop_reason === 'refusal');
  must(await api('PUT', '/ai/settings', aiAdmin, { provider: 'anthropic', model: 'claude-opus-5-5', api_key: `sk-test-${TAG}-rejected-key-0000`, data_processing_accepted: true, enabled: true }), 'bad key');
  const k = await done(must(await api('POST', '/ai/tender-studies', est, { tender_id: tenderId, documents: DOCS }), 'badkey').id);
  check('a key the provider rejects fails the study with a clear reason', k.status === 'failed' && k.error === 'The provider refused the company key', k.error);
  must(await api('PUT', '/ai/settings', aiAdmin, { provider: 'anthropic', model: 'claude-opus-5-5', api_key: KEY, data_processing_accepted: true, enabled: false }), 'disable');
  await expectStatus('with AI disabled, no study is accepted', () => api('POST', '/ai/tender-studies', est, { tender_id: tenderId, documents: DOCS }), 422);

  // --- Review.
  await expectStatus('the requester cannot review the study', () => api('POST', `/ai/tender-studies/${q.id}/review`, est, { decision: 'approved', note: 'self review' }), 403);
  await expectStatus('a refused study is not reviewed', () => api('POST', `/ai/tender-studies/${r.id}/review`, mgr, { decision: 'approved', note: 'cannot approve' }), 409);
  const ap = must(await api('POST', `/ai/tender-studies/${q.id}/review`, mgr, { decision: 'approved', note: 'مراجعة: صالحة كبداية للتسعير' }), 'review');
  check('the tendering manager approves the draft with a note; the AI run is closed as succeeded', ap.status === 'approved' && ap.reviewed_by_name === 'AI aimgr' && one(`select status from ai_runs where id = ${s1.ai_run_id}`) === 'succeeded');
  await expectStatus('a reviewed study is not reviewed again', () => api('POST', `/ai/tender-studies/${q.id}/review`, mgr, { decision: 'rejected', note: 'second thoughts' }), 409);
  { const x = sql(OWNER, `update tender_studies set result = '{}' where id = ${q.id}`); check('DB: an approved study never changes', !x.ok && /never changes/.test(x.out), x.out.slice(0, 120)); }
  { const x = sql(OWNER, `delete from tender_studies where id = ${f.id}`); check('DB: studies are permanent', !x.ok && /permanent/.test(x.out), x.out.slice(0, 120)); }

  // --- Isolation and audit.
  const B = await login(ADMIN_B);
  check('the other company sees none of these studies', must(await api('GET', '/ai/tender-studies', B), 'B').every(s => ![q.id, f.id, r.id].includes(s.id)));
  await expectStatus('the other company cannot read one of them', () => api('GET', `/ai/tender-studies/${q.id}`, B), 404);
  check('the other company has no AI settings', (await api('GET', '/ai/settings', B)).body.data === null);
  check('settings and studies are audited', Number(one(`select count(*) from audit_log where table_name in ('ai_provider_settings', 'tender_studies') and org_id = ${ADMIN.org_id}`)) >= 6);
} catch (e) {
  check('suite completed', false, e.message.slice(0, 300));
}
finish('sweep_tender_study');
