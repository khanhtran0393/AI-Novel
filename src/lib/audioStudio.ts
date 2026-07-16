/**
 * YouTube audio studio post: room tone, optional BGM bed, loudnorm mix.
 * Node-only (ffmpeg). Used by generate-tts / audio-studio API.
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export function resolveFfmpegCmd(cwd = process.cwd()): string {
  const local = path.join(cwd, 'bin', 'ffmpeg.exe');
  if (fs.existsSync(local)) return `"${local}"`;
  return 'ffmpeg';
}

export function resolveFfprobeCmd(cwd = process.cwd()): string {
  const local = path.join(cwd, 'bin', 'ffprobe.exe');
  if (fs.existsSync(local)) return `"${local}"`;
  return 'ffprobe';
}

export function probeDurationSec(filePath: string, cwd = process.cwd()): number {
  try {
    const ffprobe = resolveFfprobeCmd(cwd);
    const out = execSync(
      `${ffprobe} -i "${filePath}" -show_entries format=duration -v quiet -of csv="p=0"`,
      { encoding: 'utf-8', stdio: 'pipe' },
    );
    const d = parseFloat(String(out).trim());
    return Number.isFinite(d) && d > 0 ? d : 0;
  } catch {
    return 0;
  }
}

function scratchPaths(cwd: string, tag: string) {
  const dir = path.join(cwd, 'public', 'audio', 'studio');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const id = `${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    dir,
    in: path.join(dir, `${id}_in.mp3`),
    out: path.join(dir, `${id}_out.mp3`),
    bg: path.join(dir, `${id}_bg.mp3`),
  };
}

export interface AudioStudioOptions {
  roomTone?: boolean;
  bgmMix?: boolean;
  bgmPath?: string;
  /** Integrated loudness target for full mix (YouTube-ish) */
  loudnormI?: number;
  cwd?: string;
}

/**
 * Mix voice with subtle pink room tone and optional BGM bed, then loudnorm.
 * Falls back to original buffer on failure.
 */
export async function applyAudioStudioMix(
  inputBuffer: Buffer,
  options: AudioStudioOptions = {},
): Promise<{ buffer: Buffer; applied: string[] }> {
  const cwd = options.cwd || process.cwd();
  const applied: string[] = [];
  const roomTone = options.roomTone !== false;
  const bgmMix = !!options.bgmMix;
  const bgmPath = (options.bgmPath || '').trim();
  const loudI = options.loudnormI ?? -14;

  if (!roomTone && !bgmMix) {
    return { buffer: inputBuffer, applied };
  }

  const paths = scratchPaths(cwd, 'mix');
  fs.writeFileSync(paths.in, inputBuffer);
  const dur = probeDurationSec(paths.in, cwd) || 30;
  const ffmpeg = resolveFfmpegCmd(cwd);

  try {
    const filters: string[] = [];
    const inputs = [`-i "${paths.in}"`];
    let inputCount = 1;

    // Pink room tone (very low)
    if (roomTone) {
      inputs.push(
        `-f lavfi -i "anoisesrc=color=pink:amplitude=0.004:sample_rate=44100:duration=${Math.max(1, dur).toFixed(3)}"`,
      );
      filters.push(`[${inputCount}:a]volume=0.045,aformat=sample_fmts=fltp:channel_layouts=mono[rn]`);
      inputCount += 1;
      applied.push('room_tone');
    }

    // BGM bed
    let hasBgm = false;
    if (bgmMix && bgmPath && fs.existsSync(bgmPath)) {
      inputs.push(`-stream_loop -1 -i "${bgmPath}"`);
      filters.push(
        `[${inputCount}:a]atrim=0:${Math.max(1, dur).toFixed(3)},asetpts=PTS-STARTPTS,volume=0.11,aformat=sample_fmts=fltp:channel_layouts=mono[bg]`,
      );
      inputCount += 1;
      hasBgm = true;
      applied.push('bgm_bed');
    } else if (bgmMix && !bgmPath) {
      // Soft synthetic bed (low sine drone) when no file — still better than dry mono
      inputs.push(
        `-f lavfi -i "sine=frequency=110:sample_rate=44100:duration=${Math.max(1, dur).toFixed(3)}"`,
      );
      filters.push(`[${inputCount}:a]volume=0.03,aformat=sample_fmts=fltp:channel_layouts=mono[bg]`);
      inputCount += 1;
      hasBgm = true;
      applied.push('synth_bed');
    }

    // Voice normalize light
    filters.push(`[0:a]aformat=sample_fmts=fltp:channel_layouts=mono,volume=1.0[vx]`);

    const mixParts = ['[vx]'];
    if (roomTone) mixParts.push('[rn]');
    if (hasBgm) mixParts.push('[bg]');

    const n = mixParts.length;
    filters.push(
      `${mixParts.join('')}amix=inputs=${n}:duration=first:dropout_transition=0:normalize=0[mix]`,
    );
    filters.push(`[mix]loudnorm=I=${loudI}:TP=-1.5:LRA=11[out]`);
    applied.push('loudnorm_mix');

    const fc = filters.join(';');
    const cmd = `${ffmpeg} ${inputs.join(' ')} -filter_complex "${fc}" -map "[out]" -y "${paths.out}"`;
    execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' });

    const out = fs.readFileSync(paths.out);
    cleanup(paths);
    return { buffer: out, applied };
  } catch (err) {
    cleanup(paths);
    // IRON B10: không trả buffer gốc im lặng — user phải thấy lỗi mix thật
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `AudioStudio mix thất bại (không fallback audio gốc): ${msg}. Kiểm tra FFmpeg / roomTone / BGM path.`,
    );
  }
}

function cleanup(paths: { in: string; out: string; bg: string }) {
  for (const p of [paths.in, paths.out, paths.bg]) {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
}
