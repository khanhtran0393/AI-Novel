import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json();
    const pythonCore = path.join(process.cwd(), 'python_core');
    const scriptPath = path.join(pythonCore, 'api_script2prompt.py');
    
    // Using base64 to avoid quoting issues
    const textBase64 = Buffer.from(text).toString('base64');
    
    const command = `python "${scriptPath}" "${textBase64}"`;
    const { stdout, stderr } = await execAsync(command);
    
    return NextResponse.json({ success: true, stdout, stderr });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
