/**
 * In-process GENERATE_IMAGE_PROMPT handler smoke (no Next HTTP / no shared RPM).
 * Run: npx tsx scripts/smoke-gen-prompt-handler.mts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

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

// Open entitlement so free quota / pro IP soft-paths don't block smoke
process.env.AINOVEL_ENTITLEMENT_MODE =
  process.env.AINOVEL_ENTITLEMENT_MODE || 'open';

const keys = [
  process.env.GEMINI_KEY_7,
  process.env.GEMINI_KEY_8,
  process.env.GEMINI_KEY_6,
  process.env.GEMINI_KEY_5,
  process.env.GEMINI_KEY_4,
  process.env.GEMINI_KEY_3,
  process.env.GEMINI_KEY_2,
  process.env.GEMINI_KEY_1,
].filter((k): k is string => Boolean(k && String(k).length > 12));

console.log(`=== keys loaded: ${keys.length} (no secrets printed) ===`);
assert.ok(keys.length > 0, 'Need GEMINI_KEY_* in .env');

const { handleImagePrompt } = await import(
  '../src/app/api/generate/handlers/imagePrompt.ts'
);

const ctx = {
  keysToUse: keys.slice(0, 4),
  model: 'gemini',
  payload: {
    sceneText:
      '[CẢNH 1: NỘI CẢNH. TRUNG TÂM DỮ LIỆU ZENITH - SÁNG] Lãng Phong đứng trước dàn máy chủ. Diệp Tuyên mở tablet. Ánh đèn xanh nhấp nháy trên rack.',
    style: 'cinematic sci-fi, cool cyan lighting, photorealistic, 35mm lens',
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
  req: new Request('http://localhost/api/generate', { method: 'POST' }),
  rawBody: {},
};

console.log('=== handleImagePrompt GENERATE_IMAGE_PROMPT ===');
const res = await handleImagePrompt(ctx, 'GENERATE_IMAGE_PROMPT');
assert.ok(res, 'handler returned null');
const status = res!.status;
const data = (await res!.json()) as Record<string, unknown>;
console.log('status=', status);

if (status !== 200) {
  console.error('error=', String(data.error || '').slice(0, 400));
  throw new Error(`handler HTTP ${status}: ${String(data.error || '').slice(0, 280)}`);
}

const prompts = Array.isArray(data.prompts) ? data.prompts : [];
console.log(`prompts=${prompts.length}`);
assert.ok(prompts.length > 0, 'non-empty prompts');

for (let i = 0; i < prompts.length; i++) {
  const p = prompts[i] as Record<string, unknown>;
  const img = String(p.image_prompt || p.prompt || '').trim();
  const vid = String(p.video_prompt || '').trim();
  const sent = String(p.sentence || p.script_prompt || '').trim();
  assert.ok(img.length > 10, `shot ${i + 1} image empty`);
  assert.ok(vid.length > 10, `shot ${i + 1} video empty`);
  console.log(
    `  #${i + 1} img=${img.length}ch vid=${vid.length}ch ts=${p.timestamp || '-'} sent=${sent.slice(0, 40)}…`,
  );
}

console.log('\n✅ smoke-gen-prompt-handler PASS — full handler path usable');
