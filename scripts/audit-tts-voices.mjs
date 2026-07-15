/**
 * Audit TTS voice catalog + sample preview per Engine picker platform.
 * Usage: node scripts/audit-tts-voices.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const base = process.env.TTS_AUDIT_BASE || 'http://127.0.0.1:3000';
const auditOut = path.join(root, 'tmp-voice-audit.json');
const previewOut = path.join(root, 'tmp-voice-preview.json');

const engines = [
  'edge_tts',
  'piper',
  'vieneu_tts',
  'omnivoice_local',
  'vina_voice',
  'capcut_tts',
  'tiktok_tts',
  'gemini_tts',
  'hotai_tts',
];

async function main() {
  const res = await fetch(`${base}/api/tts/voices`, { cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  const cat = body.catalog || body;

  const report = {
    http: res.status,
    sources: body.sources || [],
    platforms: {},
    totals: { platforms: 0, voices: 0 },
    enginePicker: {},
  };

  for (const [plat, langs] of Object.entries(cat || {})) {
    if (!langs || typeof langs !== 'object') continue;
    let total = 0;
    const langCounts = {};
    const dups = [];
    const viIds = [];
    for (const [lang, list] of Object.entries(langs)) {
      const arr = Array.isArray(list) ? list : [];
      langCounts[lang] = arr.length;
      total += arr.length;
      const seen = new Set();
      for (const v of arr) {
        const id = String(v?.id || '');
        if (!id) continue;
        if (seen.has(id)) dups.push(`${lang}:${id}`);
        seen.add(id);
        if (lang === 'vi') viIds.push(id);
      }
    }
    report.platforms[plat] = {
      total,
      languages: Object.keys(langCounts).length,
      langCounts,
      dups,
      viIds,
      viSamples: (langs.vi || []).slice(0, 10).map((v) => ({
        id: v.id,
        name: v.name,
        gender: v.gender || null,
      })),
    };
    report.totals.platforms += 1;
    report.totals.voices += total;
  }

  for (const p of engines) {
    const row = report.platforms[p];
    report.enginePicker[p] = row
      ? {
          total: row.total,
          vi: row.langCounts.vi || 0,
          langs: row.languages,
          dups: row.dups.length,
        }
      : { missing: true };
  }

  fs.writeFileSync(auditOut, JSON.stringify(report, null, 2), 'utf8');
  console.log(
    'AUDIT',
    JSON.stringify(
      { sources: report.sources, totals: report.totals, enginePicker: report.enginePicker },
      null,
      2,
    ),
  );

  async function tryPreview(platform, voice) {
    if (!voice) return { platform, voice: null, success: false, error: 'no voice' };
    const bodyReq = {
      sceneText: 'Xin chao, kiem tra giong doc.',
      chapterNum: 0,
      sceneIndex: 999,
      isPreview: true,
      voiceName: voice,
      ttsConfig: { platform, language: 'vi', voice, speed: 1, pitch: 0 },
      apiKeys: [],
      ten_tac_pham: 'VoiceAudit',
      applyLoudnorm: false,
      injectBreathPauses: false,
      roomTone: false,
      bgmMix: false,
    };
    const t0 = Date.now();
    try {
      const r = await fetch(`${base}/api/generate-tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyReq),
      });
      const data = await r.json().catch(() => ({}));
      return {
        platform,
        voice,
        status: r.status,
        success: !!data.success,
        cached: !!data.cached,
        method: data.method || '',
        error: String(data.error || '').slice(0, 200),
        duration: data.duration,
        ms: Date.now() - t0,
      };
    } catch (e) {
      return {
        platform,
        voice,
        success: false,
        error: String(e).slice(0, 200),
        ms: Date.now() - t0,
      };
    }
  }

  const results = [];
  for (const p of engines) {
    const ids = report.platforms[p]?.viIds || [];
    let voice = ids[0] || null;
    if (p === 'omnivoice_local') {
      voice =
        ids.find((id) => /^(alloy|nova|echo|onyx|shimmer|fable)$/i.test(id)) ||
        ids.find((id) => /preset/i.test(id)) ||
        ids[0] ||
        null;
    }
    if (p === 'vina_voice') {
      voice = ids.find((id) => !/^USER/i.test(id)) || ids[0] || null;
    }
    if (p === 'edge_tts') {
      voice = ids.includes('vi-VN-HoaiMyNeural') ? 'vi-VN-HoaiMyNeural' : ids[0] || null;
    }
    console.log('previewing', p, '→', voice);
    results.push(await tryPreview(p, voice));
  }

  fs.writeFileSync(previewOut, JSON.stringify(results, null, 2), 'utf8');
  console.log(
    'PREVIEW',
    JSON.stringify(
      results.map((r) => ({
        p: r.platform,
        ok: r.success,
        st: r.status,
        voice: r.voice,
        err: r.error,
        ms: r.ms,
        method: String(r.method || '').slice(0, 70),
      })),
      null,
      2,
    ),
  );
  console.log('DONE', auditOut, previewOut);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
