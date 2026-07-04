/**
 * Module quản lý thư mục PC cục bộ (Local Directory Manager)
 */

export async function selectFolderAction(): Promise<{ cancelled: boolean; path?: string }> {
  try {
    const res = await fetch('/api/select-folder', { method: 'POST' });
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

export async function openFolderAction(folderPath: string): Promise<void> {
  if (!folderPath || folderPath.trim() === '') {
    throw new Error('⚠️ Đường dẫn thư mục trống hoặc chưa cấu hình.');
  }

  try {
    const res = await fetch('/api/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath: folderPath.trim() })
    });
    
    if (!res.ok) {
      const err = await res.json();
      if (res.status === 404 && err.fallbackUrl) {
        // Trả về một đối tượng đặc biệt để UI tự mở link Google Drive nếu muốn
        return Promise.reject({ isFallback: true, fallbackUrl: err.fallbackUrl, message: err.error });
      }
      throw new Error(err.error || 'Thư mục cục bộ không tồn tại.');
    }
  } catch (err: unknown) {
    const errorObj = err as { isFallback?: boolean };
    if (errorObj.isFallback) throw err;
    throw new Error(`Không thể mở thư mục: ${err instanceof Error ? err.message : String(err)}`);
  }
}
