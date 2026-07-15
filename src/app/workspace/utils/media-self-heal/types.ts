import type { TTSConfig } from '@/store/useNovelStore';

export type MediaIssueKind =
  | 'invalid_key'
  | 'missing_key'
  | 'quota'
  | 'model_mismatch'
  | 'missing_module'
  | 'missing_field'
  | 'cookie_auth'
  | 'network'
  | 'unknown';

export interface ImageRepairRoute {
  provider: string;
  model: string;
  imageApiKey: string;
  selectedCookie: string;
  reason: string;
}

export interface MediaIssue {
  kind: MediaIssueKind;
  message: string;
}

export type MediaSelfHealDomain = 'image' | 'video' | 'audio' | 'ui_click';

export interface MediaSelfHealPatch {
  imageProvider?: string;
  imageModel?: string;
  videoProvider?: string;
  videoModel?: string;
  pickerStrategy?: 'windows_dialog' | 'compat_dialog';
  ttsConfig?: Partial<TTSConfig>;
}

export interface MediaSelfHealDiagnosis {
  logId: string;
  logPath?: string;
  issue: {
    kind: string;
    message: string;
  };
  patch: MediaSelfHealPatch;
  shouldRetry: boolean;
  summary: string;
  checkedProviders?: {
    provider: string;
    ok: boolean;
    status?: number;
    reason: string;
    models?: string[];
  }[];
}

export interface VideoRepairRoute {
  provider: string;
  model: string;
  videoApiKey: string;
  reason: string;
}

export interface AudioRepairRoute {
  platform: NonNullable<Partial<TTSConfig>['platform']> | string;
  voice: string;
  reason: string;
}
