/**
 * claude-video /watch bridge — runs D:\repo\claude-video-main skills/watch scripts
 * via local Python + app-bundled ffmpeg.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import {
  ensureWorkDirs,
  getIntegrationPaths,
  localFfmpegBin,
  localFfprobeBin,
} from './paths';

export type WatchDetail = 'transcript' | 'efficient' | 'balanced' | 'token-burner';

export interface WatchRunInput {
  source: string;
  detail?: WatchDetail;
  start?: string;
  end?: string;
  maxFrames?: number;
  noWhisper?: boolean;
  outDir?: string;
  timeoutMs?: number;
}

export interface WatchRunResult {
  success: boolean;
  report: string;
  outDir?: string;
  framePaths: string[];
  stderr?: string;
  error?: string;
  durationMs: number;
}

function findPython(): string {
  // Prefer `python` on Windows (python3 is often Store stub)
  return process.platform === 'win32' ? 'python' : 'python3';
}

function enrichPathForWatch(cwd: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const bins: string[] = [];
  const ff = localFfmpegBin(cwd);
  const fp = localFfprobeBin(cwd);
  if (ff) bins.push(path.dirname(ff));
  if (fp) bins.push(path.dirname(fp));
  // ytdlp often next to python_core tools
  const ytdlpDirs = [
    path.join(cwd, 'python_core'),
    path.join(cwd, 'bin'),
  ];
  for (const d of ytdlpDirs) {
    if (fs.existsSync(d)) bins.push(d);
  }
  if (bins.length) {
    env.PATH = `${bins.join(path.delimiter)}${path.delimiter}${env.PATH || ''}`;
  }
  // Point ffmpeg explicitly if script honors it
  if (ff) env.FFMPEG_BINARY = ff;
  if (fp) env.FFPROBE_BINARY = fp;
  return env;
}

function extractFramePaths(report: string): string[] {
  const paths: string[] = [];
  const re = /(?:^|\s)((?:[A-Za-z]:)?[^\s*]+\.(?:jpg|jpeg|png))\b/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(report)) !== null) {
    const p = m[1];
    if (fs.existsSync(p)) paths.push(p);
  }
  // Also markdown image or `t=..` lines with paths
  const re2 = /`([^`]+\.(?:jpg|jpeg|png))`/gi;
  while ((m = re2.exec(report)) !== null) {
    if (fs.existsSync(m[1]) && !paths.includes(m[1])) paths.push(m[1]);
  }
  return paths;
}

function extractOutDir(report: string): string | undefined {
  const m =
    report.match(/working directory[:\s]+([^\n\r]+)/i) ||
    report.match(/out(?:put)?[_\s-]?dir[:\s]+([^\n\r]+)/i) ||
    report.match(/Work dir[:\s]+([^\n\r]+)/i);
  if (m?.[1]) {
    const p = m[1].trim().replace(/[`"']/g, '');
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

export function watchRepoReady(): boolean {
  const p = getIntegrationPaths();
  return fs.existsSync(path.join(p.watchScripts, 'watch.py'));
}

export function runWatchSetupCheck(): Promise<{ ok: boolean; output: string }> {
  const paths = getIntegrationPaths();
  const setup = path.join(paths.watchScripts, 'setup.py');
  if (!fs.existsSync(setup)) {
    return Promise.resolve({ ok: false, output: `setup.py missing under ${paths.watchScripts}` });
  }
  return new Promise((resolve) => {
    const env = enrichPathForWatch(process.cwd());
    const child = spawn(findPython(), [setup, '--json'], {
      cwd: paths.watchScripts,
      env,
      windowsHide: true,
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('close', (code) => {
      resolve({ ok: code === 0, output: (out || err).trim() });
    });
    child.on('error', (e) => resolve({ ok: false, output: e.message }));
  });
}

export function runWatch(input: WatchRunInput): Promise<WatchRunResult> {
  const started = Date.now();
  const paths = getIntegrationPaths();
  ensureWorkDirs(paths);

  const watchPy = path.join(paths.watchScripts, 'watch.py');
  if (!fs.existsSync(watchPy)) {
    return Promise.resolve({
      success: false,
      report: '',
      framePaths: [],
      error: `watch.py not found at ${watchPy}`,
      durationMs: 0,
    });
  }

  if (!input.source?.trim()) {
    return Promise.resolve({
      success: false,
      report: '',
      framePaths: [],
      error: 'Missing video source (URL or local path)',
      durationMs: 0,
    });
  }

  const outDir =
    input.outDir ||
    path.join(paths.watchWork, `run_${Date.now()}`);
  fs.mkdirSync(outDir, { recursive: true });

  const args = [watchPy, input.source, '--out-dir', outDir];
  if (input.detail) args.push('--detail', input.detail);
  if (input.start) args.push('--start', input.start);
  if (input.end) args.push('--end', input.end);
  if (input.maxFrames != null) args.push('--max-frames', String(input.maxFrames));
  if (input.noWhisper !== false) {
    // Default no-whisper for offline-friendly first run; caller can set noWhisper:false
    if (input.noWhisper === true || input.noWhisper === undefined) {
      args.push('--no-whisper');
    }
  }

  const timeoutMs = input.timeoutMs ?? 300_000;
  const env = enrichPathForWatch(process.cwd());

  return new Promise((resolve) => {
    const child = spawn(findPython(), args, {
      cwd: paths.watchScripts,
      env,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      resolve({
        success: false,
        report: stdout,
        stderr,
        outDir,
        framePaths: extractFramePaths(stdout),
        error: `watch timed out after ${timeoutMs}ms`,
        durationMs: Date.now() - started,
      });
    }, timeoutMs);

    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));

    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        success: false,
        report: stdout,
        stderr,
        outDir,
        framePaths: [],
        error: e.message,
        durationMs: Date.now() - started,
      });
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const report = stdout || stderr;
      const framePaths = extractFramePaths(report);
      // also scan outDir for frames
      try {
        const files = fs.readdirSync(outDir);
        for (const f of files) {
          if (/\.(jpe?g|png)$/i.test(f)) {
            const full = path.join(outDir, f);
            if (!framePaths.includes(full)) framePaths.push(full);
          }
        }
        // nested
        for (const f of files) {
          const sub = path.join(outDir, f);
          if (fs.statSync(sub).isDirectory()) {
            for (const sf of fs.readdirSync(sub)) {
              if (/\.(jpe?g|png)$/i.test(sf)) {
                const full = path.join(sub, sf);
                if (!framePaths.includes(full)) framePaths.push(full);
              }
            }
          }
        }
      } catch {
        /* ignore */
      }

      resolve({
        success: code === 0 || report.length > 50,
        report,
        stderr: stderr || undefined,
        outDir: extractOutDir(report) || outDir,
        framePaths,
        error: code === 0 ? undefined : `watch exited ${code}`,
        durationMs: Date.now() - started,
      });
    });
  });
}

/**
 * After watch report is available, ask an LLM (caller supplies) — this helper
 * only structures a QC brief for AI Novel render review.
 */
export function buildWatchQcBrief(opts: {
  report: string;
  question?: string;
  chapterTitle?: string;
}): string {
  const q =
    opts.question ||
    'Summarize structure, hooks, pacing, on-screen text, and issues useful for AI Novel short-form remake.';
  return [
    '# Video Watch QC Brief',
    opts.chapterTitle ? `Project context: ${opts.chapterTitle}` : '',
    `Question: ${q}`,
    '',
    '## Raw watch report',
    opts.report.slice(0, 12000),
  ]
    .filter(Boolean)
    .join('\n');
}
