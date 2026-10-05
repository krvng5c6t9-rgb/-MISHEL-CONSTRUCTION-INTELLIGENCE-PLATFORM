import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  BOOTSTRAP_ADMIN_TOKEN: z.string().min(32, 'BOOTSTRAP_ADMIN_TOKEN must be at least 32 characters'),
  // F-08/G-006: the global bootstrap token may create a tenant only on first run (no user exists in any
  // organization). Creating further tenants with it must be enabled explicitly; the SaaS commercial
  // provisioning model is an owner decision (DEC-010) and does not use this token.
  ALLOW_MULTI_TENANT_BOOTSTRAP: z.enum(['true', 'false']).default('false').transform(v => v === 'true')
});

export const env = envSchema.parse(process.env);
