import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

const execAsync = promisify(exec);

export async function POST(req: NextRequest) {
  try {
    const { mode, type = 'media' } = await req.json();

    let psScript = '';
    if (mode === 'folder') {
      psScript = `
        Add-Type -AssemblyName System.Windows.Forms;
        $f = New-Object System.Windows.Forms.FolderBrowserDialog;
        $f.Description = "Chọn thư mục lưu đầu ra";
        $f.ShowNewFolderButton = $true;
        $result = $f.ShowDialog((New-Object System.Windows.Forms.Form -Property @{TopMost = $true}));
        if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
            Write-Output $f.SelectedPath;
        }
      `;
    } else {
      let filter = 'All Files (*.*)|*.*';
      if (type === 'media') {
        filter = 'Media Files (*.mp4;*.mp3;*.wav;*.png;*.jpg;*.avi;*.mkv)|*.mp4;*.mp3;*.wav;*.png;*.jpg;*.avi;*.mkv|All Files (*.*)|*.*';
      } else if (type === 'text') {
        filter = 'Text Files (*.txt)|*.txt|All Files (*.*)|*.*';
      }
      psScript = `
        Add-Type -AssemblyName System.Windows.Forms;
        $f = New-Object System.Windows.Forms.OpenFileDialog;
        $f.Filter = "${filter}";
        $f.Title = "Chọn file đầu vào";
        $f.Multiselect = $true;
        $result = $f.ShowDialog((New-Object System.Windows.Forms.Form -Property @{TopMost = $true}));
        if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
            Write-Output ($f.FileNames -join "|");
        }
      `;
    }

    const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript.replace(/\n/g, ' ').replace(/"/g, '\\"')}"`;
    const { stdout } = await execAsync(cmd);
    const selected = stdout.trim();

    if (!selected) {
      return NextResponse.json({ success: true, path: '', content: '' });
    }

    let fileContent = '';
    if (mode === 'file' && type === 'text') {
      // Nếu là chọn file text, đọc nội dung file trả về luôn cho frontend
      const filePath = selected.split('|')[0];
      if (fs.existsSync(filePath)) {
        fileContent = fs.readFileSync(filePath, 'utf-8');
      }
    }

    return NextResponse.json({ success: true, path: selected, content: fileContent });
  } catch (err: unknown) {
    console.error('[select-path] Error:', err);
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
