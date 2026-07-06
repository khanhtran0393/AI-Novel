import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const { folderPath } = await req.json();

    if (!folderPath) {
      return NextResponse.json({ error: 'Đường dẫn thư mục trống.' }, { status: 400 });
    }

    const resolvedPath = path.resolve(folderPath.trim());

    // Tự động tạo thư mục cục bộ nếu chưa tồn tại để nâng cao trải nghiệm người dùng
    if (!fs.existsSync(resolvedPath)) {
      try {
        fs.mkdirSync(resolvedPath, { recursive: true });
        console.log(`[Open Folder] Tự động tạo thành công thư mục: ${resolvedPath}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        console.warn(`[Open Folder] Không thể tự động tạo thư mục: ${err.message}`);
      }
    }

    if (!fs.existsSync(resolvedPath)) {
      return NextResponse.json({
        error: `Thư mục không tồn tại cục bộ: ${resolvedPath}`,
        fallbackUrl: 'https://drive.google.com/drive/my-drive',
        path: resolvedPath
      }, { status: 404 });
    }

    try {
      const child = spawn('explorer.exe', [resolvedPath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
    } catch (openError: unknown) {
      return NextResponse.json({
        error: openError instanceof Error ? openError.message : String(openError),
        fallbackUrl: 'https://drive.google.com/drive/my-drive',
        path: resolvedPath
      }, { status: 500 });
    }

    return NextResponse.json({ success: true, opened: resolvedPath });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Lỗi khi mở thư mục.' }, { status: 500 });
  }
}
