import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import util from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = util.promisify(exec);

export const runtime = 'nodejs';

export async function GET() {
  try {
    // 1. Scan display adapters/GPUs from wmic
    const gpus: any[] = [];
    let primaryGpu = {
      name: 'CPU Only',
      ram: '0 GB',
      driverVersion: '',
      vendor: 'generic',
      hasNvidia: false
    };

    try {
      const { stdout } = await execAsync('wmic path win32_VideoController get Name, DriverVersion, AdapterRAM /format:list');
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
            else if (key === 'AdapterRAM') ramBytes = parseInt(val) || 0;
            else if (key === 'DriverVersion') driver = val;
          }
        }
        
        if (name) {
          const uppercaseName = name.toUpperCase();
          const vendor = uppercaseName.includes('NVIDIA') ? 'nvidia' :
                         (uppercaseName.includes('AMD') || uppercaseName.includes('RADEON')) ? 'amd' :
                         (uppercaseName.includes('INTEL') || uppercaseName.includes('IRIS') || uppercaseName.includes('ARC')) ? 'intel' : 'generic';
          
          gpus.push({
            name,
            ram: ramBytes ? (ramBytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB' : 'N/A',
            driverVersion: driver,
            vendor,
            hasNvidia: vendor === 'nvidia'
          });
        }
      }

      // Pick primary GPU (Nvidia > AMD > Intel > Generic)
      if (gpus.length > 0) {
        gpus.sort((a, b) => {
          const priority = { nvidia: 4, amd: 3, intel: 2, generic: 1 };
          return (priority[b.vendor as keyof typeof priority] || 1) - (priority[a.vendor as keyof typeof priority] || 1);
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
      cuda_version: null,
      onnx_providers: [] as string[],
      directml_available: false
    };

    try {
      const checkScriptPath = path.join(process.cwd(), 'python_core', 'gpu_check.py');
      const { stdout } = await execAsync(`"${pythonExe}" "${checkScriptPath}"`);
      pythonStatus = JSON.parse(stdout.trim());
    } catch (err: any) {
      console.error('[System Info] Python check failed:', err);
    }

    // 4. Test FFmpeg GPU encoders
    const localFfmpeg = path.join(process.cwd(), 'bin', 'ffmpeg.exe');
    const ffmpegCmd = fs.existsSync(localFfmpeg) ? `"${localFfmpeg}"` : 'ffmpeg';

    const testEncoder = async (codecName: string) => {
      try {
        await execAsync(`${ffmpegCmd} -y -f lavfi -i nullsrc=s=64x64:d=1 -c:v ${codecName} -f null -`);
        return { supported: true, error: '' };
      } catch (err: any) {
        return { supported: false, error: err.stderr || err.message || '' };
      }
    };

    const nvenc = await testEncoder('h264_nvenc');
    const amf = await testEncoder('h264_amf');
    const qsv = await testEncoder('h264_qsv');

    // 5. Check if installer is running
    const statusPath = path.join(process.cwd(), 'python_core', 'gpu_install_status.json');
    let installStatus = { status: 'idle', progress: 0, message: '' };
    if (fs.existsSync(statusPath)) {
      try {
        installStatus = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
      } catch {}
    }

    return NextResponse.json({
      gpus,
      gpu: primaryGpu, // backward compatibility
      python: {
        path: pythonExe,
        version: pythonStatus.python,
        torchVersion: pythonStatus.torch,
        cudaAvailable: pythonStatus.cuda,
        cudaVersion: pythonStatus.cuda_version,
        onnxProviders: pythonStatus.onnx_providers,
        directmlAvailable: pythonStatus.directml_available
      },
      ffmpeg: {
        nvencSupported: nvenc.supported,
        nvencError: nvenc.error,
        amfSupported: amf.supported,
        amfError: amf.error,
        qsvSupported: qsv.supported,
        qsvError: qsv.error,
        // backward compatibility:
        nvencSupportedOld: nvenc.supported,
        error: nvenc.error || amf.error || qsv.error || ''
      },
      installStatus
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Lỗi kiểm tra cấu hình hệ thống.' }, { status: 500 });
  }
}
