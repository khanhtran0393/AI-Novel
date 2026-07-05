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
  ngon_ngu?: string;
  noi_dung_hien_tai: string;
  userRules?: {
    forbidden_words: string;
    fatigue_words: string;
  };
}

export async function compressContextAction(params: {
  apiKeys: string[];
  apiKey: string;
  tom_tat_cuon_chieu: string;
  tri_nho_ngan_han: string[];
  useMock: boolean;
}): Promise<string> {
  if (params.useMock) {
    return "Tóm tắt giả lập: Mọi thứ đang diễn ra rất kịch tính. Nhân vật chính vừa tìm được manh mối mới.";
  }
  const keysToUse = (params.apiKeys && params.apiKeys.length > 0) ? params.apiKeys : (params.apiKey ? [params.apiKey] : []);
  if (keysToUse.length === 0) throw new Error('Chưa cấu hình API Key.');

  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestType: 'COMPRESS_CONTEXT',
      apiKeys: keysToUse,
      payload: {
        tom_tat_cuon_chieu: params.tom_tat_cuon_chieu,
        tri_nho_ngan_han: params.tri_nho_ngan_han
      }
    })
  });
  if (!res.ok) {
    // Nếu lỗi nén context, ta có thể bỏ qua và dùng context thô (hoặc ném lỗi)
    return params.tom_tat_cuon_chieu;
  }
  const data = await res.json();
  return data.simulated_memory || params.tom_tat_cuon_chieu;
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
    ngon_ngu,
    noi_dung_hien_tai,
    userRules
  } = params;

  if (useMock) {
    await new Promise(resolve => setTimeout(resolve, 800));
    // Trả về đoạn văn bản kịch bản mẫu
    const dummyHeader = noi_dung_hien_tai ? '' : '### ' + chuong_hien_tai.tieu_de + '\n\n';
    return dummyHeader + `[CẢNH 1: Hố Đen Ký Ức Trong Hẻm Neon]\n\nCon phố hẹp Neo-Veridia ẩm ướt dưới những cơn mưa axit nhẹ, ánh đèn quảng cáo 3D nhấp nháy phát ra những dải sáng neon xanh lục lạnh lẽo. Khải Đăng dựng đứng cổ áo khoác, bước từng bước nặng nề trên vũng nước đọng phản chiếu các đám mây bụi hạt số hóa. Bàn tay anh nắm chặt chiếc máy quét xung điện não cầm tay - thiết bị duy nhất giúp anh sinh tồn trong thế giới mạt thế ký ức này.\n\n"Tín hiệu cảm xúc biến mất ngay tại điểm này," Khải Đăng lẩm bẩm, mắt liếc nhìn chỉ số nhiễu hạt liên tục vượt ngưỡng đỏ trên màn hình tinh thể lỏng.\n\nMột lão già ăn xin ngồi co ro bên cạnh bốt sạc xe bay rách nát khẽ dịch chuyển. Lão nhìn Khải Đăng với đôi mắt trống rỗng không chút thần sắc - hậu quả điển hình của việc để Mạng Lưới Thấu Cảm hút sạch neuron ký ức nhằm duy trì năng lượng cho các máy chủ trung tâm.\n\nKhải Đăng tiến lại gần, trong lòng dâng lên nỗi chua xót. Vết sẹo dài bên thái dương - di chứng của một lần đột nhập firewall thất bại năm xưa - chợt nhói đau buốt giá.\n\n[CẢNH 2: Xâm Nhập Não Bộ]\n\nKhải Đăng gắn hai bản cực mỏng của máy quét vào thái dương lão già. Chiếc máy rít lên một tần số chói tai, màn hình lập tức chuyển sang chế độ ánh sáng xanh dịu.\n\n"Bắt đầu đồng bộ hóa dữ liệu..." giọng nói robot của hệ điều hành vang lên trong tai nghe.\n\nMột dòng thác thông tin neuron ùa vào ý thức của Khải Đăng. Mê cung ký ức của lão già hiện ra đầy những vết rách rưới, xám xịt do sự lãng quên. Khải Đăng phải lướt thật nhanh qua những mảnh vụn cảm xúc hỗn độn - nỗi sợ hãi, đói nghèo, sự tuyệt vọng - để khoanh vùng đúng thời điểm cô gái bí ẩn kia xuất hiện. Kia rồi, một bóng hình mờ nhạt dần ngưng tụ lại giữa đám nhiễu hạt.\n\n"Bắt được tần số rồi," Khải Đăng mím môi, nhấn nút khóa cứng phân vùng dữ liệu cảm xúc trước khi bức tường lửa quét định kỳ của thành phố kịp quét tới.`;
  }

  // Thuật toán giả lập / nén ngữ cảnh (Context Simulation)
  let simulated_memory = tom_tat_cuon_chieu;
  if (tom_tat_cuon_chieu && tom_tat_cuon_chieu.length > 5000) {
    // Nếu ngữ cảnh quá lớn, nén lại trước khi gọi AI
    simulated_memory = await compressContextAction({
      apiKeys: apiKeys,
      apiKey: apiKey,
      tom_tat_cuon_chieu,
      tri_nho_ngan_han,
      useMock
    });
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
        tom_tat_cuon_chieu: simulated_memory,
        tri_nho_ngan_han,
        nhan_vat,
        chuong_hien_tai,
        so_chuong,
        so_tu_chuong,
        ngon_ngu,
        noi_dung_hien_tai,
        userRules
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

export async function evaluateChapterAction(params: {
  apiKey: string;
  apiKeys: string[];
  chuong_hien_tai: Chuong;
  noi_dung_kich_ban: string;
  userRules: { forbidden_words: string; fatigue_words: string; };
  useMock: boolean;
}): Promise<any> {
  if (params.useMock) {
    await new Promise(r => setTimeout(r, 1000));
    return {
      dimensions: [
        { dimension: 'consistency', score: 85, comment: 'Mock consistency' },
        { dimension: 'character', score: 90, comment: 'Mock character' },
        { dimension: 'pacing', score: 75, comment: 'Mock pacing' },
        { dimension: 'continuity', score: 88, comment: 'Mock continuity' },
        { dimension: 'foreshadow', score: 80, comment: 'Mock foreshadow' },
        { dimension: 'hook', score: 95, comment: 'Mock hook' },
        { dimension: 'aesthetic', score: 82, comment: 'Mock aesthetic' }
      ],
      verdict: 'accept',
      summary: 'Mock review summary.'
    };
  }

  const keysToUse = (params.apiKeys && params.apiKeys.length > 0) ? params.apiKeys : (params.apiKey ? [params.apiKey] : []);
  if (keysToUse.length === 0) throw new Error('Chưa cấu hình API Key.');

  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestType: 'EVALUATE_CHAPTER',
      apiKeys: keysToUse,
      payload: {
        chuong_hien_tai: params.chuong_hien_tai,
        noi_dung_kich_ban: params.noi_dung_kich_ban,
        userRules: params.userRules
      }
    })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Lỗi khi chấm điểm.');
  }

  return await res.json();
}

export async function planArcAction(params: {
  apiKey: string;
  apiKeys: string[];
  ten_tac_pham: string;
  lorebook: string;
  danh_sach_chuong_da_viet: string;
  cung_hien_tai: number;
  so_chuong_moi_cung: number;
  chuong_bat_dau: number;
}): Promise<any> {
  const keysToUse = (params.apiKeys && params.apiKeys.length > 0) ? params.apiKeys : (params.apiKey ? [params.apiKey] : []);
  if (keysToUse.length === 0) throw new Error('Chưa cấu hình API Key.');

  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestType: 'PLAN_ARC',
      apiKeys: keysToUse,
      payload: params
    })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Lỗi khi lập kế hoạch cung mới.');
  }

  return await res.json();
}
