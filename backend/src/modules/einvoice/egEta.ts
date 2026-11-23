// CC-096 (Stage 67): Egypt Tax Authority (ETA) e-invoice adapter, document type "I", version "1.0". The document
// structure, the canonical serialization signed by the company and the API calls follow the ETA specification as
// implemented by the open-source Odoo Community module l10n_eg_edi_eta (LGPL-3; read as a reference, no code copied)
// - the official SDK site sdk.invoicing.eta.gov.eg could not be reached from the build environment, so the first live
// submission must be made against the authority's pre-production system before production use.
// Amounts are the IPC's stored output-tax base and tax (tax engine, migration 074); nothing is recomputed here except
// the total (base + tax), which the database returns.

export type Missing = string[];

// ETA canonical form: each key upper-cased and quoted, each value quoted as text; nested objects flattened in order;
// an array writes its key once, then the key again before each element.
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(String(value));
  if (Array.isArray(value)) return JSON.stringify(String(value));
  let out = '';
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const key = JSON.stringify(k).toUpperCase();
    if (Array.isArray(v)) {
      out += key;
      for (const el of v) out += key + canonical(el);
    } else if (v !== null && typeof v === 'object') {
      out += key + canonical(v);
    } else {
      out += key + canonical(v);
    }
  }
  return out;
}

const num = (s: string) => Number(s); // database text with 2 decimals -> JSON number (no arithmetic)

export interface EtaInputs {
  profile: { issuer: any; defaults: any; client_id: string | null; secret_last4: string | null; signer_url: string | null; environment: string };
  ipc: { ipc_no: string; project_code: string; project_name: string; currency: string; base: string; tax: string; total: string; tax_type: string | null; sub_type: string | null; rate: string | null; tax_treatment: string | null };
  client: { client_name: string; tax_id: string | null; party_type: string | null; address: any };
  issuedAt: string; // YYYY-MM-DDTHH:MM:SSZ (UTC)
}

// Lists what the company still has to enter before this IPC can be invoiced electronically.
export function missingFor(i: EtaInputs): Missing {
  const m: Missing = [], is = i.profile.issuer ?? {}, ad = is.address ?? {}, df = i.profile.defaults ?? {}, ca = i.client.address ?? {};
  for (const [k, v] of [['issuer.rin', is.rin], ['issuer.name', is.name], ['issuer.activity_code', is.activity_code], ['issuer.branch_id', is.branch_id],
    ['issuer.address.governate', ad.governate], ['issuer.address.region_city', ad.region_city], ['issuer.address.street', ad.street], ['issuer.address.building_number', ad.building_number],
    ['defaults.item_type', df.item_type], ['defaults.item_code', df.item_code], ['defaults.unit_type', df.unit_type]] as [string, unknown][]) if (!v) m.push(k);
  if (!i.profile.client_id || !i.profile.secret_last4) m.push('credentials');
  if (!i.profile.signer_url) m.push('signer_url');
  if (i.ipc.tax_treatment !== 'computed') m.push('ipc.output_tax (no tax profile on the contract)');
  else if (!i.ipc.tax_type || !i.ipc.sub_type) m.push('tax_code.einvoice_tax_type / einvoice_sub_type');
  if (i.ipc.currency !== 'EGP') m.push('currency (only EGP invoices are supported in this version)');
  if (!i.client.party_type) m.push('client.einvoice_party_type');
  if (i.client.party_type === 'business' && !i.client.tax_id) m.push('client.tax_id');
  if (i.client.party_type && i.client.party_type !== 'person') for (const [k, v] of [['country', ca.country], ['governate', ca.governate], ['region_city', ca.region_city], ['street', ca.street], ['building_number', ca.building_number]])
    if (!v) m.push(`client.address.${k}`);
  return m;
}

const address = (a: any, branch?: string) => ({ ...(branch !== undefined ? { branchID: String(branch) } : {}), country: String(a.country ?? 'EG'), governate: String(a.governate ?? ''),
  regionCity: String(a.region_city ?? ''), street: String(a.street ?? ''), buildingNumber: String(a.building_number ?? ''), ...(a.postal_code ? { postalCode: String(a.postal_code) } : {}) });
const PARTY: Record<string, string> = { business: 'B', person: 'P', foreign: 'F' };

export function buildDocument(i: EtaInputs) {
  const is = i.profile.issuer, df = i.profile.defaults, base = num(i.ipc.base), tax = num(i.ipc.tax), total = num(i.ipc.total);
  const internalId = `${i.ipc.project_code}-IPC-${i.ipc.ipc_no}`;
  const taxable = { taxType: i.ipc.tax_type, amount: tax, subType: i.ipc.sub_type, rate: num(i.ipc.rate ?? '0') };
  const doc = {
    issuer: { address: address(is.address, is.branch_id), type: 'B', id: String(is.rin), name: String(is.name) },
    receiver: { address: i.client.party_type === 'person' && !i.client.address ? { country: 'EG', governate: '', regionCity: '', street: '', buildingNumber: '' } : address(i.client.address ?? {}),
      type: PARTY[i.client.party_type ?? ''], ...(i.client.tax_id ? { id: String(i.client.tax_id) } : {}), name: i.client.client_name },
    documentType: 'I',
    documentTypeVersion: '1.0',
    dateTimeIssued: i.issuedAt,
    taxpayerActivityCode: String(is.activity_code),
    internalID: internalId,
    invoiceLines: [{
      description: `${df.description ?? 'Construction works'} - IPC ${i.ipc.ipc_no} - ${i.ipc.project_name}`,
      itemType: String(df.item_type), itemCode: String(df.item_code), unitType: String(df.unit_type), quantity: 1, internalCode: `IPC-${i.ipc.ipc_no}`,
      salesTotal: base, total, valueDifference: 0, totalTaxableFees: 0, netTotal: base, itemsDiscount: 0,
      unitValue: { currencySold: 'EGP', amountEGP: base },
      discount: { rate: 0, amount: 0 },
      taxableItems: [taxable]
    }],
    totalDiscountAmount: 0,
    totalSalesAmount: base,
    netAmount: base,
    taxTotals: [{ taxType: i.ipc.tax_type, amount: tax }],
    totalAmount: total,
    extraDiscountAmount: 0,
    totalItemsDiscountAmount: 0
  };
  return { internalId, doc };
}

// Hosts of the authority (pre-production for "test"); overridable for a company gateway or the gate's mock.
export const hosts = (environment: string) => ({
  id: process.env.EINVOICE_EG_ID_HOST || (environment === 'production' ? 'https://id.eta.gov.eg' : 'https://id.preprod.eta.gov.eg'),
  api: process.env.EINVOICE_EG_API_HOST || (environment === 'production' ? 'https://api.invoicing.eta.gov.eg' : 'https://api.preprod.invoicing.eta.gov.eg')
});

async function json(res: Response) { const t = await res.text(); try { return t ? JSON.parse(t) : {}; } catch { return { raw: t.slice(0, 500) }; } }

export async function token(environment: string, clientId: string, secret: string): Promise<string> {
  const res = await fetch(`${hosts(environment).id}/connect/token`, { method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
  const j = await json(res);
  if (!res.ok || !j.access_token) throw Object.assign(new Error('The tax authority refused the company credentials'), { status: res.status, body: j });
  return j.access_token;
}

// The company's signing service signs the canonical form (CAdES-BES with the company's certificate) and returns it.
export async function sign(signerUrl: string, canonicalText: string, sha256: string): Promise<string> {
  const res = await fetch(signerUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scheme: 'eg_eta', canonical: canonicalText, sha256 }) });
  const j = await json(res);
  if (!res.ok || typeof j.signature !== 'string' || !j.signature) throw Object.assign(new Error('The company signing service did not return a signature'), { status: res.status, body: j });
  return j.signature;
}

export async function submit(environment: string, accessToken: string, signedDoc: unknown) {
  const res = await fetch(`${hosts(environment).api}/api/v1.0/documentsubmissions`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ documents: [signedDoc] }) });
  return { ok: res.ok, status: res.status, body: await json(res) };
}

export async function submissionStatus(environment: string, accessToken: string, submissionId: string) {
  const res = await fetch(`${hosts(environment).api}/api/v1.0/documentsubmissions/${encodeURIComponent(submissionId)}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  return { ok: res.ok, status: res.status, body: await json(res) };
}
