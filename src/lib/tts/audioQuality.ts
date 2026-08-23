/**
 * Node-only signal guard for generated TTS and durable preview cache files.
 * Decodes every container through the bundled FFmpeg, then inspects mono PCM16.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { getPrimaryFfmpegPath } from '@/lib/ffmpeg/ffmpegPaths';

const AUDIT_SAMPLE_RATE = 16_000;

export type TtsAudioQuality = {
  ok: boolean;
  classification: 'speech-like' | 'invalid';
  reasons: string[];
  durationSec: number;
  rmsDb: number;
  peak: number;
  clipRatio: number;
  zeroCrossingRate: number;
  discontinuityRatio: number;
  differenceEnergyRatio: number;
};

type DecodedPcm16 = {
  pcm: Buffer;
  sampleRate: number;
};

function resolveFfmpeg(cwd: string): string {
  return getPrimaryFfmpegPath(cwd);
}

function invalidQuality(reason: string): TtsAudioQuality {
  return {
    ok: false,
    classification: 'invalid',
    reasons: [reason],
    durationSec: 0,
    rmsDb: -Infinity,
    peak: 0,
    clipRatio: 0,
    zeroCrossingRate: 0,
    discontinuityRatio: 0,
    differenceEnergyRatio: 0,
  };
}

function decodePcm16Wav(buffer: Buffer): DecodedPcm16 | null {
  if (buffer.length < 44) return null;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF') return null;
  if (buffer.toString('ascii', 8, 12) !== 'WAVE') return null;

  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let audioFormat = 0;
  let dataStart = -1;
  let dataSize = 0;

  for (let offset = 12; offset + 8 <= buffer.length;) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = Math.min(chunkStart + chunkSize, buffer.length);

    if (chunkId === 'fmt ' && chunkSize >= 16 && chunkEnd <= buffer.length) {
      audioFormat = buffer.readUInt16LE(chunkStart);
      channels = buffer.readUInt16LE(chunkStart + 2);
      sampleRate = buffer.readUInt32LE(chunkStart + 4);
      bitsPerSample = buffer.readUInt16LE(chunkStart + 14);
    } else if (chunkId === 'data' && chunkSize > 0) {
      dataStart = chunkStart;
      dataSize = Math.max(0, chunkEnd - chunkStart);
    }

    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  if (
    audioFormat !== 1 ||
    channels <= 0 ||
    sampleRate <= 0 ||
    bitsPerSample !== 16 ||
    dataStart < 0 ||
    dataSize <= 0
  ) {
    return null;
  }

  const data = buffer.subarray(dataStart, dataStart + dataSize);
  if (channels === 1) {
    return { pcm: Buffer.from(data), sampleRate };
  }

  const frameSize = channels * 2;
  const frames = Math.floor(data.length / frameSize);
  const mono = Buffer.alloc(frames * 2);
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    const base = frame * frameSize;
    for (let channel = 0; channel < channels; channel += 1) {
      sum += data.readInt16LE(base + channel * 2);
    }
    const mixed = Math.max(-32768, Math.min(32767, Math.round(sum / channels)));
    mono.writeInt16LE(mixed, frame * 2);
  }

  return { pcm: mono, sampleRate };
}

export function analyzePcm16Signal(
  pcm: Buffer,
  sampleRate = AUDIT_SAMPLE_RATE,
): TtsAudioQuality {
  const sampleCount = Math.floor(pcm.length / 2);
  if (sampleCount < Math.floor(sampleRate * 0.1)) {
    return invalidQuality('audio quá ngắn hoặc không giải mã được PCM');
  }

  let sumSquares = 0;
  let diffSquares = 0;
  let peak = 0;
  let clipped = 0;
  let zeroCrossings = 0;
  let discontinuities = 0;
  let previous = pcm.readInt16LE(0) / 32768;

  for (let i = 0; i < sampleCount; i += 1) {
    const value = pcm.readInt16LE(i * 2) / 32768;
    const abs = Math.abs(value);
    sumSquares += value * value;
    if (abs > peak) peak = abs;
    if (abs >= 0.999) clipped += 1;
    if (i > 0) {
      const diff = value - previous;
      diffSquares += diff * diff;
      if ((value < 0) !== (previous < 0)) zeroCrossings += 1;
      if (Math.abs(diff) >= 0.95) discontinuities += 1;
    }
    previous = value;
  }

  const meanSquares = sumSquares / sampleCount;
  const rms = Math.sqrt(meanSquares);
  const rmsDb = 20 * Math.log10(Math.max(rms, 1e-12));
  const adjacentCount = Math.max(1, sampleCount - 1);
  const clipRatio = clipped / sampleCount;
  const zeroCrossingRate = zeroCrossings / adjacentCount;
  const discontinuityRatio = discontinuities / adjacentCount;
  const differenceEnergyRatio =
    meanSquares > 1e-12
      ? diffSquares / adjacentCount / (2 * meanSquares)
      : 0;
  const durationSec = sampleCount / sampleRate;

  const reasons: string[] = [];
  if (durationSec < 0.35) reasons.push('audio ngắn hơn 0,35 giây');
  if (rmsDb < -52) reasons.push(`gần như im lặng (${rmsDb.toFixed(1)} dBFS)`);
  if (clipRatio > 0.005) {
    reasons.push(`vỡ đỉnh ${(clipRatio * 100).toFixed(2)}% mẫu`);
  }
  if (discontinuityRatio > 0.001) {
    reasons.push(
      `bước nhảy tín hiệu ${(discontinuityRatio * 100).toFixed(3)}%`,
    );
  }
  if (zeroCrossingRate > 0.23 && differenceEnergyRatio > 0.08) {
    reasons.push(
      `tín hiệu giống nhiễu (ZCR=${zeroCrossingRate.toFixed(3)}, diff=${differenceEnergyRatio.toFixed(3)})`,
    );
  }

  return {
    ok: reasons.length === 0,
    classification: reasons.length === 0 ? 'speech-like' : 'invalid',
    reasons,
    durationSec,
    rmsDb,
    peak,
    clipRatio,
    zeroCrossingRate,
    discontinuityRatio,
    differenceEnergyRatio,
  };
}

export function inspectTtsAudioFile(
  filePath: string,
  cwd = process.cwd(),
): TtsAudioQuality {
  if (!fs.existsSync(filePath)) return invalidQuality('file audio không tồn tại');
  try {
    const direct = decodePcm16Wav(fs.readFileSync(filePath));
    if (direct) return analyzePcm16Signal(direct.pcm, direct.sampleRate);
  } catch {
    /* Fall through to FFmpeg for compressed or unusual containers. */
  }
  try {
    const pcm = execFileSync(
      resolveFfmpeg(cwd),
      [
        '-v',
        'error',
        '-i',
        filePath,
        '-f',
        's16le',
        '-ac',
        '1',
        '-ar',
        String(AUDIT_SAMPLE_RATE),
        'pipe:1',
      ],
      { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
    );
    return analyzePcm16Signal(pcm, AUDIT_SAMPLE_RATE);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return invalidQuality(
      `FFmpeg không giải mã được audio: ${message.slice(0, 180)}. ` +
        'Bản app cần kèm bin/ffmpeg.exe hoặc cập nhật bản mới.',
    );
  }
}

export function inspectTtsAudioBuffer(
  buffer: Buffer,
  cwd = process.cwd(),
): TtsAudioQuality {
  const direct = decodePcm16Wav(buffer);
  if (direct) return analyzePcm16Signal(direct.pcm, direct.sampleRate);

  const tempPath = path.join(
    os.tmpdir(),
    `ainovel-tts-audit-${process.pid}-${crypto.randomUUID()}.audio`,
  );
  try {
    fs.writeFileSync(tempPath, buffer);
    return inspectTtsAudioFile(tempPath, cwd);
  } finally {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      /* best-effort temp cleanup */
    }
  }
}

export function assertTtsAudioBufferQuality(
  buffer: Buffer,
  label: string,
  cwd = process.cwd(),
): TtsAudioQuality {
  const quality = inspectTtsAudioBuffer(buffer, cwd);
  if (!quality.ok) {
    throw new Error(
      `${label}: audio bị từ chối vì ${quality.reasons.join('; ')}. ` +
        'Không lưu cache và không phát file này.',
    );
  }
  return quality;
}
