import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const statusPath = path.join(process.cwd(), 'python_core', 'gpu_install_status.json');
    if (fs.existsSync(statusPath)) {
      const data = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
      return NextResponse.json(data);
    }
    return NextResponse.json({ status: 'idle', progress: 0, message: 'Chưa bắt đầu cài đặt' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Lỗi khi đọc trạng thái cài đặt.' }, { status: 500 });
  }
}
