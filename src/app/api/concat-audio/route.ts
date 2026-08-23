/**
 * Concat multiple public audio files → one scene MP3 (+ optional loudnorm / drive save).
 * Used by client multi-cast TTS progress orchestration.
 */
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { driveMediaFilename, localAudioFilename } from '@/contracts';
import { applyAudioStudioMix } from '@/lib/audioStudio';
import { getRuntimePublicPath } from '@/lib/runtimePaths';

export const runtime = 'nodejs';
export const maxDuration = 120;

function resolveFfmpegCmd(): string {
  const localFfmpeg = path.join(process.cwd(), 'bin', 'ffmpeg.exe');
  if (fs.existsSync(localFfmpeg)) return `"${localFfmpeg}"`;
  return 'ffmpeg';
}

function resolvePublicAudioPath(audioPath: string): string | null {
  if (!audioPath || typeof audioPath !== 'string') return null;
  let rel = audioPath.trim().replace(/\\/g, '/');
  // Strip ?t= cache-buster from generate-tts URLs
  const q = rel.indexOf('?');
  if (q >= 0) rel = rel.slice(0, q);
  if (rel.startsWith('http://') || rel.startsWith('https://')) {
    try {
      const u = new URL(rel);
      rel = u.pathname;
    } catch {
      return null;
    }
  }
  if (!rel.startsWith('/')) rel = `/${rel}`;
  if (!rel.startsWith('/audio/')) return null;
  // prevent path traversal
  if (rel.includes('..')) return null;
  const abs = getRuntimePublicPath(rel.replace(/^\//, ''));
  const audioRoot = getRuntimePublicPath('audio');
  if (!abs.startsWith(audioRoot)) return null;
  if (!fs.existsSync(abs)) return null;
  return abs;
}

function isDisposableMultiPart(absPath: string): boolean {
  const audioRoot = getRuntimePublicPath('audio');
  const multiRoot = path.join(audioRoot, 'multi');
  const base = path.basename(absPath);
  const normalized = path.resolve(absPath);
  return (
    normalized.startsWith(path.resolve(multiRoot)) &&
    /^part_[a-zA-Z0-9_-]+\.(mp3|wav)$/i.test(base)
  );
}

function probeDurationSec(filePath: string): number {
  try {
    const ffprobeLocal = path.join(process.cwd(), 'bin', 'ffprobe.exe');
    const ffprobe = fs.existsSync(ffprobeLocal) ? `"${ffprobeLocal}"` : 'ffprobe';
    const out = execSync(
      `${ffprobe} -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const n = parseFloat(String(out).trim());
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

async function concatFiles(absPaths: string[]): Promise<Buffer> {
  if (absPaths.length === 0) throw new Error('Không có file để nối.');
  if (absPaths.length === 1) return fs.readFileSync(absPaths[0]);

  const scratch = getRuntimePublicPath(path.join('audio', 'multi'));
  if (!fs.existsSync(scratch)) fs.mkdirSync(scratch, { recursive: true });
  const tag = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const listPath = path.join(scratch, `list_${tag}.txt`);
  const outPath = path.join(scratch, `out_${tag}.mp3`);
  const normalized: string[] = [];
  const ffmpeg = resolveFfmpegCmd();

  try {
    for (let i = 0; i < absPaths.length; i++) {
      const norm = path.join(scratch, `norm_${tag}_${i}.mp3`);
      execSync(
        `${ffmpeg} -y -i "${absPaths[i]}" -ar 44100 -ac 1 -c:a libmp3lame -q:a 2 "${norm}"`,
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
    if (!fs.existsSync(outPath)) throw new Error('FFmpeg concat failed');
    return fs.readFileSync(outPath);
  } finally {
    try {
      for (const f of fs.readdirSync(scratch)) {
        if (f.includes(tag)) {
          try {
            fs.unlinkSync(path.join(scratch, f));
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore */
    }
  }
}

async function applyLoudnormOnly(input: Buffer): Promise<Buffer> {
  const ffmpeg = resolveFfmpegCmd();
  const tag = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const dir = getRuntimePublicPath('audio');
  const inPath = path.join(dir, `ln_in_${tag}.mp3`);
  const outPath = path.join(dir, `ln_out_${tag}.mp3`);
  try {
    fs.writeFileSync(inPath, input);
    execSync(
      `${ffmpeg} -y -i "${inPath}" -af loudnorm=I=-14:TP=-1.5:LRA=11 -ar 44100 -ac 1 -c:a libmp3lame -q:a 2 "${outPath}"`,
      { encoding: 'utf-8', stdio: 'pipe' },
    );
    return fs.readFileSync(outPath);
  } finally {
    for (const p of [inPath, outPath]) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const paths: string[] = Array.isArray(body.paths) ? body.paths : [];
    const chapterNum = Number(body.chapterNum) || 0;
    const sceneIndex = Number(body.sceneIndex) || 0;
    const drivePath = typeof body.drivePath === 'string' ? body.drivePath : '';
    const ten_tac_pham = typeof body.ten_tac_pham === 'string' ? body.ten_tac_pham : '';
    const applyLoudnorm = body.applyLoudnorm !== false;
    const roomTone = body.roomTone === true;
    const bgmMix = body.bgmMix === true;
    const bgmPath = typeof body.bgmPath === 'string' ? body.bgmPath : '';
    const cleanupPaths = body.cleanup !== false;
    /** scene (default) | chapter — full-chapter master MP3 + optional SRT */
    const outputRole =
      body.outputRole === 'chapter' || body.kind === 'chapter'
        ? 'chapter'
        : 'scene';
    const srtContent =
      typeof body.srtContent === 'string' ? body.srtContent : '';

    if (paths.length < 1) {
      return NextResponse.json({ error: 'paths rỗng.' }, { status: 400 });
    }

    const absPaths: string[] = [];
    for (const p of paths) {
      const abs = resolvePublicAudioPath(p);
      if (!abs) {
        return NextResponse.json(
          { error: `Đường dẫn audio không hợp lệ hoặc ngoài /audio: ${p}` },
          { status: 400 },
        );
      }
      absPaths.push(abs);
    }

    let buffer = await concatFiles(absPaths);

    if (applyLoudnorm) {
      try {
        buffer = await applyLoudnormOnly(buffer);
      } catch (e) {
        console.warn('[concat-audio] loudnorm skipped', e);
      }
    }

    if (roomTone || bgmMix) {
      try {
        const mixed = await applyAudioStudioMix(buffer, {
          roomTone,
          bgmMix,
          bgmPath,
          loudnormI: -14,
        });
        buffer = mixed.buffer;
      } catch (e) {
        console.warn('[concat-audio] studio mix skipped', e);
      }
    }

    const publicAudioDir = path.join(process.cwd(), 'public', 'audio');
    if (!fs.existsSync(publicAudioDir)) fs.mkdirSync(publicAudioDir, { recursive: true });

    const scriptTitle = ten_tac_pham
      ? ten_tac_pham.replace(/[/\\:*?"<>|]/g, '_').trim()
      : 'Kịch Bản';
    const safeTitle = scriptTitle || 'KichBan';

    let filename: string;
    let driveFilename: string;
    let srtLocalName: string;
    let srtDriveName: string;
    if (outputRole === 'chapter') {
      filename = `chapter_${chapterNum}_full.mp3`;
      driveFilename = `${safeTitle}_Chuong_${chapterNum}_Full.mp3`;
      srtLocalName = `chapter_${chapterNum}_full.srt`;
      srtDriveName = `${safeTitle}_Chuong_${chapterNum}_Full.srt`;
    } else {
      filename = localAudioFilename(chapterNum, sceneIndex, 'mp3');
      driveFilename = driveMediaFilename(scriptTitle, chapterNum, sceneIndex, {
        kind: 'audio',
        ext: 'mp3',
      });
      srtLocalName = filename.replace(/\.mp3$/i, '.srt');
      srtDriveName = driveFilename.replace(/\.mp3$/i, '.srt');
    }

    const localSavePath = path.join(publicAudioDir, filename);
    fs.writeFileSync(localSavePath, buffer);
    const audioPathRet = `/audio/${filename}`;

    let localSrtPath = '';
    if (srtContent.trim()) {
      localSrtPath = path.join(publicAudioDir, srtLocalName);
      fs.writeFileSync(localSrtPath, srtContent, 'utf8');
    }

    let driveSaved = false;
    let driveFilePath = '';
    let driveSrtPath = '';
    if (drivePath?.trim()) {
      try {
        let driveFolder = drivePath.trim();
        if (chapterNum > 0) {
          driveFolder = path.join(driveFolder, `Chương ${chapterNum}`);
        }
        if (!fs.existsSync(driveFolder)) fs.mkdirSync(driveFolder, { recursive: true });
        driveFilePath = path.join(driveFolder, driveFilename);
        fs.writeFileSync(driveFilePath, buffer);
        driveSaved = true;
        if (srtContent.trim()) {
          driveSrtPath = path.join(driveFolder, srtDriveName);
          fs.writeFileSync(driveSrtPath, srtContent, 'utf8');
        }
      } catch (e) {
        console.warn('[concat-audio] drive save failed', e);
      }
    }

    let duration = probeDurationSec(localSavePath);
    if (!(duration > 0)) duration = Math.max(5, Math.round(buffer.length / 16000));

    // cleanup temp multi part files (client multi uses sceneIndex 99xxx)
    if (cleanupPaths) {
      for (const abs of absPaths) {
        try {
          const base = path.basename(abs);
          if (/scene_99\d+/.test(base) || /_multi_part_/.test(base) || isDisposableMultiPart(abs)) {
            fs.unlinkSync(abs);
          }
        } catch {
          /* ignore */
        }
      }
    }

    return NextResponse.json({
      success: true,
      audioPath: audioPathRet,
      duration: Math.round(duration),
      driveSaved,
      driveFilePath,
      driveSrtPath: driveSrtPath || undefined,
      localSrtPath: localSrtPath || undefined,
      srtPath: driveSrtPath || localSrtPath || undefined,
      outputRole,
      segmentCount: absPaths.length,
      method: `concat-audio (${absPaths.length} parts${outputRole === 'chapter' ? ', chapter full' : ''})`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[concat-audio]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
