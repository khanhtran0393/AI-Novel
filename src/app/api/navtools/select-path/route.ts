import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import fs from 'fs';
import { requireFeature } from '@/lib/commercial/apiGate';

export const runtime = 'nodejs';

const FILTERS: Record<string, string> = {
  media: 'Media Files (*.mp4;*.mov;*.avi;*.mkv;*.mp3;*.wav;*.m4a;*.aac;*.flac;*.ogg;*.png;*.jpg;*.jpeg;*.webp)|*.mp4;*.mov;*.avi;*.mkv;*.mp3;*.wav;*.m4a;*.aac;*.flac;*.ogg;*.png;*.jpg;*.jpeg;*.webp|All Files (*.*)|*.*',
  video: 'Video Files (*.mp4;*.mov;*.avi;*.mkv)|*.mp4;*.mov;*.avi;*.mkv|All Files (*.*)|*.*',
  audio: 'Audio Files (*.mp3;*.wav;*.m4a;*.aac;*.flac;*.ogg)|*.mp3;*.wav;*.m4a;*.aac;*.flac;*.ogg|All Files (*.*)|*.*',
  text: 'Text Files (*.txt)|*.txt|All Files (*.*)|*.*',
};

function psSingle(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function runPowerShell(script: string) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise<string>((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-Sta', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 },
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const denied = await requireFeature(req, 'toolbox_labs', body);
    if (denied) return denied;
    const { mode, type = 'media' } = body;
    const filter = FILTERS[String(type)] || FILTERS.media;

    const script = mode === 'folder'
      ? `
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.StartPosition = 'CenterScreen'
$owner.ShowInTaskbar = $false
$f = New-Object System.Windows.Forms.FolderBrowserDialog
$f.Description = 'Chon thu muc luu dau ra'
$f.ShowNewFolderButton = $true
$result = $f.ShowDialog($owner)
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $f.SelectedPath
}
$owner.Dispose()
`.trim()
      : `
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.StartPosition = 'CenterScreen'
$owner.ShowInTaskbar = $false
$f = New-Object System.Windows.Forms.OpenFileDialog
$f.Filter = ${psSingle(filter)}
$f.Title = 'Chon file dau vao'
$f.Multiselect = $true
$result = $f.ShowDialog($owner)
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output ($f.FileNames -join '|')
}
$owner.Dispose()
`.trim();

    const selected = await runPowerShell(script);
    if (!selected) {
      return NextResponse.json({ success: true, cancelled: true, path: '', content: '' });
    }

    let fileContent = '';
    if (mode === 'file' && type === 'text') {
      const filePath = selected.split('|')[0];
      if (fs.existsSync(filePath)) {
        fileContent = fs.readFileSync(filePath, 'utf8');
      }
    }

    return NextResponse.json({ success: true, cancelled: false, path: selected, content: fileContent });
  } catch (err: unknown) {
    console.error('[select-path] Error:', err);
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
