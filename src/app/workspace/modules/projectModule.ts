/**
 * Module quản lý toàn cục Dự án kịch bản (Project-wide Export & Assets Cleanup Manager)
 */

interface ExportTxtParams {
  ten_tac_pham: string;
  chuong_dang_chon: number;
  dan_y_tong_the: string;
  tab_hien_tai: string;
  noi_dung_chuong: string;
  dan_y_chuong: string;
  streamText: string;
}

export function exportTxtAction(params: ExportTxtParams): void {
  const { ten_tac_pham, chuong_dang_chon, dan_y_tong_the, tab_hien_tai, noi_dung_chuong, dan_y_chuong, streamText } = params;
  
  let text = '';
  if (tab_hien_tai === 'dan_y') {
    text = `TÁC PHẨM: ${ten_tac_pham}\n\n${dan_y_tong_the}\n\n======================\nCHI TIẾT CHƯƠNG ${chuong_dang_chon}:\n${dan_y_chuong || ''}`;
  } else {
    text = noi_dung_chuong || streamText || 'Chưa có nội dung.';
  }

  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${ten_tac_pham}_Chuong_${chuong_dang_chon}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function resetProjectAction(googleDrivePath: string): Promise<void> {
  try {
    await fetch('/api/cleanup-assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drivePath: googleDrivePath })
    });
  } catch (e) {
    console.error('Error cleaning up script assets:', e);
    throw new Error('Dọn dẹp tệp tin cũ thất bại, nhưng hệ thống vẫn tiếp tục reset bộ nhớ.');
  }
}
