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

  // Commercial entitlement posture
  try {
    // Lazy import keeps this module free of circular deps in pure probes
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getEntitlementPublicStatus } = require('@/lib/entitlement') as typeof import('@/lib/entitlement');
    const ent = getEntitlementPublicStatus();
    if (ent.readyForCommercial) {
      const packaged = process.env.AI_NOVEL_PACKAGED === '1';
      const licenseApi = (process.env.AINOVEL_LICENSE_API_URL || '').trim();
      items.push(
        item(
          'entitlement',
          'License (enforce)',
          'ok',
          packaged
            ? `mode=${ent.mode} · public key OK · license API ${licenseApi ? 'OK' : 'missing'}`
            : `mode=${ent.mode} · signer/admin ${ent.signerConfigured && ent.adminKeyConfigured ? 'OK' : 'not required'}`,
        ),
      );
    } else if (ent.mode === 'open') {
      items.push(
        item(
          'entitlement',
          'License mode',
          'warn',
          'open (dev) — Pro mở tự do. Publish: AINOVEL_ENTITLEMENT_MODE=enforce + secret + admin key',
        ),
      );
    } else {
      items.push(
        item(
          'entitlement',
          'License (enforce)',
          'fail',
          ent.blockers.join(' · ') || 'chưa sẵn sàng commercial',
        ),
      );
    }
  } catch (e) {
    items.push(
      item(
        'entitlement',
        'License',
        'warn',
        e instanceof Error ? e.message : 'entitlement probe failed',
      ),
    );
  }

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
    const abs = path.join(/* turbopackIgnore: true */ root, rel);
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
    let edgeInstalled = false;
    try {
      require.resolve('node-edge-tts/package.json');
      edgeInstalled = true;
    } catch {
      try {
        require.resolve('node-edge-tts');
        edgeInstalled = true;
      } catch {
        edgeInstalled = false;
      }
    }
    if (edgeInstalled) {
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

  // LA Studio / Kokoro-VI portable (platform la_studio — ship TTS)
  const kokoroCli = path.join(root, 'bin', 'la-studio-kokoro', 'bin', 'kokoro-vi-cli.exe');
  const kokoroOnnx = path.join(root, 'bin', 'la-studio-kokoro', 'models', 'kokoro_vi.onnx');
  if (fs.existsSync(kokoroCli) && fs.existsSync(kokoroOnnx)) {
    items.push(
      item(
        'la_studio_kokoro',
        'LA Studio Kokoro-VI',
        'ok',
        'bin/la-studio-kokoro (portable ship)',
      ),
    );
  } else {
    items.push(
      item(
        'la_studio_kokoro',
        'LA Studio Kokoro-VI',
        'warn',
        'Thiếu pack — chạy npm run prepare:la-studio-kokoro trước khi pack',
      ),
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
  const contractsCompiled = process.env.AI_NOVEL_PACKAGED === '1';
  items.push(
    contractsCompiled || fs.existsSync(contracts)
      ? item(
          'contracts',
          'Contracts',
          'ok',
          contractsCompiled ? 'compiled in app bundle' : 'validate.ts',
        )
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
