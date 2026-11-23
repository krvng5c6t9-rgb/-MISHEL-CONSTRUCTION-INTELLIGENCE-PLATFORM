// CC-097 / Stage 68 (migration 102): work calendars, dated CPM and schedule exchange with Primavera P6 (XER) and
// Microsoft Project (MSPDI XML). The files below are TEST FIXTURES written in each format's structure; the expected
// dates are worked out by hand in the comments (calendar Sunday-Thursday, 8 h a day, holiday Tuesday 2026-12-01).
import { createHash } from 'node:crypto';
import { ADMIN, ADMIN_B, TAG, api, must, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL, BASE = process.env.API_BASE;
const one = (text) => { const r = sql(OWNER, text); if (!r.ok) throw new Error(r.out.slice(0, 300)); return r.out; };
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
async function upload(token, projectId, format, fileName, text, dry = false) {
  const res = await fetch(`${BASE}/planning/projects/${projectId}/import?format=${format}&file_name=${encodeURIComponent(fileName)}${dry ? '&dry_run=1' : ''}`,
    { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain; charset=utf-8' }, body: text });
  const j = await res.json().catch(() => null); return { status: res.status, ok: res.ok, data: j?.data, body: j };
}
async function download(token, projectId, format) {
  const res = await fetch(`${BASE}/planning/projects/${projectId}/export?format=${format}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, type: res.headers.get('content-type') ?? '', disp: res.headers.get('content-disposition') ?? '', text: await res.text() };
}
const T = '\t';
// P6 network: A1000 Mobilisation 24 h (3 d) -> A1010 Excavation 16 h (2 d) FS; A1000 -> A1020 Blinding 32 h (4 d) SS lag 8 h (1 d);
// A1010, A1020 -> M1000 finish milestone; a WBS summary activity (skipped) and a level-of-effort activity (read as a task).
const XER = ['ERMHDR\t19.12\t2026-11-23\tProject\tADMIN\tTest\tdbxDatabaseNoName\tProject Management\tEGP',
  '%T\tCALENDAR', '%F\tclndr_id\tclndr_name\tday_hr_cnt', '%R\t7\tSite 8h\t8',
  '%T\tPROJECT', '%F\tproj_id\tproj_short_name', '%R\t1\tXP',
  '%T\tPROJWBS', '%F\twbs_id\tproj_id\tproj_node_flag\twbs_short_name\twbs_name\tparent_wbs_id', '%R\t10\t1\tY\tXP\tProject\t', '%R\t11\t1\tN\tCIV\tCivil\t10', '%R\t12\t1\tN\tEXC\tEarthworks\t11',
  '%T\tTASK', '%F\ttask_id\tproj_id\twbs_id\tclndr_id\ttask_code\ttask_name\ttask_type\ttarget_drtn_hr_cnt',
  '%R\t100\t1\t11\t7\tA1000\tMobilisation\tTT_Task\t24', '%R\t101\t1\t12\t7\tA1010\tExcavation\tTT_Task\t16', '%R\t102\t1\t12\t7\tA1020\tBlinding concrete\tTT_Task\t32',
  '%R\t103\t1\t11\t7\tM1000\tSubstructure complete\tTT_FinMile\t0', '%R\t104\t1\t11\t7\tW1\tSummary\tTT_WBS\t0', '%R\t105\t1\t11\t7\tL1\tSite supervision\tTT_LOE\t12',
  '%T\tTASKPRED', '%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt',
  '%R\t1\t101\t100\tPR_FS\t0', '%R\t2\t102\t100\tPR_SS\t8', '%R\t3\t103\t101\tPR_FS\t0', '%R\t4\t103\t102\tPR_FS\t0', '%R\t5\t105\t104\tPR_FS\t0', '%E', ''].join('\r\n');
// MS Project network: 1 Design 40 h (5 d) -> 2 Approval 8 h (1 d) FS lag 1 d (4800 tenths of a minute); summary task 3 (WBS);
// 4 Handover milestone after 2.
const MSP = `<?xml version="1.0" encoding="UTF-8"?>
<Project xmlns="http://schemas.microsoft.com/project"><Name>MSP fixture &amp; test</Name><MinutesPerDay>480</MinutesPerDay><Tasks>
<Task><UID>0</UID><ID>0</ID><Name>Project summary</Name><Summary>1</Summary></Task>
<Task><UID>3</UID><ID>1</ID><Name>Design phase</Name><Summary>1</Summary><OutlineNumber>1</OutlineNumber></Task>
<Task><UID>1</UID><ID>2</ID><Name>Design &lt;stage 1&gt;</Name><Duration>PT40H0M0S</Duration><Milestone>0</Milestone><OutlineNumber>1.1</OutlineNumber></Task>
<Task><UID>2</UID><ID>3</ID><Name>Approval</Name><Duration>PT8H0M0S</Duration><Milestone>0</Milestone><OutlineNumber>1.2</OutlineNumber>
  <PredecessorLink><PredecessorUID>1</PredecessorUID><Type>1</Type><LinkLag>4800</LinkLag><LagFormat>7</LagFormat></PredecessorLink></Task>
<Task><UID>4</UID><ID>4</ID><Name>Handover</Name><Duration>PT0H0M0S</Duration><Milestone>1</Milestone><OutlineNumber>2</OutlineNumber>
  <PredecessorLink><PredecessorUID>2</PredecessorUID><Type>1</Type></PredecessorLink><PredecessorLink><PredecessorUID>3</PredecessorUID><Type>1</Type></PredecessorLink></Task>
</Tasks></Project>`;

try {
  const admin = await login(ADMIN);
  const mk = async (key, perms) => {
    const roleId = must(await api('POST', '/roles', admin, { role_name: `SC ${key} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), 'role').id;
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    must(await api('POST', '/users', admin, { role_id: roleId, full_name: `SC ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return login(u);
  };
  const planner = await mk('scplan', [['planning', 'view'], ['planning', 'manage'], ['projects', 'view']]);
  const viewer = await mk('scview', [['planning', 'view']]);
  const cur = Number(one(`select id from currencies where code = 'EGP' limit 1`));
  const P1 = must(await api('POST', '/projects', admin, { project_code: `SX-${TAG}`, project_name: `Schedule XER ${TAG}`, currency_id: cur }), 'project 1').id;
  const P2 = must(await api('POST', '/projects', admin, { project_code: `SM-${TAG}`, project_name: `Schedule MSP ${TAG}`, currency_id: cur }), 'project 2').id;

  // --- Calendars (company data; nothing assumed).
  await expectStatus('a calendar needs planning.manage', () => api('POST', '/planning/calendars', viewer, { name: `Site ${TAG}`, work_days: [0, 1, 2, 3, 4], hours_per_day: 8 }), 403);
  await expectStatus('a calendar needs at least one working day', () => api('POST', '/planning/calendars', planner, { name: `Empty ${TAG}`, work_days: [], hours_per_day: 8 }), 400);
  const cal = must(await api('POST', '/planning/calendars', planner, { name: `Site ${TAG}`, work_days: [4, 0, 1, 2, 3, 3], hours_per_day: 8 }), 'calendar').id;
  must(await api('POST', `/planning/calendars/${cal}/holidays`, planner, { holiday_date: '2026-12-01', description: 'Company holiday (test fixture)' }), 'holiday');
  await expectStatus('the same holiday twice is refused', () => api('POST', `/planning/calendars/${cal}/holidays`, planner, { holiday_date: '2026-12-01', description: 'Again' }), 409);
  const cals = must(await api('GET', '/planning/calendars', viewer), 'calendars');
  const c1 = cals.find(c => c.id === cal);
  check('calendar stored with its working days (sorted, no duplicates), hours and holidays', JSON.stringify(c1?.work_days) === '[0,1,2,3,4]' && c1.hours_per_day === '8.00' && c1.holidays.length === 1, JSON.stringify(c1));

  // --- Dated schedule needs settings.
  await expectStatus('a dated schedule needs the project calendar and data date', () => api('GET', `/planning/projects/${P1}/schedule`, viewer), 422);
  await expectStatus('an import needs the project calendar and data date', () => upload(planner, P1, 'xer', 'x.xer', XER), 422);
  must(await api('PUT', `/planning/projects/${P1}/schedule-settings`, planner, { calendar_id: cal, data_date: '2026-11-29' }), 'settings 1');
  must(await api('PUT', `/planning/projects/${P2}/schedule-settings`, planner, { calendar_id: cal, data_date: '2026-11-29' }), 'settings 2');
  await expectStatus('schedule settings need planning.manage', () => api('PUT', `/planning/projects/${P1}/schedule-settings`, viewer, { calendar_id: cal, data_date: '2026-11-29' }), 403);

  // --- XER import.
  await expectStatus('an import needs planning.manage', () => upload(viewer, P1, 'xer', 'x.xer', XER), 403);
  await expectStatus('a file that is not XER is refused', () => upload(planner, P1, 'xer', 'bad.xer', 'hello\nworld'), 422);
  const dry = must(await upload(planner, P1, 'xer', `p6-${TAG}.xer`, XER, true), 'dry run');
  check('dry run reads the file without saving: 5 activities (WBS summary skipped), 4 relationships, warnings named',
    dry.saved === false && dry.activities === 5 && dry.relationships === 4 && dry.warnings.some(w => /W1: WBS summary activity skipped/.test(w)) && dry.warnings.some(w => /L1: level of effort/.test(w))
      && dry.warnings.some(w => /104 -> 105/.test(w)) && dry.file_sha256 === sha(XER) && one(`select count(*) from schedule_activities where project_id = ${P1}`) === '0', JSON.stringify(dry).slice(0, 300));
  const imp = must(await upload(planner, P1, 'xer', `p6-${TAG}.xer`, XER), 'import');
  check('import saved and recorded with the file SHA-256', imp.saved === true && one(`select format || '|' || file_name || '|' || activities_count || '|' || relationships_count || '|' || (file_sha256 = '${sha(XER)}') from schedule_imports where id = ${imp.import_id}`) === `xer|p6-${TAG}.xer|5|4|true`);
  check('activities stored with code, whole-day duration, type and WBS path', one(`select string_agg(activity_id_ext || ':' || planned_duration_days || ':' || activity_type || ':' || coalesce(wbs_code, '-'), ' ' order by activity_id_ext)
    from schedule_activities where project_id = ${P1}`) === 'A1000:3:task:CIV A1010:2:task:CIV.EXC A1020:4:task:CIV.EXC L1:2:task:CIV M1000:0:finish_milestone:CIV');
  await expectStatus('a second import into a project with a schedule is refused', () => upload(planner, P1, 'xer', 'again.xer', XER), 409);

  // Hand calculation. Working days from Sun 2026-11-29: d0 11-29, d1 11-30, (12-01 holiday), d2 12-02, d3 12-03, (Fri, Sat), d4 12-06, d5 12-07.
  // A1000 d0-d2 (11-29..12-02); A1010 FS: d3-d4 (12-03..12-06); A1020 SS+1: d1-d4 (11-30..12-06); M1000 at the end of d4 (12-06);
  // L1 (12 h -> 2 d, no relationship) d0-d1, total float 3. Project 5 working days, 11-29 -> 12-06.
  const sch = must(await api('GET', `/planning/projects/${P1}/schedule`, viewer), 'schedule');
  const a = Object.fromEntries(sch.activities.map(x => [x.code, x]));
  check('dates on the work calendar (weekend and holiday skipped), project 5 working days ending 2026-12-06',
    sch.duration_days === 5 && sch.start === '2026-11-29' && sch.finish === '2026-12-06' && a.A1000.early_start === '2026-11-29' && a.A1000.early_finish === '2026-12-02'
      && a.A1010.early_start === '2026-12-03' && a.A1010.early_finish === '2026-12-06' && a.A1020.early_start === '2026-11-30' && a.A1020.early_finish === '2026-12-06', JSON.stringify(sch).slice(0, 400));
  check('finish milestone at the finish of what precedes it; floats and critical path', a.M1000.early_finish === '2026-12-06' && a.M1000.critical && a.A1000.critical && a.A1010.critical && a.A1020.critical
    && a.L1.total_float === 3 && !a.L1.critical && a.L1.late_start === '2026-12-03' && a.L1.late_finish === '2026-12-06');
  await expectStatus('a relationship that closes a loop is refused (database)', () => api('POST', '/planning/relationships', planner, { project_id: P1, predecessor_activity_id: a.M1000.id, successor_activity_id: a.A1000.id, relationship_type: 'FS', lag_days: 0 }), 422);
  const holidayLater = must(await api('POST', `/planning/calendars/${cal}/holidays`, planner, { holiday_date: '2026-12-03', description: 'Second holiday (test fixture)' }), 'holiday 2');
  const sch2 = must(await api('GET', `/planning/projects/${P1}/schedule`, viewer), 'schedule 2');
  check('a new holiday moves the dates: finish 2026-12-07', sch2.finish === '2026-12-07' && sch2.duration_days === 5, sch2.finish);
  must(await api('DELETE', `/planning/calendars/${cal}/holidays/${holidayLater.id}`, planner), 'remove holiday 2');

  // --- Export XER and MSPDI; read back.
  const ex = await download(viewer, P1, 'xer');
  check('XER export: file download with header, the five tables and the activities', ex.status === 200 && /attachment; filename="SX-/.test(ex.disp) && ex.text.startsWith('ERMHDR')
    && ['%T\tCALENDAR', '%T\tPROJECT', '%T\tPROJWBS', '%T\tTASK', '%T\tTASKPRED'].every(t => ex.text.includes(t)) && /\tA1020\tBlinding concrete\tTT_Task\t/.test(ex.text) && /\tPR_SS\t8/.test(ex.text), ex.text.slice(0, 200));
  const exm = await download(viewer, P1, 'mspdi');
  check('MS Project XML export: namespace, tasks with durations in hours, links, milestone, critical flag', exm.status === 200 && /application\/xml/.test(exm.type)
    && exm.text.includes('xmlns="http://schemas.microsoft.com/project"') && exm.text.includes('<Name>Blinding concrete</Name>') && exm.text.includes('<Duration>PT32H0M0S</Duration>')
    && /<Type>3<\/Type><LinkLag>4800<\/LinkLag>/.test(exm.text) && exm.text.includes('<Milestone>1</Milestone>'));
  const dryBack = must(await upload(planner, P2, 'mspdi', 'roundtrip.xml', exm.text, true), 'round trip');
  check('the exported MS Project file reads back with the same network', dryBack.activities === 5 && dryBack.relationships === 4 && dryBack.milestones === 1 && dryBack.warnings.length === 0, JSON.stringify(dryBack));
  const dryXer = must(await upload(planner, P2, 'xer', 'roundtrip.xer', ex.text, true), 'round trip xer');
  check('the exported XER file reads back with the same network', dryXer.activities === 5 && dryXer.relationships === 4 && dryXer.warnings.length === 0, JSON.stringify(dryXer));

  // --- MSPDI import.
  await expectStatus('XML with a document type declaration is refused (no external entities)', () => upload(planner, P2, 'mspdi', 'evil.xml', '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><Project><Name>&e;</Name></Project>'), 422);
  await expectStatus('malformed XML is refused', () => upload(planner, P2, 'mspdi', 'bad.xml', '<Project><Tasks><Task></Project>'), 422);
  const m = must(await upload(planner, P2, 'mspdi', `msp-${TAG}.xml`, MSP), 'msp import');
  check('MS Project import: summary tasks become WBS, 3 activities, 2 links (the link from a summary task ignored with a warning)', m.activities === 3 && m.relationships === 2
    && m.warnings.some(w => /summary task used as WBS/.test(w)) && m.warnings.some(w => /Link 3 -> 4/.test(w)), JSON.stringify(m));
  // Design d0-d4 (11-29..12-06, holiday 12-01 skipped); Approval FS lag 1: d6 (12-08); Handover at the end of d6 (12-08).
  const s2 = must(await api('GET', `/planning/projects/${P2}/schedule`, viewer), 'schedule 2');
  const b = Object.fromEntries(s2.activities.map(x => [x.name, x]));
  check('MS Project network dated: Design 11-29..12-06, Approval after a 1-day lag 12-08, Handover 12-08; names decoded',
    b['Design <stage 1>']?.early_finish === '2026-12-06' && b.Approval?.early_start === '2026-12-08' && b.Approval.early_finish === '2026-12-08' && b.Handover?.early_finish === '2026-12-08'
      && b['Design <stage 1>'].wbs === '1' && b.Handover.type === 'finish_milestone', JSON.stringify(s2.activities.map(x => [x.name, x.early_start, x.early_finish])));
  const imports = must(await api('GET', `/planning/projects/${P2}/imports`, viewer), 'imports');
  check('import history listed with who imported', imports.length === 1 && imports[0].imported_by_name === 'SC scplan' && imports[0].format === 'mspdi');

  // --- Database rules, isolation, audit.
  const ch = sql(OWNER, `update schedule_imports set file_name = 'x' where id = ${imp.import_id}`);
  check('import records are permanent (database)', !ch.ok && /permanent/.test(ch.out), ch.out.slice(0, 120));
  const ms = sql(OWNER, `update schedule_activities set planned_duration_days = 2 where id = ${a.M1000.id}`);
  check('a milestone has no duration (database)', !ms.ok && /milestone has no duration/.test(ms.out), ms.out.slice(0, 120));
  const adminB = await login(ADMIN_B);
  check('another company sees none of these calendars', !must(await api('GET', '/planning/calendars', adminB), 'B cal').some(c => c.id === cal));
  await expectStatus('another company cannot read this schedule', () => api('GET', `/planning/projects/${P1}/schedule`, adminB), 404);
  await expectStatus('another company cannot import into this project', () => upload(adminB, P1, 'xer', 'x.xer', XER), 404);
  const bCal = sql(OWNER, `insert into project_schedule_settings (org_id, project_id, calendar_id, data_date, updated_by) values (2, ${P1}, ${cal}, '2026-11-29', 1)`);
  check('a calendar or project of another company cannot be linked (database)', !bCal.ok && /not found in this company/.test(bCal.out), bCal.out.slice(0, 120));
  check('calendars, settings and imports are audited', Number(one(`select count(*) from audit_log where table_name in ('work_calendars', 'calendar_holidays', 'project_schedule_settings', 'schedule_imports') and org_id = ${ADMIN.org_id}`)) >= 7);
} catch (e) {
  check('suite completed', false, e.message.slice(0, 300));
}
finish('sweep_schedule');
