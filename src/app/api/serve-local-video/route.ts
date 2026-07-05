import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const videoPath = searchParams.get('path');

    if (!videoPath) {
      return new NextResponse('Missing path parameter', { status: 400 });
    }

    // Decode and normalize path
    const absolutePath = path.resolve(videoPath);

    if (!fs.existsSync(absolutePath)) {
      return new NextResponse('Video file not found', { status: 404 });
    }

    const stat = fs.statSync(absolutePath);
    const fileSize = stat.size;
    const range = req.headers.get('range');

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      const chunksize = end - start + 1;
      const file = fs.createReadStream(absolutePath, { start, end });
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize.toString(),
        'Content-Type': 'video/mp4',
      };

      return new NextResponse(file as any, { status: 206, headers: head });
    } else {
      const head = {
        'Content-Length': fileSize.toString(),
        'Content-Type': 'video/mp4',
      };
      const file = fs.createReadStream(absolutePath);
      return new NextResponse(file as any, { status: 200, headers: head });
    }
  } catch (error: any) {
    console.error('Error serving video:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
