import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export function createWavHeader(
  dataLength: number,
  sampleRate = 24000,
  channels = 1,
  bitsPerSample = 16,
): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);
  return header;
}

export function splitTtsText(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let cutIndex = remaining.lastIndexOf('.', maxLen);
    if (cutIndex < 50) cutIndex = remaining.lastIndexOf(' ', maxLen);
    if (cutIndex < 50) cutIndex = maxLen;
    chunks.push(remaining.substring(0, cutIndex + 1).trim());
    remaining = remaining.substring(cutIndex + 1).trim();
  }
  return chunks.filter(Boolean);
}

export function resolveFfmpegCmd(): string {
  const localFfmpeg = path.join(process.cwd(), 'bin', 'ffmpeg.exe');
  if (fs.existsSync(localFfmpeg)) return `"${localFfmpeg}"`;
  return 'ffmpeg';
}

/** Nối nhiều buffer audio (mp3/wav) thành 1 file mp3 bằng ffmpeg concat. */
export async function concatAudioBuffers(
  buffers: Buffer[],
  preferWav = false,
): Promise<Buffer> {
  if (buffers.length === 0) throw new Error('Không có đoạn audio để nối.');
  if (buffers.length === 1) return buffers[0];

  const scratch = path.join(process.cwd(), 'public', 'audio', 'multi');
  if (!fs.existsSync(scratch)) fs.mkdirSync(scratch, { recursive: true });
  const tag = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ext = preferWav ? 'wav' : 'mp3';
  const partPaths: string[] = [];
  const listPath = path.join(scratch, `list_${tag}.txt`);
  const outPath = path.join(scratch, `out_${tag}.mp3`);

  try {
    for (let i = 0; i < buffers.length; i++) {
      const p = path.join(scratch, `part_${tag}_${i}.${ext}`);
      fs.writeFileSync(p, buffers[i]);
      partPaths.push(p);
    }
    const normalized: string[] = [];
    const ffmpeg = resolveFfmpegCmd();
    for (let i = 0; i < partPaths.length; i++) {
      const norm = path.join(scratch, `norm_${tag}_${i}.mp3`);
      execSync(
        `${ffmpeg} -y -i "${partPaths[i]}" -ar 44100 -ac 1 -c:a libmp3lame -q:a 2 "${norm}"`,
        { encoding: 'utf-8', stdio: 'pipe' },
      );
      normalized.push(norm);
    }
    const listBody = normalized.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n');
    fs.writeFileSync(listPath, listBody, 'utf8');
    execSync(
      `${ffmpeg} -y -f concat -safe 0 -i "${listPath}" -c:a libmp3lame -q:a 2 "${outPath}"`,
      { encoding: 'utf-8', stdio: 'pipe' },
    );
    if (!fs.existsSync(outPath)) throw new Error('FFmpeg concat không tạo file đầu ra.');
    return fs.readFileSync(outPath);
  } finally {
    for (const p of [...partPaths, listPath, outPath]) {
      try {
        if (p && fs.existsSync(p)) fs.unlinkSync(p);
      } catch {
        // ignore
      }
    }
    try {
      for (const f of fs.readdirSync(scratch)) {
        if (f.includes(tag)) {
          try {
            fs.unlinkSync(path.join(scratch, f));
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }
  }
}

/** Detect container from magic so FFmpeg probes correctly (WAV vs MP3). */
function detectAudioExt(buf: Buffer): 'wav' | 'mp3' {
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') {
    return 'wav';
  }
  // ID3 or MPEG frame sync
  if (buf.length >= 3 && buf.toString('ascii', 0, 3) === 'ID3') return 'mp3';
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'mp3';
  return 'mp3';
}

/** Pitch / speed / optional broadcast loudnorm (YouTube-friendlier levels). */
export async function applyAudioEffects(
  inputBuffer: Buffer,
  pitchSemitones: number,
  speedFactor: number,
  applyLoudnorm = false,
): Promise<Buffer> {
  const pitch = Number.isFinite(pitchSemitones) ? pitchSemitones : 0;
  const speed = Number.isFinite(speedFactor) && speedFactor > 0 ? speedFactor : 1;
  if (pitch === 0 && Math.abs(speed - 1.0) < 0.001 && !applyLoudnorm) return inputBuffer;

  const audioDir = path.join(process.cwd(), 'public', 'audio');
  if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });

  const ext = detectAudioExt(inputBuffer);
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const tempIn = path.join(audioDir, `temp_in_${stamp}.${ext}`);
  const tempOut = path.join(audioDir, `temp_out_${stamp}.mp3`);

  fs.writeFileSync(tempIn, inputBuffer);

  const filters: string[] = [];

  if (pitch !== 0) {
    // Classic FFmpeg pitch shift (semitones), SR-safe:
    // 1) aresample=44100 — normalize any engine sample rate (Piper 22k, Edge 24k, …)
    // 2) asetrate=44100*f — shift pitch (+ duration)
    // 3) aresample=44100 — restore clock so players keep correct length
    // 4) atempo — undo duration stretch; fold UI speed in the same step
    const rateFactor = Math.pow(2, pitch / 12);
    const newSampleRate = Math.max(8000, Math.min(192000, Math.round(44100 * rateFactor)));
    let tempo = (1 / rateFactor) * speed;

    filters.push('aresample=44100');
    filters.push(`asetrate=${newSampleRate}`);
    filters.push('aresample=44100');

    while (tempo > 2.0) {
      filters.push('atempo=2.0');
      tempo /= 2.0;
    }
    while (tempo < 0.5) {
      filters.push('atempo=0.5');
      tempo /= 0.5;
    }
    if (Math.abs(tempo - 1.0) > 0.001) filters.push(`atempo=${tempo.toFixed(4)}`);
  } else if (Math.abs(speed - 1.0) > 0.001) {
    let tempo = speed;
    while (tempo > 2.0) {
      filters.push('atempo=2.0');
      tempo /= 2.0;
    }
    while (tempo < 0.5) {
      filters.push('atempo=0.5');
      tempo /= 0.5;
    }
    if (Math.abs(tempo - 1.0) > 0.001) filters.push(`atempo=${tempo.toFixed(4)}`);
  }

  if (applyLoudnorm) {
    filters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
  }

  if (filters.length === 0) {
    if (fs.existsSync(tempIn)) fs.unlinkSync(tempIn);
    return inputBuffer;
  }

  try {
    const filterStr = filters.join(',');
    const ffmpegCmd = resolveFfmpegCmd();
    const command = `${ffmpegCmd} -i "${tempIn}" -af "${filterStr}" -y "${tempOut}"`;
    execSync(command, { encoding: 'utf-8', stdio: 'pipe' });

    const outBuffer = fs.readFileSync(tempOut);
    fs.unlinkSync(tempIn);
    fs.unlinkSync(tempOut);
    return outBuffer;
  } catch (err: unknown) {
    if (fs.existsSync(tempIn)) fs.unlinkSync(tempIn);
    if (fs.existsSync(tempOut)) fs.unlinkSync(tempOut);
    if (applyLoudnorm && (pitch !== 0 || Math.abs(speed - 1.0) > 0.001)) {
      console.warn('[TTS] loudnorm failed, retry without loudnorm');
      return applyAudioEffects(inputBuffer, pitch, speed, false);
    }
    if (applyLoudnorm && pitch === 0 && Math.abs(speed - 1.0) < 0.001) {
      console.warn('[TTS] loudnorm failed, returning original buffer');
      return inputBuffer;
    }
    console.error('Lỗi FFmpeg Effects (execSync):', err);
    throw err instanceof Error ? err : new Error(String(err));
  }
}

export async function forceAudioDuration(
  inputBuffer: Buffer,
  targetDuration: number,
): Promise<Buffer> {
  const tempIn = path.join(
    process.cwd(),
    'public',
    'audio',
    `temp_force_in_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`,
  );
  const tempOut = path.join(
    process.cwd(),
    'public',
    'audio',
    `temp_force_out_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`,
  );

  fs.writeFileSync(tempIn, inputBuffer);

  let ffmpegCmd = 'ffmpeg';
  let ffprobeCmd = 'ffprobe';
  const localFfmpeg = path.join(process.cwd(), 'bin', 'ffmpeg.exe');
  const localFfprobe = path.join(process.cwd(), 'bin', 'ffprobe.exe');

  if (fs.existsSync(localFfmpeg)) ffmpegCmd = `"${localFfmpeg}"`;
  if (fs.existsSync(localFfprobe)) ffprobeCmd = `"${localFfprobe}"`;

  try {
    const probeOutput = execSync(
      `${ffprobeCmd} -i "${tempIn}" -show_entries format=duration -v quiet -of csv="p=0"`,
      { encoding: 'utf-8' },
    );
    const currentDuration = parseFloat(probeOutput.trim());

    if (Number.isNaN(currentDuration) || currentDuration <= 0) {
      throw new Error('Không thể xác định thời lượng audio bằng ffprobe.');
    }

    const speedFactor = currentDuration / targetDuration;
    const filters: string[] = [];
    let tempo = speedFactor;
    while (tempo > 2.0) {
      filters.push('atempo=2.0');
      tempo /= 2.0;
    }
    while (tempo < 0.5) {
      filters.push('atempo=0.5');
      tempo /= 0.5;
    }
    if (tempo !== 1.0) filters.push(`atempo=${tempo.toFixed(4)}`);

    const filterStr = filters.join(',') || 'atempo=1.0';
    const command = `${ffmpegCmd} -i "${tempIn}" -af "${filterStr}" -t ${targetDuration} -y "${tempOut}"`;
    execSync(command, { encoding: 'utf-8', stdio: 'pipe' });

    return fs.readFileSync(tempOut);
  } catch (err: unknown) {
    console.error('Lỗi FFmpeg Ép Khớp Timestamp:', err);
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    if (fs.existsSync(tempIn)) fs.unlinkSync(tempIn);
    if (fs.existsSync(tempOut)) fs.unlinkSync(tempOut);
  }
}
