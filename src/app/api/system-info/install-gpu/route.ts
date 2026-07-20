import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const vendor = body.vendor || 'nvidia';
    
    const statusPath = path.join(process.cwd(), 'python_core', 'gpu_install_status.json');
    
    // Check if already running
    if (fs.existsSync(statusPath)) {
      try {
        const currentStatus = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
        if (currentStatus.status === 'installing') {
          return NextResponse.json({ success: true, message: 'Bộ cài đặt đang chạy trong nền.', alreadyRunning: true });
        }
      } catch {}
    }

    // Initialize status file
    const initialStatus = {
      status: 'installing',
      progress: 5,
      message: 'Khởi động bộ cài đặt...',
      log: `Khởi động bộ cài đặt GPU (${vendor.toUpperCase()}) trong nền...\n`,
      startTime: new Date().toISOString()
    };
    
    fs.mkdirSync(path.dirname(statusPath), { recursive: true });
    fs.writeFileSync(statusPath, JSON.stringify(initialStatus, null, 2), 'utf8');

    // Spawn the background worker script
    const workerPath = path.join(
      /* turbopackIgnore: true */ process.cwd(),
      'python_core',
      'install_gpu_worker.js',
    );
    if (!fs.existsSync(workerPath)) {
      throw new Error(`Thiếu GPU worker: ${workerPath}`);
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
    
    child.unref();

    return NextResponse.json({ success: true, message: `Đã khởi động tiến trình cài đặt GPU ${vendor.toUpperCase()} trong nền.` });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Lỗi khi khởi chạy bộ cài đặt.' }, { status: 500 });
  }
}
