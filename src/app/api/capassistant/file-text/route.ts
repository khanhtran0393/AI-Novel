import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

const TEXT_EXTENSIONS = new Set(['.srt', '.txt', '.json', '.ass', '.vtt']);

function assertTextPath(filePath: string) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Missing file path');
  }
  const ext = path.extname(filePath).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported text file type: ${ext || '(none)'}`);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = String(body.action || 'read');
    const filePath = String(body.path || '');
    assertTextPath(filePath);

    if (action === 'read') {
      if (!fs.existsSync(filePath)) {
        return NextResponse.json({ success: false, error: `File not found: ${filePath}` }, { status: 404 });
      }
      const content = fs.readFileSync(filePath, 'utf8');
      return NextResponse.json({ success: true, path: filePath, content });
    }

    if (action === 'write') {
      const content = String(body.content ?? '');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, 'utf8');
      return NextResponse.json({ success: true, path: filePath });
    }

    return NextResponse.json({ success: false, error: `Unsupported action: ${action}` }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
