import { postGenerate } from './apiClient';
/**
 * Module quản lý các thao tác tương tác phân cảnh (Scene Card Interactivity Manager)
 */
import type { Chuong } from '@/store/useNovelStore';
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

  const data = await postGenerate('EXPAND_SCENE', {
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
  });
  return String(data.expanded_content || sceneToExpand.content).normalize('NFC');
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

  const data = await postGenerate('REWRITE_SCENE', {
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
  });
  return String(data.rewritten_content || sceneToRewrite.content).normalize('NFC');
}
