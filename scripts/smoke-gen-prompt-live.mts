/**
 * Empirical smoke: Gen Prompt path + Trial write chapter num resolution.
 * 1) Pure policy (no network)
 * 2) Live POST /api/generate GENERATE_IMAGE_PROMPT (requires Next + Gemini key)
 *
 * Run: npx tsx scripts/smoke-gen-prompt-live.mts
 * Optional: AINOVEL_SMOKE_BASE=http://127.0.0.1:3000
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  isTrialChapterOutOfRange,
  resolveWriteChapterNum,
  TRIAL_LIMITS,
} from '../src/lib/commercial/freeLimitsPolicy.ts';
import {
  cleanAndParseJson,
  generateJsonWithRetry,
} from '../src/app/api/generate/modelClients.ts';

function section(name: string) {
  console.log(`\n=== ${name} ===`);
}

function loadEnvFile(file: string) {
  const p = path.join(process.cwd(), file);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

loadEnvFile('.env');
loadEnvFile('.env.local');

// Mirror handler normalize (keep in sync with imagePrompt.ts)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizePromptArray(raw: any, depth = 0): any[] {
  if (depth > 3) return [];
  if (Array.isArray(raw)) return raw.filter((x) => x != null);
  if (raw && typeof raw === 'object') {
    for (const k of [
      'prompts',
      'items',
      'data',
      'results',
      'result',
      'shots',
      'list',
      'output',
      'scenes',
      'beats',
      'storyboard',
      'prompt_list',
      'promptList',
      'image_prompts',
      'imagePrompts',
    ]) {
      if (Array.isArray(raw[k])) return raw[k].filter((x: unknown) => x != null);
      if (raw[k] && typeof raw[k] === 'object' && !Array.isArray(raw[k])) {
        const nested = normalizePromptArray(raw[k], depth + 1);
        if (nested.length) return nested;
      }
    }
    if (
      raw.image_prompt ||
      raw.imagePrompt ||
      raw.video_prompt ||
      raw.videoPrompt ||
      raw.prompt ||
      raw.script_prompt
    ) {
      return [raw];
    }
    const vals = Object.values(raw);
    if (
      vals.length > 0 &&
      vals.every((v) => v && typeof v === 'object' && !Array.isArray(v))
    ) {
      const looks = vals.some(
        (v) =>
          (v as { image_prompt?: string }).image_prompt ||
          (v as { video_prompt?: string }).video_prompt ||
          (v as { script_prompt?: string }).script_prompt,
      );
      if (looks) return vals as unknown[];
    }
  }
  return [];
}

section('Trial write payload — no false max_chapters');
{
  const n = resolveWriteChapterNum({
    chuong_hien_tai: { so_chuong: 1, tieu_de: 'Hook', noi_dung: '' },
    so_chuong: 20,
  });
  assert.equal(n, 1);
  assert.equal(isTrialChapterOutOfRange(n), false);
  assert.equal(isTrialChapterOutOfRange(TRIAL_LIMITS.maxChapters + 1), true);
  // Old bug: Number(object) => NaN => out of range
  assert.equal(Number({ so_chuong: 1 }), Number.NaN);
  console.log('resolveWriteChapterNum(ch1, planned20)=', n, 'OK');
}

section('normalize wrappers (regression empty array)');
{
  assert.equal(
    normalizePromptArray({
      result: {
        shots: [
          { image_prompt: 'a', video_prompt: 'b' },
          { image_prompt: 'c', video_prompt: 'd' },
        ],
      },
    }).length,
    2,
  );
  assert.equal(
    normalizePromptArray({
      prompts: [{ image_prompt: 'x', video_prompt: 'y' }],
    }).length,
    1,
  );
  assert.equal(normalizePromptArray([]).length, 0);
  assert.equal(normalizePromptArray({ status: 'ok' }).length, 0);
  console.log('normalize nested + empty shapes OK');
}

section('cleanAndParseJson array preference');
{
  const raw = cleanAndParseJson(
    'Here:\n[{"id":1,"image_prompt":"en still","video_prompt":"dolly in"}]',
  );
  const arr = normalizePromptArray(raw);
  assert.equal(arr.length, 1);
  assert.ok(String(arr[0].image_prompt).includes('still'));
  console.log('parse+normalize OK');
}

const keys = [
  process.env.GEMINI_KEY_1,
  process.env.GEMINI_KEY_2,
  process.env.GEMINI_KEY_3,
  process.env.GEMINI_API_KEY,
].filter((k): k is string => Boolean(k && k.length > 10));

assert.ok(keys.length > 0, 'Need at least one GEMINI_KEY_* in .env for live probe');
console.log(`keys available: ${keys.length} (fingerprints only, not printed)`);

const skipDirect =
  process.env.AINOVEL_SMOKE_SKIP_DIRECT === '1' ||
  process.argv.includes('--http-only');
const skipHttp =
  process.env.AINOVEL_SMOKE_SKIP_HTTP === '1' ||
  process.argv.includes('--direct-only');

if (!skipDirect) {
  section('Live Gemini → JSON prompt array (modelClients)');
  const prompt = `Return ONLY a pure JSON array with exactly 2 objects. No markdown.
Each object: id (number), script_prompt (Vietnamese string), image_prompt (English), video_prompt (English).
Scene: interior data center Zenith at dawn, two characters stand by server racks.
Example shape: [{"id":1,"script_prompt":"...","image_prompt":"...","video_prompt":"..."},{"id":2,...}]`;

  const raw = await generateJsonWithRetry(prompt, keys.slice(0, 2), 2, 'gemini');
  const arr = normalizePromptArray(raw);
  console.log(
    'live shape len=',
    arr.length,
    'keys0=',
    arr[0] ? Object.keys(arr[0]).join(',') : '-',
  );
  assert.ok(
    arr.length >= 1,
    `expected prompts, got ${JSON.stringify(raw).slice(0, 200)}`,
  );
  for (let i = 0; i < arr.length; i++) {
    const img = String(
      arr[i].image_prompt || arr[i].imagePrompt || arr[i].prompt || '',
    ).trim();
    const vid = String(arr[i].video_prompt || arr[i].videoPrompt || '').trim();
    assert.ok(img.length > 5, `shot ${i + 1} missing image_prompt`);
    assert.ok(vid.length > 5, `shot ${i + 1} missing video_prompt`);
  }
  console.log('live Gemini generateJsonWithRetry → usable prompts OK');
}

const base = process.env.AINOVEL_SMOKE_BASE || 'http://127.0.0.1:3000';

if (!skipHttp) {
  // Avoid RPM collision after direct call — pool enforces min gap between calls.
  const waitMs = Number(process.env.AINOVEL_SMOKE_RPM_WAIT_MS || 8000);
  if (!skipDirect && waitMs > 0) {
    console.log(`\n… RPM gap wait ${waitMs}ms before HTTP …`);
    await new Promise((r) => setTimeout(r, waitMs));
  }

  section(`Live HTTP ${base}/api/generate GENERATE_IMAGE_PROMPT`);
  // Prefer keys 4–6 for HTTP if present (less overlap with direct probe keys 1–2)
  const httpKeys = [
    process.env.GEMINI_KEY_4,
    process.env.GEMINI_KEY_5,
    process.env.GEMINI_KEY_6,
    process.env.GEMINI_KEY_3,
    ...keys,
  ].filter((k): k is string => Boolean(k && k.length > 10));
  // de-dupe preserve order
  const seen = new Set<string>();
  const httpPool: string[] = [];
  for (const k of httpKeys) {
    if (seen.has(k)) continue;
    seen.add(k);
    httpPool.push(k);
  }

  const body = {
    requestType: 'GENERATE_IMAGE_PROMPT',
    model: 'gemini',
    apiKeys: httpPool.slice(0, 4),
    payload: {
      sceneText:
        '[CẢNH 1: NỘI CẢNH. TRUNG TÂM DỮ LIỆU ZENITH - SÁNG] Lãng Phong đứng trước dàn máy chủ. Diệp Tuyên mở tablet. Ánh đèn xanh nhấp nháy.',
      style: 'cinematic sci-fi, cool cyan lighting, photorealistic, 35mm',
      voiceDuration: 30,
      wpm: 140,
      secondsPerBeat: 6,
      chu_de: 'Khoa học viễn tưởng',
      phong_cach: 'Hành động',
      genre: 'Khoa học viễn tưởng / Hành động',
      characterReferences: {
        'Lãng Phong': {
          vai_tro: 'Protagonist',
          gioi_tinh: 'Nam',
          ngoai_hinh: 'sharp jaw, short black hair',
          prompt: 'young Vietnamese man, short black hair, tactical jacket',
        },
      },
      scriptMode: 'standard',
      chapterNum: 1,
      sceneIndex: 0,
    },
  };

  let res = await fetch(`${base}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let text = await res.text();
  // One automatic wait+retry on RPM
  if (
    res.status === 429 ||
    /RPM|RPD|CHỜ|giữ nhịp|giu nhip/i.test(text)
  ) {
    console.log('HTTP RPM — wait 10s and retry once…');
    await new Promise((r) => setTimeout(r, 10_000));
    res = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    text = await res.text();
  }

  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`HTTP ${res.status} non-JSON: ${text.slice(0, 300)}`);
  }

  if (!res.ok) {
    console.error('HTTP fail', res.status, String(data.error || text).slice(0, 400));
    throw new Error(
      `GENERATE_IMAGE_PROMPT HTTP ${res.status}: ${String(data.error || '').slice(0, 300)}`,
    );
  }

  const prompts = Array.isArray(data.prompts) ? data.prompts : [];
  console.log(
    `HTTP ${res.status} prompts=${prompts.length} usedApiKey=${Boolean(data.usedApiKey)}`,
  );
  assert.ok(prompts.length > 0, 'API must return non-empty prompts[]');

  for (let i = 0; i < prompts.length; i++) {
    const p = prompts[i] as Record<string, unknown>;
    const img = String(p.image_prompt || p.prompt || '').trim();
    const vid = String(p.video_prompt || '').trim();
    assert.ok(img.length > 10, `API shot #${i + 1} image_prompt empty`);
    assert.ok(vid.length > 10, `API shot #${i + 1} video_prompt empty`);
    console.log(
      `  shot${i + 1}: img=${img.length}ch vid=${vid.length}ch ts=${p.timestamp || '-'}`,
    );
  }
  console.log('HTTP GENERATE_IMAGE_PROMPT usable OK');
}

console.log('\n✅ smoke-gen-prompt-live PASS — Gen Prompt path empirically usable');
