/**
 * YouTube Studio / post-write meta: always score + rewrite until pass or max rounds.
 * Server: POST /api/youtube-meta → generateYoutubeMetaWithQA (psych laws).
 * Client: re-score with scoreYoutubeMetaFields; filter low scores (B10: no soft-success).
 */

import { API } from '@/contracts';
import { buildClientApiHeaders } from './apiClient';
import {
  scoreYoutubeMetaFields,
  YOUTUBE_META_PASS_SCORE,
  buildThumbnailPrompt,
  type YoutubeFieldScores,
} from '@/lib/youtubeSafe';

export type YoutubeMetaPackResult = {
  hook: string;
  seoTitle: string;
  thumbnailLine: string;
  seoDescription: string;
  seoTags: string;
  thumbnailPrompt: string;
  scores: YoutubeFieldScores;
  rounds: number;
  source: string;
  passed: boolean;
};

export type FetchYoutubeMetaInput = {
  script: string;
  novelTitle?: string;
  chapter?: number;
  chaptersText?: string;
  visualDna: string;
  characterHint?: string;
  usedTitles?: string[];
  usedThumbLines?: string[];
  /** Server QA rounds (default 5) */
  maxRounds?: number;
  /** Extra client outer retries if still below pass (default 2) */
  outerRetries?: number;
  signal?: AbortSignal;
  /** Style Engine niche (Setup) — CTR title/thumb bias */
  chu_de?: string;
  phong_cach?: string;
  genre?: string;
  styleEngineId?: string | null;
};

function asPack(raw: Record<string, unknown>, visualDna: string, characterHint?: string) {
  const hook = String(raw.hook || '').normalize('NFC').trim();
  const seoTitle = String(raw.seoTitle || raw.seo_title || '')
    .normalize('NFC')
    .trim()
    .slice(0, 100);
  const thumbnailLine = String(
    raw.thumbnailLine || raw.thumbnail_line || '',
  )
    .normalize('NFC')
    .trim()
    .slice(0, 30);
  const seoDescription = String(
    raw.seoDescription || raw.seo_description || '',
  )
    .normalize('NFC')
    .trim()
    .slice(0, 4500);
  const seoTags = String(raw.seoTags || raw.seo_tags || raw.hashtags || '')
    .normalize('NFC')
    .trim();
  let thumbnailPrompt = String(
    raw.thumbnailPrompt || raw.thumbnail_prompt || '',
  )
    .normalize('NFC')
    .trim();
  if (!thumbnailPrompt && (hook || thumbnailLine) && visualDna) {
    thumbnailPrompt = buildThumbnailPrompt({
      hook: hook || seoTitle,
      thumbnailLine: thumbnailLine || seoTitle.slice(0, 30),
      visualDna,
      characterHint,
    });
  }
  return {
    hook,
    seoTitle,
    thumbnailLine,
    seoDescription,
    seoTags,
    thumbnailPrompt,
  };
}

/**
 * Fetch meta with server QA loop, then client re-score.
 * If still below YOUTUBE_META_PASS_SCORE, outer-retry with failed titles in usedTitles.
 * Returns best pack; `passed` false when still under bar after all rounds.
 */
export async function fetchYoutubeMetaWithQA(
  input: FetchYoutubeMetaInput,
): Promise<YoutubeMetaPackResult> {
  const visualDna = (input.visualDna || '').trim();
  if (!visualDna) {
    throw new Error(
      'Thiếu Visual DNA / Media Style để gen Meta (thumbnail prompt).',
    );
  }
  const script = (input.script || '').trim();
  if (!script) {
    throw new Error('Thiếu kịch bản để gen Meta YouTube.');
  }

  const outer = Math.max(1, Math.min(4, input.outerRetries ?? 2));
  const maxRounds = Math.max(3, Math.min(8, input.maxRounds ?? 5));

  let usedTitles = [...(input.usedTitles || [])].filter(Boolean);
  let usedThumbLines = [...(input.usedThumbLines || [])].filter(Boolean);

  let best: YoutubeMetaPackResult | null = null;

  for (let attempt = 1; attempt <= outer; attempt++) {
    const res = await fetch(API.youtubeMeta, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildClientApiHeaders(),
      },
      body: JSON.stringify({
        script: script.slice(0, 20000),
        novelTitle: input.novelTitle,
        chapter: input.chapter,
        chaptersText: input.chaptersText,
        maxRounds: maxRounds + (attempt - 1),
        usedTitles,
        usedThumbLines,
        visualDna,
        characterHint: input.characterHint,
        chu_de: input.chu_de,
        phong_cach: input.phong_cach,
        genre: input.genre,
        styleEngineId: input.styleEngineId,
        // diversify outer retry seed on server via chapter+attempt in used titles
        randomSeed: `${Date.now()}-${attempt}`,
      }),
      signal: input.signal,
    });

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || data.success === false) {
      throw new Error(
        String(data.error || `YouTube meta API lỗi HTTP ${res.status}`),
      );
    }

    const pack = asPack(data, visualDna, input.characterHint);
    if (!pack.hook && !pack.seoTitle) {
      throw new Error('YouTube meta API không trả hook/title.');
    }

    // Prefer server scores if present; always re-score client for filter authority
    const scores = scoreYoutubeMetaFields({
      seoTitle: pack.seoTitle,
      thumbnailLine: pack.thumbnailLine,
      seoDescription: pack.seoDescription,
    });

    const rounds =
      typeof data.rounds === 'number'
        ? data.rounds
        : typeof (data as { scores?: unknown }).scores === 'object'
          ? maxRounds
          : attempt;

    const result: YoutubeMetaPackResult = {
      ...pack,
      hook: pack.hook || pack.seoTitle,
      scores,
      rounds: Number(rounds) || attempt,
      source: String(data.source || 'youtube-meta'),
      passed: scores.pass,
    };

    if (!best || scores.average > best.scores.average) {
      best = result;
    }

    if (scores.pass) {
      return result;
    }

    // Filter low score → rewrite next outer attempt (ban weak titles/thumbs)
    if (pack.seoTitle) usedTitles = [...usedTitles, pack.seoTitle];
    if (pack.thumbnailLine) usedThumbLines = [...usedThumbLines, pack.thumbnailLine];
  }

  if (!best) {
    throw new Error('YouTube meta QA không sinh được pack nào.');
  }
  return best;
}

export function formatMetaScoreLine(scores: YoutubeFieldScores): string {
  return (
    `Title ${scores.title}/10 · Thumb ${scores.thumbnail}/10 · Desc ${scores.description}/10` +
    ` · TB ${scores.average}/10 (pass≥${YOUTUBE_META_PASS_SCORE})`
  );
}
