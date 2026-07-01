/**
 * Module xử lý sinh kịch bản chi tiết chương truyện (Novel AI Writer)
 */

import { Chuong } from '@/store/useNovelStore';

interface WriteChapterParams {
  useMock: boolean;
  apiKey: string;
  apiKeys: string[];
  ten_tac_pham: string;
  dan_y_tong_the: string;
  lorebook: string;
  tom_tat_cuon_chieu: string;
  tri_nho_ngan_han: string[];
  nhan_vat: string[];
  chuong_hien_tai: Chuong;
  so_chuong: number;
  so_tu_chuong: number;
  noi_dung_hien_tai: string;
}

export async function writeChapterAction(params: WriteChapterParams): Promise<string> {
  const {
    useMock,
    apiKey,
    apiKeys,
    ten_tac_pham,
    dan_y_tong_the,
    lorebook,
    tom_tat_cuon_chieu,
    tri_nho_ngan_han,
    nhan_vat,
    chuong_hien_tai,
    so_chuong,
    so_tu_chuong,
    noi_dung_hien_tai
  } = params;

  if (useMock) {
    await new Promise(resolve => setTimeout(resolve, 800));
    // Trả về đoạn văn bản kịch bản mẫu
    const dummyHeader = noi_dung_hien_tai ? '' : '### ' + chuong_hien_tai.tieu_de + '\n\n';
    return dummyHeader + `[CẢNH 1: Hố Đen Ký Ức Trong Hẻm Neon]\n\nCon phố hẹp Neo-Veridia ẩm ướt dưới những cơn mưa axit nhẹ, ánh đèn quảng cáo 3D nhấp nháy phát ra những dải sáng neon xanh lục lạnh lẽo. Khải Đăng dựng đứng cổ áo khoác, bước từng bước nặng nề trên vũng nước đọng phản chiếu các đám mây bụi hạt số hóa. Bàn tay anh nắm chặt chiếc máy quét xung điện não cầm tay - thiết bị duy nhất giúp anh sinh tồn trong thế giới mạt thế ký ức này.\n\n"Tín hiệu cảm xúc biến mất ngay tại điểm này," Khải Đăng lẩm bẩm, mắt liếc nhìn chỉ số nhiễu hạt liên tục vượt ngưỡng đỏ trên màn hình tinh thể lỏng.\n\nMột lão già ăn xin ngồi co ro bên cạnh bốt sạc xe bay rách nát khẽ dịch chuyển. Lão nhìn Khải Đăng với đôi mắt trống rỗng không chút thần sắc - hậu quả điển hình của việc để Mạng Lưới Thấu Cảm hút sạch neuron ký ức nhằm duy trì năng lượng cho các máy chủ trung tâm.\n\nKhải Đăng tiến lại gần, trong lòng dâng lên nỗi chua xót. Vết sẹo dài bên thái dương - di chứng của một lần đột nhập firewall thất bại năm xưa - chợt nhói đau buốt giá.\n\n[CẢNH 2: Xâm Nhập Não Bộ]\n\nKhải Đăng gắn hai bản cực mỏng của máy quét vào thái dương lão già. Chiếc máy rít lên một tần số chói tai, màn hình lập tức chuyển sang chế độ ánh sáng xanh dịu.\n\n"Bắt đầu đồng bộ hóa dữ liệu..." giọng nói robot của hệ điều hành vang lên trong tai nghe.\n\nMột dòng thác thông tin neuron ùa vào ý thức của Khải Đăng. Mê cung ký ức của lão già hiện ra đầy những vết rách rưới, xám xịt do sự lãng quên. Khải Đăng phải lướt thật nhanh qua những mảnh vụn cảm xúc hỗn độn - nỗi sợ hãi, đói nghèo, sự tuyệt vọng - để khoanh vùng đúng thời điểm cô gái bí ẩn kia xuất hiện. Kia rồi, một bóng hình mờ nhạt dần ngưng tụ lại giữa đám nhiễu hạt.\n\n"Bắt được tần số rồi," Khải Đăng mím môi, nhấn nút khóa cứng phân vùng dữ liệu cảm xúc trước khi bức tường lửa quét định kỳ của thành phố kịp quét tới.`;
  }

  const keysToUse = (apiKeys && apiKeys.length > 0) ? apiKeys : (apiKey ? [apiKey] : []);
  if (keysToUse.length === 0) {
    throw new Error('Chưa cấu hình API Key.');
  }

  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requestType: 'WRITE_CHAPTER',
      apiKeys: keysToUse,
      payload: {
        ten_tac_pham,
        dan_y_tong_the,
        lorebook,
        tom_tat_cuon_chieu,
        tri_nho_ngan_han,
        nhan_vat,
        chuong_hien_tai,
        so_chuong,
        so_tu_chuong,
        noi_dung_hien_tai
      }
    })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Lỗi khi kết nối với AI.');
  }

  const data = await res.json();
  return (data.noi_dung || 'Không có nội dung trả về.').normalize('NFC');
}
