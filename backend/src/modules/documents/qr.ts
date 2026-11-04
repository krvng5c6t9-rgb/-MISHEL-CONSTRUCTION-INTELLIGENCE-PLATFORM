import QRCode from 'qrcode';

// CC-089 (F-64, MP-03 §5): the QR code printed on every exported document. It encodes a short versioned text, not a
// link: "MARC-DOC/1?" followed by URL-encoded fields (export number, company, document type, record, document number,
// status, draft mark and, on financial documents, the key amount and currency as stored). A reader with access to MARC
// passes the scanned text to POST /documents/verify, which compares it with the export entry (where the same text is
// recorded) and with the record as it is now. The SHA-256 of the file cannot be in the code (the code is part of the
// file); it stays in the export entry.
export const QR_PREFIX = 'MARC-DOC/1?';
export const CLASSES = ['public', 'internal', 'confidential', 'restricted'] as const;
export type Classification = typeof CLASSES[number];

export type QrFields = { exp: number; org: number; type: string; rec: number; no: string; status: string; draft: boolean; amount?: string | null; cur?: string | null; cls?: Classification | null };

export function qrPayload(f: QrFields): string {
  const p = new URLSearchParams();
  p.set('exp', String(f.exp)); p.set('org', String(f.org)); p.set('type', f.type); p.set('rec', String(f.rec)); p.set('no', f.no);
  p.set('status', f.status); p.set('draft', f.draft ? '1' : '0');
  if (f.amount != null && f.cur) { p.set('amount', f.amount); p.set('cur', f.cur); }
  if (f.cls) p.set('class', f.cls);
  return QR_PREFIX + p.toString();
}

// Returns null when the text is not a MARC document code (or carries no valid export number).
export function parseQrPayload(text: string): Record<string, string> | null {
  if (typeof text !== 'string' || !text.startsWith(QR_PREFIX) || text.length > 600) return null;
  const p = new URLSearchParams(text.slice(QR_PREFIX.length));
  const out: Record<string, string> = {};
  for (const [k, v] of p) out[k] = v;
  return /^\d+$/.test(out.exp ?? '') && /^\d+$/.test(out.org ?? '') ? out : null;
}

// Inline SVG (no image host, no font): error correction M, 2-module quiet zone; drawn black on white.
export const qrSvg = async (payload: string): Promise<string> =>
  (await QRCode.toString(payload, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#000000', light: '#ffffff' } })).trim();
