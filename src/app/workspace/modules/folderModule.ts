import { API } from '@/contracts';
/**
 * Module quản lý thư mục PC cục bộ (Local Directory Manager)
 */

export async function selectFolderAction(): Promise<{ cancelled: boolean; path?: string }> {
  try {
    const res = await fetch(API.selectFolder, { method: 'POST' });
    if (!res.ok) {
      throw new Error('Không thể kết nối tới dịch vụ chọn thư mục.');
    }
    const data = await res.json();
    return data;
  } catch (error: unknown) {
    console.error('Lỗi khi đọc file/thư mục:', error);
    throw new Error(`Lỗi chọn thư mục: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Mở thư mục trên OS:
 * 1) Electron shell.openPath (nếu có path tuyệt đối đã resolve từ API)
 * 2) Next API /api/open-folder (explorer.exe / open / xdg-open)
 */
export async function openFolderAction(folderPath: string): Promise<{ opened?: string }> {
  const target = (folderPath || 'project').trim() || 'project';

  // Always resolve via API first (handles aliases: project / . / cwd)
  try {
    const res = await fetch(API.openFolder, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath: target }),
    });

    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      opened?: string;
      error?: string;
      path?: string;
    };

    if (!res.ok || data.success === false) {
      // Electron fallback if Next API fails
      const electronPath = data.path || '';
      const tools = typeof window !== 'undefined' ? window.ainovelTools : undefined;
      if (
        tools?.openPath &&
        tools.isElectron &&
        electronPath &&
        pathLooksAbsolute(electronPath)
      ) {
        const r = await tools.openPath(electronPath);
        if (r?.ok) return { opened: electronPath };
      }
      throw new Error(data.error || 'Thư mục cục bộ không tồn tại.');
    }

    return { opened: data.opened || target };
  } catch (err: unknown) {
    throw new Error(
      `Không thể mở thư mục: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function pathLooksAbsolute(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\') || p.startsWith('/');
}
