// Stage 16 / GC-04: design-revision impact - drawing-number links to BOQ items, activities, PO lines and inspections;
// a new current revision opens an impact listing every linked object; stale links visible; human dispositions re-base
// the links; closing needs every object assessed and, for required changes, a contract event or a no-entitlement
// reason. Uses the variations project (execution BOQ, signed contract) and the AR project (PO lines). TEST FIXTURES.
import { ADMIN, ADMIN_B, TAG, api, must, run, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL;
const day = (o) => new Date(Date.now() + o * 86400000).toISOString().slice(0, 10);
const one = (text) => sql(OWNER, text).out.trim().split('\n').filter(Boolean).pop();
try {
  const admin = await login(ADMIN);
  const mkRole = async (name, perms) => must(await api('POST', '/roles', admin, { role_name: `${name} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), `role ${name}`).id;
  const mkUser = async (key, role_id) => {
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    must(await api('POST', '/users', admin, { role_id, full_name: `DI ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return login(u);
  };
  const all = await mkRole('Design Impact', [['technical_office', 'view'], ['technical_office', 'manage'], ['planning', 'view'], ['planning', 'manage'], ['qaqc', 'view'], ['qaqc', 'create'], ['contracts', 'view'], ['contracts', 'create']]);
  const T1 = await mkUser('di1', all), T2 = await mkUser('di2', all);
  const proj = must(await api('GET', '/projects', admin), 'projects');
  const list = Array.isArray(proj) ? proj : proj.projects ?? [];
  const P = list.find(p => p.project_code === `VA-${TAG}`).id, PA = list.find(p => p.project_code === `AR-${TAG}`).id;
  const other = must(await api('POST', '/projects', admin, { project_code: `DIO-${TAG}`, project_name: `DIO ${TAG}`, currency_id: 1 }), 'other').id;
  const boq = must(await api('GET', `/boq/project/${P}`, admin), 'boq')[0].id;
  const poLine = Number(one(`select pl.id from po_lines pl join purchase_orders po on po.id = pl.po_id where po.project_id = ${PA} order by pl.id limit 1`));
  const contract = Number(one(`select id from contracts where project_id = ${P} and contract_status in ('signed','active') order by id limit 1`));
  const act = must(await api('POST', '/planning/activities', T1, { project_id: P, activity_id_ext: `DI-A1-${TAG}`, activity_name: 'Slab L3 formwork (fixture)', planned_duration_days: 5 }), 'activity').id;
  const actOther = must(await api('POST', '/planning/activities', T1, { project_id: other, activity_id_ext: `DI-X-${TAG}`, activity_name: 'Other project activity', planned_duration_days: 1 }), 'activity other').id;
  const insp = must(await api('POST', '/qaqc/inspections', T1, { project_id: P, checklist_type: 'slab_L3_rebar' }), 'inspection').id;
  const drawing = async (no, rev) => {
    const d = must(await api('POST', '/technical-office/drawings', T1, { project_id: P, drawing_no: no, title: `Slab L3 (fixture) ${no}`, discipline: 'structural', revision: rev }), `drawing ${no}${rev}`);
    must(await api('PATCH', `/technical-office/drawings/${d.id}/status`, T2, { status: 'approved' }), `approve ${no}${rev}`);
    return d;
  };
  const DWG = `S-300-${TAG}`;
  const rA = await drawing(DWG, 'A');
  const noImpact = must(await api('GET', `/technical-office/design-impacts?project_id=${P}`, T1), 'impacts0');
  check('first approved revision opens no impact', !noImpact.some(i => i.drawing_no === DWG));

  // --- Links (where-used).
  const link = (type, id) => api('POST', '/technical-office/design-links', T1, { drawing_id: rA.id, object_type: type, object_id: id });
  for (const [t, id] of [['boq_item', boq], ['activity', act], ['inspection', insp]]) must(await link(t, id), `link ${t}`);
  await expectStatus('a PO line of another project cannot be linked', () => link('po_line', poLine), 422);
  await expectStatus('object from another project cannot be linked', () => link('activity', actOther), 422);
  await expectStatus('the same object is linked once per drawing', () => link('activity', act), 409);
  const l0 = must(await api('GET', `/technical-office/design-links?project_id=${P}`, T2), 'links0').filter(l => l.drawing_no === DWG);
  check('where-used lists 3 objects on revision A, none stale', l0.length === 3 && l0.every(l => l.based_on_revision === 'A' && l.stale === false && l.object_label), JSON.stringify(l0.map(l => [l.object_type, l.object_label])));

  // --- New revision B becomes current: impact opened.
  const rB = must(await api('POST', '/technical-office/drawings', T1, { project_id: P, drawing_no: DWG, title: 'Slab L3 (fixture) rev B', discipline: 'structural', revision: 'B' }), 'rev B');
  check('a revision under review opens nothing yet', !must(await api('GET', `/technical-office/design-impacts?project_id=${P}`, T1), 'imp1').some(i => i.drawing_no === DWG));
  must(await api('PATCH', `/technical-office/drawings/${rB.id}/status`, T2, { status: 'approved_with_comments', comment: 'Thickened edge added at grid C (fixture)' }), 'approve B');
  const imp = must(await api('GET', `/technical-office/design-impacts?project_id=${P}`, T1), 'imp2').find(i => i.drawing_no === DWG);
  check('approving revision B opens one impact with the 3 linked objects (A -> B)', imp && imp.items === 3 && imp.pending_items === 3 && imp.new_revision === 'B' && imp.superseded_revision === 'A', JSON.stringify(imp));
  const l1 = must(await api('GET', `/technical-office/design-links?project_id=${P}`, T2), 'links1').filter(l => l.drawing_no === DWG);
  check('every link is flagged stale (based on superseded revision A)', l1.every(l => l.stale === true));
  const detail = must(await api('GET', `/technical-office/design-impacts/${imp.id}`, T2), 'impact detail');
  check('impact items carry a readable label and the revision they were based on', detail.items.every(x => x.object_label && x.based_on_revision === 'A' && !/no longer found/.test(x.object_label)), JSON.stringify(detail.items.map(x => x.object_label)));

  // --- Dispositions and closing.
  await expectStatus('closing refused while objects are not assessed', () => api('POST', `/technical-office/design-impacts/${imp.id}/close`, T2, { no_entitlement_reason: 'nothing to see here at all' }), 422);
  const item = (type) => detail.items.find(x => x.object_type === type);
  await expectStatus('a disposition needs a reason', () => api('POST', `/technical-office/design-impact-items/${item('boq_item').id}/disposition`, T2, { disposition: 'no_change', reason: 'ok' }), 400);
  must(await api('POST', `/technical-office/design-impact-items/${item('boq_item').id}/disposition`, T2, { disposition: 'change_required', reason: 'Edge thickening adds 3.2 m3 concrete (fixture)' }), 'boq disp');
  for (const t of ['activity', 'inspection']) must(await api('POST', `/technical-office/design-impact-items/${item(t).id}/disposition`, T2, { disposition: 'no_change', reason: 'Not affected by edge detail (fixture)' }), `disp ${t}`);
  await expectStatus('a dispositioned object cannot be re-assessed', () => api('POST', `/technical-office/design-impact-items/${item('activity').id}/disposition`, T2, { disposition: 'change_required', reason: 'second thoughts here' }), 422);
  const l2 = must(await api('GET', `/technical-office/design-links?project_id=${P}`, T2), 'links2').filter(l => l.drawing_no === DWG);
  check('assessed links are re-based on revision B (no longer stale)', l2.every(l => l.based_on_revision === 'B' && l.stale === false));
  await expectStatus('required change: closing refused without a contract event or no-entitlement reason', () => api('POST', `/technical-office/design-impacts/${imp.id}/close`, T2, {}), 422);
  const otherContractEvent = Number(one(`select ce.id from contract_events ce join contracts c on c.id = ce.contract_id where c.project_id <> ${P} and c.org_id = 1 order by ce.id limit 1`));
  await expectStatus('a contract event of another project is refused', () => api('POST', `/technical-office/design-impacts/${imp.id}/close`, T2, { contract_event_id: otherContractEvent }), 422);
  const ev = must(await api('POST', `/contract-admin/contracts/${contract}/events`, T1, { title: `Revision B of ${DWG} (fixture)`, description: 'Thickened edge at grid C instructed by revised drawing (fixture)', occurred_on: day(0), became_aware_on: day(0), source_type: 'design_revision', source_reference: `${DWG} rev B` }), 'event').event;
  const closed = await run('impact closed with the contract event raised for the change', async () => must(await api('POST', `/technical-office/design-impacts/${imp.id}/close`, T2, { contract_event_id: ev.id }), 'close'));
  check('closer and event recorded', Number(closed.contract_event_id) === Number(ev.id) && !!closed.closed_at);
  await expectStatus('a closed impact cannot be closed again', () => api('POST', `/technical-office/design-impacts/${imp.id}/close`, T2, { no_entitlement_reason: 'again and again' }), 409);

  // --- PO lines are traced too (AR project holds the purchase order).
  const D3 = `M-500-${TAG}`;
  const pA = must(await api('POST', '/technical-office/drawings', T1, { project_id: PA, drawing_no: D3, title: 'Pump schedule (fixture)', discipline: 'mechanical', revision: 'A' }), 'pump A');
  must(await api('PATCH', `/technical-office/drawings/${pA.id}/status`, T2, { status: 'approved' }), 'approve pump A');
  must(await api('POST', '/technical-office/design-links', T1, { drawing_id: pA.id, object_type: 'po_line', object_id: poLine }), 'link po');
  const pB = must(await api('POST', '/technical-office/drawings', T1, { project_id: PA, drawing_no: D3, title: 'Pump schedule (fixture) B', discipline: 'mechanical', revision: 'B' }), 'pump B');
  must(await api('PATCH', `/technical-office/drawings/${pB.id}/status`, T2, { status: 'approved' }), 'approve pump B');
  const impP = must(await api('GET', `/technical-office/design-impacts?project_id=${PA}`, T1), 'impP').find(i => i.drawing_no === D3);
  const impPd = must(await api('GET', `/technical-office/design-impacts/${impP.id}`, T1), 'impP detail');
  check('a revised pump schedule lists the purchase-order line bought against it', impPd.items.length === 1 && impPd.items[0].object_type === 'po_line' && /^PO /.test(impPd.items[0].object_label), JSON.stringify(impPd.items.map(x => x.object_label)));

  // --- A drawing with no links still records the revision change.
  const D2 = `A-100-${TAG}`;
  await drawing(D2, 'A'); await drawing(D2, 'B');
  const imp2 = must(await api('GET', `/technical-office/design-impacts?project_id=${P}`, T1), 'imp3').find(i => i.drawing_no === D2);
  check('revision without links opens an impact with 0 objects (nothing traced is visible, not silent)', imp2 && imp2.items === 0);
  await run('impact without required changes closes without event', async () => must(await api('POST', `/technical-office/design-impacts/${imp2.id}/close`, T2, {}), 'close2'));

  if (OWNER) {
    const probe = (name, text) => { const r = sql(OWNER, text); check(name, !r.ok, r.out.split('\n').find(l => /ERROR/.test(l)) ?? r.out.slice(0, 120)); };
    probe('DB: impacts are never deleted', `delete from design_revision_impacts where id=${imp.id}`);
    probe('DB: closed impact immutable', `update design_revision_impacts set contract_event_id=null where id=${imp.id}`);
    probe('DB: impact items of a closed impact immutable', `update design_impact_items set reason='rewritten later on' where impact_id=${imp.id}`);
    probe('DB: a link with impact history cannot be removed', `delete from design_links where project_id=${P} and drawing_no='${DWG}'`);
  } else check('DB probes (OWNER_PSQL_URL required)', false);

  const tb = await login(ADMIN_B);
  await expectStatus('tenant B cannot read a tenant A impact', () => api('GET', `/technical-office/design-impacts/${imp.id}`, tb), 404);
  await expectStatus('tenant B cannot link to a tenant A drawing', () => api('POST', '/technical-office/design-links', tb, { drawing_id: rB.id, object_type: 'activity', object_id: act }), 404);
  await expectStatus('tenant B cannot disposition a tenant A item', () => api('POST', `/technical-office/design-impact-items/${item('boq_item').id}/disposition`, tb, { disposition: 'no_change', reason: 'cross tenant' }), 404);
} catch (e) {
  console.error('SUITE STOPPED:', e.message);
  check('suite completed', false, e.message.slice(0, 200));
}
finish('sweep_design_impact');
