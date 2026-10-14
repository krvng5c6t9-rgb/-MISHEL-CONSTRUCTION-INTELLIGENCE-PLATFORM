import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { apiRouter } from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';

const app = express();
// G-017: req.ip is the client address only when the proxy hop count is configured (0 = use the socket address).
if (env.TRUST_PROXY > 0) app.set('trust proxy', env.TRUST_PROXY);

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

// Stage 32 / DEC-015: production never runs without multi-factor sign-in for privileged users, and keeps the TOTP
// secrets under their own key.
if (env.NODE_ENV === 'production' && env.MFA_ENFORCEMENT !== 'required') throw new Error('MFA_ENFORCEMENT must be required in production (DEC-015)');
if (env.NODE_ENV === 'production' && !env.MFA_ENCRYPTION_KEY) throw new Error('MFA_ENCRYPTION_KEY is required in production');

const server = app.listen(env.PORT, () => {
  console.log(`Construction ERP backend listening on port ${env.PORT}`);
});

process.on('SIGTERM', async () => {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
});
