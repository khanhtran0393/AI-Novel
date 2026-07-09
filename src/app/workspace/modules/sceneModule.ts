/**
 * Module quản lý các thao tác tương tác phân cảnh (Scene Card Interactivity Manager)
 */
import { Chuong, useNovelStore } from '@/store/useNovelStore';
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
  apiKey: string;
  apiKeys: string[];
  ten_tac_pham: string;
  currentChapter: Chuong;
  lorebook: string;
  scenes: { title: string; content: string }[];
  sceneToExpand: { title: string; content: string };
  /** Cold-open Hook ~30s */
  isHook?: boolean;
}

export async function expandSceneAction(params: ExpandSceneParams): Promise<string> {
  const {
    idx,
    apiKey,
    apiKeys,
    ten_tac_pham,
    currentChapter,
    lorebook,
    scenes,
    sceneToExpand,
    isHook,
  } = params;
  void apiKey;
  void apiKeys;

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
      requestType: 'EXPAND_SCENE',
      apiKeys: keysToUse,
      model,
      payload: {
        ten_tac_pham,
        chuong_hien_tai: currentChapter,
        lorebook,
        previous_scene_content: isHook ? '' : idx > 0 ? scenes[idx - 1].content : '',
        current_scene_content: sceneToExpand.content,
        next_scene_content: isHook
          ? scenes[0]?.content || ''
          : idx < scenes.length - 1
            ? scenes[idx + 1].content
            : '',
        is_hook: !!isHook,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Lỗi khi kết nối với AI (Expart).');
  }

  const data = await res.json();
  return (data.expanded_content || sceneToExpand.content).normalize('NFC');
}

interface RewriteSceneParams {
  idx: number;
  apiKey: string;
  apiKeys: string[];
  ten_tac_pham: string;
  currentChapter: Chuong;
  lorebook: string;
  scenes: { title: string; content: string }[];
  sceneToRewrite: { title: string; content: string };
  /** Cold-open Hook ~30s */
  isHook?: boolean;
  /** Bật humanize + câu đùa người khi viết lại Hook */
  humanize?: boolean;
}

/** Viết lại nhẹ nội dung cảnh — giữ cốt lõi, điều hòa nối tiếp cảnh kề */
export async function rewriteSceneAction(params: RewriteSceneParams): Promise<string> {
  const {
    idx,
    apiKey,
    apiKeys,
    ten_tac_pham,
    currentChapter,
    lorebook,
    scenes,
    sceneToRewrite,
    isHook,
    humanize,
  } = params;
  void apiKey;
  void apiKeys;

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
      requestType: 'REWRITE_SCENE',
      apiKeys: keysToUse,
      model,
      payload: {
        ten_tac_pham,
        chuong_hien_tai: currentChapter,
        lorebook,
        previous_scene_content: isHook ? '' : idx > 0 ? scenes[idx - 1].content : '',
        current_scene_content: sceneToRewrite.content,
        next_scene_content: isHook
          ? scenes[0]?.content || ''
          : idx < scenes.length - 1
            ? scenes[idx + 1].content
            : '',
        is_hook: !!isHook,
        humanize_script: humanize !== false,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Lỗi khi kết nối với AI (Viết lại cảnh).');
  }

  const data = await res.json();
  return (data.rewritten_content || sceneToRewrite.content).normalize('NFC');
}
