/**
 * Print current TLS SPKI pin for a host (use in AINOVEL_LICENSE_TLS_PINS).
 *
 *   node scripts/print-license-tls-pin.mjs
 *   node scripts/print-license-tls-pin.mjs ai-novel-flax.vercel.app
 *
 * Note: Vercel/LE certs rotate — re-run and update public.env when pin breaks.
 */
import tls from 'tls';
import crypto from 'crypto';

const host = process.argv[2] || 'ai-novel-flax.vercel.app';
const port = Number(process.argv[3] || 443);

const socket = tls.connect(
  { host, port, servername: host, rejectUnauthorized: true },
  () => {
    const cert = socket.getPeerCertificate();
    const raw = cert.raw;
    const x509 = new crypto.X509Certificate(raw);
    const spki = x509.publicKey.export({ type: 'spki', format: 'der' });
    const b64 = crypto.createHash('sha256').update(spki).digest('base64');
    const hex = crypto.createHash('sha256').update(spki).digest('hex');
    console.log(
      JSON.stringify(
        {
          host,
          pin_base64: b64,
          pin_env: `sha256/${b64}`,
          pin_hex: hex,
          subject: cert.subject,
          valid_to: cert.valid_to,
          note: 'Set AINOVEL_LICENSE_TLS_PINS in resources/commercial/public.env (bundled only).',
        },
        null,
        2,
      ),
    );
    socket.end();
  },
);
socket.on('error', (e) => {
  console.error(e);
  process.exit(1);
});
