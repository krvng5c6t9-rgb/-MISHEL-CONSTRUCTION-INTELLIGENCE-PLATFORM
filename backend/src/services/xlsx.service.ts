import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { ScheduleError, parseXml } from '../modules/planning/scheduleEngine.js';

// CC-098 (Stage 69): Office Open XML spreadsheets (.xlsx) written and read without a third-party library. An .xlsx
// file is a ZIP archive of XML parts (ECMA-376). Writing: one or more sheets of text / number cells, the first row
// bold and frozen. Reading: the first sheet (or a sheet by name), shared strings, inline strings, numbers and booleans;
// formulas are read by their cached value. Limits guard against oversized or hostile archives.

export type Cell = string | number | null | undefined;
export interface Sheet { name: string; rows: Cell[][]; widths?: number[] }

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b: Buffer) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function zip(files: { name: string; data: Buffer }[]): Buffer {
  const parts: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8'), comp = deflateRawSync(f.data), crc = crc32(f.data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8); h.writeUInt32LE(0, 10);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(f.data.length, 22); h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
    parts.push(h, name, comp);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10); c.writeUInt32LE(0, 12);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(f.data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, name); offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, e]);
}

const MAX_ENTRY = 50 * 1024 * 1024, MAX_ENTRIES = 2000;
function unzip(buf: Buffer): Map<string, Buffer> {
  let e = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new ScheduleError('Not an Excel workbook (.xlsx)');
  const count = buf.readUInt16LE(e + 10), cdOff = buf.readUInt32LE(e + 16), out = new Map<string, Buffer>();
  if (count > MAX_ENTRIES) throw new ScheduleError('The workbook has too many parts');
  let p = cdOff;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new ScheduleError('The workbook archive is damaged');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl); p += 46 + nl + xl + cl;
    if (usize > MAX_ENTRY) throw new ScheduleError('A part of the workbook is too large');
    const lnl = buf.readUInt16LE(lo + 26), lxl = buf.readUInt16LE(lo + 28), start = lo + 30 + lnl + lxl, data = buf.subarray(start, start + csize);
    if (method === 0) out.set(name, Buffer.from(data));
    else if (method === 8) out.set(name, inflateRawSync(data, { maxOutputLength: MAX_ENTRY }));
    else throw new ScheduleError('The workbook uses an unsupported compression method');
  }
  return out;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const colName = (i: number) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const colIndex = (ref: string) => { const m = /^([A-Z]+)/.exec(ref); if (!m) return -1; let n = 0; for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

export function writeXlsx(sheets: Sheet[]): Buffer {
  const strings: string[] = [], index = new Map<string, number>();
  const si = (s: string) => { let i = index.get(s); if (i === undefined) { i = strings.length; strings.push(s); index.set(s, i); } return i; };
  const sheetXml = sheets.map(sh => {
    const rows = sh.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
      if (v === null || v === undefined || v === '') return '';
      const ref = `${colName(ci)}${ri + 1}`, st = ri === 0 ? ' s="1"' : '';
      return typeof v === 'number' && Number.isFinite(v) ? `<c r="${ref}"${st}><v>${v}</v></c>` : `<c r="${ref}" t="s"${st}><v>${si(String(v))}</v></c>`;
    }).join('')}</row>`).join('');
    const cols = sh.widths?.length ? `<cols>${sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${rows}</sheetData></worksheet>`;
  });
  const enc = (s: string) => Buffer.from(s, 'utf8');
  const files = [
    { name: '[Content_Types].xml', data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`) },
    { name: '_rels/.rels', data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: 'xl/workbook.xml', data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`) },
    { name: 'xl/styles.xml', data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`) },
    ...sheetXml.map((x, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc(x) }))
  ];
  files.push({ name: 'xl/sharedStrings.xml', data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map(s => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`) });
  return zip(files);
}

type XN = ReturnType<typeof parseXml>;
const all = (n: XN, name: string, out: XN[] = []): XN[] => { for (const c of n.children) { if (c.name === name) out.push(c); all(c, name, out); } return out; };
const textOf = (n: XN): string => n.text + n.children.map(c => c.name === 'rPh' ? '' : textOf(c)).join('');
const attr = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<(?:\\w+:)?${tag}\\b([^>]*)>`, 'g'))].map(m => Object.fromEntries([...m[1].matchAll(/([\w:]+)="([^"]*)"/g)].map(a => [a[1], a[2]])));

// Reads a sheet as rows of text / numbers (empty cells as null). The first sheet unless a name is given.
export function readXlsx(buf: Buffer, sheetName?: string, maxRows = 20000): Cell[][] {
  const parts = unzip(buf), text = (n: string) => parts.get(n)?.toString('utf8');
  const wb = text('xl/workbook.xml'); if (!wb) throw new ScheduleError('Not an Excel workbook (.xlsx)');
  const sheets = attr(wb, 'sheet'), rels = attr(text('xl/_rels/workbook.xml.rels') ?? '', 'Relationship');
  const sh = sheetName ? sheets.find(s => s.name === sheetName) : sheets[0];
  if (!sh) throw new ScheduleError(`The workbook has no sheet ${sheetName ?? ''}`.trim());
  const target = rels.find(r => r.Id === sh['r:id'])?.Target; if (!target) throw new ScheduleError('The workbook archive is damaged');
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  const ss = text('xl/sharedStrings.xml'), shared = ss ? all(parseXml(ss), 'si').map(textOf) : [];
  const xml = text(path); if (!xml) throw new ScheduleError('The workbook archive is damaged');
  const rows: Cell[][] = [];
  // Row / cell references and types read from the raw XML; text values decoded by the XML reader.
  const rowRe = /<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g, cellRe = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
  let m: RegExpExecArray | null, next = 1;
  while ((m = rowRe.exec(xml))) {
    const rn = Number(/\br="(\d+)"/.exec(m[1])?.[1] ?? next); next = rn + 1;
    if (rn > maxRows + 1) throw new ScheduleError(`The sheet has more than ${maxRows} rows`);
    const out: Cell[] = []; let cm: RegExpExecArray | null, col = 0;
    cellRe.lastIndex = 0; const body = m[2] ?? '';
    while ((cm = cellRe.exec(body))) {
      const ref = /\br="([A-Z]+\d+)"/.exec(cm[1])?.[1], t = /\bt="(\w+)"/.exec(cm[1])?.[1] ?? 'n';
      const ci = ref ? colIndex(ref) : col; col = ci + 1;
      if (ci > 500) continue;
      const inner = cm[2] ?? '', v = /<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(inner)?.[1];
      let val: Cell = null;
      if (t === 's') val = v !== undefined ? shared[Number(v)] ?? null : null;
      else if (t === 'inlineStr') val = textOf(parseXml(`<x>${inner}</x>`));
      else if (t === 'str') val = v !== undefined ? textOf(parseXml(`<x>${v}</x>`)) : null;
      else if (t === 'b') val = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : null;
      else if (t === 'e') val = null;
      else val = v !== undefined && v !== '' ? Number(v) : null;
      out[ci] = val;
    }
    rows[rn - 1] = out;
  }
  return Array.from(rows, r => r ?? []);
}
