import { NextResponse } from 'next/server';
import { exec } from 'child_process';

export const runtime = 'nodejs';

export async function POST() {
  try {
    // Sử dụng PowerShell System.Windows.Forms.FolderBrowserDialog trên Windows
    const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Chọn thư mục lưu trữ cho ứng dụng'
$dialog.ShowNewFolderButton = $true
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $dialog.SelectedPath
} else {
  Write-Output ''
}
`.trim().replace(/\n/g, '; ');

    const selectedPath = await new Promise<string>((resolve, reject) => {
      exec(
        `powershell -NoProfile -Command "${psScript}"`,
        { timeout: 120000 },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`Lỗi PowerShell: ${error.message}`));
            return;
          }
          resolve(stdout.trim());
        }
      );
    });

    if (!selectedPath) {
      return NextResponse.json({ cancelled: true, path: '' });
    }

    return NextResponse.json({ cancelled: false, path: selectedPath });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Lỗi khi mở hộp thoại chọn thư mục.' },
      { status: 500 }
    );
  }
}
