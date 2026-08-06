import { NextResponse } from 'next/server';
import { exec, execFile } from 'child_process';
import util from 'util';
import fs from 'fs';
import path from 'path';
import {
  clearNvencProbeCache,
  probeH264Nvenc,
} from '@/lib/ffmpeg/nvencProbe';
import { resolveNvidiaDriverForGpu } from '@/lib/ffmpeg/nvidiaDriverLookup';
import { resolveFfmpegPath } from '@/lib/capassistant/core';
import { spawnSync } from 'child_process';
import { readGpuInstallStatus } from '@/lib/gpuInstallStatus';
import { resolvePythonExe } from '@/app/api/self-heal/media/mediaHelpers';

const execAsync = util.promisify(exec);
const execFileAsync = util.promisify(execFile);

export const runtime = 'nodejs';

const PROFILE_PATH = () => path.join(process.cwd(), 'python_core', 'gpu_profile.json');

function writeGpuProfile(profile: Record<string, unknown>) {
  try {
    const p = PROFILE_PATH();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    // Strip bulky install logs from disk cache
    const slim = { ...profile };
    if (slim.installStatus && typeof slim.installStatus === 'object') {
      const st = slim.installStatus as Record<string, unknown>;
      slim.installStatus = {
        status: st.status,
        progress: st.progress,
        message: st.message,
        startTime: st.startTime,
      };
    }
    fs.writeFileSync(p, JSON.stringify(slim, null, 2), 'utf8');
  } catch (err) {
    console.error('[System Info] Failed to write gpu_profile.json:', err);
  }
}

function readGpuProfile(): Record<string, unknown> | null {
  try {
    const p = PROFILE_PATH();
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

type GpuVendor = 'nvidia' | 'amd' | 'intel' | 'generic';

type ScannedGpu = {
  name: string;
  ram: string;
  driverVersion: string;
  vendor: GpuVendor;
  hasNvidia: boolean;
};

function classifyGpuVendor(name: string): GpuVendor {
  const upper = name.toUpperCase();
  if (upper.includes('NVIDIA')) return 'nvidia';
  if (upper.includes('AMD') || upper.includes('RADEON')) return 'amd';
  if (
    upper.includes('INTEL') ||
    upper.includes('IRIS') ||
    upper.includes('ARC')
  ) {
    return 'intel';
  }
  return 'generic';
}

function normalizeGpuEntry(raw: unknown): ScannedGpu | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const name = String(row.Name || row.name || '').trim();
  if (!name) return null;
  const ramBytes = Number(row.AdapterRAM || row.adapterRam || 0);
  const vendor = classifyGpuVendor(name);
  return {
    name,
    ram:
      Number.isFinite(ramBytes) && ramBytes > 0
        ? `${(ramBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
        : 'N/A',
    driverVersion: String(row.DriverVersion || row.driverVersion || '').trim(),
    vendor,
    hasNvidia: vendor === 'nvidia',
  };
}

async function scanWindowsGpus(): Promise<ScannedGpu[]> {
  if (process.platform !== 'win32') return [];
  const script = [
    '$items = Get-CimInstance -ClassName Win32_VideoController -EA SilentlyContinue |',
    'Select-Object Name,DriverVersion,AdapterRAM;',
    "if ($null -eq $items) { '[]' } else { $items | ConvertTo-Json -Compress -Depth 3 }",
  ].join(' ');
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 7_000,
      maxBuffer: 1024 * 1024,
    },
  );
  const text = String(stdout || '').trim();
  if (!text) return [];
  const parsed = JSON.parse(text) as unknown;
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.map(normalizeGpuEntry).filter((x): x is ScannedGpu => Boolean(x));
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const cachedOnly = url.searchParams.get('cached') === '1';

    if (cachedOnly) {
      const cached = readGpuProfile();
      if (cached) {
        return NextResponse.json({ ...cached, fromCache: true });
      }
    }

    // 1. Scan display adapters/GPUs from PowerShell CIM (WMIC is absent on many clean Windows 11 PCs).
    const gpus: ScannedGpu[] = [];
    let primaryGpu = {
      name: 'CPU Only',
      ram: '0 GB',
      driverVersion: '',
      vendor: 'generic',
      hasNvidia: false,
    };

    try {
      gpus.push(...await scanWindowsGpus());

      // Pick primary GPU (Nvidia > AMD > Intel > Generic)
      if (gpus.length > 0) {
        gpus.sort((a, b) => {
          const priority = { nvidia: 4, amd: 3, intel: 2, generic: 1 };
          return (
            (priority[b.vendor as keyof typeof priority] || 1) -
            (priority[a.vendor as keyof typeof priority] || 1)
          );
        });
        primaryGpu = gpus[0];
      }
    } catch (err) {
      console.error(
        '[System Info] GPU scan failed:',
        err instanceof Error ? err.message : String(err),
      );
    }

    // Prefer nvidia-smi product name (cleaner than OEM WMIC strings)
    try {
      const smi = spawnSync(
        'nvidia-smi',
        ['--query-gpu=name,driver_version', '--format=csv,noheader'],
        { encoding: 'utf8', windowsHide: true, timeout: 4000 },
      );
      if (smi.status === 0 && String(smi.stdout || '').trim()) {
        const line = String(smi.stdout).split(/\r?\n/).map((l) => l.trim()).find(Boolean);
        if (line) {
          const parts = line.split(',').map((s) => s.trim());
          const smiName = parts[0];
          const smiDrv = parts[1] || '';
          if (smiName) {
            primaryGpu = {
              ...primaryGpu,
              name: smiName.startsWith('NVIDIA') ? smiName : `NVIDIA ${smiName}`,
              driverVersion: smiDrv || primaryGpu.driverVersion,
              vendor: 'nvidia',
              hasNvidia: true,
            };
          }
        }
      }
    } catch {
      /* ignore */
    }

    // Exact NVIDIA driver package for this GPU (AjaxDriverService)
    let nvidiaDriver: Awaited<ReturnType<typeof resolveNvidiaDriverForGpu>> | null = null;
    if (primaryGpu.hasNvidia || primaryGpu.vendor === 'nvidia') {
      try {
        nvidiaDriver = await resolveNvidiaDriverForGpu(primaryGpu.name, { force: true });
      } catch (err) {
        console.error('[System Info] NVIDIA driver lookup failed:', err);
      }
    }

    // 2. Determine python path
    const pythonExe = resolvePythonExe();

    // 3. Run Python diagnostic script
    let pythonStatus = {
      python: '',
      torch: 'not_installed',
      cuda: false,
      cuda_version: null as string | null,
      onnx_providers: [] as string[],
      directml_available: false,
    };

    try {
      const checkScriptPath = path.join(process.cwd(), 'python_core', 'gpu_check.py');
      const { stdout } = await execAsync(`"${pythonExe}" "${checkScriptPath}"`);
      pythonStatus = JSON.parse(stdout.trim());
    } catch (err: unknown) {
      console.error('[System Info] Python check failed:', err);
    }

    // 4. Test FFmpeg GPU encoders (real yuv420p frames — nullsrc is unreliable)
    // h264_nvenc: shared probe with Phantom-X (force refresh on full scan)
    const ffmpegPath = resolveFfmpegPath();
    const ffmpegCmd = `"${ffmpegPath}"`;

    clearNvencProbeCache();
    // Probe all candidate FFmpeg (bin + python_core) — GTX 10xx often needs older binary
    const nvencProbe = probeH264Nvenc({ force: true });
    const nvenc = {
      supported: nvencProbe.ok,
      error: nvencProbe.ok ? '' : nvencProbe.errorDetail || nvencProbe.message,
      message: nvencProbe.message,
      bf2Ok: nvencProbe.bf2Ok,
      ffmpegPath: nvencProbe.ffmpegPath,
      usedCompatFfmpeg: nvencProbe.usedCompatFfmpeg,
      preset: nvencProbe.preset,
    };

    const testEncoder = async (codecName: string) => {
      try {
        await execAsync(
          `${ffmpegCmd} -hide_banner -loglevel error -y -f lavfi -i testsrc=size=640x360:rate=30 -t 0.3 -pix_fmt yuv420p -c:v ${codecName} -f null -`,
          { timeout: 20000 },
        );
        return { supported: true, error: '' };
      } catch (err: unknown) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const e = err as any;
        const raw = String(e?.stderr || e?.message || '');
        const short =
          raw
            .split(/\r?\n/)
            .map((l: string) => l.trim())
            .filter(Boolean)
            .find(
              (l: string) =>
                /nvenc|amf|qsv|driver|error|not implemented|invalid/i.test(l),
            ) || raw.slice(0, 240);
        return { supported: false, error: short };
      }
    };

    const amf = await testEncoder('h264_amf');
    const qsv = await testEncoder('h264_qsv');

    // 5. Check if installer is running; stale installs must not keep UI spinning forever.
    const installStatus = readGpuInstallStatus();

    const aiReady =
      Boolean(pythonStatus.cuda) ||
      Boolean(pythonStatus.directml_available) ||
      (Array.isArray(pythonStatus.onnx_providers) &&
        pythonStatus.onnx_providers.some((p) =>
          /CUDA|Tensorrt|Dml|DirectML/i.test(String(p)),
        ));

    const videoEncodeReady = nvenc.supported || amf.supported || qsv.supported;

    const payload = {
      platform: 'windows-pc',
      supported: true,
      scannedAt: new Date().toISOString(),
      gpus,
      gpu: primaryGpu,
      /** Exact driver for scanned GPU — Phantom-X / NVENC install CTA */
      nvidiaDriver,
      python: {
        path: pythonExe,
        version: pythonStatus.python,
        torchVersion: pythonStatus.torch,
        cudaAvailable: pythonStatus.cuda,
        cudaVersion: pythonStatus.cuda_version,
        onnxProviders: pythonStatus.onnx_providers,
        directmlAvailable: pythonStatus.directml_available,
      },
      ffmpeg: {
        nvencSupported: nvenc.supported,
        nvencError: nvenc.error,
        nvencMessage: nvenc.message,
        nvencBf2Ok: nvenc.bf2Ok,
        nvencFfmpegPath: nvenc.ffmpegPath,
        nvencUsedCompatFfmpeg: nvenc.usedCompatFfmpeg,
        nvencPreset: nvenc.preset,
        amfSupported: amf.supported,
        amfError: amf.error,
        qsvSupported: qsv.supported,
        qsvError: qsv.error,
        nvencSupportedOld: nvenc.supported,
        error: nvenc.error || amf.error || qsv.error || '',
        /** Primary app FFmpeg (may differ from NVENC-capable binary) */
        ffmpegPath,
      },
      readiness: {
        /** PyTorch CUDA / ONNX GPU / DirectML — AI local acceleration */
        ai: aiReady,
        /** FFmpeg hardware video encode */
        videoEncode: videoEncodeReady,
        /** Recommend install stack if GPU present but AI not ready */
        needsInstall:
          primaryGpu.vendor !== 'generic' &&
          primaryGpu.vendor !== 'cpu' &&
          !aiReady,
        recommendedVendor: primaryGpu.vendor,
      },
      installStatus,
      fromCache: false,
    };

    // Persist first/latest scan for cold start & Settings "đã quét lần đầu"
    writeGpuProfile(payload);

    return NextResponse.json(payload);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Lỗi kiểm tra cấu hình hệ thống.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
