import type { YoutubeChecklistItem } from './checklist';
import type { buildCutPlan } from './timeline';

export interface YoutubeExportPack {
  version: 2;
  generatedAt: string;
  title: string;
  chapter: number;
  /** ~30s cold-open VO */
  hook: string;
  thumbnailLine: string;
  seoTitle: string;
  seoDescription: string;
  seoTags: string;
  thumbnailPrompt: string;
  /** Generated thumbnail still path when available */
  thumbnailImagePath?: string;
  chaptersText: string;
  chapters: { startSec: number; label: string; line: string }[];
  cutPlans: ReturnType<typeof buildCutPlan>[];
  checklist: YoutubeChecklistItem[];
  voiceDna: { platform?: string; voice?: string; speed?: number; pitch?: number };
  /** What this pack is for (shown in UI + file) */
  purpose: string[];
  notes: string[];
}

