import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

// Stage 32 / DEC-015 (migration 081): TOTP (RFC 6238: HMAC-SHA1, 30-second steps, 6 digits) built on node:crypto,
// secrets encrypted at rest (AES-256-GCM), one-time recovery codes stored as SHA-256 only.

const STEP_SECONDS = 30;
const DIGITS = 6;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32');
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const currentStep = (nowMs = Date.now()) => Math.floor(nowMs / 1000 / STEP_SECONDS);

export function totpAt(secretB32: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', base32Decode(secretB32)).update(counter).digest();
  const offset = h[h.length - 1] & 15;
  const bin = ((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

// Accepts the current step and one either side (clock drift); returns the matched step, newer than lastStep only.
export function matchStep(secretB32: string, code: string, lastStep: number, nowMs = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = currentStep(nowMs);
  for (const step of [now - 1, now, now + 1]) {
    if (step <= lastStep) continue;
    const expected = Buffer.from(totpAt(secretB32, step));
    if (crypto.timingSafeEqual(expected, Buffer.from(code))) return step;
  }
  return null;
}

export const newSecret = () => base32Encode(crypto.randomBytes(20));

const key = () => crypto.createHash('sha256').update(env.MFA_ENCRYPTION_KEY ?? `${env.JWT_SECRET}:mfa-at-rest`).digest();
export function encryptSecret(secretB32: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(secretB32, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}
export function decryptSecret(stored: string): string {
  const [v, iv, tag, enc] = stored.split(':');
  if (v !== 'v1') throw new Error('Unknown MFA secret format');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
}

export const otpauthUri = (email: string, secretB32: string) =>
  `otpauth://totp/${encodeURIComponent(`${env.MFA_ISSUER}:${email}`)}?secret=${secretB32}&issuer=${encodeURIComponent(env.MFA_ISSUER)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;

export function newRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const h = crypto.randomBytes(5).toString('hex');
    return `${h.slice(0, 5)}-${h.slice(5)}`;
  });
}
export const hashRecoveryCode = (code: string) => crypto.createHash('sha256').update(code.trim().toLowerCase()).digest('hex');

// Challenge tokens are signed with a derived key, so the session middleware (which verifies with JWT_SECRET) can never
// accept one as an access token. They carry the session epoch: an administrator reset invalidates them.
const challengeKey = () => `${env.JWT_SECRET}:mfa-challenge`;
export type ChallengePurpose = 'mfa_verify' | 'mfa_enroll';
export function signChallenge(user: { id: number; org_id: number; token_version: number }, purpose: ChallengePurpose) {
  return jwt.sign({ sub: String(user.id), org_id: user.org_id, tv: user.token_version, purpose }, challengeKey(), { expiresIn: '5m' });
}
export function verifyChallenge(token: string, purpose: ChallengePurpose): { userId: number; orgId: number; tv: number } {
  const d = jwt.verify(token, challengeKey()) as jwt.JwtPayload;
  if (d.purpose !== purpose || typeof d.sub !== 'string' || typeof d.org_id !== 'number' || typeof d.tv !== 'number') throw new Error('Invalid challenge');
  return { userId: Number(d.sub), orgId: d.org_id, tv: d.tv };
}
