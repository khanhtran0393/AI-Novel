import type { VideoApiProviderId } from './types';
import { DEFAULT_GEMINI_VEO_MODEL } from '@/lib/geminiModels';

export type VideoApiCatalogEntry = {
  id: VideoApiProviderId;
  label: string;
  defaultBaseUrl: string;
  defaultModel: string;
  durationsSec: number[];
  authStyle: 'x-api-key' | 'bearer' | 'api-key' | 'unknown';
  /** Host fragments for baseUrl match */
  hostHints: string[];
  /** Key substring / prefix hints (lowercase) */
  keyHints: string[];
  /** Whether /api/generate-video has a working adapter */
  generateSupported: boolean;
  uiNote: string;
};

/** Catalog of external / BYOK video platforms (not Flow bridge). */
export const VIDEO_API_CATALOG: VideoApiCatalogEntry[] = [
  {
    id: 'heygen',
    label: 'HeyGen',
    defaultBaseUrl: 'https://api.heygen.com',
    defaultModel: 'video-agent',
    durationsSec: [8, 15, 30, 60],
    authStyle: 'x-api-key',
    hostHints: ['heygen.com', 'heygen.ai', 'movio.la'],
    keyHints: ['heygen'],
    generateSupported: true,
    uiNote: 'Video Agent v3 — prompt → MP4 (X-Api-Key).',
  },
  {
    id: 'luma',
    label: 'Luma Dream Machine',
    defaultBaseUrl: 'https://api.lumalabs.ai',
    defaultModel: 'ray-2',
    durationsSec: [5, 9],
    authStyle: 'bearer',
    hostHints: ['lumalabs.ai', 'dream-machine'],
    keyHints: ['luma'],
    generateSupported: true,
    uiNote: 'Luma Dream Machine — Bearer token.',
  },
  {
    id: 'runway',
    label: 'Runway',
    defaultBaseUrl: 'https://api.dev.runwayml.com',
    defaultModel: 'gen4_turbo',
    durationsSec: [5, 10],
    authStyle: 'bearer',
    hostHints: ['runwayml.com', 'runway.ml'],
    keyHints: ['runway'],
    generateSupported: true,
    uiNote: 'Runway image_to_video — Bearer + X-Runway-Version.',
  },
  {
    id: 'fal',
    label: 'fal.ai',
    defaultBaseUrl: 'https://fal.run',
    defaultModel: 'fal-ai/minimax-video',
    durationsSec: [5, 6, 8, 10],
    authStyle: 'api-key',
    hostHints: ['fal.ai', 'fal.run'],
    keyHints: ['fal'],
    generateSupported: false,
    uiNote: 'Nhận dạng được — gen adapter sẽ mở rộng (chưa ship).',
  },
  {
    id: 'sora',
    label: 'OpenAI Sora',
    defaultBaseUrl: 'https://api.openai.com',
    defaultModel: 'sora-2',
    durationsSec: [4, 8, 12],
    authStyle: 'bearer',
    hostHints: ['openai.com', 'api.openai.com'],
    keyHints: ['sk-'],
    generateSupported: true,
    uiNote: 'OpenAI video (Sora) — dùng key sk-…',
  },
  {
    id: 'veo',
    label: 'Google Veo (API key)',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    defaultModel: DEFAULT_GEMINI_VEO_MODEL,
    durationsSec: [4, 6, 8],
    authStyle: 'api-key',
    hostHints: ['googleapis.com', 'generativelanguage'],
    keyHints: ['aizasy'],
    generateSupported: true,
    uiNote: 'Gemini/Veo API key (AIzaSy…).',
  },
  {
    id: 'grok',
    label: 'xAI Grok Video',
    defaultBaseUrl: 'https://api.x.ai',
    defaultModel: 'grok-video',
    durationsSec: [1, 2, 3, 4, 5, 6, 8, 10, 12, 15],
    authStyle: 'bearer',
    hostHints: ['x.ai', 'api.x.ai'],
    keyHints: ['xai-'],
    generateSupported: true,
    uiNote: 'xAI video — Bearer.',
  },
];

export function getVideoApiCatalogEntry(
  id: string,
): VideoApiCatalogEntry | undefined {
  return VIDEO_API_CATALOG.find((c) => c.id === id);
}

/** Providers selectable in Media Config (includes Flow bridge + BYOK). */
export const VIDEO_PROVIDER_OPTIONS: Array<{
  id: string;
  label: string;
  group: 'bridge' | 'byok' | 'local';
}> = [
  { id: 'flow', label: 'Google Flow (bridge)', group: 'bridge' },
  { id: 'heygen', label: 'HeyGen', group: 'byok' },
  { id: 'luma', label: 'Luma Dream Machine', group: 'byok' },
  { id: 'runway', label: 'Runway', group: 'byok' },
  { id: 'sora', label: 'OpenAI Sora', group: 'byok' },
  { id: 'veo', label: 'Google Veo (API)', group: 'byok' },
  { id: 'grok', label: 'xAI Grok Video', group: 'byok' },
  { id: 'ffmpeg', label: 'FFmpeg (local still→clip)', group: 'local' },
];

export const SUPPORTED_GENERATE_VIDEO_PROVIDERS = [
  'flow',
  'sora',
  'veo',
  'grok',
  'luma',
  'runway',
  'heygen',
  'ffmpeg',
] as const;

export type SupportedGenerateVideoProvider =
  (typeof SUPPORTED_GENERATE_VIDEO_PROVIDERS)[number];
