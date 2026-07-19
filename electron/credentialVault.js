/**
 * OS-protected credential storage for renderer secrets.
 * Windows uses DPAPI through Electron safeStorage. Plaintext fallback is forbidden.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');

const TOP_LEVEL_SECRET_KEYS = [
  'apiKey',
  'apiKeys',
  'openaiApiKey',
  'openaiApiKeys',
  'grokApiKey',
  'grokApiKeys',
  'claudeApiKey',
  'claudeApiKeys',
  'lumaApiKey',
  'lumaApiKeys',
  'runwayApiKey',
  'runwayApiKeys',
  'falaiApiKey',
  'falaiApiKeys',
  'imageApiKey',
  'videoApiKey',
  'aiMasterApiKey',
  'googleStudioCookie',
  'googleStudioCookies',
  'tiktokSessionIds',
];

const TTS_SECRET_KEYS = [
  'tiktokSessionId',
  'googleCloudApiKey',
  'vbeeApiKey',
  'vbeeAppId',
  'vinaReferenceAudioB64',
];

function vaultPath(userData) {
  return path.join(userData, 'secure', 'credentials.bin');
}

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== '';
}

function extractFromState(state) {
  if (!state || typeof state !== 'object') return {};
  const output = {};
  for (const key of TOP_LEVEL_SECRET_KEYS) {
    if (hasValue(state[key])) output[key] = state[key];
  }
  const tts = state.ttsConfig;
  if (tts && typeof tts === 'object') {
    const ttsSecrets = {};
    for (const key of TTS_SECRET_KEYS) {
      if (hasValue(tts[key])) ttsSecrets[key] = tts[key];
    }
    if (Object.keys(ttsSecrets).length) output.ttsSecrets = ttsSecrets;
  }
  return output;
}

function stripFromState(state) {
  if (!state || typeof state !== 'object') return state;
  const clean = { ...state };
  for (const key of TOP_LEVEL_SECRET_KEYS) delete clean[key];
  if (clean.ttsConfig && typeof clean.ttsConfig === 'object') {
    const ttsConfig = { ...clean.ttsConfig };
    for (const key of TTS_SECRET_KEYS) delete ttsConfig[key];
    clean.ttsConfig = ttsConfig;
  }
  return clean;
}

function stripFromRaw(raw) {
  try {
    const parsed = JSON.parse(raw);
    const wrapped = parsed && typeof parsed === 'object' && parsed.state;
    const state = stripFromState(wrapped ? parsed.state : parsed);
    return JSON.stringify(wrapped ? { ...parsed, state } : state);
  } catch {
    return raw;
  }
}

function extractFromRaw(raw) {
  try {
    const parsed = JSON.parse(raw);
    return extractFromState(parsed?.state || parsed);
  } catch {
    return {};
  }
}

function mergeCredentials(base, incoming) {
  const merged = { ...(base || {}) };
  for (const key of TOP_LEVEL_SECRET_KEYS) {
    if (hasValue(incoming?.[key])) merged[key] = incoming[key];
  }
  if (incoming?.ttsSecrets && typeof incoming.ttsSecrets === 'object') {
    merged.ttsSecrets = { ...(merged.ttsSecrets || {}), ...incoming.ttsSecrets };
  }
  return merged;
}

function ensureEncryption() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Electron safeStorage encryption is unavailable; credentials were not persisted.');
  }
}

function read(userData) {
  const file = vaultPath(userData);
  try {
    if (!fs.existsSync(file)) return {};
    ensureEncryption();
    const encrypted = fs.readFileSync(file);
    const plaintext = safeStorage.decryptString(encrypted);
    const parsed = JSON.parse(plaintext);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.warn('[CredentialVault] read failed:', error?.message || error);
    return {};
  }
}

function write(userData, credentials) {
  ensureEncryption();
  const file = vaultPath(userData);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const encrypted = safeStorage.encryptString(JSON.stringify(credentials || {}));
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, encrypted);
  try {
    fs.renameSync(temporary, file);
  } catch {
    fs.writeFileSync(file, encrypted);
    try {
      fs.unlinkSync(temporary);
    } catch {
      // ignore
    }
  }
  return { ok: true, path: file };
}

function migrateFromRaw(userData, raw, legacySecretsPath) {
  let incoming = extractFromRaw(raw);
  try {
    if (legacySecretsPath && fs.existsSync(legacySecretsPath)) {
      const legacy = JSON.parse(fs.readFileSync(legacySecretsPath, 'utf8'));
      incoming = mergeCredentials(incoming, extractFromState(legacy));
      if (legacy.ttsConfig) {
        incoming = mergeCredentials(incoming, extractFromState({ ttsConfig: legacy.ttsConfig }));
      }
    }
  } catch {
    // A malformed legacy file must not block the application boot.
  }

  if (Object.keys(incoming).length > 0) {
    const merged = mergeCredentials(read(userData), incoming);
    write(userData, merged);
  }
  if (legacySecretsPath && fs.existsSync(legacySecretsPath)) {
    try {
      fs.unlinkSync(legacySecretsPath);
    } catch {
      // ignore; main process will never read it again.
    }
  }
  return stripFromRaw(raw);
}

module.exports = {
  TOP_LEVEL_SECRET_KEYS,
  TTS_SECRET_KEYS,
  extractFromRaw,
  extractFromState,
  stripFromRaw,
  stripFromState,
  mergeCredentials,
  migrateFromRaw,
  read,
  write,
  vaultPath,
};
