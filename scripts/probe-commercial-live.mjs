/**
 * Live probe: Telegram bridge + production license API.
 *   node scripts/probe-commercial-live.mjs
 */
const bridgeUrl =
  'https://ainovel-telegram-bridge.vercel.app/api/entitlement/telegram-webhook';
const apiUrl = 'https://ai-novel-flax.vercel.app/api/commercial/status';

async function main() {
  const bridgeRes = await fetch(bridgeUrl, {
    signal: AbortSignal.timeout(20_000),
  });
  const bridge = await bridgeRes.json().catch(() => ({}));
  if (!bridgeRes.ok || !bridge.configured) {
    console.error('telegram-bridge FAIL', bridgeRes.status, bridge);
    process.exit(2);
  }

  const apiRes = await fetch(apiUrl, { signal: AbortSignal.timeout(20_000) });
  const api = await apiRes.json().catch(() => ({}));
  if (!apiRes.ok || !api.entitlement?.readyForCommercial) {
    console.error('license-api FAIL', apiRes.status, api.entitlement || api);
    process.exit(2);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        telegram: {
          configured: bridge.configured,
          service: bridge.service,
        },
        licenseApi: {
          mode: api.entitlement.mode,
          ready: api.entitlement.readyForCommercial,
          publicKey: api.entitlement.publicKeyConfigured,
          signer: api.entitlement.signerConfigured,
        },
      },
      null,
      2,
    ),
  );
  console.log('PASS probe-commercial-live');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
