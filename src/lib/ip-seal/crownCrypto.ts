/**
 * Crown IP seal crypto (Node) — AES-256-GCM.
 * Key = app pepper + moduleId (+ optional AINOVEL_CROWN_SEAL_SECRET).
 * NEVER derive from entitlement token (license one-path).
 */
import crypto from 'crypto';

const APP_PEPPER = Buffer.from(
  'AI-Novel|crown-ip-v1|phantom-x|tts-srt|nav-analyzer|2026',
  'utf8',
);
const MAGIC = Buffer.from('AINCRL', 'ascii');

export function deriveCrownKey(moduleId: string): Buffer {
  const secret = process.env.AINOVEL_CROWN_SEAL_SECRET || '';
  return crypto
    .createHash('sha256')
    .update(APP_PEPPER)
    .update('|')
    .update(String(moduleId || ''))
    .update('|')
    .update(secret)
    .digest();
}

export function unsealCrownBuffer(sealed: Buffer, moduleId: string): Buffer {
  if (!Buffer.isBuffer(sealed) || sealed.length < 6 + 1 + 12 + 16 + 1) {
    throw new Error(`Crown seal corrupt/short (${moduleId})`);
  }
  if (!sealed.subarray(0, 6).equals(MAGIC)) {
    throw new Error(`Crown seal bad magic (${moduleId})`);
  }
  if (sealed[6] !== 1) {
    throw new Error(`Crown seal unsupported ver ${sealed[6]} (${moduleId})`);
  }
  const iv = sealed.subarray(7, 19);
  const tag = sealed.subarray(19, 35);
  const ct = sealed.subarray(35);
  const key = deriveCrownKey(moduleId);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

export function unsealCrownUtf8(sealed: Buffer, moduleId: string): string {
  return unsealCrownBuffer(sealed, moduleId).toString('utf8');
}
