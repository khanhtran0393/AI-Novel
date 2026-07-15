/**
 * Export / import project snapshot for durable backup (JSON).
 */

export const PROJECT_BACKUP_VERSION = 1 as const;

export type ProjectBackupEnvelope = {
  version: typeof PROJECT_BACKUP_VERSION;
  exportedAt: string;
  app: 'ai-novel-script-generator';
  /** Partial or full zustand-like state */
  state: Record<string, unknown>;
};

/** Keys safe / useful to backup (no giant binary blobs as base64) */
export const BACKUP_STATE_KEYS = [
  'ten_tac_pham',
  'setup',
  'dan_y_tong_the',
  'nhan_vat',
  'nhan_vat_prompts',
  'danh_sach_chuong',
  'chuong_dang_chon',
  'lorebook',
  'tom_tat_cuon_chieu',
  'tri_nho_ngan_han',
  'voiceCast',
  'visualDnaPrompt',
  'mediaStylePreset',
  'imageProvider',
  'imageModel',
  'imageAspectRatio',
  'imageCount',
  'videoProvider',
  'videoModel',
  'videoAspectRatio',
  'videoDuration',
  'ttsConfig',
  'youtubeSafe',
  'chapterHooks',
  'humanEditFlags',
  'editorReviews',
  'userRules',
  'generatedAudioPaths',
  'generatedPrompts',
  'generatedPromptsAnalysis',
  'generatedImages',
  'generatedImageVariants',
  'generatedVideos',
  'channels',
  'activeChannelId',
  'pipeline_step',
  'wpm',
  'secondsPerBeat',
  'savePathTTS',
  'savePathImage',
  'savePathCharacter',
  'savePathVideo',
  'googleDrivePath',
] as const;

export function buildProjectBackup(
  state: Record<string, unknown>,
): ProjectBackupEnvelope {
  const slice: Record<string, unknown> = {};
  for (const k of BACKUP_STATE_KEYS) {
    if (k in state) slice[k] = state[k];
  }
  return {
    version: PROJECT_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    app: 'ai-novel-script-generator',
    state: slice,
  };
}

export function downloadProjectBackup(envelope: ProjectBackupEnvelope, filename?: string) {
  if (typeof window === 'undefined') return;
  const blob = new Blob([JSON.stringify(envelope, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const title =
    typeof envelope.state.ten_tac_pham === 'string'
      ? envelope.state.ten_tac_pham
      : 'project';
  const safe = String(title)
    .normalize('NFC')
    .replace(/[<>:"/\\|?*]+/g, '_')
    .slice(0, 40);
  a.download =
    filename ||
    `ainovel_backup_${safe}_${Date.now().toString(36)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function parseProjectBackup(raw: string): ProjectBackupEnvelope {
  const data = JSON.parse(raw) as ProjectBackupEnvelope;
  if (!data || typeof data !== 'object') {
    throw new Error('File backup không hợp lệ.');
  }
  if (!data.state || typeof data.state !== 'object') {
    throw new Error('Backup thiếu state.');
  }
  return data;
}
