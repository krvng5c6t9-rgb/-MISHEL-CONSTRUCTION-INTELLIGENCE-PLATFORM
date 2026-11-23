// CC-096 (Stage 67): a local stand-in for the Egyptian Tax Authority e-invoicing API and for a company signing service,
// used only by the gate. Token (client credentials; a secret ending in "0000" is refused), document submission (a
// receiver whose name contains REJECT is rejected), submission status (INVALID in the receiver name -> Invalid, else
// Valid) and /sign (returns a signature over the SHA-256 it is given, after checking it against the canonical text).
// On submission the mock re-computes the canonical form of the received document with its own implementation of the
// ETA rule and checks that it is exactly what was signed. GET /__received lists what arrived.
import http from 'node:http';
import { createHash } from 'node:crypto';

const port = Number(process.env.MOCK_ETA_PORT ?? 4140);
const received = [];
const signed = new Map(); // sha256 -> signature
let n = 0;

// Independent implementation of the ETA canonical form (keys upper-cased and quoted; values quoted; arrays: key once,
// then key + element for each element).
function serialize(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return JSON.stringify(String(v));
  return Object.keys(v).map(k => {
    const K = JSON.stringify(k).toUpperCase(), x = v[k];
    return Array.isArray(x) ? K + x.map(e => K + serialize(e)).join('') : K + serialize(x);
  }).join('');
}
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

http.createServer((req, res) => {
  let body = '';
  req.on('data', d => { body += d; });
  req.on('end', () => {
    const url = req.url ?? '';
    if (req.method === 'GET' && url === '/__received') return send(res, 200, received);
    received.push({ method: req.method, url, auth: (req.headers.authorization ?? '').split(' ')[0], body: body.slice(0, 20000) });
    if (req.method === 'POST' && url === '/connect/token') {
      const [id, secret] = Buffer.from((req.headers.authorization ?? '').replace(/^Basic /, ''), 'base64').toString().split(':');
      if (!id || !secret || secret.endsWith('0000') || !/grant_type=client_credentials/.test(body)) return send(res, 400, { error: 'invalid_client' });
      return send(res, 200, { access_token: `tok-${id}`, token_type: 'Bearer', expires_in: 3600 });
    }
    if (req.method === 'POST' && url === '/sign') {
      const j = JSON.parse(body || '{}');
      if (!j.canonical || sha(j.canonical) !== j.sha256) return send(res, 400, { error: 'fingerprint mismatch' });
      const signature = Buffer.from(`MOCK-CADES-BES:${j.sha256}`).toString('base64');
      signed.set(j.sha256, signature);
      return send(res, 200, { signature });
    }
    if (req.method === 'POST' && url === '/api/v1.0/documentsubmissions') {
      if (!/^Bearer tok-/.test(req.headers.authorization ?? '')) return send(res, 401, { error: 'unauthorized' });
      const doc = JSON.parse(body || '{}').documents?.[0] ?? {};
      const { signatures, ...unsigned } = doc;
      const h = sha(serialize(unsigned));
      n += 1;
      const ok = signed.get(h) && signatures?.[0]?.signatureType === 'I' && signatures[0].value === signed.get(h);
      if (!ok) return send(res, 202, { submissionId: `SUB${n}`, acceptedDocuments: [], rejectedDocuments: [{ internalId: doc.internalID, error: { code: '4043', message: 'Signature does not match the document' } }] });
      if (String(doc.receiver?.name ?? '').includes('REJECT')) return send(res, 202, { submissionId: `SUB${n}`, acceptedDocuments: [], rejectedDocuments: [{ internalId: doc.internalID, error: { code: '4', message: 'Validation error' } }] });
      return send(res, 202, { submissionId: `SUB${n}`, acceptedDocuments: [{ uuid: `UUID${n}`, longId: `LONG${n}`, internalId: doc.internalID, hashKey: h }], rejectedDocuments: [] });
    }
    const m = /^\/api\/v1\.0\/documentsubmissions\/(SUB\d+)$/.exec(url);
    if (req.method === 'GET' && m) {
      const all = received.filter(r => r.method === 'POST' && r.url === '/api/v1.0/documentsubmissions');
      const doc = JSON.parse(all[Number(m[1].slice(3)) - 1]?.body || '{}').documents?.[0] ?? {};
      const invalid = String(doc.receiver?.name ?? '').includes('INVALID');
      return send(res, 200, { submissionId: m[1], overallStatus: invalid ? 'Invalid' : 'Valid', documentSummary: [{ uuid: `UUID${m[1].slice(3)}`, internalId: doc.internalID, status: invalid ? 'Invalid' : 'Valid' }] });
    }
    send(res, 404, { error: 'not found' });
  });
}).listen(port, () => console.log(`MOCK_ETA ${port}`));
