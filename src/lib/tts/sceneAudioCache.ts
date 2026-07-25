/**
 * Durable cache for full scene TTS (kịch bản), not only preview.
 * Key = platform + voice + text + prosody + seeds + sample mtime.
 * Retries / re-gen same scene text hit disk instead of re-running ONNX.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { inspectTtsAudioFile } from './audioQuality';

/** Invalidate scenes rendered before the conditioning + signal-quality fixes. */
const SCENE_CACHE_VERSION = 'v2-conditioning-quality';
/** Invalidate Piper scenes whose WAV filenames could contain an MP3 studio mix. */
const PIPER_SCENE_CACHE_VERSION = 'v2-container-format-44100hz';

export type SceneCacheKeyInput = {
  platform: string;
  voice: string;
  speed: number;
  pitch: number;
  text: string;
  speakerSeed?: number;
  styleSeed?: number;
  nfeStep?: number;
  variantKey?: string;
  samplePath?: string;
  /** multi-voice fingerprint optional */
  multiSig?: string;
};

function sampleFingerprint(samplePath?: string): string {
  if (!samplePath || !fs.existsSync(samplePath)) return 'nosample';
  try {
    const st = fs.statSync(samplePath);
    return `${st.size}-${Math.trunc(st.mtimeMs)}`;
  } catch {
    return 'nosample';
  }
}

export function buildSceneCacheId(input: SceneCacheKeyInput): string {
  const platform = String(input.platform || '').toLowerCase();
  const payload = [
    ...(platform === 'vina_voice' ? [SCENE_CACHE_VERSION] : []),
    ...(platform === 'piper' ? [PIPER_SCENE_CACHE_VERSION] : []),
    platform,
    String(input.voice || '').trim(),
    String(Number(input.speed) || 1),
    String(Number(input.pitch) || 0),
    String(input.text || '').trim().slice(0, 8000),
    String(input.speakerSeed ?? ''),
    String(input.styleSeed ?? ''),
    String(input.nfeStep ?? ''),
    String(input.variantKey ?? ''),
    sampleFingerprint(input.samplePath),
    String(input.multiSig || ''),
  ].join('|');
  return crypto.createHash('sha1').update(payload, 'utf8').digest('hex').slice(0, 24);
}

function roots(cwd = process.cwd()) {
  return {
    durable: path.join(cwd, 'data', 'tts-scene-cache'),
    publicDir: path.join(cwd, 'public', 'audio', 'scene-cache'),
  };
}

export function tryReadSceneCache(
  input: SceneCacheKeyInput,
  ext: 'wav' | 'mp3',
  cwd = process.cwd(),
): { publicUrl: string; filename: string; method: string } | null {
  const id = buildSceneCacheId(input);
  const safePlat = String(input.platform || 'tts').replace(/[^a-z0-9]/gi, '_').slice(0, 20);
  const filename = `sc_${safePlat}_${id}.${ext}`;
  const { durable, publicDir } = roots(cwd);
  const durablePath = path.join(durable, filename);
  const publicPath = path.join(publicDir, filename);
  const publicUrl = `/audio/scene-cache/${filename}`;

  for (const p of [publicPath, durablePath]) {
    if (!fs.existsSync(p)) continue;
    try {
      const st = fs.statSync(p);
      if (st.size < 800) continue;
      const quality = inspectTtsAudioFile(p, cwd);
      if (!quality.ok) {
        console.warn(
          `[TTS Scene] reject corrupt cache ${filename}: ${quality.reasons.join('; ')}`,
        );
        continue;
      }
      if (p === durablePath) {
        if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
        if (!fs.existsSync(publicPath) || fs.statSync(publicPath).size < 800) {
          fs.copyFileSync(durablePath, publicPath);
        }
      }
      return {
        publicUrl,
        filename,
        method: `Scene cache HIT (${input.voice}) · ${id}`,
      };
    } catch {
      /* next */
    }
  }
  return null;
}

export function writeSceneCache(
  input: SceneCacheKeyInput,
  ext: 'wav' | 'mp3',
  buffer: Buffer,
  cwd = process.cwd(),
): { publicUrl: string; filename: string; publicPath: string } {
  const id = buildSceneCacheId(input);
  const safePlat = String(input.platform || 'tts').replace(/[^a-z0-9]/gi, '_').slice(0, 20);
  const filename = `sc_${safePlat}_${id}.${ext}`;
  const { durable, publicDir } = roots(cwd);
  if (!fs.existsSync(durable)) fs.mkdirSync(durable, { recursive: true });
  if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
  const durablePath = path.join(durable, filename);
  const publicPath = path.join(publicDir, filename);
  fs.writeFileSync(durablePath, buffer);
  fs.writeFileSync(publicPath, buffer);
  return {
    filename,
    publicUrl: `/audio/scene-cache/${filename}`,
    publicPath,
  };
}
