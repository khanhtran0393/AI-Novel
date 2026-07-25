import { API } from '@/contracts';
import { buildClientApiHeaders } from './apiClient';

type AinovelTools = {
  isElectron?: boolean;
  openXinChao?: (payload: {
    packRoot: string;
    mediaDir?: string;
    openExplorer: boolean;
  }) => Promise<{
    ok?: boolean;
    error?: string;
    url?: string;
    mode?: string;
    editorOpened?: boolean;
  }>;
};

export interface CapCutPackRequest {
  chapterNum: number;
  ten_tac_pham: string;
  generatedAudioPaths: Record<string, { path: string; duration: number }>;
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
  if (!tools?.openXinChao) {
    throw new Error(
      'Bridge CapCut nội bộ không có trong runtime Electron hiện tại',
    );
  }
  const opened = await tools.openXinChao({
    packRoot: payload.packRoot,
    mediaDir: payload.mediaDir,
    // The native editor consumes ainovel-xinchao-pack.json itself. Explorer is
    // no longer part of the primary path and no manual drag/drop is required.
    openExplorer: false,
  });
  if (!opened?.editorOpened) {
    throw new Error(opened?.error || 'Runtime CapCut nội bộ không mở được');
  }
  if (opened.mode === 'native') {
    return '\nEditor CapCut desktop nội bộ đã mở và đang nạp timeline thật';
  }
  return opened.url ? `\nEditor: ${opened.url}` : '\nEditor CapCut đã mở';
}
