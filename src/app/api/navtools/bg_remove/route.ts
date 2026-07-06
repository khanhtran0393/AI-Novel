import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execAsync = promisify(exec);

export async function POST(req: NextRequest) {
  try {
    const { imagePath, outPath, color } = await req.json();
    const pythonCore = path.join(process.cwd(), 'python_core');
    const scriptPath = path.join(pythonCore, 'cli_bg_remove.py');
    const PYTHON_EXE = fs.existsSync('D:\\SuperAudioTools\\omnivoice-python\\python.exe')
      ? 'D:\\SuperAudioTools\\omnivoice-python\\python.exe'
      : 'python';
    
    let command = `"${PYTHON_EXE}" "${scriptPath}" --image "${imagePath}" --output "${outPath}"`;
    if (color) {
      command += ` --color "${color}"`;
    }
    
    const { stdout, stderr } = await execAsync(command);
    
    return NextResponse.json({ success: true, stdout, stderr, outPath });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
