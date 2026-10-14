import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  // CC-037: optional previous signing key, accepted for verification only during a key rotation window.
  JWT_SECRET_PREVIOUS: z.string().min(32).optional(),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  BOOTSTRAP_ADMIN_TOKEN: z.string().min(32, 'BOOTSTRAP_ADMIN_TOKEN must be at least 32 characters'),
  // F-08/G-006: the global bootstrap token may create a tenant only on first run (no user exists in any
  // organization). Creating further tenants with it must be enabled explicitly; the SaaS commercial
  // provisioning model is an owner decision (DEC-010) and does not use this token.
  // G-017 login throttling. Defaults are PROVISIONAL engineering values pending the owner's security policy
  // (DEC-015); set them explicitly per deployment. 0 disables a limit.
  LOGIN_MAX_FAILED_ATTEMPTS: z.coerce.number().int().min(0).default(5),
  LOGIN_FAILURE_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
  // Per-address limit needs the real client address: set TRUST_PROXY to the number of proxy hops in front of the API.
  LOGIN_ADDRESS_MAX_FAILURES: z.coerce.number().int().min(0).default(0),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  ALLOW_MULTI_TENANT_BOOTSTRAP: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  // Stage 32 / DEC-015: multi-factor sign-in for privileged users (admin, finance post/approve/manage, DOA approvers).
  // 'required' is the decided policy; 'off' exists only for local test servers and is refused in production.
  MFA_ENFORCEMENT: z.enum(['required', 'off']).default('required'),
  MFA_ISSUER: z.string().min(2).max(60).default('MISHEL ERP'),
  // Key for TOTP secrets at rest. Set it in production (independent of JWT_SECRET, so a JWT key rotation never
  // locks users out); without it a key derived from JWT_SECRET is used (development only, see server.ts).
  MFA_ENCRYPTION_KEY: z.string().min(32).optional()
});

export const env = envSchema.parse(process.env);
