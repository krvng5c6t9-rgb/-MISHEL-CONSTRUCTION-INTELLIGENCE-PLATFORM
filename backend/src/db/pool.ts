import pg from 'pg';
import { env } from '../config/env.js';
import { currentDbContext } from './context.js';

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
