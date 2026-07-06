import { NextResponse } from 'next/server';
import { execFile } from 'child_process';

export const runtime = 'nodejs';

const FILTERS: Record<string, string> = {
  video: 'Video Files (*.mp4;*.mov;*.avi;*.mkv)|*.mp4;*.mov;*.avi;*.mkv|All Files (*.*)|*.*',
  srt: 'Subtitle Files (*.srt)|*.srt|Text Files (*.txt)|*.txt|All Files (*.*)|*.*',
  audio: 'Audio Files (*.mp3;*.wav;*.m4a;*.aac;*.flac;*.ogg)|*.mp3;*.wav;*.m4a;*.aac;*.flac;*.ogg|All Files (*.*)|*.*',
  image: 'Image Files (*.png;*.jpg;*.jpeg;*.webp)|*.png;*.jpg;*.jpeg;*.webp|All Files (*.*)|*.*',
  png: 'PNG Files (*.png)|*.png|All Files (*.*)|*.*',
};

function psSingle(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function runPowerShell(script: string) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise<string>((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-Sta', '-EncodedCommand', encoded],
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

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const kind = String(body.kind || 'video');
    const title = String(body.title || 'Chọn file');
    const multi = Boolean(body.multi);
    const filter = FILTERS[kind] || FILTERS.video;

    const script = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = ${psSingle(title)}
$dialog.Filter = ${psSingle(filter)}
$dialog.Multiselect = ${multi ? '$true' : '$false'}
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  if ($dialog.Multiselect) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    Write-Output ($dialog.FileNames -join [Environment]::NewLine)
  } else {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    Write-Output $dialog.FileName
  }
}
`.trim();

    const stdout = await runPowerShell(script);
    const paths = stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    return NextResponse.json({ cancelled: paths.length === 0, path: paths[0] || '', paths });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
