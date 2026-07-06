/**
 * Module thiết lập ban đầu & Dàn ý tác phẩm (Novel Setup & Outline Generator)
 */
import { SetupData, useNovelStore } from '@/store/useNovelStore';

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



  const storeState = useNovelStore.getState();
  const model = storeState.aiMasterModel;
  let keysToUse: string[] = [];
  if (model === 'gpt4o') {
    keysToUse = storeState.openaiApiKeys && storeState.openaiApiKeys.length > 0 ? storeState.openaiApiKeys : (storeState.openaiApiKey ? [storeState.openaiApiKey] : []);
  } else if (model === 'llama') {
    keysToUse = storeState.grokApiKeys && storeState.grokApiKeys.length > 0 ? storeState.grokApiKeys : (storeState.grokApiKey ? [storeState.grokApiKey] : []);
  } else {
    keysToUse = storeState.apiKeys && storeState.apiKeys.length > 0 ? storeState.apiKeys : (storeState.apiKey ? [storeState.apiKey] : []);
  }

  if (keysToUse.length === 0 && model !== 'aistudio') {
    throw new Error('Chưa cấu hình API Key cho mô hình đã chọn. Vui lòng cấu hình trong Cài đặt chung.');
  }

  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestType: 'GENERATE_IDEAS',
      apiKeys: keysToUse,
      model,
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



  const storeState = useNovelStore.getState();
  const model = storeState.aiMasterModel;
  let keysToUse: string[] = [];
  if (model === 'gpt4o') {
    keysToUse = storeState.openaiApiKeys && storeState.openaiApiKeys.length > 0 ? storeState.openaiApiKeys : (storeState.openaiApiKey ? [storeState.openaiApiKey] : []);
  } else if (model === 'llama') {
    keysToUse = storeState.grokApiKeys && storeState.grokApiKeys.length > 0 ? storeState.grokApiKeys : (storeState.grokApiKey ? [storeState.grokApiKey] : []);
  } else {
    keysToUse = storeState.apiKeys && storeState.apiKeys.length > 0 ? storeState.apiKeys : (storeState.apiKey ? [storeState.apiKey] : []);
  }

  if (keysToUse.length === 0 && model !== 'aistudio') {
    throw new Error('Chưa cấu hình API Key cho mô hình đã chọn. Vui lòng cấu hình trong Cài đặt chung.');
  }

  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestType: 'GENERATE_OUTLINE',
      apiKeys: keysToUse,
      model,
      payload: setupData
    })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Có lỗi xảy ra khi gọi API');
  }

  return await res.json();
}
