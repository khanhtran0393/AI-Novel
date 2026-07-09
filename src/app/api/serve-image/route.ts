import { NextResponse, NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const filename = searchParams.get('file');

    if (!filename) {
      return NextResponse.json({ error: 'Thiếu tham số file.' }, { status: 400 });
    }

    // Loại bỏ bất kỳ query parameter phụ nào nếu bị nối đuôi (ví dụ: ?t=123)
    const cleanFilename = filename.split('?')[0];

    // Chặn path traversal tấn công bảo mật
    const sanitized = path.basename(cleanFilename);
    const filePath = path.join(process.cwd(), 'public', 'images', sanitized);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'File ảnh không tồn tại.' }, { status: 404 });
    }

    const buffer = fs.readFileSync(filePath);

    // Phát hiện Content-Type thực tế dựa trên nội dung tệp tin hoặc đuôi file
    let contentType = 'image/png';
    const ext = path.extname(sanitized).toLowerCase();

    // Tu choi SVG trong che do production vi pipeline anh/video yeu cau raster that.
    const contentHead = buffer.toString('utf8', 0, 100).trim();
    if (contentHead.includes('<svg')) {
      return NextResponse.json(
        { error: 'Tệp tin vector SVG không được hỗ trợ trong chế độ sản xuất. Vui lòng sử dụng hình ảnh raster thực tế.' },
        { status: 415 },
      );
    } else {
      if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
      else if (ext === '.webp') contentType = 'image/webp';
      else if (ext === '.svg') contentType = 'image/svg+xml';
      else if (ext === '.gif') contentType = 'image/gif';
    }

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Lỗi khi phục vụ ảnh.' },
      { status: 500 }
    );
  }
}
