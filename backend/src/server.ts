import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { apiRouter } from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';

const app = express();

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(express.json({ limit: '2mb' }));

app.use('/api', apiRouter);
app.use(notFoundHandler);
app.use(errorHandler);

async function assertRlsEnforced() {
  // Superusers and BYPASSRLS roles ignore row-level security, which would disable tenant isolation.
  const { rows } = await pool.query<{ bypass: boolean }>(
    'select (rolsuper or rolbypassrls) as bypass from pg_roles where rolname = current_user'
  );
  if (rows[0]?.bypass) {
    const message = 'Database role bypasses row-level security; tenant isolation would not be enforced.';
    if (env.NODE_ENV === 'production') throw new Error(message);
    console.warn(`WARNING: ${message}`);
  }
}

await assertRlsEnforced();

const server = app.listen(env.PORT, () => {
  console.log(`Construction ERP backend listening on port ${env.PORT}`);
});

process.on('SIGTERM', async () => {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
});
