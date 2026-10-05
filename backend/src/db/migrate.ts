import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import { env } from '../config/env.js';

const migrationsDir = path.resolve(process.env.MIGRATIONS_DIR ?? '../database/migrations');
const client = new pg.Client({ connectionString: env.DATABASE_URL });

function checksum(sql: string) {
  return crypto.createHash('sha256').update(sql).digest('hex');
}

async function main() {
  await client.connect();
  try {
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

    process.stdout.write(`MIGRATIONS_OK ${files.length}\n`);
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error('MIGRATION_FAILURE', error instanceof Error ? error.message : error);
  process.exit(1);
});
