// CC-095 (Stage 66): a local stand-in for the Anthropic Messages API, used only by the gate so that no real key or
// paid request is needed. POST /v1/messages answers like the API: by default a study that matches the structured
// output schema, whose quotes are lines copied from the submitted documents; a document containing MOCK_REFUSE gets
// stop_reason "refusal"; MOCK_FAKE_QUOTE gets one quote that is not in the documents; a key ending in "0000" gets 401
// (the key is read from x-api-key or from Authorization: Bearer, which SDK 1.x uses).
// GET /__requests returns what was received (headers and body) so the suite can check what the server sent.
import http from 'node:http';

const port = Number(process.env.MOCK_ANTHROPIC_PORT ?? 4130);
const received = [];

function study(docs) {
  const lines = docs.split('\n').map(l => l.trim()).filter(l => l.length > 8);
  const q = (i) => lines[i % lines.length];
  const fake = docs.includes('MOCK_FAKE_QUOTE');
  return {
    summary: 'Study of the submitted tender documents (mock).',
    boq_items: [{ item_ref: '1', description: q(0), unit: 'm3', quantity: '', observation: 'Quantity to be confirmed against drawings.', risk_level: 'medium', quote: q(0) }],
    missing_information: [{ title: 'Soil report', detail: 'No soil investigation report is listed.', quote: q(1) }],
    clarification_questions: [{ question: 'Is dewatering included?', reason: 'Not stated.', quote: q(2) }],
    risks: [{ title: 'Delay damages', severity: 'high', description: 'Delay damages apply.', mitigation: 'Price float.', quote: fake ? 'This sentence is not in the documents at all.' : q(3) }],
    contract_conditions: [{ title: 'Retention', detail: 'Retention is deducted.', quote: q(4) }],
    pricing_notes: [{ title: 'Concrete', detail: 'Obtain supplier quotations.', quote: q(0) }],
    recommendation: { decision: 'needs_more_information', reasons: ['Soil report missing.'] }
  };
}

http.createServer((req, res) => {
  let body = '';
  req.on('data', d => { body += d; });
  req.on('end', () => {
    if (req.method === 'GET' && req.url === '/__requests') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(received)); }
    if (req.method !== 'POST' || !req.url.startsWith('/v1/messages')) { res.writeHead(404); return res.end(); }
    const json = JSON.parse(body || '{}');
    // The key arrives as x-api-key or, with SDK 1.x, as Authorization: Bearer <key>.
    const key = String(req.headers['x-api-key'] ?? String(req.headers['authorization'] ?? '').replace(/^Bearer /, ''));
    received.push({ url: req.url, headers: { 'anthropic-beta': req.headers['anthropic-beta'] ?? null, 'x-api-key-last4': key.slice(-4) }, body: json });
    if (key.endsWith('0000')) {
      res.writeHead(401, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
    }
    const text = (json.messages?.[0]?.content ?? '');
    const docs = (/<documents>\n([\s\S]*)\n<\/documents>/.exec(typeof text === 'string' ? text : '') ?? [])[1] ?? '';
    const refuse = docs.includes('MOCK_REFUSE');
    const msg = { id: `msg_mock_${received.length}`, type: 'message', role: 'assistant', model: json.model,
      content: refuse ? [] : [{ type: 'text', text: JSON.stringify(study(docs)) }],
      stop_reason: refuse ? 'refusal' : 'end_turn', stop_sequence: null,
      ...(refuse ? { stop_details: { type: 'refusal', category: null, explanation: 'mock refusal' } } : {}),
      usage: { input_tokens: 1200 + docs.length, output_tokens: 640 } };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(msg));
  });
}).listen(port, () => console.log(`MOCK_ANTHROPIC ${port}`));
