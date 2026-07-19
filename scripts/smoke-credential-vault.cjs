/** Empirical Electron safeStorage / Windows DPAPI smoke. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, safeStorage } = require('electron');

app.whenReady().then(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ainovel-vault-'));
  try {
    assert.equal(safeStorage.isEncryptionAvailable(), true);
    const vault = require('../electron/credentialVault');
    const secrets = {
      apiKey: 'REAL-SMOKE-SECRET-NOT-A-NETWORK-KEY',
      googleStudioCookies: ['cookie-smoke-value'],
      ttsSecrets: { vbeeApiKey: 'vbee-smoke-value' },
    };

    const result = vault.write(root, secrets);
    assert.equal(result.ok, true);
    const encrypted = fs.readFileSync(vault.vaultPath(root));
    assert.equal(encrypted.includes(Buffer.from(secrets.apiKey)), false);
    assert.deepEqual(vault.read(root), secrets);

    const raw = JSON.stringify({
      state: {
        ten_tac_pham: 'Vault smoke',
        apiKey: secrets.apiKey,
        ttsConfig: { platform: 'vbee', vbeeApiKey: 'nested-secret' },
      },
      version: 4,
    });
    const stripped = JSON.parse(vault.stripFromRaw(raw));
    assert.equal(stripped.state.apiKey, undefined);
    assert.equal(stripped.state.ttsConfig.vbeeApiKey, undefined);
    assert.equal(stripped.state.ttsConfig.platform, 'vbee');

    console.log(
      JSON.stringify({
        ok: true,
        encryptionAvailable: true,
        encryptedBytes: encrypted.length,
        plaintextAbsent: true,
      }),
    );
    console.log('PASS smoke-credential-vault');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    app.quit();
  }
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
