/**
 * FableCut bridge — builds Premiere-style project.json timelines from AI Novel
 * chapter assets (images + TTS audio) and can start/stop the FableCut server.
 *
 * Target: D:\repo\FableCut-main (zero-dep Node server on :7777).
 */
import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { ensureWorkDirs, getIntegrationPaths, localFfmpegBin } from './paths';

export const FABLECUT_DEFAULT_PORT = 7777;

export interface FableClipInput {
  id?: string;
  /** Absolute path to image/video/audio on disk */
  mediaPath: string;
  kind: 'video' | 'audio' | 'image';
  track?: number;
  startSec?: number;
  durationSec?: number;
  label?: string;
  /** Optional title overlay text */
  titleText?: string;
}

export interface FableProjectBuildInput {
  name: string;
  width?: number;
  height?: number;
  fps?: number;
  clips: FableClipInput[];
  /** If true, write into FableCut-main/project.json + media/ (live editor). Else exports/integrations/fablecut/ */
  liveEditor?: boolean;
  aspect?: '16:9' | '9:16' | '1:1' | '4:5';
}

export interface FableProjectBuildResult {
  success: boolean;
  projectPath: string;
  mediaDir: string;
  project: Record<string, unknown>;
  clipCount: number;
  mediaCount: number;
  editorUrl?: string;
  error?: string;
}

const g = globalThis as unknown as {
  __ainovelFableCutProc?: ChildProcess | null;
  __ainovelFableCutPort?: number;
};

function aspectSize(aspect: FableProjectBuildInput['aspect']): { width: number; height: number } {
  switch (aspect) {
    case '9:16':
      return { width: 1080, height: 1920 };
    case '1:1':
      return { width: 1080, height: 1080 };
    case '4:5':
      return { width: 1080, height: 1350 };
    case '16:9':
    default:
      return { width: 1920, height: 1080 };
  }
}

function safeName(name: string): string {
  return name.replace(/[^\w.\- ()\[\]]+/g, '_').slice(0, 120) || 'file';
}

function copyIntoMedia(src: string, mediaDir: string, preferredName?: string): string | null {
  if (!src || !fs.existsSync(src)) return null;
  fs.mkdirSync(mediaDir, { recursive: true });
  const base = safeName(preferredName || path.basename(src));
  let dest = path.join(/* turbopackIgnore: true */ mediaDir, base);
  if (
    fs.existsSync(dest) &&
    path.resolve(/* turbopackIgnore: true */ dest) !==
      path.resolve(/* turbopackIgnore: true */ src)
  ) {
    const ext = path.extname(base);
    const stem = path.basename(base, ext);
    dest = path.join(
      /* turbopackIgnore: true */ mediaDir,
      `${stem}_${Date.now()}${ext}`,
    );
  }
  if (
    path.resolve(/* turbopackIgnore: true */ dest) !==
    path.resolve(/* turbopackIgnore: true */ src)
  ) {
    fs.copyFileSync(src, dest);
  }
  return dest;
}

/**
 * Build a FableCut-compatible project.json from chapter media.
 * Schema follows FableCut CLAUDE.md: { name, width, height, fps, revision, media[], clips[] }.
 */
export function buildFableCutProject(input: FableProjectBuildInput): FableProjectBuildResult {
  try {
    const paths = getIntegrationPaths();
    ensureWorkDirs(paths);

    const hasEditor =
      fs.existsSync(paths.fablecut) &&
      fs.existsSync(path.join(paths.fablecut, 'server.js'));

    // Ship-ready: always allow export under exports/integrations/fablecut
    // Live editor only when vendor/ or D:\repo FableCut is present
    if (input.liveEditor && !hasEditor) {
      console.warn(
        `[FableCut] liveEditor requested but editor missing at ${paths.fablecut} — falling back to export pack only`,
      );
    }

    const size = aspectSize(input.aspect || '9:16');
    const width = input.width || size.width;
    const height = input.height || size.height;
    const fps = input.fps || 30;

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const packName = safeName(input.name || 'AI-Novel') + `_${stamp}`;

    let projectRoot: string;
    let mediaDir: string;
    let projectPath: string;

    const useLive = Boolean(input.liveEditor && hasEditor);
    if (useLive) {
      projectRoot = paths.fablecut;
      mediaDir = path.join(paths.fablecut, 'media');
      projectPath = path.join(paths.fablecut, 'project.json');
    } else {
      projectRoot = path.join(paths.fablecutExport, packName);
      mediaDir = path.join(projectRoot, 'media');
      projectPath = path.join(projectRoot, 'project.json');
    }

    fs.mkdirSync(mediaDir, { recursive: true });

    const media: Array<Record<string, unknown>> = [];
    const clips: Array<Record<string, unknown>> = [];
    let cursor = 0;
    let mediaIdx = 0;

    for (const c of input.clips) {
      const copied = copyIntoMedia(c.mediaPath, mediaDir, c.label ? `${safeName(c.label)}${path.extname(c.mediaPath)}` : undefined);
      if (!copied) continue;

      const mediaId = `m_${mediaIdx++}`;
      const rel = path.basename(copied);
      media.push({
        id: mediaId,
        name: rel,
        path: `media/${rel}`,
        kind: c.kind === 'image' ? 'image' : c.kind,
        duration: c.durationSec ?? (c.kind === 'image' ? 5 : undefined),
      });

      const start = c.startSec ?? cursor;
      const dur = c.durationSec ?? (c.kind === 'audio' ? 5 : 5);
      const track =
        c.track ??
        (c.kind === 'audio' ? 4 : 0); // FableCut: video tracks 0-3, audio 4-6 typical

      clips.push({
        id: c.id || `c_${clips.length}`,
        mediaId,
        track,
        start,
        duration: dur,
        props:
          c.kind === 'image'
            ? { fit: 'cover', filterPreset: 'cinematic' }
            : c.kind === 'audio'
              ? { volume: 1 }
              : { fit: 'cover' },
      });

      if (c.titleText) {
        clips.push({
          id: `t_${clips.length}`,
          kind: 'title',
          track: 1,
          start,
          duration: Math.min(3, dur),
          props: {
            text: c.titleText,
            style: 'Neon',
            fontSize: 48,
            align: 'center',
          },
        });
      }

      if (c.kind !== 'audio') {
        cursor = Math.max(cursor, start + dur);
      }
    }

    // Bump revision if live-editing existing project
    let revision = 1;
    if (useLive && fs.existsSync(projectPath)) {
      try {
        const prev = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
        revision = (Number(prev.revision) || 0) + 1;
      } catch {
        revision = 1;
      }
    }

    const project = {
      name: input.name || packName,
      width,
      height,
      fps,
      revision,
      media,
      clips,
      meta: {
        source: 'ai-novel-fablecut-bridge',
        builtAt: new Date().toISOString(),
        packName,
        liveEditor: useLive,
        fablecutRoot: paths.fablecut,
      },
    };

    fs.mkdirSync(path.dirname(projectPath), { recursive: true });
    fs.writeFileSync(projectPath, JSON.stringify(project, null, 2), 'utf8');

    // Always keep a backup under exports/ when writing live
    if (useLive) {
      const backupDir = path.join(paths.fablecutExport, packName);
      fs.mkdirSync(backupDir, { recursive: true });
      fs.writeFileSync(path.join(backupDir, 'project.json'), JSON.stringify(project, null, 2), 'utf8');
    }

    return {
      success: true,
      projectPath,
      mediaDir,
      project,
      clipCount: clips.length,
      mediaCount: media.length,
      editorUrl: hasEditor ? `http://127.0.0.1:${FABLECUT_DEFAULT_PORT}` : undefined,
    };
  } catch (err) {
    const e = err as Error;
    return {
      success: false,
      projectPath: '',
      mediaDir: '',
      project: {},
      clipCount: 0,
      mediaCount: 0,
      error: e.message,
    };
  }
}

/** Build timeline from chapter image map + optional audio path. */
export function buildFromChapterAssets(opts: {
  name: string;
  imagePaths: string[];
  audioPath?: string;
  /** Prefer store TTS duration; will re-probe disk if audioDurationSec missing */
  audioDurationSec?: number;
  secondsPerImage?: number;
  aspect?: FableProjectBuildInput['aspect'];
  liveEditor?: boolean;
  title?: string;
}): FableProjectBuildResult {
  const n = opts.imagePaths.length;
  let audioDur = Number(opts.audioDurationSec);
  if ((!Number.isFinite(audioDur) || audioDur <= 0) && opts.audioPath) {
    try {
      // Lazy require to avoid circular deps in edge runtimes
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { probeDurationSec } = require('@/lib/audioStudio') as typeof import('@/lib/audioStudio');
      audioDur = probeDurationSec(opts.audioPath);
    } catch {
      audioDur = 0;
    }
  }

  let sec: number;
  if (Number.isFinite(audioDur) && audioDur > 0 && n > 0) {
    // Stretch stills to match TTS narration length (core ship stability)
    sec = Math.max(1.5, audioDur / n);
  } else if (opts.secondsPerImage && opts.secondsPerImage > 0) {
    sec = opts.secondsPerImage;
  } else {
    return {
      success: false,
      projectPath: '',
      mediaDir: '',
      project: {},
      clipCount: 0,
      mediaCount: 0,
      error:
        'FableCut: thieu secondsPerImage va khong probe duoc duration TTS. Gen TTS truoc hoac truyen audioDurationSec.',
    };
  }

  const clips: FableClipInput[] = [];
  let t = 0;

  opts.imagePaths.forEach((img, i) => {
    clips.push({
      mediaPath: img,
      kind: 'image',
      track: 0,
      startSec: t,
      durationSec: sec,
      label: `shot_${String(i + 1).padStart(3, '0')}`,
      titleText: i === 0 ? opts.title : undefined,
    });
    t += sec;
  });

  if (opts.audioPath) {
    const audioLen =
      Number.isFinite(audioDur) && audioDur > 0 ? audioDur : t;
    clips.push({
      mediaPath: opts.audioPath,
      kind: 'audio',
      track: 4,
      startSec: 0,
      durationSec: audioLen,
      label: 'narration',
    });
    // If audio longer than still sum, pad last still
    if (audioLen > t + 0.05 && clips.length > 1) {
      const lastStill = clips[clips.length - 2];
      if (lastStill.kind === 'image') {
        lastStill.durationSec = (lastStill.durationSec || sec) + (audioLen - t);
      }
    }
  }

  return buildFableCutProject({
    name: opts.name,
    clips,
    aspect: opts.aspect || '9:16',
    liveEditor: opts.liveEditor !== false,
  });
}

export async function isFableCutServerUp(port = FABLECUT_DEFAULT_PORT): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });
    return res.ok || res.status === 200 || res.status === 304;
  } catch {
    return false;
  }
}

export function startFableCutServer(port = FABLECUT_DEFAULT_PORT): {
  success: boolean;
  pid?: number;
  port: number;
  url: string;
  alreadyRunning?: boolean;
  error?: string;
} {
  const paths = getIntegrationPaths();
  const serverJs = path.join(paths.fablecut, 'server.js');
  if (!fs.existsSync(serverJs)) {
    return { success: false, port, url: `http://127.0.0.1:${port}`, error: `server.js missing: ${serverJs}` };
  }

  if (g.__ainovelFableCutProc && !g.__ainovelFableCutProc.killed) {
    return {
      success: true,
      pid: g.__ainovelFableCutProc.pid,
      port: g.__ainovelFableCutPort || port,
      url: `http://127.0.0.1:${g.__ainovelFableCutPort || port}`,
      alreadyRunning: true,
    };
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
  };
  const ffmpeg = localFfmpegBin();
  if (ffmpeg) {
    env.PATH = `${path.dirname(ffmpeg)};${env.PATH || ''}`;
  }

  try {
    // Use process.execPath so Windows finds node even when `node` is not on PATH for spawn
    const nodeBin = process.execPath;
    const child = spawn(nodeBin, [serverJs], {
      cwd: paths.fablecut,
      env,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('error', (err) => {
      console.error('[FableCut] spawn error:', err.message);
      g.__ainovelFableCutProc = null;
    });
    child.unref();
    g.__ainovelFableCutProc = child;
    g.__ainovelFableCutPort = port;
    return {
      success: true,
      pid: child.pid,
      port,
      url: `http://127.0.0.1:${port}`,
    };
  } catch (err) {
    return {
      success: false,
      port,
      url: `http://127.0.0.1:${port}`,
      error: (err as Error).message,
    };
  }
}

export function stopFableCutServer(): { success: boolean; message: string } {
  const proc = g.__ainovelFableCutProc;
  if (!proc || proc.killed) {
    g.__ainovelFableCutProc = null;
    return { success: true, message: 'No managed FableCut process' };
  }
  try {
    if (process.platform === 'win32' && proc.pid) {
      spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      proc.kill('SIGTERM');
    }
    g.__ainovelFableCutProc = null;
    return { success: true, message: 'FableCut process stopped' };
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}

export function fableCutStatus() {
  const paths = getIntegrationPaths();
  const ready = fs.existsSync(path.join(paths.fablecut, 'server.js'));
  return {
    ready,
    path: paths.fablecut,
    port: g.__ainovelFableCutPort || FABLECUT_DEFAULT_PORT,
    managedPid: g.__ainovelFableCutProc?.pid ?? null,
    url: `http://127.0.0.1:${g.__ainovelFableCutPort || FABLECUT_DEFAULT_PORT}`,
  };
}
