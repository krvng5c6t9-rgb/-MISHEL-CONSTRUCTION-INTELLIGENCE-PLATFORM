// CC-097 (Stage 68): dated critical path method on a work calendar, and schedule exchange with Primavera P6 (XER) and
// Microsoft Project (MSPDI XML). Pure functions: no database access here.
// Conventions (stated, not assumed silently): durations are whole working days; the data date is day 0 (moved to the
// next working day if it is not one); an activity of d > 0 days starting on working day s finishes at the end of
// working day s + d - 1; a milestone starts and finishes on its day. Relationship lags are working days.
// File formats were implemented from their published structure (XER: Primavera's tab-separated table export;
// MSPDI: Microsoft's Project XML schema). Only the fields listed below are read or written.

export type RelType = 'FS' | 'SS' | 'FF' | 'SF';
export interface Act { id: number; code: string | null; name: string; duration: number; type: 'task' | 'start_milestone' | 'finish_milestone'; wbs: string | null }
export interface Rel { pred: number; succ: number; type: RelType; lag: number }
export interface Calendar { work_days: number[]; hours_per_day: number; holidays: string[] }

export class ScheduleError extends Error { constructor(message: string, public detail?: unknown) { super(message); } }

// --- CPM in working-day offsets (forward and backward pass, total and free float).
export function cpm(acts: Act[], rels: Rel[]) {
  const by = new Map(acts.map(a => [a.id, a])), inc = new Map<number, Rel[]>(), out = new Map<number, Rel[]>(), indeg = new Map(acts.map(a => [a.id, 0]));
  for (const r of rels) {
    if (!by.has(r.pred) || !by.has(r.succ)) throw new ScheduleError('Schedule relationship references an activity outside the selected project');
    (inc.get(r.succ) ?? inc.set(r.succ, []).get(r.succ)!).push(r);
    (out.get(r.pred) ?? out.set(r.pred, []).get(r.pred)!).push(r);
    indeg.set(r.succ, indeg.get(r.succ)! + 1);
  }
  const q = acts.filter(a => indeg.get(a.id) === 0).map(a => a.id), order: number[] = [];
  while (q.length) { const n = q.shift()!; order.push(n); for (const r of out.get(n) ?? []) { indeg.set(r.succ, indeg.get(r.succ)! - 1); if (indeg.get(r.succ) === 0) q.push(r.succ); } }
  if (order.length !== acts.length) throw new ScheduleError('Schedule contains a relationship cycle');
  const es = new Map<number, number>(), ef = new Map<number, number>();
  for (const id of order) {
    const d = by.get(id)!.duration; let s = 0;
    for (const r of inc.get(id) ?? []) {
      const c = r.type === 'FS' ? ef.get(r.pred)! + r.lag : r.type === 'SS' ? es.get(r.pred)! + r.lag : r.type === 'FF' ? ef.get(r.pred)! + r.lag - d : es.get(r.pred)! + r.lag - d;
      s = Math.max(s, c);
    }
    es.set(id, s); ef.set(id, s + d);
  }
  const finish = Math.max(0, ...acts.map(a => ef.get(a.id)!)), ls = new Map<number, number>(), lf = new Map<number, number>();
  for (const id of [...order].reverse()) {
    const d = by.get(id)!.duration; let l = finish - d;
    for (const r of out.get(id) ?? []) {
      const c = r.type === 'FS' ? ls.get(r.succ)! - r.lag - d : r.type === 'SS' ? ls.get(r.succ)! - r.lag : r.type === 'FF' ? lf.get(r.succ)! - r.lag - d : lf.get(r.succ)! - r.lag;
      l = Math.min(l, c);
    }
    ls.set(id, l); lf.set(id, l + d);
  }
  const rows = order.map(id => {
    const outs = out.get(id) ?? [];
    const free = outs.length ? Math.min(...outs.map(r => r.type === 'FS' ? es.get(r.succ)! - ef.get(id)! - r.lag : r.type === 'SS' ? es.get(r.succ)! - es.get(id)! - r.lag
      : r.type === 'FF' ? ef.get(r.succ)! - ef.get(id)! - r.lag : ef.get(r.succ)! - es.get(id)! - r.lag)) : finish - ef.get(id)!;
    const total = ls.get(id)! - es.get(id)!;
    return { id, es: es.get(id)!, ef: ef.get(id)!, ls: ls.get(id)!, lf: lf.get(id)!, total_float: total, free_float: free, critical: total <= 0 };
  });
  return { duration: finish, rows };
}

// --- Work calendar: working dates from the data date.
const iso = (d: Date) => d.toISOString().slice(0, 10);
const parseDay = (s: string) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new ScheduleError('Invalid date'); return new Date(`${s}T00:00:00Z`); };
export function workingDays(cal: Calendar, dataDate: string, count: number): string[] {
  if (!cal.work_days.length) throw new ScheduleError('The calendar has no working day');
  const hol = new Set(cal.holidays), days: string[] = [], d = parseDay(dataDate);
  let guard = 0;
  while (days.length < count) {
    if (cal.work_days.includes(d.getUTCDay()) && !hol.has(iso(d))) days.push(iso(d));
    d.setUTCDate(d.getUTCDate() + 1);
    if (++guard > 40000) throw new ScheduleError('The calendar has too few working days');
  }
  return days;
}
// Offsets -> dates. Start of offset s is working day s; finish of an activity of d > 0 days is working day s + d - 1.
// (Text1 of an MSPDI task carries the activity code on export and is read back on import.)
export function datedSchedule(acts: Act[], rels: Rel[], cal: Calendar, dataDate: string) {
  const r = cpm(acts, rels), by = new Map(acts.map(a => [a.id, a]));
  const maxOff = Math.max(1, ...r.rows.map(x => Math.max(x.lf, x.ef) + 1));
  const days = workingDays(cal, dataDate, maxOff + 1);
  const startOf = (off: number) => days[off], finishOf = (start: number, d: number) => days[d > 0 ? start + d - 1 : start];
  // A finish milestone falls at the end of the working day before its offset (the finish of what precedes it), as in
  // Primavera; a start milestone at the start of its day.
  const fm = (off: number) => days[Math.max(0, off - 1)];
  const rows = r.rows.map(x => { const a = by.get(x.id)!;
    if (a.type === 'finish_milestone') return { ...x, early_start: fm(x.es), early_finish: fm(x.es), late_start: fm(x.ls), late_finish: fm(x.ls) };
    return { ...x, early_start: startOf(x.es), early_finish: finishOf(x.es, a.duration), late_start: startOf(x.ls), late_finish: finishOf(x.ls, a.duration) }; });
  const finishDate = rows.length ? rows.map(x => x.early_finish).sort().pop()! : days[0];
  return { duration: r.duration, start: days[0], finish: finishDate, rows };
}

// --- Primavera P6 XER (tab-separated tables: %T table, %F fields, %R rows, %E end).
export function parseXer(text: string) {
  const tables = new Map<string, Record<string, string>[]>(); let cur: string | null = null, fields: string[] = [];
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (!lines[0]?.startsWith('ERMHDR')) throw new ScheduleError('Not a Primavera XER file (ERMHDR header missing)');
  for (const line of lines) {
    const c = line.split('\t');
    if (c[0] === '%T') { cur = c[1]; tables.set(cur, []); fields = []; }
    else if (c[0] === '%F') fields = c.slice(1);
    else if (c[0] === '%R' && cur) { const row: Record<string, string> = {}; fields.forEach((f, i) => { row[f] = c[i + 1] ?? ''; }); tables.get(cur)!.push(row); }
  }
  return tables;
}
const XER_TYPE: Record<string, Act['type'] | null> = { TT_Task: 'task', TT_Rsrc: 'task', TT_LOE: 'task', TT_Mile: 'start_milestone', TT_FinMile: 'finish_milestone', TT_WBS: null };
const XER_REL: Record<string, RelType> = { PR_FS: 'FS', PR_SS: 'SS', PR_FF: 'FF', PR_SF: 'SF' };

export interface Imported { acts: (Omit<Act, 'id'> & { key: string })[]; rels: { pred: string; succ: string; type: RelType; lag: number }[]; warnings: string[] }

export function importXer(text: string, defaultHoursPerDay: number): Imported {
  const t = parseXer(text), tasks = t.get('TASK') ?? [], preds = t.get('TASKPRED') ?? [], warnings: string[] = [];
  if (!tasks.length) throw new ScheduleError('The XER file has no TASK table');
  if ((t.get('PROJECT') ?? []).length > 1) throw new ScheduleError('The XER file holds more than one project; export one project at a time');
  const cal = new Map((t.get('CALENDAR') ?? []).map(c => [c.clndr_id, Number(c.day_hr_cnt) || 0]));
  const wbs = new Map((t.get('PROJWBS') ?? []).map(w => [w.wbs_id, w]));
  const wbsPath = (id: string) => { const parts: string[] = []; let w = wbs.get(id), guard = 0;
    while (w && w.proj_node_flag !== 'Y' && guard++ < 50) { parts.unshift(w.wbs_short_name); w = wbs.get(w.parent_wbs_id); } return parts.length ? parts.join('.') : null; };
  const acts: Imported['acts'] = [];
  for (const k of tasks) {
    const ty = XER_TYPE[k.task_type];
    if (ty === undefined) { warnings.push(`Activity ${k.task_code}: unknown type ${k.task_type}, read as a task`); }
    if (ty === null) { warnings.push(`Activity ${k.task_code}: WBS summary activity skipped`); continue; }
    if (k.task_type === 'TT_LOE' || k.task_type === 'TT_Rsrc') warnings.push(`Activity ${k.task_code}: ${k.task_type === 'TT_LOE' ? 'level of effort' : 'resource dependent'} activity read as a task`);
    const hpd = cal.get(k.clndr_id) || defaultHoursPerDay, hours = Number(k.target_drtn_hr_cnt || 0), type = ty ?? 'task';
    let days = type === 'task' ? hours / hpd : 0;
    if (type === 'task' && Math.abs(days - Math.round(days)) > 1e-6) { warnings.push(`Activity ${k.task_code}: ${hours} h is not a whole number of ${hpd} h days; rounded up`); days = Math.ceil(days); }
    acts.push({ key: k.task_id, code: k.task_code || null, name: k.task_name || k.task_code, duration: Math.round(days), type, wbs: wbsPath(k.wbs_id) });
  }
  const keys = new Set(acts.map(a => a.key)), rels: Imported['rels'] = [];
  for (const p of preds) {
    if (!keys.has(p.task_id) || !keys.has(p.pred_task_id)) { warnings.push(`Relationship ${p.pred_task_id} -> ${p.task_id}: an activity is not in the file or was skipped; ignored`); continue; }
    const type = XER_REL[p.pred_type]; if (!type) { warnings.push(`Relationship ${p.pred_task_id} -> ${p.task_id}: unknown type ${p.pred_type}; ignored`); continue; }
    const succTask = tasks.find(x => x.task_id === p.task_id)!, hpd = cal.get(succTask.clndr_id) || defaultHoursPerDay, lag = Number(p.lag_hr_cnt || 0) / hpd;
    if (Math.abs(lag - Math.round(lag)) > 1e-6) warnings.push(`Relationship ${p.pred_task_id} -> ${p.task_id}: lag rounded to whole days`);
    rels.push({ pred: p.pred_task_id, succ: p.task_id, type, lag: Math.round(lag) });
  }
  return { acts, rels, warnings };
}

const xerEsc = (s: unknown) => String(s ?? '').replace(/[\t\r\n]+/g, ' ');
export function exportXer(project: { code: string; name: string }, acts: Act[], rels: Rel[], cal: Calendar, dated: ReturnType<typeof datedSchedule>) {
  const hpd = cal.hours_per_day, by = new Map(dated.rows.map(r => [r.id, r])), L: string[] = [];
  const table = (name: string, fields: string[], rows: unknown[][]) => { L.push(`%T\t${name}`, `%F\t${fields.join('\t')}`); for (const r of rows) L.push(`%R\t${r.map(xerEsc).join('\t')}`); };
  L.push(`ERMHDR\t19.12\t${new Date().toISOString().slice(0, 10)}\tProject\tMARC\tMARC\tdbxDatabaseNoName\tProject Management\tUSD`);
  table('CALENDAR', ['clndr_id', 'clndr_name', 'day_hr_cnt'], [[1, 'Project calendar', hpd]]);
  table('PROJECT', ['proj_id', 'proj_short_name', 'plan_start_date', 'clndr_id'], [[1, project.code, `${dated.start} 00:00`, 1]]);
  const wbsCodes = [...new Set(acts.map(a => a.wbs).filter(Boolean) as string[])].sort(), wbsId = new Map(wbsCodes.map((w, i) => [w, i + 2]));
  table('PROJWBS', ['wbs_id', 'proj_id', 'proj_node_flag', 'wbs_short_name', 'wbs_name', 'parent_wbs_id'], [[1, 1, 'Y', project.code, project.name, ''], ...wbsCodes.map(w => [wbsId.get(w), 1, 'N', w, w, 1])]);
  const T: Record<Act['type'], string> = { task: 'TT_Task', start_milestone: 'TT_Mile', finish_milestone: 'TT_FinMile' };
  table('TASK', ['task_id', 'proj_id', 'wbs_id', 'clndr_id', 'task_code', 'task_name', 'task_type', 'duration_type', 'target_drtn_hr_cnt', 'early_start_date', 'early_end_date', 'late_start_date', 'late_end_date', 'total_float_hr_cnt', 'driving_path_flag'],
    acts.map(a => { const r = by.get(a.id)!; return [a.id, 1, a.wbs ? wbsId.get(a.wbs) : 1, 1, a.code ?? `A${a.id}`, a.name, T[a.type], 'DT_FixedDrtn', a.duration * hpd,
      `${r.early_start} 00:00`, `${r.early_finish} 00:00`, `${r.late_start} 00:00`, `${r.late_finish} 00:00`, r.total_float * hpd, r.critical ? 'Y' : 'N']; }));
  table('TASKPRED', ['task_pred_id', 'task_id', 'pred_task_id', 'proj_id', 'pred_proj_id', 'pred_type', 'lag_hr_cnt'], rels.map((r, i) => [i + 1, r.succ, r.pred, 1, 1, `PR_${r.type}`, r.lag * hpd]));
  L.push('%E');
  return L.join('\r\n') + '\r\n';
}

// --- Microsoft Project XML (MSPDI). A small reader for its plain element structure: no DTD, no entities beyond the
// five XML ones (a DOCTYPE is refused, so no external entity can be read).
interface XNode { name: string; children: XNode[]; text: string }
export function parseXml(text: string): XNode {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new ScheduleError('XML with a document type declaration is not accepted');
  const root: XNode = { name: '#root', children: [], text: '' }, stack = [root];
  const ent = (s: string) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) => e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'amp' ? '&' : e === 'quot' ? '"' : e === 'apos' ? "'"
    : String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2]) { const n = stack.pop(); if (!n || n.name.replace(/^.*:/, '') !== m[2].replace(/^.*:/, '')) throw new ScheduleError('Malformed XML'); }
    else if (m[3]) { const n: XNode = { name: m[3].replace(/^.*:/, ''), children: [], text: '' }; top.children.push(n); if (!m[5]) stack.push(n); }
    else if (m[6] !== undefined) top.text += ent(m[6]);
  }
  if (stack.length !== 1) throw new ScheduleError('Malformed XML');
  return root;
}
const kid = (n: XNode | undefined, name: string) => n?.children.find(c => c.name === name);
const kids = (n: XNode | undefined, name: string) => n?.children.filter(c => c.name === name) ?? [];
const val = (n: XNode | undefined, name: string) => kid(n, name)?.text.trim() ?? '';
// ISO 8601 duration used by MSPDI (PT40H0M0S) -> hours.
const hoursOf = (d: string) => { const m = /^P(?:(\d+(?:\.\d+)?)D)?T?(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(d || 'PT0H');
  if (!m) throw new ScheduleError(`Unreadable duration ${d}`); return Number(m[1] || 0) * 24 + Number(m[2] || 0) + Number(m[3] || 0) / 60 + Number(m[4] || 0) / 3600; };
const MSP_REL: Record<string, RelType> = { '0': 'FF', '1': 'FS', '2': 'SF', '3': 'SS' };

export function importMspdi(text: string, defaultHoursPerDay: number): Imported {
  const root = parseXml(text.replace(/^﻿/, '')), proj = kid(root, 'Project');
  if (!proj) throw new ScheduleError('Not a Microsoft Project XML file (Project element missing)');
  const minutesPerDay = Number(val(proj, 'MinutesPerDay')) || defaultHoursPerDay * 60, hpd = minutesPerDay / 60, warnings: string[] = [];
  const tasks = kids(kid(proj, 'Tasks'), 'Task'), acts: Imported['acts'] = [], links: { succ: string; node: XNode }[] = [];
  for (const k of tasks) {
    const uid = val(k, 'UID'), name = val(k, 'Name');
    if (uid === '0' || val(k, 'IsNull') === '1') continue;
    if (val(k, 'Summary') === '1') { warnings.push(`Task ${val(k, 'ID') || uid} ${name}: summary task used as WBS, not imported as an activity`); continue; }
    const milestone = val(k, 'Milestone') === '1', hours = hoursOf(val(k, 'Duration'));
    let days = milestone ? 0 : hours / hpd;
    if (!milestone && Math.abs(days - Math.round(days)) > 1e-6) { warnings.push(`Task ${val(k, 'ID') || uid}: ${hours} h is not a whole number of ${hpd} h days; rounded up`); days = Math.ceil(days); }
    const outline = val(k, 'OutlineNumber'), wbs = val(k, 'WBS') || (outline.includes('.') ? outline.split('.').slice(0, -1).join('.') : '') || null;
    acts.push({ key: uid, code: val(k, 'Text1') || (val(k, 'ID') ? `T${val(k, 'ID')}` : `U${uid}`), name: name || `Task ${uid}`, duration: Math.round(days), type: milestone ? 'finish_milestone' : 'task', wbs });
    for (const l of kids(k, 'PredecessorLink')) links.push({ succ: uid, node: l });
  }
  const keys = new Set(acts.map(a => a.key)), rels: Imported['rels'] = [];
  for (const { succ, node } of links) {
    const pred = val(node, 'PredecessorUID'), type = MSP_REL[val(node, 'Type') || '1'];
    if (!keys.has(pred)) { warnings.push(`Link ${pred} -> ${succ}: predecessor is a summary task or not in the file; ignored`); continue; }
    if (!type) { warnings.push(`Link ${pred} -> ${succ}: unknown type; ignored`); continue; }
    const fmt = val(node, 'LagFormat');
    if (fmt && !['5', '7', '35', '37', '3', '4', ''].includes(fmt)) warnings.push(`Link ${pred} -> ${succ}: lag format ${fmt} read as working time`);
    if (['19', '20', '51', '52'].includes(fmt)) { warnings.push(`Link ${pred} -> ${succ}: percentage lag not supported; ignored`); rels.push({ pred, succ, type, lag: 0 }); continue; }
    const lag = Number(val(node, 'LinkLag') || 0) / 10 / 60 / hpd; // tenths of a minute -> working days
    if (Math.abs(lag - Math.round(lag)) > 1e-6) warnings.push(`Link ${pred} -> ${succ}: lag rounded to whole days`);
    rels.push({ pred, succ, type, lag: Math.round(lag) });
  }
  return { acts, rels, warnings };
}

const xmlEsc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function exportMspdi(project: { code: string; name: string }, acts: Act[], rels: Rel[], cal: Calendar, dated: ReturnType<typeof datedSchedule>) {
  const hpd = cal.hours_per_day, by = new Map(dated.rows.map(r => [r.id, r])), uid = new Map(acts.map((a, i) => [a.id, i + 1]));
  const T = { FF: 0, FS: 1, SF: 2, SS: 3 } as const;
  const tasks = acts.map((a, i) => { const r = by.get(a.id)!;
    const links = rels.filter(l => l.succ === a.id).map(l => `<PredecessorLink><PredecessorUID>${uid.get(l.pred)}</PredecessorUID><Type>${T[l.type]}</Type><LinkLag>${l.lag * hpd * 60 * 10}</LinkLag><LagFormat>7</LagFormat></PredecessorLink>`).join('');
    return `<Task><UID>${i + 1}</UID><ID>${i + 1}</ID><Name>${xmlEsc(a.name)}</Name>${a.wbs ? `<WBS>${xmlEsc(a.wbs)}</WBS>` : ''}<Text1>${xmlEsc(a.code ?? '')}</Text1><Duration>PT${a.duration * hpd}H0M0S</Duration><DurationFormat>7</DurationFormat>`
      + `<Start>${r.early_start}T08:00:00</Start><Finish>${r.early_finish}T17:00:00</Finish><Milestone>${a.type === 'task' ? 0 : 1}</Milestone><Summary>0</Summary><Critical>${r.critical ? 1 : 0}</Critical>`
      + `<TotalSlack>${r.total_float * hpd * 60 * 10}</TotalSlack>${links}</Task>`; }).join('');
  const weekDays = [1, 2, 3, 4, 5, 6, 7].map(d => `<WeekDay><DayType>${d}</DayType><DayWorking>${cal.work_days.includes(d - 1) ? 1 : 0}</DayWorking></WeekDay>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Project xmlns="http://schemas.microsoft.com/project"><Name>${xmlEsc(project.name)}</Name><Title>${xmlEsc(project.code)}</Title>`
    + `<StartDate>${dated.start}T08:00:00</StartDate><MinutesPerDay>${hpd * 60}</MinutesPerDay><CalendarUID>1</CalendarUID>`
    + `<Calendars><Calendar><UID>1</UID><Name>Project calendar</Name><IsBaseCalendar>1</IsBaseCalendar><WeekDays>${weekDays}</WeekDays></Calendar></Calendars>`
    + `<Tasks>${tasks}</Tasks></Project>\n`;
}
