import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { requireToolboxAccess } from '@/lib/commercial/apiGate';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const denied = await requireToolboxAccess(req, body);
    if (denied) return denied;
    const targetPath = String(body.path || '').trim();
    if (!targetPath) {
      return NextResponse.json({ success: false, error: 'Missing path.' }, { status: 400 });
    }

    const resolvedPath = path.resolve(targetPath);
    if (!fs.existsSync(resolvedPath)) {
      return NextResponse.json({ success: false, error: `Path does not exist: ${resolvedPath}` }, { status: 404 });
    }

    const child = spawn('cmd.exe', ['/c', 'start', '', resolvedPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();

    return NextResponse.json({ success: true, opened: resolvedPath });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
