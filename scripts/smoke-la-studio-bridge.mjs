/**
 * Empirical smoke: LA Studio local API bridge (no Next server required).
 * Usage: node scripts/smoke-la-studio-bridge.mjs
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

const PORT = 3900;
const BASE = `http://127.0.0.1:${PORT}`;
const SETTINGS = path.join(os.homedir(), '.lastudio', 'settings.ini');
const EXE = 'D:\\LA Studio\\bin\\LA Studio.exe';

function ensureSettings() {
  let raw = fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS, 'utf8') : '';
  const before = raw;
  const setKey = (key, value) => {
    const re = new RegExp(`^${key}=.*$`, 'mi');
    if (re.test(raw)) {
      raw = raw.replace(re, `${key}=${value}`);
      return;
    }
    if (/^\[api\]/mi.test(raw)) {
      raw = raw.replace(/^\[api\][ \t]*\r?\n/mi, `[api]\n${key}=${value}\n`);
      return;
    }
    raw = `${raw.trimEnd()}\n\n[api]\n${key}=${value}\n`;
  };
  setKey('serverEnabled', 'true');
  setKey('serverAllowLan', 'false');
  setKey('serverPort', String(PORT));
  if (raw !== before) {
    fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
    fs.writeFileSync(SETTINGS, raw.endsWith('\n') ? raw : `${raw}\n`, 'utf8');
  }
  return { changed: raw !== before, path: SETTINGS, raw };
}

async function health(timeoutMs = 2500) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/health`, { signal: ctrl.signal, cache: 'no-store' });
    const text = await res.text();
    let json = {};
    try {
      json = JSON.parse(text);
    } catch {
      return { online: false, error: `non-json ${res.status}` };
    }
    return {
      online: res.ok && (json.running === true || json.status === 'ok'),
      ...json,
    };
  } catch (e) {
    return { online: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(t);
  }
}

async function speech(text) {
  const res = await fetch(`${BASE}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'audio/wav' },
    body: JSON.stringify({
      input: text,
      voice: 'default',
      response_format: 'wav',
      speed: 1,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`speech ${res.status}: ${t.slice(0, 300)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const settings = ensureSettings();
console.log('[settings]', JSON.stringify({ changed: settings.changed, path: settings.path }));
console.log('[settings.ini]\n' + fs.readFileSync(SETTINGS, 'utf8'));

let h = await health();
console.log('[health:1]', JSON.stringify(h));

if (!h.online && fs.existsSync(EXE)) {
  console.log('[spawn]', EXE);
  const child = spawn(EXE, [], { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    h = await health();
    console.log(`[health:poll ${i + 1}]`, JSON.stringify({ online: h.online, tts_loaded: h.tts_loaded, status: h.status, error: h.error }));
    if (h.online) break;
  }
}

if (!h.online) {
  console.log('[RESULT] API_OFFLINE — open LA Studio → Developer → enable API (settings already serverEnabled=true)');
  process.exitCode = 2;
} else if (h.tts_loaded === false) {
  console.log('[RESULT] API_ONLINE_TTS_NOT_LOADED — load TTS model in LA Studio UI');
  process.exitCode = 3;
} else {
  try {
    const buf = await speech('Xin chào, kiểm tra cầu nối LA Studio.');
    const riff = buf.slice(0, 4).toString('ascii');
    console.log('[speech] bytes=', buf.length, 'header=', riff);
    if (riff !== 'RIFF' || buf.length < 1000) {
      console.log('[RESULT] SPEECH_BAD_AUDIO');
      process.exitCode = 4;
    } else {
      const out = path.join(process.cwd(), 'public', 'audio', 'la_studio_smoke.wav');
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, buf);
      console.log('[RESULT] SPEECH_OK', out);
      process.exitCode = 0;
    }
  } catch (e) {
    console.log('[RESULT] SPEECH_ERR', e instanceof Error ? e.message : e);
    process.exitCode = 5;
  }
}
