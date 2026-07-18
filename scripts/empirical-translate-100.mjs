/**
 * Empirical: dịch 100 cue SRT (Trung → Việt) bằng method Cap (|| batch 50) + Gemini.
 * Chạy: node scripts/empirical-translate-100.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function loadEnv() {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

loadEnv();

const ANCHOR = ' || ';
const BATCH = 50;
const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'];
const RULE =
  'Tone chân thực, thực tế, đời sống thường ngày kết hợp thuật ngữ công sở và gia đình. Ngôn từ gần gũi.';

function collectKeys() {
  const keys = [];
  for (let i = 1; i <= 12; i++) {
    const k = process.env[`GEMINI_KEY_${i}`];
    if (k && k.startsWith('AIza')) keys.push(k.trim());
  }
  for (const n of ['GEMINI_API_KEY', 'GOOGLE_API_KEY']) {
    const k = process.env[n];
    if (k && k.startsWith('AIza') && !keys.includes(k.trim())) keys.push(k.trim());
  }
  return keys;
}

/** 100 Chinese-ish subtitle lines (mixed everyday ZH) */
function buildSrt100() {
  const samples = [
    '你好，今天天气怎么样？',
    '我们马上出发去公司。',
    '请把文件发给我。',
    '这个项目很重要。',
    '他刚刚打来电话。',
    '会议改到下午三点。',
    '我需要一点时间考虑。',
    '你能再说一遍吗？',
    '路上小心安全。',
    '晚饭一起吃吧。',
    '这道菜很好吃。',
    '别忘了带钥匙。',
    '电脑突然死机了。',
    '代码已经提交了。',
    '客户还在等回复。',
    '飞机晚点了半小时。',
    '酒店已经订好了。',
    '明天有考试吗？',
    '她笑得很开心。',
    '雨下得越来越大。',
  ];
  const blocks = [];
  for (let i = 0; i < 100; i++) {
    const start = i * 3;
    const end = start + 2;
    const sh = String(Math.floor(start / 3600)).padStart(2, '0');
    const sm = String(Math.floor((start % 3600) / 60)).padStart(2, '0');
    const ss = String(start % 60).padStart(2, '0');
    const eh = String(Math.floor(end / 3600)).padStart(2, '0');
    const em = String(Math.floor((end % 3600) / 60)).padStart(2, '0');
    const es = String(end % 60).padStart(2, '0');
    const text = `${samples[i % samples.length]}（第${i + 1}句）`;
    blocks.push(
      `${i + 1}\n${sh}:${sm}:${ss},000 --> ${eh}:${em}:${es},500\n${text}\n`,
    );
  }
  return blocks.join('\n');
}

function parseSrt(srt) {
  const blocks = srt
    .replace(/^\uFEFF/, '')
    .trim()
    .split(/\n\s*\n+/);
  const cues = [];
  for (const b of blocks) {
    const lines = b.split(/\n/).map((l) => l.trimEnd()).filter((l) => l.length);
    if (lines.length < 2) continue;
    let ti = 0;
    if (/^\d+$/.test(lines[0]) && lines.length >= 3) ti = 1;
    if (!lines[ti]?.includes('-->')) continue;
    const text = lines.slice(ti + 1).join('\n').trim();
    if (!text) continue;
    cues.push({ index: cues.length + 1, time: lines[ti], text });
  }
  return cues;
}

async function callGemini(apiKey, prompt, maxOut = 16384) {
  let lastErr = null;
  for (const model of MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.45, maxOutputTokens: maxOut },
      }),
      signal: AbortSignal.timeout(180_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      lastErr = data?.error?.message || `HTTP ${res.status}`;
      if (res.status === 429) continue;
      continue;
    }
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (text.trim()) return { text: text.trim(), model };
    lastErr = 'empty';
  }
  throw new Error(lastErr || 'Gemini fail');
}

function splitAnchor(raw, n) {
  const cleaned = raw.replace(/```(?:text|plain)?/gi, '').trim();
  let parts = cleaned.split(ANCHOR).map((p) => p.trim());
  if (parts.length === n) return parts;
  parts = cleaned
    .split(/\s*\|\|\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === n) return parts;
  return null;
}

async function translateBatch(texts, keys, keyOffset) {
  const joined = texts.join(ANCHOR);
  const prompt = `Bạn là chuyên gia dịch phụ đề chuyên nghiệp (Google Gemini / AI Studio).
Nhiệm vụ: Dịch TỪNG đoạn sang Vietnamese — văn phong mềm mại, tự nhiên, không khô như máy.
Quy tắc đặc biệt (phong cách): ${RULE}

INPUT: các đoạn được ngăn bằng đúng chuỗi ${JSON.stringify(ANCHOR)}
OUTPUT: CÙNG SỐ đoạn, ngăn bằng đúng chuỗi đó.

HARD RULES:
1. Giữ đúng số đoạn = ${texts.length}. Không gộp, không tách, không bỏ đoạn.
2. KHÔNG thêm số thứ tự, timestamp, markdown, giải thích.
3. Chỉ trả về các đoạn đã dịch, nối bằng ${JSON.stringify(ANCHOR)}.

--- ĐOẠN ---
${joined}`;

  let lastErr = null;
  for (let k = 0; k < keys.length; k++) {
    const key = keys[(keyOffset + k) % keys.length];
    try {
      const { text, model } = await callGemini(key, prompt, 16384);
      const parts = splitAnchor(text, texts.length);
      if (!parts) {
        lastErr = `count mismatch key...${key.slice(-4)}`;
        continue;
      }
      return { parts, model, keyTail: key.slice(-4) };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(lastErr || 'batch fail');
}

async function main() {
  const keys = collectKeys();
  console.log('[setup] keys AIza count =', keys.length);
  if (!keys.length) {
    console.error('FAIL: no Gemini API keys in .env');
    process.exit(1);
  }

  const srt = buildSrt100();
  const cues = parseSrt(srt);
  console.log('[setup] cues =', cues.length);
  if (cues.length !== 100) {
    console.error('FAIL: expected 100 cues, got', cues.length);
    process.exit(1);
  }

  const outDir = path.join(root, 'public', 'audio', 'srt-batch', '_empirical');
  fs.mkdirSync(outDir, { recursive: true });
  const inPath = path.join(outDir, 'test_100_zh.srt');
  fs.writeFileSync(inPath, srt, 'utf8');
  console.log('[setup] wrote', inPath);

  // Cap-style: 2 batches of 50, parallel
  const batch1 = cues.slice(0, 50).map((c) => c.text);
  const batch2 = cues.slice(50, 100).map((c) => c.text);

  const t0 = Date.now();
  console.log('[run] Cap method: 2 batches × 50 || anchor, parallel Gemini…');

  const [r1, r2] = await Promise.all([
    translateBatch(batch1, keys, 0),
    translateBatch(batch2, keys, 1),
  ]);
  const ms = Date.now() - t0;

  const flat = [...r1.parts, ...r2.parts];
  console.log('[result] out segments =', flat.length);
  console.log('[result] models', r1.model, r2.model);
  console.log('[result] keys', r1.keyTail, r2.keyTail);
  console.log('[result] wall_ms =', ms, 'wall_s =', (ms / 1000).toFixed(2));

  if (flat.length !== 100) {
    console.error('FAIL: segment count mismatch');
    process.exit(1);
  }

  // rebuild SRT
  const outSrt = cues
    .map(
      (c, i) =>
        `${i + 1}\n${c.time}\n${flat[i]}\n`,
    )
    .join('\n');
  const outPath = path.join(outDir, 'test_100_vi.srt');
  fs.writeFileSync(outPath, outSrt, 'utf8');
  console.log('[result] wrote', outPath);

  console.log('\n--- samples ---');
  for (const i of [0, 1, 2, 49, 50, 98, 99]) {
    console.log(`#${i + 1}`);
    console.log('  ZH:', cues[i].text);
    console.log('  VI:', flat[i]);
  }

  // sanity: Vietnamese-ish characters
  const viHits = flat.filter((t) => /[àáạảãăằắặẳẵâầấậẩẫèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(t)).length;
  console.log('\n[check] lines with VN diacritics:', viHits, '/100');
  console.log(
    viHits >= 70
      ? 'PASS: translation looks Vietnamese'
      : 'WARN: few VN diacritics (may still be ok)',
  );
  console.log('EMPIRICAL_TRANSLATE_100_OK');
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
