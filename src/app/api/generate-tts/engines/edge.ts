import fs from 'fs';
import path from 'path';
import { EdgeTTS } from 'node-edge-tts';

/**
 * Edge SSML prosody rate: "default" | "+20%" | "-30%"
 * Pitch is applied post via FFmpeg (Edge pitch often hangs/timeout).
 */
export function speedToEdgeRate(speed: number): string {
  const s = Number.isFinite(speed) && speed > 0 ? speed : 1;
  if (Math.abs(s - 1) < 0.02) return 'default';
  const pct = Math.round(Math.max(-50, Math.min(100, (s - 1) * 100)));
  return pct >= 0 ? `+${pct}%` : `${pct}%`;
}

/** Kept for tests / callers; Edge pitch SSML is unreliable — prefer FFmpeg. */
export function pitchToEdgePitch(semitones: number): string {
  const p = Number.isFinite(semitones) ? Math.round(semitones) : 0;
  if (p === 0) return 'default';
  const pct = Math.max(-40, Math.min(40, p * 5));
  return pct >= 0 ? `+${pct}%` : `${pct}%`;
}

function inferLang(voiceName: string): string {
  if (!voiceName) return 'vi-VN';
  const parts = voiceName.split('-');
  if (parts.length >= 2) return `${parts[0]}-${parts[1]}`;
  return 'vi-VN';
}

function safeVoiceFor(voiceName: string): string {
  const v = voiceName || '';
  if (/^en-/i.test(v)) {
    return /female|aria|jenny|emma|ava|sara|nancy|michelle|ana|amber|ashley|cora|elizabeth|monica|leah|luna|rosa|yan|emily|molly|clara|natasha|sonia|libby|maisie|neerja/i.test(
      v,
    )
      ? 'en-US-JennyNeural'
      : 'en-US-GuyNeural';
  }
  if (/^zh-/i.test(v)) return 'zh-CN-XiaoxiaoNeural';
  if (/^ja-/i.test(v)) return 'ja-JP-NanamiNeural';
  if (/^ko-/i.test(v)) return 'ko-KR-SunHiNeural';
  if (/^fr-/i.test(v)) return 'fr-FR-DeniseNeural';
  if (/^de-/i.test(v)) return 'de-DE-KatjaNeural';
  if (/^es-/i.test(v)) return 'es-ES-ElviraNeural';
  return /HoaiMy|female|Nu|nữ/i.test(v) ? 'vi-VN-HoaiMyNeural' : 'vi-VN-NamMinhNeural';
}

async function edgeOnce(
  text: string,
  voiceName: string,
  rate: string,
  timeoutMs: number,
): Promise<Buffer> {
  const options = {
    voice: voiceName,
    lang: inferLang(voiceName),
    outputFormat: 'audio-24khz-48kbitrate-mono-mp3' as const,
    rate,
    pitch: 'default' as const,
    volume: 'default' as const,
    timeout: timeoutMs,
  };

  const audioDir = path.join(process.cwd(), 'public', 'audio');
  if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });

  const tempPath = path.join(
    audioDir,
    `temp_edge_${Date.now()}_${Math.random().toString(36).slice(2, 9)}.mp3`,
  );

  try {
    const tts = new EdgeTTS(options);
    await tts.ttsPromise(text, tempPath);
    if (!fs.existsSync(tempPath) || fs.statSync(tempPath).size < 100) {
      throw new Error('Edge TTS empty output');
    }
    return fs.readFileSync(tempPath);
  } finally {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      /* ignore */
    }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Microsoft Edge TTS with retries (handles flaky "unknown" / rate limit).
 * - Applies **rate (speed)** natively via SSML.
 * - Does **not** apply pitch (use FFmpeg post-process).
 */
export async function generateEdgeTTS(
  text: string,
  voiceName: string,
  speed: number = 1.0,
  _pitch: number = 0,
): Promise<Buffer> {
  const rate = speedToEdgeRate(speed);
  const primary = voiceName || 'vi-VN-HoaiMyNeural';
  const safe = safeVoiceFor(primary);

  const attempts: Array<{ voice: string; rate: string; timeout: number; label: string }> = [
    { voice: primary, rate, timeout: 25_000, label: 'primary' },
    { voice: primary, rate: 'default', timeout: 20_000, label: 'primary-default-rate' },
    { voice: safe, rate, timeout: 25_000, label: 'safe-voice' },
    { voice: safe, rate: 'default', timeout: 20_000, label: 'safe-default' },
    {
      voice: 'vi-VN-HoaiMyNeural',
      rate: 'default',
      timeout: 20_000,
      label: 'vi-hoaimy',
    },
  ];

  // Dedupe identical attempts
  const seen = new Set<string>();
  const queue = attempts.filter((a) => {
    const k = `${a.voice}|${a.rate}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  let lastErr: Error | null = null;
  for (let i = 0; i < queue.length; i++) {
    const a = queue[i];
    try {
      console.log(
        `[EdgeTTS] try#${i + 1} ${a.label} voice=${a.voice} rate=${a.rate} (ui speed=${speed})`,
      );
      const buf = await edgeOnce(text, a.voice, a.rate, a.timeout);
      if (i > 0) {
        console.log(`[EdgeTTS] recovered via ${a.label} (${a.voice})`);
      }
      return buf;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      console.warn(`[EdgeTTS] try#${i + 1} fail: ${lastErr.message}`);
      // Brief pause to dodge rate-limit
      await sleep(350 + i * 200);
    }
  }

  throw lastErr || new Error('Edge TTS failed after retries');
}
