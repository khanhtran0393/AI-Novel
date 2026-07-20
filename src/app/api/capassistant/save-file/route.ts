/**
 * Save text file via native Windows SaveFileDialog (CapAssist-style export SRT).
 */
import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { requireToolboxAccess } from '@/lib/commercial/apiGate';

export const runtime = 'nodejs';

function psSingle(value: string) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runPowerShell(script: string) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise<string>((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-Sta', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: 120000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const denied = await requireToolboxAccess(req, body);
    if (denied) return denied;
    const content = String(body.content ?? '');
    const title = String(body.title || 'Lưu file phụ đề');
    const defaultName = String(body.defaultName || 'translated.srt').replace(
      /[<>:"/\\|?*]/g,
      '_',
    );
    const filter = String(
      body.filter ||
        'SRT (*.srt)|*.srt|Text (*.txt)|*.txt|All Files (*.*)|*.*',
    );

    // Write temp then copy after dialog (content may be large / special chars)
    const tmpDir = path.join(process.cwd(), 'public', 'audio', 'srt-batch', '_save_tmp');
    fs.mkdirSync(tmpDir, { recursive: true });
    const tmpPath = path.join(tmpDir, `save_${Date.now()}.srt`);
    fs.writeFileSync(tmpPath, content, 'utf8');

    const script = `
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.StartPosition = 'CenterScreen'
$owner.ShowInTaskbar = $false
$dialog = New-Object System.Windows.Forms.SaveFileDialog
$dialog.Title = ${psSingle(title)}
$dialog.Filter = ${psSingle(filter)}
$dialog.FileName = ${psSingle(defaultName)}
$dialog.OverwritePrompt = $true
$result = $dialog.ShowDialog($owner)
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  $dest = $dialog.FileName
  Copy-Item -LiteralPath ${psSingle(tmpPath)} -Destination $dest -Force
  Write-Output $dest
}
$owner.Dispose()
`.trim();

    const stdout = await runPowerShell(script);
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }

    if (!stdout) {
      return NextResponse.json({ cancelled: true });
    }
    return NextResponse.json({ cancelled: false, path: stdout });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
