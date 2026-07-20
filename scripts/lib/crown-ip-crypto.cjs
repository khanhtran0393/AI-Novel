/**
 * Crown IP seal crypto.
 * - v1 (JS CJS bundles): AES-256-GCM
 * - v2 (Python source): SHA-256 keystream + HMAC-SHA256 (stdlib-friendly on client)
 *
 * Key = app pepper + moduleId (+ optional AINOVEL_CROWN_SEAL_SECRET).
 * NEVER derive from entitlement token (license one-path).
 */
'use strict';

const crypto = require('crypto');

const APP_PEPPER = Buffer.from(
  'AI-Novel|crown-ip-v1|phantom-x|tts-srt|nav-analyzer|2026',
  'utf8',
);

/**
 * @param {string} moduleId
 * @returns {Buffer} 32 bytes
 */
function deriveKey(moduleId) {
  const secret = process.env.AINOVEL_CROWN_SEAL_SECRET || '';
  return crypto
    .createHash('sha256')
    .update(APP_PEPPER)
    .update('|')
    .update(String(moduleId || ''))
    .update('|')
    .update(String(secret))
    .digest();
}

/**
 * AES-256-GCM seal (JS modules).
 * Layout: magic(6) + ver=1 + iv(12) + tag(16) + ct
 * @param {Buffer|string} plaintext
 * @param {string} moduleId
 */
function sealBuffer(plaintext, moduleId) {
  const key = deriveKey(moduleId);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const pt = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(String(plaintext), 'utf8');
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from('AINCRL', 'ascii'), Buffer.from([1]), iv, tag, ct]);
}

/**
 * Python-friendly seal (no AES dependency at runtime).
 * Layout: magic(6) + ver=2 + iv(16) + hmac(32) + xor-body
 * @param {Buffer|string} plaintext
 * @param {string} moduleId
 */
function sealBufferV2(plaintext, moduleId) {
  const key = deriveKey(moduleId);
  const iv = crypto.randomBytes(16);
  const pt = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(String(plaintext), 'utf8');
  const body = xorKeystream(pt, key, iv);
  const hmac = crypto.createHmac('sha256', key).update(iv).update(body).digest();
  return Buffer.concat([Buffer.from('AINCRL', 'ascii'), Buffer.from([2]), iv, hmac, body]);
}

/**
 * @param {Buffer} data
 * @param {Buffer} key
 * @param {Buffer} iv
 */
function xorKeystream(data, key, iv) {
  const out = Buffer.alloc(data.length);
  let offset = 0;
  let counter = 0;
  while (offset < data.length) {
    const block = crypto
      .createHash('sha256')
      .update(key)
      .update(iv)
      .update(Buffer.from([
        (counter >>> 24) & 0xff,
        (counter >>> 16) & 0xff,
        (counter >>> 8) & 0xff,
        counter & 0xff,
      ]))
      .digest();
    const n = Math.min(block.length, data.length - offset);
    for (let i = 0; i < n; i++) {
      out[offset + i] = data[offset + i] ^ block[i];
    }
    offset += n;
    counter += 1;
  }
  return out;
}

/**
 * @param {Buffer} sealed
 * @param {string} moduleId
 * @returns {Buffer}
 */
function unsealBuffer(sealed, moduleId) {
  if (!Buffer.isBuffer(sealed) || sealed.length < 8) {
    throw new Error(`Crown seal corrupt/short (${moduleId})`);
  }
  const magic = sealed.subarray(0, 6).toString('ascii');
  if (magic !== 'AINCRL') {
    throw new Error(`Crown seal bad magic (${moduleId})`);
  }
  const ver = sealed[6];
  const key = deriveKey(moduleId);

  if (ver === 1) {
    if (sealed.length < 6 + 1 + 12 + 16 + 1) {
      throw new Error(`Crown seal v1 short (${moduleId})`);
    }
    const iv = sealed.subarray(7, 19);
    const tag = sealed.subarray(19, 35);
    const ct = sealed.subarray(35);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  }

  if (ver === 2) {
    if (sealed.length < 6 + 1 + 16 + 32 + 1) {
      throw new Error(`Crown seal v2 short (${moduleId})`);
    }
    const iv = sealed.subarray(7, 23);
    const hmac = sealed.subarray(23, 55);
    const body = sealed.subarray(55);
    const expect = crypto.createHmac('sha256', key).update(iv).update(body).digest();
    if (!crypto.timingSafeEqual(hmac, expect)) {
      throw new Error(`Crown seal v2 HMAC fail (${moduleId})`);
    }
    return xorKeystream(body, key, iv);
  }

  throw new Error(`Crown seal unsupported ver ${ver} (${moduleId})`);
}

module.exports = {
  APP_PEPPER,
  deriveKey,
  sealBuffer,
  sealBufferV2,
  unsealBuffer,
  xorKeystream,
};
