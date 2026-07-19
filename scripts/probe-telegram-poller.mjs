/**
 * One-shot: load .env.local, start Telegram poller, print status, exit.
 * Usage: node scripts/probe-telegram-poller.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['.env', '.env.local']) {
  const p = path.join(root, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}

const { ensureTelegramPoller, getTelegramPollerStatus } = await import(
  '../src/lib/commercial/telegramPoller.ts'
);

console.log(
  'token',
  Boolean(process.env.AINOVEL_TELEGRAM_BOT_TOKEN),
  'chat',
  Boolean(process.env.AINOVEL_TELEGRAM_CHAT_ID),
);
ensureTelegramPoller();
await new Promise((r) => setTimeout(r, 10000));
console.log(JSON.stringify(getTelegramPollerStatus(), null, 2));
process.exit(0);
