import { NextResponse, NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

function contentTypeFor(filePath: string, buffer: Buffer): string | null {
  const contentHead = buffer.toString('utf8', 0, 100).trim();
  if (contentHead.includes('<svg')) {
    return null; // SVG blocked in production media pipeline
  }
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.svg') return 'image/svg+xml';
  return 'image/png';
}

/**
 * Resolve allowed absolute image path for ?path=
 * - public/images/*
 * - absolute path that exists as a regular image file (user save folder / face_ref)
 * Rejects path traversal and non-image extensions.
 */
function resolveAllowedPath(raw: string): string | null {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    /* keep raw */
  }
  decoded = String(decoded || '').trim().split('?')[0];
  if (!decoded || decoded.includes('\0')) return null;

  const publicImages = path.join(process.cwd(), 'public', 'images');
  const cwd = process.cwd();

  // Relative under public/images
  if (
    decoded.startsWith('/images/') ||
    decoded.startsWith('images/') ||
    decoded.startsWith('public/images/') ||
    decoded.startsWith('public\\images\\')
  ) {
    const base = path.basename(decoded.replace(/\\/g, '/'));
    if (!base || base === '.' || base === '..') return null;
    const abs = path.join(publicImages, base);
    return abs;
  }

  // Basename only → public/images
  if (!decoded.includes('/') && !decoded.includes('\\') && !/^[A-Za-z]:/.test(decoded)) {
    return path.join(publicImages, path.basename(decoded));
  }

  // Absolute path (Windows / Unix)
  let abs = decoded;
  try {
    if (abs.startsWith('file:')) {
      abs = decodeURIComponent(
        abs.replace(/^file:\/\//, '').replace(/^\/([A-Za-z]:)/, '$1'),
      );
    }
  } catch {
    /* ignore */
  }
  abs = path.resolve(abs);
  const ext = path.extname(abs).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) return null;

  // Allow under project public/images
  const pubNorm = path.resolve(publicImages);
  if (abs === pubNorm || abs.startsWith(pubNorm + path.sep)) return abs;

  // Allow absolute files that exist (durable face_ref in user save folder).
  // Block obvious system roots only.
  const lower = abs.toLowerCase();
  if (
    lower.startsWith('c:\\windows') ||
    lower.startsWith('/etc') ||
    lower.startsWith('/usr') ||
    lower.startsWith('/bin')
  ) {
    return null;
  }
  // Must be a real file (not directory)
  try {
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  } catch {
    return null;
  }
  // Also allow under cwd for packaged relative paths
  if (abs.startsWith(path.resolve(cwd) + path.sep)) return abs;
  return abs;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const filename = searchParams.get('file');
    const pathParam = searchParams.get('path');

    let filePath: string | null = null;

    if (filename) {
      const cleanFilename = filename.split('?')[0];
      const sanitized = path.basename(cleanFilename);
      if (!sanitized || sanitized === '.' || sanitized === '..') {
        return NextResponse.json({ error: 'Tên file không hợp lệ.' }, { status: 400 });
      }
      filePath = path.join(process.cwd(), 'public', 'images', sanitized);
    } else if (pathParam) {
      filePath = resolveAllowedPath(pathParam);
      if (!filePath) {
        return NextResponse.json(
          { error: 'Đường dẫn ảnh không được phép hoặc không hợp lệ.' },
          { status: 400 },
        );
      }
    } else {
      return NextResponse.json(
        { error: 'Thiếu tham số file hoặc path.' },
        { status: 400 },
      );
    }

    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return NextResponse.json({ error: 'File ảnh không tồn tại.' }, { status: 404 });
    }

    const buffer = fs.readFileSync(filePath);
    const contentType = contentTypeFor(filePath, buffer);
    if (!contentType || contentType === 'image/svg+xml') {
      return NextResponse.json(
        {
          error:
            'Tệp tin vector SVG không được hỗ trợ trong chế độ sản xuất. Vui lòng sử dụng hình ảnh raster thực tế.',
        },
        { status: 415 },
      );
    }

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : 'Lỗi khi phục vụ ảnh.',
      },
      { status: 500 },
    );
  }
}
