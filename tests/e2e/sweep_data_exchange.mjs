// CC-098 / Stage 69 (migration 103): Excel (.xlsx) template, export and import of clients, vendors, cost codes and
// bill-of-quantities rows. Files come from two sources independent of the server's writer: fixtures/clients_openpyxl.xlsx
// (written by the openpyxl library; Arabic header, an empty row, a number in a text column, an unknown column) and a
// minimal writer below (stored ZIP, inline strings). Exports are read back with a minimal reader below. Values are
// TEST FIXTURES.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { ADMIN, ADMIN_B, TAG, api, must, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL, BASE = process.env.API_BASE;
const one = (text) => { const r = sql(OWNER, text); if (!r.ok) throw new Error(r.out.slice(0, 300)); return r.out; };
const sha = (b) => createHash('sha256').update(b).digest('hex');

// --- Independent minimal .xlsx writer: stored (uncompressed) ZIP, inline-string and number cells.
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function storedZip(files) {
  const out = [], cd = []; let off = 0;
  for (const [name, text] of files) {
    const n = Buffer.from(name), d = Buffer.from(text, 'utf8'), c = crc(d), h = Buffer.alloc(30), e = Buffer.alloc(46);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(10, 4); h.writeUInt32LE(c, 14); h.writeUInt32LE(d.length, 18); h.writeUInt32LE(d.length, 22); h.writeUInt16LE(n.length, 26);
    e.writeUInt32LE(0x02014b50, 0); e.writeUInt16LE(10, 6); e.writeUInt32LE(c, 16); e.writeUInt32LE(d.length, 20); e.writeUInt32LE(d.length, 24); e.writeUInt16LE(n.length, 28); e.writeUInt32LE(off, 42);
    out.push(h, n, d); cd.push(e, n); off += 30 + n.length + d.length;
  }
  const c = Buffer.concat(cd), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(c.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...out, c, end]);
}
const xe = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function makeXlsx(rows) {
  const col = (i) => String.fromCharCode(65 + i);
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => v === null ? ''
    : typeof v === 'number' ? `<c r="${col(ci)}${ri + 1}"><v>${v}</v></c>` : `<c r="${col(ci)}${ri + 1}" t="inlineStr"><is><t>${xe(v)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`;
  return storedZip([
    ['[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', sheet]]);
}
// --- Independent minimal reader for the server's exports (deflated parts, shared strings).
function readParts(buf) {
  let e = buf.length - 22; while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  const parts = {}; let p = buf.readUInt32LE(e + 16);
  for (let i = 0; i < buf.readUInt16LE(e + 10); i++) {
    const m = buf.readUInt16LE(p + 10), cs = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl); p += 46 + nl + xl + cl;
    const s = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28), d = buf.subarray(s, s + cs);
    parts[name] = (m === 8 ? inflateRawSync(d) : d).toString('utf8');
  }
  return parts;
}
const unx = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
function readSheet(buf, n = 1) {
  const P = readParts(buf), ss = [...(P['xl/sharedStrings.xml'] ?? '').matchAll(/<si><t[^>]*>([\s\S]*?)<\/t><\/si>/g)].map(m => unx(m[1]));
  return [...P[`xl/worksheets/sheet${n}.xml`].matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)].map(r => {
    const out = []; for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*)><v>([^<]*)<\/v><\/c>/g)) out[c[1].charCodeAt(0) - 65] = /t="s"/.test(c[2]) ? ss[Number(c[3])] : Number(c[3]); return out; });
}
async function upload(token, path, fileName, buf, dry) {
  const res = await fetch(`${BASE}/data-exchange/${path}${path.includes('?') ? '&' : '?'}file_name=${encodeURIComponent(fileName)}${dry ? '&dry_run=1' : ''}`,
    { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, body: buf });
  const j = await res.json().catch(() => null); return { status: res.status, ok: res.ok, data: j?.data, body: j };
}
async function download(token, path) {
  const res = await fetch(`${BASE}/data-exchange/${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, type: res.headers.get('content-type') ?? '', disp: res.headers.get('content-disposition') ?? '', buf: Buffer.from(await res.arrayBuffer()) };
}

try {
  const admin = await login(ADMIN);
  const mk = async (key, perms) => {
    const roleId = must(await api('POST', '/roles', admin, { role_name: `DX ${key} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), 'role').id;
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    must(await api('POST', '/users', admin, { role_id: roleId, full_name: `DX ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return login(u);
  };
  const crm = await mk('dxcrm', [['crm', 'view'], ['crm', 'create'], ['crm', 'export']]);
  const crmView = await mk('dxview', [['crm', 'view']]);
  const cc = await mk('dxcc', [['cost_control', 'view'], ['cost_control', 'manage'], ['cost_control', 'export']]);
  const boq = await mk('dxboq', [['boq', 'view'], ['boq', 'create'], ['boq', 'export']]);
  const ven = await mk('dxven', [['vendors', 'view'], ['vendors', 'create']]);

  // --- Record types offered by permission; template.
  const ents = must(await api('GET', '/data-exchange/entities', crm), 'entities');
  check('only the record types the user may see are offered, with what they may do', ents.length === 1 && ents[0].entity === 'clients' && ents[0].can_import && ents[0].can_export, JSON.stringify(ents.map(e => e.entity)));
  const tpl = await download(crmView, 'clients/template');
  const tRows = readSheet(tpl.buf), guide = readSheet(tpl.buf, 2);
  check('template: an .xlsx with the column keys and a guide sheet in English and Arabic with allowed values', tpl.status === 200 && /spreadsheetml\.sheet/.test(tpl.type) && /clients-template\.xlsx/.test(tpl.disp)
    && tRows[0].join(',') === 'client_name,client_type,contact_person,phone,email,address,tax_id,source' && guide.some(r => r[0] === 'client_type' && r[2] === 'نوع العميل' && /government/.test(r[4])), JSON.stringify(tRows[0]));
  await expectStatus('an unknown record type is refused', () => download(crm, 'nothing/template'), 404);

  // --- Import of a file written by openpyxl.
  const fx = readFileSync(new URL('./fixtures/clients_openpyxl.xlsx', import.meta.url));
  await expectStatus('import needs crm.create', () => upload(crmView, 'clients/import', 'c.xlsx', fx), 403);
  const before = Number(one(`select count(*) from clients where org_id = ${ADMIN.org_id}`));
  const dry = must(await upload(crm, 'clients/import', 'clients.xlsx', fx, true), 'dry run');
  check('dry run of the openpyxl file: Arabic and English headers matched, empty row skipped, 3 rows accepted, unknown column named, nothing saved',
    dry.rows === 3 && dry.accepted === 3 && dry.errors.length === 0 && JSON.stringify(dry.unknown_columns) === '["unknown col"]' && dry.saved === false && dry.file_sha256 === sha(fx)
      && Number(one(`select count(*) from clients where org_id = ${ADMIN.org_id}`)) === before, JSON.stringify(dry));
  const imp = must(await upload(crm, 'clients/import', 'clients.xlsx', fx), 'import');
  check('import saved: rows created with their values (a number in the tax id column kept as text)', imp.saved === true && imp.rows === 3
    && one(`select string_agg(client_name || ':' || client_type || ':' || coalesce(tax_id, '-'), ' | ' order by client_name) from clients where org_id = ${ADMIN.org_id} and client_name like '%(fixture)'`)
      === 'Cairo Municipality (fixture):government:- | Gulf Holding (fixture):private:AE-998877 | شركة الدلتا للتطوير (fixture):developer:100200300');
  check('import recorded with file name, SHA-256 and rows', one(`select entity || '|' || file_name || '|' || rows_count || '|' || (file_sha256 = '${sha(fx)}')::text from data_imports where id = ${imp.import_id}`) === 'clients|clients.xlsx|3|true');

  // --- All or nothing; every refused row named.
  const bad = makeXlsx([['client_name', 'client_type', 'email'], [`Good ${TAG}`, 'private', null], [`Bad type ${TAG}`, 'alien', null], ['X', 'private', 'not-an-email'], [`Good two ${TAG}`, null, `a.${TAG}@test.local`]]);
  const r422 = await upload(crm, 'clients/import', 'bad.xlsx', bad);
  const ers = r422.body?.details?.errors ?? [];
  check('a file with refused rows saves nothing and names each refused row and field', r422.status === 422 && r422.body.details.accepted === 2 && ers.map(x => x.row).join(',') === '3,4'
    && /client_type/.test(ers[0].error) && /client_name/.test(ers[1].error) && /email/.test(ers[1].error) && one(`select count(*) from clients where client_name = 'Good ${TAG}'`) === '0', JSON.stringify(r422.body).slice(0, 400));
  await expectStatus('a file that is not a workbook is refused', () => upload(crm, 'clients/import', 'x.xlsx', Buffer.from('hello, world')), 422);
  await expectStatus('a required column missing is refused', () => upload(crm, 'clients/import', 'x.xlsx', makeXlsx([['phone'], ['1']])), 422);
  await expectStatus('a sheet with no data rows is refused', () => upload(crm, 'clients/import', 'x.xlsx', makeXlsx([['client_name']])), 422);

  // --- Export.
  await expectStatus('export needs crm.export', () => download(crmView, 'clients/export'), 403);
  const ex = readSheet((await download(crm, 'clients/export')).buf);
  check('export holds the company\'s clients with the import columns (round trip)', ex[0].join(',') === tRows[0].join(',') && ex.some(r => r[0] === 'Gulf Holding (fixture)' && r[6] === 'AE-998877'));

  // --- Cost codes: parent before child, project codes, unknown references.
  const pcode = one(`select project_code from projects where org_id = ${ADMIN.org_id} order by id limit 1`);
  const ccFile = makeXlsx([['code', 'description', 'cost_type', 'unit_of_measure', 'parent_code', 'project_code'],
    [`X${TAG}`, 'Earthworks (fixture)', 'subcontract', null, null, null], [`X${TAG}.1`, 'Excavation (fixture)', 'subcontract', 'm3', `X${TAG}`, null], [`X${TAG}.P`, 'Project-only code (fixture)', 'material', 't', null, pcode]]);
  const ccImp = must(await upload(cc, 'cost_codes/import', 'cc.xlsx', ccFile), 'cost codes');
  check('cost codes imported: child linked to the parent above it, project code resolved', ccImp.rows === 3 && one(`select p.code from cost_codes c join cost_codes p on p.id = c.parent_code_id where c.code = 'X${TAG}.1'`) === `X${TAG}`
    && one(`select pr.project_code from cost_codes c join projects pr on pr.id = c.project_id where c.code = 'X${TAG}.P'`) === pcode);
  const ccBad = await upload(cc, 'cost_codes/import', 'cc2.xlsx', makeXlsx([['code', 'description', 'cost_type', 'parent_code', 'project_code'], [`Y${TAG}.1`, 'Child first', 'labor', `Y${TAG}`, null], [`Y${TAG}`, 'Parent', 'labor', null, null], [`Y${TAG}.2`, 'Bad project', 'labor', null, 'NO-SUCH']]), true);
  check('a child before its parent and an unknown project are named', ccBad.data.errors.length === 2 && /parent must come before/.test(ccBad.data.errors[0].error) && /Unknown project code NO-SUCH/.test(ccBad.data.errors[1].error), JSON.stringify(ccBad.data?.errors));

  // --- Bill of quantities into a project; export and read back.
  const proj = Number(one(`select id from projects where org_id = ${ADMIN.org_id} and project_code = '${pcode}'`));
  const proj2 = must(await api('POST', '/projects', admin, { project_code: `DX-${TAG}`, project_name: `Data exchange ${TAG}`, currency_id: Number(one(`select id from currencies where code = 'EGP' limit 1`)) }), 'project 2').id;
  const boqFile = makeXlsx([['رقم البند', 'Section', 'description', 'unit_of_measure', 'quantity', 'cost_code', 'unit_rate_material', 'unit_rate_labor', 'overhead_percent'],
    [`DX${TAG}-01`, 'Earthworks', 'Excavation in any soil (fixture)', 'm3', 1250.5, `X${TAG}.1`, 0, 85.25, 10], [`DX${TAG}-02`, 'Earthworks', 'Backfilling (fixture)', 'm3', '1,000', null, 12, 30, 10]]);
  await expectStatus('a bill of quantities import needs a project or a tender', () => upload(boq, 'boq/import', 'b.xlsx', boqFile), 400);
  const bImp = must(await upload(boq, `boq/import?project_id=${proj}`, 'boq.xlsx', boqFile), 'boq');
  check('BOQ rows imported into the project: numbers (also "1,000"), cost code resolved', bImp.rows === 2 && one(`select string_agg(b.item_no || ':' || b.quantity::text || ':' || coalesce(c.code, '-') || ':' || b.unit_rate_labor::text, ' ' order by b.item_no)
    from boq_master b left join cost_codes c on c.id = b.cost_code_id where b.project_id = ${proj} and b.item_no like 'DX${TAG}%'`) === `DX${TAG}-01:1250.500:X${TAG}.1:85.25 DX${TAG}-02:1000.000:-:30.00`);
  const bx = await download(boq, `boq/export?project_id=${proj}`);
  const back = must(await upload(boq, `boq/import?project_id=${proj2}`, 'back.xlsx', bx.buf, true), 'boq round trip');
  check('the BOQ export of the project reads back into another project (dry run, all rows accepted)', back.errors.length === 0 && back.accepted === back.rows && back.rows >= 2, JSON.stringify(back).slice(0, 300));
  await expectStatus('BOQ export needs boq.export', () => download(ven, `boq/export?project_id=${proj}`), 403);

  // --- Vendors: created through the governed path (with the created event).
  const vImp = must(await upload(ven, 'vendors/import', 'v.xlsx', makeXlsx([['vendor_name', 'vendor_type', 'trade_category'], [`Steel Supplier ${TAG}`, 'supplier', 'Rebar'], [`Finishes Sub ${TAG}`, 'subcontractor', 'Finishes']])), 'vendors');
  check('vendors imported with their created event (vendor rules apply)', vImp.rows === 2 && one(`select count(*) from vendor_status_events e join vendors_subcontractors v on v.id = e.vendor_id
    where v.vendor_name in ('Steel Supplier ${TAG}', 'Finishes Sub ${TAG}') and e.event = 'created'`) === '2');

  // --- History, permanence, isolation, audit.
  const hist = must(await api('GET', '/data-exchange/imports', crm), 'history');
  check('import history shows only record types the user may see', hist.length >= 1 && hist.every(h => h.entity === 'clients'));
  const ch = sql(OWNER, `update data_imports set rows_count = 9 where id = ${imp.import_id}`);
  check('import records are permanent (database)', !ch.ok && /permanent/.test(ch.out), ch.out.slice(0, 120));
  const adminB = await login(ADMIN_B);
  const exB = readSheet((await download(adminB, 'clients/export')).buf);
  check('another company\'s export holds none of these clients', !exB.some(r => String(r[0] ?? '').includes('(fixture)')));
  await expectStatus('another company cannot import into this company\'s project', () => upload(adminB, `boq/import?project_id=${proj}`, 'b.xlsx', boqFile, true), 404);
  check('imports are audited', Number(one(`select count(*) from audit_log where table_name = 'data_imports' and org_id = ${ADMIN.org_id}`)) >= 4);
} catch (e) {
  check('suite completed', false, e.message.slice(0, 300));
}
finish('sweep_data_exchange');
