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
  // IRON B10: đúng voice + rate user chọn — không đổi voice/rate dự phòng
  if (!voiceName || !String(voiceName).trim()) {
    throw new Error('Edge TTS: thiếu voice. Không gán giọng mặc định dự phòng.');
  }
  const rate = speedToEdgeRate(speed);
  const primary = String(voiceName).trim();
  let lastErr: Error | null = null;
  // Bing Edge WS cold-start can exceed 25s on some networks — use 55s × 3 tries.
  // IRON B10: same voice + same rate only (no voice/rate swap fallback).
  const timeouts = [55_000, 70_000, 90_000];
  for (let i = 0; i < timeouts.length; i++) {
    try {
      console.log(
        `[EdgeTTS] try#${i + 1}/${timeouts.length} voice=${primary} rate=${rate} timeout=${timeouts[i]}ms uiSpeed=${speed}`,
      );
      return await edgeOnce(text, primary, rate, timeouts[i]);
    } catch (err) {
      // node-edge-tts rejects with bare string "Timed out" (not Error)
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : String(err);
      lastErr = new Error(msg || 'unknown');
      console.warn(`[EdgeTTS] try#${i + 1} fail: ${lastErr.message}`);
      if (i < timeouts.length - 1) await sleep(600 + i * 400);
    }
  }
  throw new Error(
    `Edge TTS fail voice=${primary} rate=${rate} (không đổi giọng/rate dự phòng): ${lastErr?.message || 'unknown'}`,
  );
}
