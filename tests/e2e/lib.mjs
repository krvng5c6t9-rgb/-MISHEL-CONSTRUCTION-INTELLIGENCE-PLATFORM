// Minimal HTTP helper for runtime E2E evidence. All monetary values and DOA thresholds
// used by these tests are TEST FIXTURES, not owner-approved business values.
export const BASE = process.env.API_BASE ?? 'http://localhost:4000/api';
export const log = [];
export async function api(method, path, token, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json; try { json = await res.json(); } catch { json = null; }
  log.push({ method, path, status: res.status, ok: res.ok, error: json?.error ?? null });
  return { status: res.status, ok: res.ok, data: json?.data, body: json };
}
export function must(r, label) {
  if (!r.ok) throw new Error(`${label} failed: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 400)}`);
  return r.data;
}
