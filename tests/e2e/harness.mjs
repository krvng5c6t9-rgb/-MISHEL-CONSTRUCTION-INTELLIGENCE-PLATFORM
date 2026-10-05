// Shared step recorder for runtime suites written after R0 (chain.mjs keeps its own copy unchanged).
// All amounts, DOA confirmations and permission grants made by suites are TEST FIXTURES.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { api, must, log } from './lib.mjs';

export const RUN = process.env.RUN_ID ?? String(Date.now()).slice(-6);
export const TAG = /^[A-Za-z0-9]{1,8}$/.test(RUN) ? RUN : createHash('sha256').update(RUN).digest('hex').slice(0, 8);
export const ADMIN = { email: process.env.ADMIN_EMAIL ?? 'admin.a@test.local', password: process.env.ADMIN_PASSWORD ?? 'Passw0rd!A', org_id: Number(process.env.ORG_ID ?? 1) };
export const ADMIN_B = { email: 'admin.b@test.local', password: 'Passw0rd!B', org_id: 2 };
export const steps = [];

export function step(name, outcome, detail = '') { steps.push({ name, outcome, detail }); console.log(`${outcome.padEnd(5)} ${name}${detail ? ' :: ' + detail : ''}`); }
export async function run(name, fn) { try { const v = await fn(); step(name, 'PASS'); return v; } catch (e) { step(name, 'FAIL', e.message.slice(0, 300)); throw e; } }
export function check(name, cond, detail = '') { step(name, cond ? 'PASS' : 'FAIL', detail); return cond; }
// Negative test: must be rejected with exactly `status` (a different 4xx is a FAIL, not a WARN, in post-R0 suites).
export async function expectStatus(name, fn, status) {
  const r = await fn();
  step(name, r.status === status ? 'PASS' : 'FAIL', `HTTP ${r.status} ${JSON.stringify(r.body?.error ?? '').slice(0, 160)}`);
  return r;
}
export const login = async (u) => must(await api('POST', '/auth/login', null, { email: u.email, password: u.password, org_id: u.org_id }), `login ${u.email}`).token;
export function sql(url, text) {
  if (!url) throw new Error('database URL for SQL probe not set');
  try { return { ok: true, out: execFileSync('psql', [url, '-At', '-v', 'ON_ERROR_STOP=1', '-c', text], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim() }; }
  catch (e) { return { ok: false, out: String(e.stderr ?? e.message) }; }
}
export function finish(suite, extra = {}) {
  const out = { suite, run: RUN, tag: TAG, steps, http: log, ...extra };
  writeFileSync(new URL(`./out/${suite}_${RUN}.json`, import.meta.url), JSON.stringify(out, null, 2));
  const fail = steps.filter(s => s.outcome !== 'PASS').length;
  console.log(`\nSUMMARY ${suite} PASS=${steps.length - fail} FAIL=${fail}`);
  process.exitCode = fail ? 1 : 0;
}
export { api, must };
