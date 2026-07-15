import { getEdgePresetList } from '@/lib/voiceCatalog';

export const CAPASSISTANT_TTS_VOICES = getEdgePresetList().map((p) => ({
  name: p.name,
  tiktok: p.tiktok || 'BV074_streaming',
  edge: p.edge,
  preview: p.edge.startsWith('vi-')
    ? 'Xin chào, đây là giọng đọc thử của hệ thống AI Novel.'
    : 'Hello, this is a voice preview for the AI Novel system.',
}));
