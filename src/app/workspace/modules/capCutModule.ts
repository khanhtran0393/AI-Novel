import { API } from '@/contracts';
import { buildClientApiHeaders } from './apiClient';

type CapCutOpenPayload = {
  packRoot: string;
  mediaDir?: string;
  openExplorer: boolean;
};

type CapCutOpenResult = {
  ok?: boolean;
  error?: string;
  url?: string;
  mode?: string;
  editorOpened?: boolean;
};

type AinovelTools = {
  isElectron?: boolean;
  /** Primary CapCut bridge (product name). */
  openCapCut?: (payload: CapCutOpenPayload) => Promise<CapCutOpenResult>;
  /** Legacy alias — same CapCut runtime. */
  openXinChao?: (payload: CapCutOpenPayload) => Promise<CapCutOpenResult>;
};

export interface CapCutPackRequest {
  chapterNum: number;
  ten_tac_pham: string;
  generatedAudioPaths: Record<string, { path: string; duration: number }>;
  generatedPrompts: Record<string, Array<{
    timestamp?: string;
    sentence?: string;
    script_prompt?: string;
    prompt?: string;
    image_prompt?: string;
    video_prompt?: string;
  }>>;
  generatedImages: Record<string, string>;
  generatedVideos: Record<string, string>;
  imageAspectRatio: string;
  videoAspectRatio: string;
  aspect: string;
  videoDuration: number;
  imageProvider: string;
  videoProvider: string;
  mediaStylePreset: string;
  visualDna: string;
  ttsConfig: {
    platform: string;
    voice: string;
    language: string;
    speed: number;
    pitch: number;
    syncMode?: 'default' | 'force_sync' | 'pro';
  };
  openEditor: true;
}

export interface CapCutPackResponse {
  projectPath: string;
  mediaDir?: string;
  media?: { images: number; videos: number; audios: number };
  reservation?: {
    slots: number;
    filled: number;
    durationSec: number;
    manifestPath: string;
  };
  criteria?: {
    capCutAspect: string;
    tts?: { platform?: string };
  };
}

export async function exportCapCutPack(
  payload: CapCutPackRequest,
): Promise<CapCutPackResponse> {
  const response = await fetch(API.exportCapcut, {
    method: 'POST',
    headers: buildClientApiHeaders(),
    body: JSON.stringify(payload),
  });
  const data = (await response.json().catch(() => ({}))) as Partial<
    CapCutPackResponse & { error: string; message: string }
  >;
  if (!response.ok) {
    throw new Error(data.error || data.message || `HTTP ${response.status}`);
  }
  if (!data.projectPath) {
    throw new Error('API CapCut không trả projectPath');
  }
  return data as CapCutPackResponse;
}

function getTools(): AinovelTools | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { ainovelTools?: AinovelTools }).ainovelTools || null;
}

export async function openBundledCapCutEditor(payload: {
  packRoot: string;
  mediaDir?: string;
}): Promise<string> {
  const tools = getTools();
  const openEditor = tools?.openCapCut || tools?.openXinChao;
  if (!openEditor) {
    throw new Error(
      'Bridge CapCut nội bộ không có trong runtime Electron hiện tại',
    );
  }
  const opened = await openEditor({
    packRoot: payload.packRoot,
    mediaDir: payload.mediaDir,
    // Native/web CapCut runtime reads the pack manifest itself — no Explorer step.
    openExplorer: false,
  });
  if (!opened?.editorOpened) {
    throw new Error(opened?.error || 'Runtime CapCut nội bộ không mở được');
  }
  if (opened.mode === 'native') {
    return '\nEditor CapCut desktop nội bộ đã mở và đang nạp timeline thật';
  }
  return opened.url ? `\nEditor CapCut: ${opened.url}` : '\nEditor CapCut đã mở';
}
