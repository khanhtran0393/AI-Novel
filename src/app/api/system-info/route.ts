import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import util from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = util.promisify(exec);

export const runtime = 'nodejs';

const PROFILE_PATH = () => path.join(process.cwd(), 'python_core', 'gpu_profile.json');
const STATUS_PATH = () => path.join(process.cwd(), 'python_core', 'gpu_install_status.json');

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

    // 1. Scan display adapters/GPUs from wmic (Windows PC)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gpus: any[] = [];
    let primaryGpu = {
      name: 'CPU Only',
      ram: '0 GB',
      driverVersion: '',
      vendor: 'generic',
      hasNvidia: false,
    };

    try {
      const { stdout } = await execAsync(
        'wmic path win32_VideoController get Name, DriverVersion, AdapterRAM /format:list',
      );
      const blocks = stdout.split(/\r?\n\r?\n/);

      for (const block of blocks) {
        const lines = block.split(/\r?\n/);
        let name = '';
        let ramBytes = 0;
        let driver = '';

        for (const line of lines) {
          const parts = line.split('=');
          if (parts.length === 2) {
            const key = parts[0].trim();
            const val = parts[1].trim();
            if (key === 'Name') name = val;
            else if (key === 'AdapterRAM') ramBytes = parseInt(val, 10) || 0;
            else if (key === 'DriverVersion') driver = val;
          }
        }

        if (name) {
          const uppercaseName = name.toUpperCase();
          const vendor = uppercaseName.includes('NVIDIA')
            ? 'nvidia'
            : uppercaseName.includes('AMD') || uppercaseName.includes('RADEON')
              ? 'amd'
              : uppercaseName.includes('INTEL') ||
                  uppercaseName.includes('IRIS') ||
                  uppercaseName.includes('ARC')
                ? 'intel'
                : 'generic';

          gpus.push({
            name,
            ram: ramBytes ? (ramBytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB' : 'N/A',
            driverVersion: driver,
            vendor,
            hasNvidia: vendor === 'nvidia',
          });
        }
      }

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
      console.error('[System Info] GPU scan failed:', err);
    }

    // 2. Determine python path
    const localPython = 'D:\\SuperAudioTools\\omnivoice-python\\python.exe';
    const pythonExe = fs.existsSync(localPython) ? localPython : 'python';

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
    const localFfmpeg = path.join(process.cwd(), 'bin', 'ffmpeg.exe');
    const coreFfmpeg = path.join(process.cwd(), 'python_core', 'ffmpeg', 'ffmpeg.exe');
    const ffmpegCmd = fs.existsSync(localFfmpeg)
      ? `"${localFfmpeg}"`
      : fs.existsSync(coreFfmpeg)
        ? `"${coreFfmpeg}"`
        : 'ffmpeg';

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

    const nvenc = await testEncoder('h264_nvenc');
    const amf = await testEncoder('h264_amf');
    const qsv = await testEncoder('h264_qsv');

    // 5. Check if installer is running
    let installStatus = { status: 'idle', progress: 0, message: '' };
    const statusPath = STATUS_PATH();
    if (fs.existsSync(statusPath)) {
      try {
        installStatus = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
      } catch {
        /* ignore */
      }
    }

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
        amfSupported: amf.supported,
        amfError: amf.error,
        qsvSupported: qsv.supported,
        qsvError: qsv.error,
        nvencSupportedOld: nvenc.supported,
        error: nvenc.error || amf.error || qsv.error || '',
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
