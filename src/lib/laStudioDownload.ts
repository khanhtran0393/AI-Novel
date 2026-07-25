/**
 * Download-on-demand for LA Studio families.
 * Jobs live in-process (dev/server); UI polls GET /api/la-studio/families.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import https from 'https';
import http from 'http';
import { spawnSync } from 'child_process';
import {
  getLaStudioFamily,
  listLaStudioFamilyStatuses,
  laStudioWritableRoot,
  type LaStudioFamilyManifest,
} from './laStudioRuntimes';
import { ensurePortableKokoroRuntime } from './laStudioKokoroEnsure';

export type DownloadJobStatus =
  | 'idle'
  | 'queued'
  | 'downloading'
  | 'extracting'
  | 'done'
  | 'error';

export type DownloadJob = {
  familyId: string;
  status: DownloadJobStatus;
  /** 0–100 */
  progress: number;
  message: string;
  bytesReceived: number;
  bytesTotal: number;
  currentFile?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
  destPath?: string;
};

type DownloadAsset = {
  /** zip | file */
  type: 'zip' | 'file';
  url: string;
  /** relative under family dest dir */
  destRel?: string;
  label: string;
};

const jobs = new Map<string, DownloadJob>();
const inflight = new Map<string, Promise<DownloadJob>>();

function appRoot(): string {
  return (process.env.AI_NOVEL_ROOT || process.cwd()).trim() || process.cwd();
}

/**
 * Where to extract family packs on the user PC.
 * - Kokoro ship: prefer bundled resources (AI_NOVEL_ROOT) if complete; else userData.
 * - Other families: ALWAYS userData/writable — Program Files resources is read-only after install.
 */
function familyDest(familyId: string, fam: LaStudioFamilyManifest): string {
  const writable = laStudioWritableRoot();
  if (familyId === 'kokoro-vietnamese') {
    const bundled = path.join(appRoot(), 'bin', 'la-studio-kokoro');
    const bundledOk =
      fs.existsSync(path.join(bundled, 'bin', 'kokoro-vi-cli.exe')) &&
      fs.existsSync(path.join(bundled, 'models', 'kokoro_vi.onnx'));
    if (bundledOk) return bundled;
    return path.join(writable, 'bin', 'la-studio-kokoro');
  }
  const rel = fam.portableDir || path.join('la-studio-runtimes', familyId);
  // On-demand families always land under writable userData
  if (rel.startsWith('la-studio-runtimes') || rel === 'la-studio-kokoro') {
    return path.join(writable, 'bin', rel);
  }
  return path.join(writable, 'bin', 'la-studio-runtimes', familyId);
}

/** Known downloadable assets per family (CPU packages). */
function assetsForFamily(familyId: string): DownloadAsset[] {
  switch (familyId) {
    case 'kokoro-vietnamese':
      return [
        {
          type: 'zip',
          url:
            process.env.AINOVEL_KOKORO_ZIP_URL ||
            'https://github.com/dduongtrandai/Kokoro-Vietnamese.cpp/releases/download/v0.1.0/kokoro-vietnamese-win-x86_64-cpu.zip',
          label: 'Kokoro-VI runtime + models',
        },
      ];
    case 'vieneu-tts-v3-turbo':
      return [
        {
          type: 'zip',
          url: 'https://github.com/dduongtrandai/VieNeu-TTS.cpp/releases/download/v0.1.3/vieneu-tts-win-cpu.zip',
          label: 'VieNeu v3 native runtime (CPU)',
        },
        // Voice catalog (10 preset names) — required for UI list
        {
          type: 'file',
          url: 'https://huggingface.co/lastudio-community/VieNeu-TTS-v3-Turbo-CPP/resolve/main/voices_v3_turbo.json',
          destRel: 'models/voices_v3_turbo.json',
          label: 'VieNeu voices_v3_turbo.json (preset list)',
        },
        {
          type: 'file',
          url: 'https://huggingface.co/lastudio-community/VieNeu-TTS-v3-Turbo-CPP/resolve/main/config.json',
          destRel: 'models/config.json',
          label: 'VieNeu config.json',
        },
        {
          type: 'file',
          url: 'https://huggingface.co/lastudio-community/VieNeu-TTS-v3-Turbo-CPP/resolve/main/tokenizer.json',
          destRel: 'models/tokenizer.json',
          label: 'VieNeu tokenizer.json',
        },
      ];
    case 'omnivoice':
      return [
        {
          type: 'zip',
          url: 'https://github.com/dduongtrandai/omnivoice.cpp/releases/download/v0.1.3/omnivoice-win-cpu.zip',
          label: 'OmniVoice.cpp CPU runtime',
        },
      ];
    case 'vibevoice':
      return [
        {
          type: 'zip',
          // CrispASR shared runtime — required by VibeVoice in LA Studio
          url: 'https://github.com/CrispStrobe/CrispASR/releases/download/v0.8.13/libcrispasr-windows-x86_64.tar.gz',
          label: 'CrispASR CPU runtime (VibeVoice)',
        },
      ];
    case 'voxcpm2':
      return [
        {
          type: 'zip',
          url: 'https://github.com/CrispStrobe/CrispASR/releases/download/v0.8.13/libcrispasr-windows-x86_64.tar.gz',
          label: 'CrispASR CPU runtime (VoxCPM2)',
        },
      ];
    case 'kokoro':
      return [
        {
          type: 'zip',
          url: 'https://github.com/CrispStrobe/CrispASR/releases/download/v0.8.13/libcrispasr-windows-x86_64.tar.gz',
          label: 'CrispASR CPU runtime (Kokoro 82M)',
        },
      ];
    default:
      return [];
  }
}

export function getDownloadJob(familyId: string): DownloadJob | null {
  return jobs.get(familyId) || null;
}

export function getAllDownloadJobs(): DownloadJob[] {
  return [...jobs.values()];
}

function setJob(familyId: string, patch: Partial<DownloadJob>): DownloadJob {
  const prev =
    jobs.get(familyId) ||
    ({
      familyId,
      status: 'idle',
      progress: 0,
      message: '',
      bytesReceived: 0,
      bytesTotal: 0,
      startedAt: Date.now(),
    } satisfies DownloadJob);
  const next = { ...prev, ...patch, familyId };
  jobs.set(familyId, next);
  return next;
}

/**
 * HF/GitHub often return relative Location (/api/resolve-cache/...).
 * Node https.get(relative) → TypeError: Invalid URL — must resolve against current URL.
 */
function resolveRedirectUrl(fromUrl: string, location: string): string {
  const loc = String(location || '').trim();
  if (!loc) throw new Error('Empty redirect Location header');
  if (/^https?:\/\//i.test(loc)) return loc;
  try {
    return new URL(loc, fromUrl).href;
  } catch (e) {
    throw new Error(
      `Invalid redirect URL: location=${loc.slice(0, 120)} from=${fromUrl.slice(0, 120)} (${e instanceof Error ? e.message : String(e)})`,
    );
  }
}

function downloadFile(
  url: string,
  dest: string,
  onProgress?: (received: number, total: number) => void,
  redirectDepth = 0,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (redirectDepth > 12) {
      reject(new Error(`Too many redirects downloading ${url.slice(0, 160)}`));
      return;
    }
    let absoluteUrl: string;
    try {
      absoluteUrl = /^https?:\/\//i.test(url)
        ? url
        : new URL(url).href; // throws Invalid URL if relative without base
    } catch {
      reject(
        new Error(
          `Invalid URL (relative redirect not resolved): ${String(url).slice(0, 160)}`,
        ),
      );
      return;
    }

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const file = fs.createWriteStream(dest);
    const lib = absoluteUrl.startsWith('https') ? https : http;
    const req = lib.get(
      absoluteUrl,
      {
        headers: {
          'User-Agent': 'AI-Novel-FamilyDownload',
          // HF sometimes needs accept
          Accept: '*/*',
        },
      },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          file.close();
          try {
            fs.unlinkSync(dest);
          } catch {
            /* ignore */
          }
          let next: string;
          try {
            next = resolveRedirectUrl(absoluteUrl, res.headers.location);
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
            res.resume();
            return;
          }
          downloadFile(next, dest, onProgress, redirectDepth + 1).then(
            resolve,
            reject,
          );
          return;
        }
        if (res.statusCode !== 200) {
          file.close();
          try {
            fs.unlinkSync(dest);
          } catch {
            /* ignore */
          }
          reject(new Error(`HTTP ${res.statusCode} ${absoluteUrl}`));
          res.resume();
          return;
        }
        const total = Number(res.headers['content-length'] || 0);
        let received = 0;
        res.on('data', (chunk: Buffer) => {
          received += chunk.length;
          onProgress?.(received, total);
        });
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
      },
    );
    req.on('error', (e) => {
      try {
        file.close();
      } catch {
        /* ignore */
      }
      try {
        fs.unlinkSync(dest);
      } catch {
        /* ignore */
      }
      reject(e);
    });
  });
}

function extractArchive(archivePath: string, outDir: string) {
  fs.mkdirSync(outDir, { recursive: true });
  const lower = archivePath.toLowerCase();
  if (lower.endsWith('.zip')) {
    const ps = `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${outDir.replace(/'/g, "''")}' -Force`;
    const r = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { encoding: 'utf8' },
    );
    if (r.status !== 0) {
      throw new Error(`Expand-Archive failed: ${r.stderr || r.stdout || r.status}`);
    }
    return;
  }
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    // Windows 10+ tar
    const r = spawnSync(
      'tar',
      ['-xzf', archivePath, '-C', outDir],
      { encoding: 'utf8' },
    );
    if (r.status !== 0) {
      throw new Error(`tar extract failed: ${r.stderr || r.stdout || r.status}`);
    }
    return;
  }
  throw new Error(`Unsupported archive: ${path.basename(archivePath)}`);
}

function writeMarker(dest: string, familyId: string, assets: DownloadAsset[]) {
  const marker = {
    familyId,
    installedAt: new Date().toISOString(),
    assets: assets.map((a) => ({ label: a.label, url: a.url, type: a.type })),
  };
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(
    path.join(dest, '.ainovel-family-installed.json'),
    JSON.stringify(marker, null, 2),
    'utf8',
  );
}

/**
 * Start or join download job for family. Resolves when finished (or error).
 */
export async function ensureFamilyDownloaded(
  familyId: string,
): Promise<DownloadJob> {
  const fam = getLaStudioFamily(familyId);
  if (!fam) {
    return setJob(familyId, {
      status: 'error',
      progress: 0,
      message: 'Unknown family',
      error: `Unknown family: ${familyId}`,
      finishedAt: Date.now(),
    });
  }

  // Omni → not a zip pack; UI uses platform omnivoice_local inside tab LA Studio
  if (fam.kind === 'external' && familyId === 'omnivoice') {
    return setJob(familyId, {
      status: 'done',
      progress: 100,
      message:
        'OmniVoice: tab LA Studio · platform omnivoice_local (đã tích hợp). Không tải pack LA Studio.',
      finishedAt: Date.now(),
      destPath: undefined,
    });
  }

  // Fast path Kokoro existing ensure
  if (familyId === 'kokoro-vietnamese') {
    const existing = inflight.get(familyId);
    if (existing) return existing;
    const p = (async () => {
      setJob(familyId, {
        status: 'downloading',
        progress: 5,
        message: 'Đang chuẩn bị Kokoro-VI…',
        startedAt: Date.now(),
        bytesReceived: 0,
        bytesTotal: 0,
      });
      try {
        const r = await ensurePortableKokoroRuntime();
        if (!r.ok) {
          return setJob(familyId, {
            status: 'error',
            progress: 0,
            message: r.error || 'Kokoro ensure failed',
            error: r.error,
            finishedAt: Date.now(),
          });
        }
        try {
          const { ensureFamilySamplePack } = await import('./laStudioSampleVoices');
          await ensureFamilySamplePack(familyId);
        } catch {
          /* samples optional */
        }
        return setJob(familyId, {
          status: 'done',
          progress: 100,
          message: `Kokoro-VI sẵn sàng: ${r.path}`,
          destPath: r.path,
          finishedAt: Date.now(),
        });
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        return setJob(familyId, {
          status: 'error',
          progress: 0,
          message: err,
          error: err,
          finishedAt: Date.now(),
        });
      } finally {
        inflight.delete(familyId);
      }
    })();
    inflight.set(familyId, p);
    return p;
  }

  const assets = assetsForFamily(familyId);
  if (!assets.length) {
    return setJob(familyId, {
      status: 'error',
      progress: 0,
      message: 'Family chưa có URL tải portable.',
      error: 'no_assets',
      finishedAt: Date.now(),
    });
  }

  const dest = familyDest(familyId, fam);
  const marker = path.join(dest, '.ainovel-family-installed.json');
  // File assets (e.g. voices_v3_turbo.json) must exist — old installs only had runtime zip
  const fileAssetsMissing = assets
    .filter((a) => a.type === 'file' && a.destRel)
    .some((a) => !fs.existsSync(path.join(dest, a.destRel!)));
  if (fs.existsSync(marker) && !fileAssetsMissing) {
    try {
      const { ensureFamilySamplePack } = await import('./laStudioSampleVoices');
      const pack = await ensureFamilySamplePack(familyId);
      const n = pack.voices.filter((v) => v.samplePublicUrl).length;
      return setJob(familyId, {
        status: 'done',
        progress: 100,
        message:
          `Đã cài sẵn: ${dest}` +
          (n ? ` · ${n} giọng mẫu` : ''),
        destPath: dest,
        finishedAt: Date.now(),
      });
    } catch {
      return setJob(familyId, {
        status: 'done',
        progress: 100,
        message: `Đã cài sẵn: ${dest}`,
        destPath: dest,
        finishedAt: Date.now(),
      });
    }
  }

  const existing = inflight.get(familyId);
  if (existing) return existing;

  const p = (async () => {
    setJob(familyId, {
      status: 'queued',
      progress: 1,
      message: 'Hàng đợi tải…',
      startedAt: Date.now(),
      bytesReceived: 0,
      bytesTotal: 0,
      destPath: dest,
    });
    const tmp = path.join(os.tmpdir(), `ainovel-fam-${familyId}-${Date.now()}`);
    fs.mkdirSync(tmp, { recursive: true });
    try {
      const n = assets.length;
      for (let i = 0; i < n; i++) {
        const asset = assets[i];
        const basePct = Math.round((i / n) * 90);
        setJob(familyId, {
          status: 'downloading',
          progress: basePct + 1,
          message: `Đang tải (${i + 1}/${n}): ${asset.label}`,
          currentFile: asset.label,
          bytesReceived: 0,
          bytesTotal: 0,
        });
        if (asset.type === 'zip') {
          const ext = asset.url.toLowerCase().includes('.tar.gz')
            ? '.tar.gz'
            : '.zip';
          const archPath = path.join(tmp, `pack${i}${ext}`);
          await downloadFile(asset.url, archPath, (recv, total) => {
            const frac = total > 0 ? recv / total : 0;
            const pct = basePct + Math.round(frac * (90 / n) * 0.85);
            setJob(familyId, {
              status: 'downloading',
              progress: Math.min(94, pct),
              message: `Tải ${asset.label}: ${Math.round(recv / 1e6)}MB` +
                (total ? ` / ${Math.round(total / 1e6)}MB` : ''),
              bytesReceived: recv,
              bytesTotal: total,
              currentFile: asset.label,
            });
          });
          setJob(familyId, {
            status: 'extracting',
            progress: basePct + Math.round((90 / n) * 0.9),
            message: `Giải nén: ${asset.label}`,
            currentFile: asset.label,
          });
          const extractTo = path.join(tmp, `x${i}`);
          extractArchive(archPath, extractTo);
          // merge into dest
          copyTreeMerge(extractTo, dest);
        } else {
          const rel = asset.destRel || path.basename(new URL(asset.url).pathname);
          const out = path.join(dest, rel);
          await downloadFile(asset.url, out, (recv, total) => {
            const frac = total > 0 ? recv / total : 0;
            const pct = basePct + Math.round(frac * (90 / n));
            setJob(familyId, {
              status: 'downloading',
              progress: Math.min(94, pct),
              message: `Tải ${asset.label}`,
              bytesReceived: recv,
              bytesTotal: total,
              currentFile: asset.label,
            });
          });
        }
      }
      writeMarker(dest, familyId, assets);
      // Ship: bake WAV mẫu TRÊN MÁY USER (userData/data) — tự tìm link ▶ nghe thử
      try {
        setJob(familyId, {
          status: 'extracting',
          progress: 96,
          message: `Tạo file nghe thử trên máy… («${fam.title}»)`,
          destPath: dest,
        });
        const { prepareFamilySamplesForShip } = await import(
          './laStudioSampleVoices'
        );
        const prep = await prepareFamilySamplesForShip(familyId);
        return setJob(familyId, {
          status: 'done',
          progress: 100,
          message:
            `Đã tải «${fam.title}» · ${prep.readyCount}/${prep.voiceCount} giọng có ▶ nghe thử` +
            (prep.errors.length
              ? ` · lỗi bake ${prep.errors.length} (cần Kokoro ship)`
              : ''),
          destPath: dest,
          finishedAt: Date.now(),
        });
      } catch {
        return setJob(familyId, {
          status: 'done',
          progress: 100,
          message: `Đã tải xong «${fam.title}» → ${dest} · bake mẫu thất bại — mở Voice library bấm ▶ (tự bake)`,
          destPath: dest,
          finishedAt: Date.now(),
        });
      }
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      return setJob(familyId, {
        status: 'error',
        progress: 0,
        message: err,
        error: err,
        finishedAt: Date.now(),
      });
    } finally {
      inflight.delete(familyId);
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  })();

  inflight.set(familyId, p);
  return p;
}

function copyTreeMerge(src: string, dst: string) {
  fs.mkdirSync(dst, { recursive: true });
  if (process.platform === 'win32') {
    const r = spawnSync(
      'robocopy',
      [src, dst, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/nc', '/ns', '/np'],
    );
    if (r.status != null && r.status >= 8) {
      throw new Error(`robocopy merge failed ${r.status}`);
    }
    return;
  }
  fs.cpSync(src, dst, { recursive: true });
}

/** Snapshot for API */
export function familiesWithJobs() {
  const families = listLaStudioFamilyStatuses().map((f) => {
    const job = jobs.get(f.id);
    return {
      ...f,
      download: job
        ? {
            status: job.status,
            progress: job.progress,
            message: job.message,
            bytesReceived: job.bytesReceived,
            bytesTotal: job.bytesTotal,
            currentFile: job.currentFile,
            error: job.error,
          }
        : null,
    };
  });
  return families;
}
