/**
 * Module quản lý các thao tác tương tác phân cảnh (Scene Card Interactivity Manager)
 */
import { Chuong } from '@/store/useNovelStore';
import { parseScenes } from '../utils/stringUtils';

export function sceneChangeAction(params: {
  idx: number;
  newContent: string;
  noiDungHienTai: string;
  streamText: string;
}): string {
  const { idx, newContent, noiDungHienTai, streamText } = params;
  const scenes = parseScenes(noiDungHienTai || streamText);
  if (scenes[idx]) {
    scenes[idx].content = newContent;
  }

  // Gộp ngược lại toàn bộ
  return scenes.map(s => {
    if (s.title === 'MỞ ĐẦU' || s.title === 'KỊCH BẢN') {
      return s.content;
    }
    return `${s.title}\n${s.content}`;
  }).join('\n\n');
}

export async function copySceneAction(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

interface ExpandSceneParams {
  idx: number;
  useMock: boolean;
  apiKey: string;
  apiKeys: string[];
  ten_tac_pham: string;
  currentChapter: Chuong;
  lorebook: string;
  scenes: { title: string; content: string }[];
  sceneToExpand: { title: string; content: string };
}

export async function expandSceneAction(params: ExpandSceneParams): Promise<string> {
  const { idx, useMock, apiKey, apiKeys, ten_tac_pham, currentChapter, lorebook, scenes, sceneToExpand } = params;

  if (useMock) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    return sceneToExpand.content + '\n\nKhải Đăng khẽ thở dài, hơi ấm phả ra tạo thành một làn sương mỏng manh trước mắt. Mạng Lưới Thấu Cảm quanh anh vẫn đang run rẩy truyền tải các luồng sóng cảm xúc lạnh giá từ khu phố ổ chuột. Mặc dù bộ giải mã ký ức trong tay bắt đầu báo lỗi quá tải, ánh mắt anh vẫn xoáy sâu vào vùng trống không của dữ liệu. Anh biết, đằng sau sự mất tích của cô gái kia là một bí mật kinh hoàng có thể làm sụp đổ toàn bộ Neo-Veridia.';
  }

  const keysToUse = (apiKeys && apiKeys.length > 0) ? apiKeys : (apiKey ? [apiKey] : []);
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestType: 'EXPAND_SCENE',
      apiKeys: keysToUse,
      payload: {
        ten_tac_pham,
        chuong_hien_tai: currentChapter,
        lorebook,
        previous_scene_content: idx > 0 ? scenes[idx - 1].content : '',
        current_scene_content: sceneToExpand.content,
        next_scene_content: idx < scenes.length - 1 ? scenes[idx + 1].content : ''
      }
    })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Lỗi khi kết nối với AI (Expart).');
  }

  const data = await res.json();
  return (data.expanded_content || sceneToExpand.content).normalize('NFC');
}
