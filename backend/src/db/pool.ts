import pg from 'pg';
import { env } from '../config/env.js';
import { currentDbContext } from './context.js';

// CC-004: pg returns int8 (bigint) as string by default. All ids are bigserial and the
// codebase compares them strictly against numbers (e.g. authenticate.ts org check), which
// made every authenticated request fail with 401. Ids stay far below 2^53, so parse to
// number; reject values that would lose precision rather than silently corrupt them.
pg.types.setTypeParser(20, (value: string) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error(`int8 value ${value} exceeds safe integer range`);
  return n;
});

// F-13: PostgreSQL DATE (oid 1082) is a calendar date with no time zone. node-pg's default turns it into a
// JS Date at *server-local* midnight, so on a server running in Africa/Cairo '2026-10-03' was returned as
// "2026-10-02T21:00:00.000Z" (one day early - fatal for contractual time bars). Keep it as 'YYYY-MM-DD'.
pg.types.setTypeParser(1082, (value: string) => value);

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000
});

async function applyContext(client: pg.PoolClient) {
  const ctx = currentDbContext();
  await client.query('select set_config($1, $2, false)', ['app.org_id', ctx.orgId ? String(ctx.orgId) : '']);
  await client.query('select set_config($1, $2, false)', ['app.user_id', ctx.userId ? String(ctx.userId) : '']);
  await client.query('select set_config($1, $2, false)', ['app.auth_mode', ctx.mode ?? '']);
}

async function clearContext(client: pg.PoolClient) {
  await client.query("reset app.org_id").catch(() => undefined);
  await client.query("reset app.user_id").catch(() => undefined);
  await client.query("reset app.auth_mode").catch(() => undefined);
}

export async function query<T = unknown>(text: string, params: unknown[] = []): Promise<T[]> {
  const client = await pool.connect();
  try {
    await applyContext(client);
    const result = await client.query(text, params);
    return result.rows as T[];
  } finally {
    await clearContext(client);
    client.release();
  }
}

export async function getClient() {
  const client = await pool.connect();
  try {
    await applyContext(client);
  } catch (error) {
    client.release();
    throw error;
  }
  return client;
}

export async function releaseClient(client: pg.PoolClient) {
  await clearContext(client);
  client.release();
}
