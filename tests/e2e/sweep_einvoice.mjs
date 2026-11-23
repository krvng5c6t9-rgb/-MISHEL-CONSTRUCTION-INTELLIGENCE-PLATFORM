// CC-096 / Stage 67 (migration 101): electronic invoicing framework, Egypt ETA scheme, against the local mock of the
// authority and of a company signing service (EINVOICE_EG_ID_HOST / EINVOICE_EG_API_HOST, started by run_from_zero.sh).
// Company profile (credentials encrypted, never returned; finance.manage), every missing value named before a document
// is prepared, tax-code and client mapping, a document built from the IPC's stored tax figures, its canonical form and
// SHA-256 (checked here with an independent implementation and by the mock against the signature), submission by a
// person other than the preparer, status read back (Valid), refused credentials -> failed, re-preparation after a
// failure, one active document per IPC, permanence, isolation and audit. Profile values are TEST FIXTURES.
import { createHash } from 'node:crypto';
import { ADMIN, ADMIN_B, TAG, api, must, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL, MOCK = process.env.MOCK_ETA_URL;
const one = (text) => { const r = sql(OWNER, text); if (!r.ok) throw new Error(r.out.slice(0, 300)); return r.out; };
// Independent ETA canonical form (keys upper-cased and quoted; values quoted; arrays: key once, then key + element).
const ser = (v) => (v === null || typeof v !== 'object' || Array.isArray(v)) ? JSON.stringify(String(v))
  : Object.keys(v).map(k => { const K = JSON.stringify(k).toUpperCase(), x = v[k]; return Array.isArray(x) ? K + x.map(e => K + ser(e)).join('') : K + ser(x); }).join('');
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
try {
  const admin = await login(ADMIN);
  const mk = async (key, perms) => {
    const roleId = must(await api('POST', '/roles', admin, { role_name: `EI ${key} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), 'role').id;
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    must(await api('POST', '/users', admin, { role_id: roleId, full_name: `EI ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return login(u);
  };
  const mgr = await mk('eimgr', [['finance', 'view'], ['finance', 'manage']]);
  const prep = await mk('eiprep', [['finance', 'view'], ['finance', 'create']]);
  const appr = await mk('eiappr', [['finance', 'view'], ['finance', 'approve'], ['finance', 'create']]);
  const ipcs = one(`select i.id from ipcs i join contracts k on k.id = i.contract_id join clients c on c.id = k.client_id
    where i.org_id = ${ADMIN.org_id} and i.tax_treatment = 'computed' and i.status in ('client_approved', 'posted', 'paid') and c.client_name = 'TX Client ${TAG}' order by i.id`).split('\n').map(Number);
  const [I1, I2] = ipcs;
  const noTax = Number(one(`select id from ipcs where org_id = ${ADMIN.org_id} and tax_treatment = 'no_tax_profile' and status in ('client_approved', 'posted', 'paid') order by id limit 1`));
  const draftIpc = Number(one(`select id from ipcs where org_id = ${ADMIN.org_id} and status = 'draft' order by id limit 1`));
  const clientId = Number(one(`select k.client_id from ipcs i join contracts k on k.id = i.contract_id where i.id = ${I1}`));
  const taxCodes = one(`select distinct output_tax_code_id from ipcs where id in (${I1}, ${I2})`).split('\n').map(Number);
  const issuer = { rin: '100200300', name: `MARC Test Contractor ${TAG}`, activity_code: '4100', branch_id: '0', address: { country: 'EG', governate: 'Cairo', region_city: 'Nasr City', street: '90th Street', building_number: '12' } };
  const defaults = { item_type: 'EGS', item_code: 'EG-100200300-1', unit_type: 'EA', description: 'Construction works' };
  const base = { environment: 'test', signer_url: `${MOCK}/sign`, defaults };

  // --- Profile.
  check('no profile until the company sets it', must(await api('GET', '/einvoice/profiles/eg_eta', mgr), 'get') === null);
  await expectStatus('a document before e-invoicing is enabled is refused', () => api('POST', '/einvoice/eg_eta/documents', prep, { ipc_id: I1 }), 422);
  await expectStatus('the profile needs finance.manage', () => api('PUT', '/einvoice/profiles/eg_eta', prep, { ...base, issuer, client_id: 'eta-client', client_secret: 'secret-1234', enabled: true }), 403);
  await expectStatus('enabling needs the authority credentials', () => api('PUT', '/einvoice/profiles/eg_eta', mgr, { ...base, issuer, enabled: true }), 422);
  await expectStatus('an unknown scheme is refused', () => api('PUT', '/einvoice/profiles/xx_none', mgr, { ...base, issuer, enabled: false }), 400);
  const p = must(await api('PUT', '/einvoice/profiles/eg_eta', mgr, { ...base, issuer: { ...issuer, activity_code: '' }, client_id: `eta-client-${TAG}`, client_secret: 'secret-1234', enabled: true }), 'profile');
  check('profile saved: only the last four characters of the secret are returned', p.secret_last4 === '1234' && !JSON.stringify(p).includes('secret-1234') && one(`select client_secret_enc like 'v1:%' from einvoice_profiles where org_id = ${ADMIN.org_id}`) === 't');

  // --- Missing data named before anything is prepared.
  const list0 = must(await api('GET', '/einvoice/eg_eta/ipcs', prep), 'ipcs');
  const row = list0.find(r => r.ipc_id === I1);
  check('the IPCs certified by the client are listed with what is still missing (activity code, tax mapping, client data)',
    row && row.missing.includes('issuer.activity_code') && row.missing.includes('tax_code.einvoice_tax_type / einvoice_sub_type') && row.missing.includes('client.einvoice_party_type'), JSON.stringify(row?.missing));
  const r422 = await api('POST', '/einvoice/eg_eta/documents', prep, { ipc_id: I1 });
  check('preparing with missing data is refused and names each missing value', r422.status === 422 && Array.isArray(r422.body.details?.missing) && r422.body.details.missing.includes('issuer.activity_code'), JSON.stringify(r422.body).slice(0, 240));
  check('an IPC without a computed output tax names the missing tax profile', list0.find(r => r.ipc_id === noTax)?.missing.some(m => m.startsWith('ipc.output_tax')));
  await expectStatus('an IPC not certified by the client is not invoiced electronically', () => api('POST', '/einvoice/eg_eta/documents', prep, { ipc_id: draftIpc }), 409);

  // --- Complete the data (company inputs).
  must(await api('PUT', '/einvoice/profiles/eg_eta', mgr, { ...base, issuer, enabled: true }), 'issuer complete');
  for (const t of taxCodes) must(await api('PUT', `/einvoice/tax-codes/${t}`, mgr, { einvoice_tax_type: 'T1', einvoice_sub_type: 'V009' }), 'tax map');
  const lk = must(await api('GET', '/einvoice/lookups', prep), 'lookups');
  check('output tax codes and clients listed with their e-invoice fields', taxCodes.every(id => lk.tax_codes.some(c => Number(c.id) === id && c.einvoice_tax_type === 'T1' && c.einvoice_sub_type === 'V009'))
    && lk.clients.some(c => Number(c.id) === clientId));
  await expectStatus('a tax type outside the code pattern is refused', () => api('PUT', `/einvoice/tax-codes/${taxCodes[0]}`, mgr, { einvoice_tax_type: 't1;drop', einvoice_sub_type: 'V009' }), 400);
  must(await api('PUT', `/einvoice/clients/${clientId}`, mgr, { party_type: 'business', address: { country: 'EG', governate: 'Giza', region_city: 'Dokki', street: 'Tahrir St', building_number: '5' } }), 'client');
  const stillMissing = must(await api('GET', '/einvoice/eg_eta/ipcs', prep), 'ipcs2').find(r => r.ipc_id === I1).missing;
  check('a business client also needs its tax registration number', JSON.stringify(stillMissing) === JSON.stringify(['client.tax_id']), JSON.stringify(stillMissing));
  one(`update clients set tax_id = '200300400' where id = ${clientId}`); // TEST FIXTURE: the client's tax registration number

  // --- Prepare.
  const d1 = must(await api('POST', '/einvoice/eg_eta/documents', prep, { ipc_id: I1 }), 'prepare');
  const [b, t, tot, ipcNo, pcode] = one(`select i.output_tax_base::text, i.output_tax_amount::text, (i.output_tax_base + i.output_tax_amount)::text, i.ipc_no, p.project_code
    from ipcs i join projects p on p.id = i.project_id where i.id = ${I1}`).split('|');
  const P = d1.payload, L = P.invoiceLines[0];
  check('document type I, version 1.0, internal id from project and IPC, issuer and receiver (business, with tax ids)',
    P.documentType === 'I' && P.documentTypeVersion === '1.0' && P.internalID === `${pcode}-IPC-${ipcNo}` && P.issuer.id === '100200300' && P.issuer.address.branchID === '0'
      && P.receiver.type === 'B' && P.receiver.id === '200300400' && P.taxpayerActivityCode === '4100', JSON.stringify({ i: P.internalID, r: P.receiver }).slice(0, 200));
  check('amounts are the IPC\'s stored tax base, tax and their database total', L.netTotal === Number(b) && L.salesTotal === Number(b) && L.taxableItems[0].amount === Number(t) && L.total === Number(tot)
    && P.netAmount === Number(b) && P.totalAmount === Number(tot) && P.taxTotals[0].taxType === 'T1' && L.taxableItems[0].subType === 'V009', `${b} ${t} ${tot}`);
  check('dateTimeIssued is UTC without fractions', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(P.dateTimeIssued));
  check('the canonical fingerprint equals an independent implementation of the ETA rule over the stored payload', d1.canonical_sha256 === sha(ser(P)) && d1.status === 'prepared');
  await expectStatus('one active document per IPC', () => api('POST', '/einvoice/eg_eta/documents', prep, { ipc_id: I1 }), 409);

  // --- Submit: refused credentials first (status failed, a new document may then be prepared).
  await expectStatus('submitting needs finance.approve', () => api('POST', `/einvoice/eg_eta/documents/${d1.id}/submit`, prep), 403);
  await expectStatus('a prepared document has no authority status to read yet', () => api('POST', `/einvoice/eg_eta/documents/${d1.id}/refresh`, appr), 409);
  must(await api('PUT', '/einvoice/profiles/eg_eta', mgr, { ...base, issuer, client_secret: 'secret-0000', enabled: true }), 'bad secret'); // the mock refuses secrets ending 0000
  const f = must(await api('POST', `/einvoice/eg_eta/documents/${d1.id}/submit`, appr), 'submit bad');
  check('credentials refused by the authority: the document is marked failed with the reason', f.status === 'failed' && /refused the company credentials/.test(f.last_error ?? ''), `${f.status} ${f.last_error}`);
  await expectStatus('a failed document is not submitted again', () => api('POST', `/einvoice/eg_eta/documents/${d1.id}/submit`, appr), 409);
  must(await api('PUT', '/einvoice/profiles/eg_eta', mgr, { ...base, issuer, client_secret: 'secret-5678', enabled: true }), 'good secret');
  const d2 = must(await api('POST', '/einvoice/eg_eta/documents', prep, { ipc_id: I1 }), 'prepare again');
  check('after a failure a new document is prepared for the same IPC', d2.id !== d1.id && d2.status === 'prepared');
  const s2 = must(await api('POST', `/einvoice/eg_eta/documents/${d2.id}/submit`, appr), 'submit');
  check('submitted by a person other than the preparer: accepted, submission id and document uuid kept', s2.status === 'submitted' && /^SUB\d+$/.test(s2.submission_id) && /^UUID\d+$/.test(s2.provider_uuid)
    && s2.submitted_by_name === 'EI eiappr' && s2.prepared_by_name === 'EI eiprep', JSON.stringify({ s: s2.status, e: s2.last_error }).slice(0, 240));
  const recv = await (await fetch(`${MOCK}/__received`)).json();
  const sub = recv.filter(r => r.url === '/api/v1.0/documentsubmissions').pop(), sent = JSON.parse(sub.body).documents[0];
  const { signatures, ...unsigned } = sent;
  check('the authority received exactly the stored document (same key order) with the signature over its canonical form', sha(ser(unsigned)) === d2.canonical_sha256
    && signatures[0].signatureType === 'I' && Buffer.from(signatures[0].value, 'base64').toString() === `MOCK-CADES-BES:${d2.canonical_sha256}` && sub.auth === 'Bearer');
  check('the token request used the company credentials (basic authentication, client credentials grant)', recv.some(r => r.url === '/connect/token' && r.auth === 'Basic' && /client_credentials/.test(r.body)));
  const v = must(await api('POST', `/einvoice/eg_eta/documents/${d2.id}/refresh`, appr), 'refresh');
  check('status read from the authority: Valid', v.status === 'valid' && v.status_checked_at);
  await expectStatus('a valid document is not submitted again', () => api('POST', `/einvoice/eg_eta/documents/${d2.id}/submit`, appr), 409);
  await expectStatus('a second document for an IPC that has a valid one is refused', () => api('POST', '/einvoice/eg_eta/documents', prep, { ipc_id: I1 }), 409);

  // --- Separation of duties: the person who prepared a document cannot submit it.
  const d3 = must(await api('POST', '/einvoice/eg_eta/documents', appr, { ipc_id: I2 }), 'prepare I2');
  await expectStatus('the preparer cannot submit their own document', () => api('POST', `/einvoice/eg_eta/documents/${d3.id}/submit`, appr), 403);
  const list1 = must(await api('GET', '/einvoice/eg_eta/documents', prep), 'docs');
  check('documents listed with their status', list1.some(x => x.id === d2.id && x.status === 'valid') && list1.some(x => x.id === d1.id && x.status === 'failed') && list1.some(x => x.id === d3.id && x.status === 'prepared'));

  // --- Permanence (database).
  const ch = sql(OWNER, `update einvoice_documents set document_json = replace(document_json, '"I"', '"C"') where id = ${d3.id}`);
  check('a prepared document never changes (database)', !ch.ok && /never changes/.test(ch.out), ch.out.slice(0, 160));
  const del = sql(OWNER, `delete from einvoice_documents where id = ${d1.id}`);
  check('documents are never deleted (database)', !del.ok && /permanent/.test(del.out), del.out.slice(0, 160));
  const back = sql(OWNER, `update einvoice_documents set status = 'prepared' where id = ${d1.id}`);
  check('a failed document never reopens (database)', !back.ok && /never changes/.test(back.out), back.out.slice(0, 160));
  const fake = sql(OWNER, `insert into einvoice_documents (org_id, scheme, environment, source_table, source_id, internal_id, payload, document_json, canonical, canonical_sha256, prepared_by)
    values (${ADMIN.org_id}, 'eg_eta', 'test', 'ipcs', ${I2}, 'X', '{}', '{}', 'abc', repeat('0', 64), (select prepared_by from einvoice_documents where id = ${d1.id}))`);
  check('a fingerprint that does not match the canonical text is refused (database)', !fake.ok && /fingerprint/.test(fake.out), fake.out.slice(0, 160));

  // --- Isolation and audit.
  const adminB = await login(ADMIN_B);
  check('another company sees no profile and no documents', must(await api('GET', '/einvoice/profiles/eg_eta', adminB), 'B prof') === null
    && must(await api('GET', '/einvoice/eg_eta/documents', adminB), 'B docs').length === 0);
  await expectStatus('another company cannot submit this company\'s document', () => api('POST', `/einvoice/eg_eta/documents/${d3.id}/submit`, adminB), 404);
  await expectStatus('another company cannot map this company\'s tax code', () => api('PUT', `/einvoice/tax-codes/${taxCodes[0]}`, adminB, { einvoice_tax_type: 'T1', einvoice_sub_type: 'V009' }), 404);
  check('profile and documents are audited', Number(one(`select count(*) from audit_log where table_name in ('einvoice_profiles', 'einvoice_documents') and org_id = ${ADMIN.org_id}`)) >= 10);
  check('the audit never holds the secret in clear', one(`select count(*) from audit_log where table_name = 'einvoice_profiles' and (coalesce(new_value::text, '') like '%secret-5678%' or coalesce(old_value::text, '') like '%secret-5678%')`) === '0');
} catch (e) {
  check('suite completed', false, e.message.slice(0, 300));
}
finish('sweep_einvoice');
