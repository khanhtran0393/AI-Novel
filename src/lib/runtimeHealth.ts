/**
 * Server/runtime probes: FFmpeg, public dirs, TTS binaries, optional Chrome.
 * Pure Node — safe for /api/health/runtime and smoke:core.
 */
import fs from 'fs';
import path from 'path';
import type { HealthItem, HealthLevel } from '@/lib/credentialHealth';

export type RuntimeHealthResult = {
  items: HealthItem[];
  ok: number;
  warn: number;
  fail: number;
  scoreLabel: string;
  platform: NodeJS.Platform;
  cwd: string;
};

function item(
  id: string,
  label: string,
  level: HealthLevel,
  detail: string,
): HealthItem {
  return { id, label, level, detail };
}

function resolveFfmpegCandidates(root: string): string[] {
  const isWin = process.platform === 'win32';
  const name = isWin ? 'ffmpeg.exe' : 'ffmpeg';
  return [
    path.join(root, 'bin', name),
    path.join(root, 'python_core', 'ffmpeg', name),
    path.join(root, 'Voice Studio', 'bin', name),
  ];
}

export function resolveBundledFfmpeg(root = process.cwd()): string | null {
  for (const p of resolveFfmpegCandidates(root)) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function probeRuntimeHealth(root = process.cwd()): RuntimeHealthResult {
  const items: HealthItem[] = [];

  // FFmpeg
  const ff = resolveBundledFfmpeg(root);
  if (ff) {
    items.push(
      item('ffmpeg', 'FFmpeg', 'ok', path.relative(root, ff) || ff),
    );
  } else {
    items.push(
      item(
        'ffmpeg',
        'FFmpeg',
        'warn',
        'Không thấy bin/ffmpeg — export/mix có thể fail (CI/Linux có thể dùng PATH)',
      ),
    );
  }

  // Public media dirs
  for (const rel of ['public/audio', 'public/images', 'public/video']) {
    const abs = path.join(root, rel);
    try {
      if (!fs.existsSync(abs)) fs.mkdirSync(abs, { recursive: true });
      const test = path.join(abs, '.health_write_test');
      fs.writeFileSync(test, 'ok');
      fs.unlinkSync(test);
      items.push(item(`dir_${rel}`, rel, 'ok', 'Ghi được'));
    } catch (e) {
      items.push(
        item(
          `dir_${rel}`,
          rel,
          'fail',
          `Không ghi được: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    }
  }

  // Edge TTS package (node dependency)
  try {
    const edgePkg = path.join(root, 'node_modules', 'node-edge-tts', 'package.json');
    if (fs.existsSync(edgePkg)) {
      items.push(item('edge_tts_pkg', 'Edge TTS (npm)', 'ok', 'node-edge-tts installed'));
    } else {
      items.push(
        item('edge_tts_pkg', 'Edge TTS (npm)', 'warn', 'Thiếu node-edge-tts'),
      );
    }
  } catch {
    items.push(item('edge_tts_pkg', 'Edge TTS (npm)', 'warn', 'Không kiểm tra được'));
  }

  // Piper binary (optional offline TTS)
  const piperName = process.platform === 'win32' ? 'piper.exe' : 'piper';
  const piperPath = path.join(root, 'bin', 'piper', piperName);
  if (fs.existsSync(piperPath)) {
    items.push(item('piper', 'Piper TTS', 'ok', 'bin/piper có sẵn'));
  } else {
    items.push(
      item('piper', 'Piper TTS', 'idle', 'Tùy chọn — offline voice'),
    );
  }

  // Chrome / Puppeteer (Whisk) — existence only
  const chromeCandidates = [
    process.env.CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ].filter(Boolean) as string[];
  const chrome = chromeCandidates.find((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
  if (chrome) {
    items.push(item('chrome', 'Chrome / Chromium', 'ok', path.basename(chrome)));
  } else {
    items.push(
      item(
        'chrome',
        'Chrome / Chromium',
        'idle',
        'Không thấy — Whisk/Puppeteer có thể dùng cache Puppeteer',
      ),
    );
  }

  // Contracts present
  const contracts = path.join(root, 'src', 'contracts', 'validate.ts');
  items.push(
    fs.existsSync(contracts)
      ? item('contracts', 'Contracts', 'ok', 'validate.ts')
      : item('contracts', 'Contracts', 'fail', 'Thiếu src/contracts/validate.ts'),
  );

  const ok = items.filter((i) => i.level === 'ok').length;
  const warn = items.filter((i) => i.level === 'warn').length;
  const fail = items.filter((i) => i.level === 'fail').length;
  const scoreLabel =
    fail > 0 ? `${fail} lỗi runtime` : warn > 0 ? `${warn} cảnh báo` : 'Runtime OK';

  return {
    items,
    ok,
    warn,
    fail,
    scoreLabel,
    platform: process.platform,
    cwd: root,
  };
}
