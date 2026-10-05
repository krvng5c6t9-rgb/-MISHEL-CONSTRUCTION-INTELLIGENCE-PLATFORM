import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import dotenv from 'dotenv';

// CC-012: the migrator needs only database settings; importing the API env schema made it
// demand JWT_SECRET/BOOTSTRAP_ADMIN_TOKEN, which a migration job should never hold.
dotenv.config();

const migrationsDir = path.resolve(process.env.MIGRATIONS_DIR ?? '../database/migrations');
// Migrations run as a dedicated owner role; the application should use a separate
// least-privilege role (APP_DB_ROLE) so that forced row-level security applies to it.
const connectionString = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL is required');
const client = new pg.Client({ connectionString });
const appRole = process.env.APP_DB_ROLE;

async function assertMigratorCanSeeAllRows() {
  // Tables use FORCE ROW LEVEL SECURITY; a migrator without BYPASSRLS sees zero rows in
  // tenant tables, so data backfills and cleanups would silently do nothing.
  const { rows } = await client.query<{ ok: boolean }>(
    'select (rolsuper or rolbypassrls) as ok from pg_roles where rolname = current_user'
  );
  if (!rows[0]?.ok) {
    throw new Error('Migration role must have BYPASSRLS (or be superuser); otherwise data migrations silently skip tenant rows.');
  }
}

async function grantAppRole(role: string) {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error(`Invalid APP_DB_ROLE: ${role}`);
  const { rows } = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
    'select rolsuper, rolbypassrls from pg_roles where rolname = $1', [role]
  );
  if (!rows[0]) throw new Error(`APP_DB_ROLE ${role} does not exist`);
  if (rows[0].rolsuper || rows[0].rolbypassrls) throw new Error(`APP_DB_ROLE ${role} must not be superuser or BYPASSRLS`);
  for (const stmt of [
    `grant usage on schema public to ${role}`,
    `grant select, insert, update, delete on all tables in schema public to ${role}`,
    `grant usage, select on all sequences in schema public to ${role}`,
    `grant execute on all functions in schema public to ${role}`,
    `alter default privileges in schema public grant select, insert, update, delete on tables to ${role}`,
    `alter default privileges in schema public grant usage, select on sequences to ${role}`,
    `alter default privileges in schema public grant execute on functions to ${role}`
  ]) await client.query(stmt);
  process.stdout.write(`GRANTED ${role}\n`);
}

function checksum(sql: string) {
  return crypto.createHash('sha256').update(sql).digest('hex');
}

async function main() {
  await client.connect();
  try {
    await assertMigratorCanSeeAllRows();
    await client.query(`
      create table if not exists schema_migrations (
        filename text primary key,
        checksum char(64) not null,
        applied_at timestamptz not null default now()
      )
    `);

    const files = (await fs.readdir(migrationsDir))
      .filter(f => /^\d{3}_.+\.sql$/.test(f))
      .sort();
    if (!files.length) throw new Error(`No migrations found in ${migrationsDir}`);

    const existing = await client.query<{ filename:string; checksum:string }>(
      'select filename,checksum from schema_migrations order by filename'
    );
    const applied = new Map(existing.rows.map(r => [r.filename, r.checksum]));

    // Refuse to guess on an already-populated legacy database without migration history.
    if (applied.size === 0) {
      const legacy = await client.query<{ exists:boolean }>(
        "select to_regclass('public.organizations') is not null as exists"
      );
      if (legacy.rows[0]?.exists) {
        throw new Error('Database contains ERP schema but schema_migrations is empty. Refusing unsafe automatic baseline. Use a clean database or perform an explicit DBA baseline.');
      }
    }

    for (const filename of files) {
      const sql = await fs.readFile(path.join(migrationsDir, filename), 'utf8');
      const hash = checksum(sql);
      const previous = applied.get(filename);
      if (previous) {
        if (previous !== hash) throw new Error(`Applied migration checksum mismatch: ${filename}`);
        process.stdout.write(`SKIP ${filename}\n`);
        continue;
      }

      process.stdout.write(`APPLY ${filename}\n`);
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query(
          'insert into schema_migrations(filename,checksum) values($1,$2)',
          [filename, hash]
        );
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    }

    if (appRole) await grantAppRole(appRole);
    process.stdout.write(`MIGRATIONS_OK ${files.length}\n`);
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error('MIGRATION_FAILURE', error instanceof Error ? error.message : error);
  process.exit(1);
});
