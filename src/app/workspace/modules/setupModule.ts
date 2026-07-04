/**
 * Module thiết lập ban đầu & Dàn ý tác phẩm (Novel Setup & Outline Generator)
 */
import { SetupData } from '@/store/useNovelStore';

export const CO_THE_KHUYET_TAT = [
  'rách gân tay trái khiến kiếm chiêu bị lệch 1 phân',
  'mù mắt phải do vết cào của dị chủng cấp cao',
  'liệt chân trái phải bước đi tập tễnh cùng nạng sắt',
  'mất khứu giác do hít phải bụi phóng xạ mạt thế',
  'phổi bị tổn thương nặng chỉ có thể nín thở tối đa 15 giây',
  'cụt 2 ngón tay phải khiến việc nạp đạn súng bị chậm 2 giây'
];

export const KHONG_GIAN_HOANG_PHE = [
  'trạm xăng bỏ hoang ngập trong sương độc axit',
  'tầng hầm trung tâm thương mại bị rêu đỏ ăn mòn',
  'nhà kho đông lạnh cũ chứa đầy kén trứng của biến dị thể',
  'nhà thờ đổ nát có bức tượng đổ sập chặn lối thoát',
  'toa tàu điện ngầm mắc kẹt giữa đường hầm ngập nước',
  'phòng thí nghiệm sinh học đổ nát đầy bình chứa rò rỉ'
];

export const VAT_PHAM_MAC_DINH = [
  'Con dao găm rỉ sét cán gỗ',
  'Bình lọc nước cầm tay còn 1 lần lọc',
  'Bản đồ khu tị nạn rách góc',
  'Hộp quẹt đá hết gas nhưng còn tia lửa',
  'Sợi dây xích sắt dài 2 mét'
];

export const getFriendlyErrorMessage = (err: unknown): string => {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('429') || msg.includes('Quota') || msg.includes('quota') || msg.includes('limit')) {
    return `⚠️ Hạn mức API miễn phí (Quota Exceeded 429) của bạn đã tạm thời cạn kiệt.\n\n💡 Hướng dẫn khắc phục:\n1. Truy cập https://aistudio.google.com/app/apikey để tạo thêm API Key miễn phí.\n2. Nhấp vào "API Keys" ở góc trên bên phải để thêm nhiều Key dự phòng. Hệ thống sẽ TỰ ĐỘNG XOAY VÒNG khi hết hạn ngạch.\n3. Hoặc chờ 5-15 phút để Google tự reset hạn ngạch.`;
  }
  return `❌ Lỗi hệ thống AI: ${msg}`;
};

export async function randomTemplateAction(params: {
  useMock: boolean;
  apiKey: string;
  apiKeys: string[];
  chu_de: string;
  phong_cach: string;
}): Promise<string> {
  const { useMock, apiKey, apiKeys, chu_de, phong_cach } = params;

  if (useMock) {
    const tenMain = 'Khải Đăng';
    const khuyetTat = CO_THE_KHUYET_TAT[Math.floor(Math.random() * CO_THE_KHUYET_TAT.length)];
    const khongGian = KHONG_GIAN_HOANG_PHE[Math.floor(Math.random() * KHONG_GIAN_HOANG_PHE.length)];
    const vatPham = VAT_PHAM_MAC_DINH[Math.floor(Math.random() * VAT_PHAM_MAC_DINH.length)];
    return `Neo-Veridia rực rỡ dưới ánh neon nhưng trống rỗng bên trong. Nhân vật chính ${tenMain} (Memory Hunter) gánh chịu khuyết tật: ${khuyetTat}. Câu chuyện bắt đầu khi ${tenMain} lọt vào một ${khongGian} để tìm kiếm những mảnh ký ức bị xóa bỏ của một tập thể, trong tay chỉ có một ${vatPham}. Anh phải chiến đấu chống lại thực thể ảo ảnh bảo mật trước khi Mạng Lưới Thấu Cảm tự động khóa vùng dữ liệu này vào ban đêm.`;
  }

  const keysToUse = (apiKeys && apiKeys.length > 0) ? apiKeys : (apiKey ? [apiKey] : []);
  if (keysToUse.length === 0) {
    throw new Error('⚠️ Vui lòng nhập API Key để dùng tính năng AI tạo ý tưởng!');
  }

  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestType: 'GENERATE_IDEAS',
      apiKeys: keysToUse,
      payload: { chu_de, phong_cach }
    })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Có lỗi xảy ra khi gọi AI');
  }

  const data = await res.json();
  return data.idea || 'Không nhận được ý tưởng.';
}

export async function generateOutlineAction(params: {
  useMock: boolean;
  apiKey: string;
  apiKeys: string[];
  setupData: SetupData;
}): Promise<unknown> {
  const { useMock, apiKey, apiKeys, setupData } = params;

  if (useMock) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    const dummyChapters = Array.from({ length: setupData.so_chuong }).map((_, i) => ({
      so_chuong: i + 1,
      tieu_de: i === 0 ? 'Chương 1: Ký ức biến mất' : i === 1 ? 'Chương 2: Lần theo dấu vết' : `Chương ${i + 1}: Đi sâu vào Mạng Lưới`,
      dan_y: i === 0 
        ? 'Khải Đăng nhận một vụ án kỳ lạ tại khu phố ổ chuột của Neo-Veridia, nơi toàn bộ cư dân quên mất sự tồn tại của một cô gái trẻ. Anh phải kết nối trực tiếp vào Mạng Lưới Thấu Cảm để tìm lại những mảnh vụn ký ức bị xóa bỏ.'
        : i === 1 
        ? 'Khải Đăng phát hiện ra một lỗ hổng bảo mật chết người trong Mạng Lưới Thấu Cảm, cho phép một thế lực ẩn danh xóa sạch sự tồn tại của bất kỳ ai. Anh bị truy đuổi bởi các thực thể bảo vệ hệ thống.'
        : `Diễn biến tóm tắt của Chương ${i + 1} tại khu hoang dã số liệu. Khải Đăng phải vượt qua các bức tường lửa mã hóa cảm xúc.`,
      noi_dung: '',
      trang_thai: 'empty'
    }));

    const mockOutline = `# DÀN Ý TỔNG THỂ TÁC PHẨM: KÝ ỨC PHAI TÀN: MẠNG LƯỚI HƯ VÔ\n\n## 1. Khái Quát Bối Cảnh\nĐô thị Neo-Veridia ngập trong ánh đèn neon và Mạng Lưới Thấu Cảm (Empathic Net) thần kinh kết nối vạn vật.\n\n## 2. Tuyến Nhân Vật\nKhải Đăng - Thợ Săn Ký Ức (Memory Hunter) điều tra các vụ án xóa bỏ hiện thực đầy hiểm nguy.\n\n## 3. Lịch Trình Phát Triển Cốt Truyện\n- Chương 1: Khải Đăng truy tìm dấu vết ký ức bị xóa bỏ của cô gái bí ẩn ở khu ổ chuột.\n- Chương 2: Anh lật mở lỗ hổng bảo mật chết người của hệ thống thần kinh tập thể.`;

    return {
      tieu_de: 'Ký ức Phai Tàn: Mạng Lưới Hư Vô',
      dan_y_tong_the: mockOutline,
      nhan_vat: ['Khải Đăng'],
      danh_sach_chuong: dummyChapters
    };
  }

  const keysToUse = (apiKeys && apiKeys.length > 0) ? apiKeys : (apiKey ? [apiKey] : []);
  if (keysToUse.length === 0) {
    throw new Error('Chưa cấu hình API Key.');
  }

  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestType: 'GENERATE_OUTLINE',
      apiKeys: keysToUse,
      payload: setupData
    })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Có lỗi xảy ra khi gọi API');
  }

  return await res.json();
}
