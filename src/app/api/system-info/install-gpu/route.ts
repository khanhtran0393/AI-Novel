import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import {
  gpuInstallStatusPath,
  readGpuInstallStatus,
  writeGpuInstallStatus,
} from '@/lib/gpuInstallStatus';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const vendor = String(body.vendor || 'nvidia');
    const statusPath = gpuInstallStatusPath();

    if (fs.existsSync(statusPath)) {
      const currentStatus = readGpuInstallStatus();
      if (currentStatus.status === 'installing') {
        return NextResponse.json({
          success: true,
          message: currentStatus.stalled
            ? 'Bo cai GPU dang chay nhung chua co tien do moi. Neu keo dai, mo log hoac thu cai lai sau khi status stale.'
            : 'Bo cai dat dang chay trong nen.',
          alreadyRunning: true,
          status: currentStatus,
        });
      }
    }

    const now = new Date().toISOString();
    const initialStatus = {
      status: 'installing' as const,
      progress: 5,
      message: 'Khoi dong bo cai dat...',
      log: `Khoi dong bo cai dat GPU (${vendor.toUpperCase()}) trong nen...\n`,
      startTime: now,
      updatedAt: now,
    };
    writeGpuInstallStatus(initialStatus);

    const workerPath = path.join(
      /* turbopackIgnore: true */ process.cwd(),
      'python_core',
      'install_gpu_worker.js',
    );
    if (!fs.existsSync(workerPath)) {
      throw new Error(`Thieu GPU worker: ${workerPath}`);
    }
    const child = spawn(process.execPath, [workerPath, vendor], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: {
        ...process.env,
        ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      },
    });

    writeGpuInstallStatus({
      ...initialStatus,
      pid: child.pid,
      message: `Da khoi dong worker GPU PID ${child.pid || '?'}.`,
    });

    child.unref();

    return NextResponse.json({
      success: true,
      message: `Da khoi dong tien trinh cai dat GPU ${vendor.toUpperCase()} trong nen.`,
      status: readGpuInstallStatus(),
    });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Loi khi khoi chay bo cai dat.',
      },
      { status: 500 },
    );
  }
}
