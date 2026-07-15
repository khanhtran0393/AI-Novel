/**
 * Build multi-mode ship packs (radio / short / longform) from workspace + channel DNA.
 * Pure helpers — file IO lives in /api/ship-pack.
 */

import { chapterAssetPrefix } from '@/contracts';
import type { ChannelProfile, ShipMode, ShipRecipe } from './channelModel';
import { getRecipe } from './channelModel';
import type { ProjectVoiceCast } from './voiceCast';
import { normalizeVoiceCast } from './voiceCast';
import {
  exportVinaRoleProfile,
  exportVinaRolesJson,
} from './castExport';
import type { NhanVatPromptsMap } from './characterProfile';
import {
  DEFAULT_WORD_GOAL,
  evaluateWordGate,
  getWordCount,
  parseScenes,
} from './storyWriting';
import {
  generateYoutubeMetaWithQA,
  normalizeHashtagField,
  scoreYoutubeMetaFields,
  YOUTUBE_META_PASS_SCORE,
  type YoutubeFieldScores,
} from './youtubeSafe';
import {
  evaluateSettingsAsCriteria,
  resolveOutputCriteria,
  type OutputCriteriaBundle,
} from './outputCriteria';
import {
  chapterAssetKeys,
  evaluateMediaDnaMatch,
} from './mediaDnaMatch';

export type ShipChapterSlice = {
  so_chuong: number;
  tieu_de: string;
  dan_y: string;
  noi_dung: string;
};

export type ShipHookAsset = {
  hook?: string;
  thumbnailLine?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoTags?: string;
  thumbnailPrompt?: string;
  thumbnailImagePath?: string;
};

export type ShipPackInput = {
  channel: ChannelProfile;
  mode?: ShipMode;
  ten_tac_pham: string;
  chapter: ShipChapterSlice;
  chapterHooks?: ShipHookAsset | null;
  voiceCast?: ProjectVoiceCast | null;
  nhan_vat?: string[];
  nhan_vat_prompts?: NhanVatPromptsMap;
  generatedAudioPaths?: Record<string, { path: string; duration: number }>;
  generatedImages?: Record<string, string>;
  generatedVideos?: Record<string, string>;
  generatedPrompts?: Record<string, unknown[]>;
  savePathRoot?: string;
  /**
   * Word-gate goal per chapter — must match workspace setup.so_tu_chuong.
   * Defaults to DEFAULT_WORD_GOAL (4250) when omitted.
   */
  so_tu_chuong?: number;
  /** Optional DNA stamps from workspace (media vs toolbar) */
  generatedAssetDna?: Record<
    string,
    import('./mediaDnaMatch').MediaAssetDnaStamp
  >;
  liveMediaDna?: {
    ttsPlatform?: string;
    ttsVoice?: string;
    ttsSpeed?: number;
    ttsPitch?: number;
    imageProvider?: string;
    imageModel?: string;
    imageAspectRatio?: string;
    videoProvider?: string;
    videoModel?: string;
    videoAspectRatio?: string;
    videoDuration?: number;
  };
};

export type ShipFileSpec = {
  relativePath: string;
  content: string;
  encoding?: 'utf8';
};

export type MediaCopyItem = {
  kind: 'audio' | 'image' | 'video' | 'thumb';
  key: string;
  sourcePath: string;
  suggestedName: string;
};

export type ShipPackResult = {
  mode: ShipMode;
  recipe: ShipRecipe;
  channelId: string;
  channelName: string;
  chapterNum: number;
  title: string;
  folderName: string;
  files: ShipFileSpec[];
  checklist: string[];
  manifest: Record<string, unknown>;
  /** Absolute/local paths to copy into pack folder */
  mediaCopyList: MediaCopyItem[];
};

function sanitizeFolderPart(s: string): string {
  return (s || 'pack')
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 64) || 'pack';
}

/** Vietnamese / EN filler tags that must never ship as SEO hashtags. */
const SEO_TAG_STOPWORDS = new Set(
  [
    'không',
    'muốn',
    'trời',
    'phải',
    'những',
    'được',
    'trong',
    'một',
    'như',
    'của',
    'và',
    'cho',
    'với',
    'cái',
    'này',
    'kia',
    'rồi',
    'thì',
    'là',
    'có',
    'bị',
    'đã',
    'sẽ',
    'vẫn',
    'lại',
    'cũng',
    'mình',
    'bạn',
    'hắn',
    'nàng',
    'anh',
    'chị',
    'em',
    'tôi',
    'the',
    'and',
    'for',
    'with',
    'that',
    'this',
    'from',
    'into',
    'over',
    'under',
  ].map((s) => s.toLowerCase()),
);

/**
 * Split chapter into scenes for SRT / short script.
 * Prefer official [CẢNH N: …] markers (storyWriting), then markdown headings, then blanks.
 */
function splitScenes(content: string): string[] {
  const raw = (content || '').normalize('NFC').trim();
  if (!raw) return [];

  const parsed = parseScenes(raw);
  if (parsed.length > 1 || (parsed.length === 1 && /\[CẢNH\s+\d+/i.test(parsed[0].title))) {
    return parsed
      .map((s) => {
        const body = (s.content || '').trim();
        if (!body) return s.title;
        return `${s.title}\n\n${body}`.trim();
      })
      .filter((s) => s.length > 0);
  }

  const byMarker = raw
    .split(/(?=^#{1,3}\s*Cảnh\s*\d+)/im)
    .map((s) => s.trim())
    .filter(Boolean);
  if (byMarker.length > 1) return byMarker;

  const byBlank = raw
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40);
  if (byBlank.length > 1 && byBlank.length <= 40) return byBlank;

  return [raw];
}

/** Shorts: first scene(s) totaling ~120–180 words — not every blank paragraph. */
function buildShortSceneBodies(scenes: string[], hook?: string): string[] {
  const out: string[] = [];
  let words = 0;
  const target = 150;
  if (hook && hook.trim().length >= 40) {
    const h = hook.trim().slice(0, 420);
    out.push(h);
    words += getWordCount(h);
  }
  for (const s of scenes) {
    if (words >= target && out.length >= 1) break;
    out.push(s);
    words += getWordCount(s);
    if (out.length >= 2 && words >= 80) break;
  }
  return out.length ? out : scenes.slice(0, 1);
}

function sanitizeSeoTags(raw: string | string[] | undefined, fallback: string[]): string[] {
  const parts = Array.isArray(raw)
    ? raw
    : (raw || '')
        .split(/[,#\s]+/)
        .map((t) => t.trim())
        .filter(Boolean);
  const cleaned = parts
    .map((t) => t.replace(/^#+/, '').normalize('NFC').trim())
    .filter(
      (t) =>
        t.length >= 3 &&
        t.length <= 40 &&
        !SEO_TAG_STOPWORDS.has(t.toLowerCase()) &&
        !/^\d+$/.test(t),
    );
  const uniq = Array.from(new Set(cleaned.map((t) => t.toLowerCase()))).map(
    (low) => cleaned.find((c) => c.toLowerCase() === low) || low,
  );
  if (uniq.length >= 3) return uniq.slice(0, 12);
  return Array.from(new Set([...uniq, ...fallback])).slice(0, 12);
}

function estimateDurationSec(text: string, wpm = 140): number {
  const words = (text || '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round((words / Math.max(wpm, 60)) * 60));
}

function collectChapterAudio(
  chapterNum: number,
  audio?: Record<string, { path: string; duration: number }>,
): Array<{ key: string; path: string; duration: number }> {
  if (!audio) return [];
  const prefix = chapterAssetPrefix(chapterNum);
  return Object.entries(audio)
    .filter(([k]) => k.startsWith(prefix) || k === String(chapterNum))
    .map(([key, v]) => ({ key, path: v.path, duration: v.duration || 0 }))
    .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
}

function collectChapterMedia(
  chapterNum: number,
  media?: Record<string, string>,
): Array<{ key: string; path: string }> {
  if (!media) return [];
  const prefix = chapterAssetPrefix(chapterNum);
  return Object.entries(media)
    .filter(([k]) => k.startsWith(prefix) || k.startsWith(`c${chapterNum}-`) || k.includes(`_${chapterNum}_`))
    .map(([key, path]) => ({ key, path }))
    .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
}

export type ShipSeoResult = {
  title: string;
  description: string;
  tags: string[];
  thumbnailLine: string;
  hook: string;
  thumbnailPrompt: string;
  scores: YoutubeFieldScores;
  source: 'hooks_pass' | 'meta_qa' | 'fallback';
};

/** Extra product gates beyond numeric score (dialogue dump / stock agitate). */
function hooksMeetProductSeoGates(params: {
  title: string;
  thumb: string;
  desc: string;
  scores: YoutubeFieldScores;
}): boolean {
  const title = (params.title || '').normalize('NFC').trim();
  const thumb = (params.thumb || '').normalize('NFC').trim();
  const desc = (params.desc || '').normalize('NFC').trim();
  if (!params.scores.pass) return false;
  if (title.length < 28 || title.length > 100) return false;
  if (thumb.length < 8 || thumb.length > 30) return false;
  if (desc.length < 80) return false;
  // Dialogue / quote dump in title
  if (/["“”'']/.test(title)) return false;
  if (/^(hắn|nàng|tôi|ta|cô|anh|chị)\s/i.test(title) && /nói|thì thầm|hỏi|đáp/i.test(title)) {
    return false;
  }
  // FOMO + raw dialogue clause (legacy bad ship pack pattern)
  if (/đừng bỏ lỡ:\s*cô chỉ vào|nơi \p{L}+ vừa vẽ/iu.test(title)) return false;
  // Stock-only agitate body (no real hook substance)
  if (
    /Sai một bước là mất sạch/i.test(desc) &&
    /Bí mật lộ ra từng mảnh/i.test(desc) &&
    desc.length < 400
  ) {
    return false;
  }
  return true;
}

/**
 * SEO must meet YOUTUBE_META_PASS_SCORE (8.5).
 * If chapterHooks fail scoring (dialogue dump, stock, short thumb), re-run Meta QA.
 */
function buildSeoStub(input: ShipPackInput, mode: ShipMode): ShipSeoResult {
  const script = (input.chapter.noi_dung || input.chapter.dan_y || '').normalize('NFC');
  const hookIn = input.chapterHooks;
  const fallbackTags = [
    input.channel.niche || 'truyen',
    mode,
    'ai-novel',
    input.channel.language || 'vi',
    'truyenaudio',
  ];

  const fromHooksTitle = (hookIn?.seoTitle || '').trim().slice(0, 100);
  const fromHooksThumb = (hookIn?.thumbnailLine || '').trim().slice(0, 30);
  const fromHooksDesc = (hookIn?.seoDescription || '').trim();
  const fromHooksScores = scoreYoutubeMetaFields({
    seoTitle: fromHooksTitle,
    thumbnailLine: fromHooksThumb,
    seoDescription: fromHooksDesc,
  });

  if (
    hooksMeetProductSeoGates({
      title: fromHooksTitle,
      thumb: fromHooksThumb,
      desc: fromHooksDesc,
      scores: fromHooksScores,
    })
  ) {
    const tags = sanitizeSeoTags(
      normalizeHashtagField(hookIn?.seoTags || '') || hookIn?.seoTags || '',
      fallbackTags,
    );
    return {
      title: fromHooksTitle,
      description: [
        fromHooksDesc,
        `\n\n#${input.channel.slug || 'channel'} #${mode} #truyen #audio`,
      ]
        .join('')
        .trim(),
      tags,
      thumbnailLine: fromHooksThumb,
      hook: (hookIn?.hook || '').trim(),
      thumbnailPrompt: (hookIn?.thumbnailPrompt || '').trim(),
      scores: fromHooksScores,
      source: 'hooks_pass',
    };
  }

  // Re-generate to meet output criteria (title ≤100, thumb ≤30, score ≥8.5)
  if (script.trim().length >= 80) {
    const qa = generateYoutubeMetaWithQA({
      script,
      novelTitle: input.ten_tac_pham,
      chapter: input.chapter.so_chuong,
      maxRounds: 5,
    });
    const tags = sanitizeSeoTags(normalizeHashtagField(qa.seoTags) || qa.seoTags, fallbackTags);
    return {
      title: (qa.seoTitle || fromHooksTitle).slice(0, 100),
      description: [
        qa.seoDescription || fromHooksDesc,
        qa.hook ? `\n\nHook:\n${qa.hook}` : '',
        `\n\n#${input.channel.slug || 'channel'} #${mode} #truyen #audio`,
      ]
        .join('')
        .trim(),
      tags,
      thumbnailLine: (qa.thumbnailLine || fromHooksThumb).slice(0, 30),
      hook: qa.hook || (hookIn?.hook || '').trim(),
      thumbnailPrompt: qa.thumbnailPrompt || (hookIn?.thumbnailPrompt || '').trim(),
      scores: qa.scores,
      source: 'meta_qa',
    };
  }

  const title =
    fromHooksTitle ||
    `${input.ten_tac_pham} — Chương ${input.chapter.so_chuong}: ${input.chapter.tieu_de}`.slice(
      0,
      100,
    );
  const description = [
    fromHooksDesc,
    hookIn?.hook ? `\n\nHook:\n${hookIn.hook}` : '',
    `\n\n#${input.channel.slug || 'channel'} #${mode} #truyen #audio`,
  ]
    .join('')
    .trim();
  return {
    title,
    description,
    tags: sanitizeSeoTags(hookIn?.seoTags, fallbackTags),
    thumbnailLine: fromHooksThumb,
    hook: (hookIn?.hook || '').trim(),
    thumbnailPrompt: (hookIn?.thumbnailPrompt || '').trim(),
    scores: scoreYoutubeMetaFields({
      seoTitle: title,
      thumbnailLine: fromHooksThumb,
      seoDescription: description,
    }),
    source: 'fallback',
  };
}

/**
 * Build SRT. When cast has character roles, split scene into speaker lines:
 * "Tên: thoại" → cue with speaker tag for radio / multi-voice packs.
 */
function buildSrtStub(
  scenes: string[],
  audioItems: Array<{ key: string; path: string; duration: number }>,
  cast?: ProjectVoiceCast | null,
  characterNames?: string[],
): string {
  let t = 0;
  const lines: string[] = [];
  let cue = 1;
  const names = [
    ...(characterNames || []),
    ...(normalizeVoiceCast(cast || undefined).roles || [])
      .filter((r) => r.kind === 'character' && r.characterName)
      .map((r) => r.characterName as string),
  ];
  const uniqueNames = [...new Set(names.map((n) => n.normalize('NFC').trim()).filter(Boolean))];

  scenes.forEach((scene, i) => {
    const sceneDur =
      audioItems[i]?.duration || estimateDurationSec(scene.slice(0, 400));
    const segs = splitSceneBySpeaker(scene, uniqueNames);
    const totalWeight = segs.reduce((s, x) => s + Math.max(1, x.text.length), 0) || 1;
    let acc = 0;
    for (const seg of segs) {
      const weight = Math.max(1, seg.text.length) / totalWeight;
      const dur = Math.max(0.4, sceneDur * weight);
      const start = formatSrtTime(t + acc);
      const end = formatSrtTime(t + acc + dur);
      acc += dur;
      const body = seg.text.replace(/\s+/g, ' ').trim().slice(0, 220);
      const text = seg.speaker ? `[${seg.speaker}] ${body}` : body;
      lines.push(`${cue++}`, `${start} --> ${end}`, text, '');
    }
    t += sceneDur;
  });
  return lines.join('\n');
}

function splitSceneBySpeaker(
  scene: string,
  characterNames: string[],
): Array<{ speaker: string | null; text: string }> {
  const raw = (scene || '').normalize('NFC').trim();
  if (!raw) return [{ speaker: null, text: '' }];
  const parts = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (parts.length <= 1 && characterNames.length === 0) {
    return [{ speaker: null, text: raw }];
  }
  const out: Array<{ speaker: string | null; text: string }> = [];
  const nameAlt = characterNames
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const re = nameAlt
    ? new RegExp(`^(${nameAlt})\\s*[:：]\\s*(.+)$`, 'i')
    : null;
  for (const line of parts.length ? parts : [raw]) {
    const m = re ? line.match(re) : null;
    if (m) {
      out.push({ speaker: m[1].trim(), text: m[2].trim() });
    } else {
      out.push({ speaker: null, text: line });
    }
  }
  return out.length ? out : [{ speaker: null, text: raw }];
}

function formatSrtTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const whole = Math.floor(r);
  const ms = Math.round((r - whole) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(whole)},${String(ms).padStart(3, '0')}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function buildChecklist(
  recipe: ShipRecipe,
  input: ShipPackInput,
  criteria: OutputCriteriaBundle,
): string[] {
  const items: string[] = [
    `[ ] Xác nhận kênh: ${input.channel.name}`,
    `[ ] Mode: ${recipe.label} (recipe ${recipe.aspectRatio} · user img ${criteria.imageAspectRatio} / vid ${criteria.videoAspectRatio})`,
    `[ ] TTS chỉ tiêu: ${criteria.tts.platform} / ${criteria.tts.voice} (speed ${criteria.tts.speed}, pitch ${criteria.tts.pitch})`,
    `[ ] Ảnh chỉ tiêu: ${criteria.imageProvider}/${criteria.imageModel} · ${criteria.imageAspectRatio} · ×${criteria.imageCount}`,
    `[ ] Video chỉ tiêu: ${criteria.videoProvider}/${criteria.videoModel} · ${criteria.videoAspectRatio} · ${criteria.videoDuration}s`,
    `[ ] CapCut aspect: ${criteria.capCutAspect}`,
    `[ ] TTS / cast đã gen cho chương ${input.chapter.so_chuong}`,
  ];
  if (recipe.includeHook) items.push('[ ] Hook 0–8s + thumbnail line');
  if (recipe.includeSrt) items.push('[ ] SRT speaker / phụ đề đã rà');
  if (recipe.includeSeo) items.push('[ ] SEO title + description + tags');
  if (recipe.includeVisual) {
    items.push(
      `[ ] Ảnh/video đúng ratio user ${criteria.videoAspectRatio} (CapCut ${criteria.capCutAspect}) đủ shot`,
    );
    if (recipe.mode === 'short') items.push('[ ] 1 shot/cảnh, crop dọc OK');
    if (recipe.mode === 'longform') items.push('[ ] Storyboard + CapCut draft');
  } else {
    items.push('[ ] Radio: chỉ audio + SRT (không bắt buộc visual)');
  }
  items.push('[ ] Anti-reuse: hook/motif không trùng usedHooks kênh');
  items.push('[ ] Upload + thumbnail + end screen');
  return items;
}

/** Build in-memory ship pack (files as strings). */
export function buildShipPack(input: ShipPackInput): ShipPackResult {
  const criteria = resolveOutputCriteria(input.channel, input.mode);
  const recipe = criteria.recipe;
  const mode = recipe.mode;
  const chapterNum = input.chapter.so_chuong;
  const fullScript = (input.chapter.noi_dung || input.chapter.dan_y || '').normalize(
    'NFC',
  );
  const scenes = splitScenes(fullScript);
  const wordGoal =
    typeof input.so_tu_chuong === 'number' && input.so_tu_chuong > 0
      ? input.so_tu_chuong
      : DEFAULT_WORD_GOAL;
  const wordGate = evaluateWordGate(fullScript, wordGoal);
  const seo = buildSeoStub(input, mode);
  const shortScenes =
    mode === 'short'
      ? buildShortSceneBodies(scenes, seo.hook || input.chapterHooks?.hook)
      : scenes;

  const audioItems = collectChapterAudio(chapterNum, input.generatedAudioPaths);
  const images = collectChapterMedia(chapterNum, input.generatedImages);
  const videos = collectChapterMedia(chapterNum, input.generatedVideos);

  const cast = normalizeVoiceCast(input.voiceCast || undefined);
  const rolesJson = exportVinaRolesJson(
    cast,
    undefined,
    input.nhan_vat_prompts,
  );
  const roleProfile = exportVinaRoleProfile(cast, input.nhan_vat || []);

  const settingsEval = evaluateSettingsAsCriteria(criteria);
  const assetKeys = chapterAssetKeys(chapterNum, {
    audio: input.generatedAudioPaths,
    images: input.generatedImages,
    videos: input.generatedVideos,
  });
  const mediaDnaReport = evaluateMediaDnaMatch({
    chapterNum,
    audioKeys: assetKeys.audioKeys,
    imageKeys: assetKeys.imageKeys,
    videoKeys: assetKeys.videoKeys,
    stamps: input.generatedAssetDna || {},
    live: {
      ttsPlatform: input.liveMediaDna?.ttsPlatform || criteria.tts.platform,
      ttsVoice: input.liveMediaDna?.ttsVoice || criteria.tts.voice,
      ttsSpeed: input.liveMediaDna?.ttsSpeed ?? criteria.tts.speed,
      ttsPitch: input.liveMediaDna?.ttsPitch ?? criteria.tts.pitch,
      imageProvider:
        input.liveMediaDna?.imageProvider || criteria.imageProvider,
      imageModel: input.liveMediaDna?.imageModel || criteria.imageModel,
      imageAspectRatio:
        input.liveMediaDna?.imageAspectRatio || criteria.imageAspectRatio,
      videoProvider:
        input.liveMediaDna?.videoProvider || criteria.videoProvider,
      videoModel: input.liveMediaDna?.videoModel || criteria.videoModel,
      videoAspectRatio:
        input.liveMediaDna?.videoAspectRatio || criteria.videoAspectRatio,
      videoDuration:
        input.liveMediaDna?.videoDuration ?? criteria.videoDuration,
    },
  });
  const checklist = buildChecklist(recipe, input, criteria);
  const folderName = [
    sanitizeFolderPart(input.channel.slug || input.channel.name),
    mode,
    `c${chapterNum}`,
    sanitizeFolderPart(input.chapter.tieu_de || 'chuong'),
  ].join('_');

  const files: ShipFileSpec[] = [];

  // README
  files.push({
    relativePath: 'README.md',
    content: [
      `# Ship Pack — ${input.ten_tac_pham}`,
      '',
      `- **Kênh:** ${input.channel.name} (\`${input.channel.id}\`)`,
      `- **Mode:** ${recipe.label} (\`${mode}\`)`,
      `- **Aspect recipe:** ${recipe.aspectRatio}`,
      `- **Ảnh ratio (user):** ${criteria.imageAspectRatio}`,
      `- **Video ratio (user):** ${criteria.videoAspectRatio}`,
      `- **CapCut aspect:** ${criteria.capCutAspect}`,
      `- **Chương:** ${chapterNum} — ${input.chapter.tieu_de}`,
      `- **TTS:** ${criteria.tts.platform} / ${criteria.tts.voice}`,
      `- **Ảnh engine:** ${criteria.imageProvider}/${criteria.imageModel}`,
      `- **Video engine:** ${criteria.videoProvider}/${criteria.videoModel} · ${criteria.videoDuration}s`,
      '',
      recipe.description,
      '',
      '## Chỉ tiêu từ cài đặt (Ảnh/Video · TTS · CapCut)',
      ...criteria.criteriaLines.map((l) => `- ${l}`),
      '',
      '## Files',
      ...files.map(() => '').slice(0, 0),
      '- `script.txt` — full script',
      mode === 'short' ? '- `script_short.txt` — trimmed for shorts' : '',
      recipe.includeSrt ? '- `subtitles.srt` — stub timeline' : '',
      recipe.includeSeo ? '- `seo.json` — title/description/tags' : '',
      recipe.includeHook ? '- `hook.txt` — cold open' : '',
      '- `settings_criteria.json` — Ảnh/Video + TTS + CapCut targets',
      '- `cast/roles.json` + `cast/role_profile.json`',
      '- `media_index.json` — audio/image/video paths',
      '- `checklist.md`',
      '- `manifest.json`',
    ]
      .filter(Boolean)
      .join('\n'),
  });

  files.push({
    relativePath: 'script.txt',
    content: (input.chapter.noi_dung || input.chapter.dan_y || '').normalize('NFC'),
  });

  if (mode === 'short') {
    files.push({
      relativePath: 'script_short.txt',
      content: shortScenes.join('\n\n---\n\n').normalize('NFC'),
    });
  }

  if (recipe.includeHook) {
    const hookBody = seo.hook || input.chapterHooks?.hook || '';
    const thumbLine = seo.thumbnailLine || input.chapterHooks?.thumbnailLine || '';
    const hookText = [
      hookBody,
      thumbLine ? `\n\n[Thumbnail]\n${thumbLine}` : '',
    ]
      .join('')
      .trim();
    files.push({
      relativePath: 'hook.txt',
      content: hookText || '(Chưa có hook — mở Youtube Safe / Hook panel để tạo)',
    });
  }

  if (recipe.includeSrt) {
    files.push({
      relativePath: 'subtitles.srt',
      content: buildSrtStub(
        mode === 'short' ? shortScenes : scenes,
        audioItems,
        cast,
        input.nhan_vat,
      ),
    });
    // Multi-speaker SRT companion for radio / cast packs
    if (cast.enabled && cast.roles.some((r) => r.kind === 'character')) {
      files.push({
        relativePath: 'subtitles_speakers.srt',
        content: buildSrtStub(
          mode === 'short' ? shortScenes : scenes,
          audioItems,
          cast,
          input.nhan_vat,
        ),
      });
    }
  }

  if (recipe.includeSeo) {
    files.push({
      relativePath: 'seo.json',
      content: JSON.stringify(
        {
          title: seo.title,
          description: seo.description,
          tags: seo.tags,
          thumbnailLine: seo.thumbnailLine,
          thumbnailPrompt: seo.thumbnailPrompt,
          scores: seo.scores,
          metaSource: seo.source,
          metaPassScore: YOUTUBE_META_PASS_SCORE,
          channel: input.channel.name,
          mode,
          aspectRatio: criteria.videoAspectRatio,
          imageAspectRatio: criteria.imageAspectRatio,
          videoAspectRatio: criteria.videoAspectRatio,
          capCutAspect: criteria.capCutAspect,
          language: input.channel.language,
          niche: input.channel.niche,
        },
        null,
        2,
      ),
    });
  }

  // Locked criteria from toolbar Ảnh/Video + TTS + CapCut
  files.push({
    relativePath: 'settings_criteria.json',
    content: JSON.stringify(
      {
        version: 1,
        source: 'toolbar: Ảnh/Video + TTS + CapCut',
        image: {
          provider: criteria.imageProvider,
          model: criteria.imageModel,
          aspectRatio: criteria.imageAspectRatio,
          count: criteria.imageCount,
        },
        video: {
          provider: criteria.videoProvider,
          model: criteria.videoModel,
          aspectRatio: criteria.videoAspectRatio,
          duration: criteria.videoDuration,
        },
        style: {
          mediaStylePreset: criteria.mediaStylePreset,
          visualDna: criteria.visualDna,
        },
        tts: criteria.tts,
        capcut: {
          aspect: criteria.capCutAspect,
          durationHintSec: criteria.videoDuration,
        },
        ship: {
          mode,
          recipeAspect: recipe.aspectRatio,
          includeVisual: recipe.includeVisual,
        },
        criteriaLines: criteria.criteriaLines,
        settingsEval,
      },
      null,
      2,
    ),
  });

  files.push({
    relativePath: 'cast/roles.json',
    content: JSON.stringify(rolesJson, null, 2),
  });
  files.push({
    relativePath: 'cast/role_profile.json',
    content: JSON.stringify(roleProfile, null, 2),
  });

  const thumbPath =
    (input.chapterHooks as { thumbnailImagePath?: string } | null | undefined)
      ?.thumbnailImagePath ||
    images.find((im) => im.key.includes('_991_') || im.key.includes('thumb'))
      ?.path ||
    '';

  const mediaCopyList = [
    ...audioItems.map((a) => ({
      kind: 'audio' as const,
      key: a.key,
      sourcePath: a.path,
      suggestedName: `audio/${sanitizeFolderPart(a.key)}.mp3`,
    })),
    ...(recipe.includeVisual
      ? images.map((im) => ({
          kind: 'image' as const,
          key: im.key,
          sourcePath: im.path.split('?')[0],
          suggestedName: `images/${sanitizeFolderPart(im.key)}.png`,
        }))
      : []),
    ...(recipe.includeVisual
      ? videos.map((v) => ({
          kind: 'video' as const,
          key: v.key,
          sourcePath: v.path.split('?')[0],
          suggestedName: `videos/${sanitizeFolderPart(v.key)}.mp4`,
        }))
      : []),
    ...(thumbPath
      ? [
          {
            kind: 'thumb' as const,
            key: 'thumbnail',
            sourcePath: thumbPath.split('?')[0],
            suggestedName: 'thumbnail/thumb_winner.png',
          },
        ]
      : []),
  ].filter((x) => !!(x.sourcePath || '').trim());

  files.push({
    relativePath: 'media_index.json',
    content: JSON.stringify(
      {
        chapter: chapterNum,
        mode,
        aspectRatio: criteria.videoAspectRatio,
        imageAspectRatio: criteria.imageAspectRatio,
        videoAspectRatio: criteria.videoAspectRatio,
        capCutAspect: criteria.capCutAspect,
        imageProvider: criteria.imageProvider,
        videoProvider: criteria.videoProvider,
        videoDuration: criteria.videoDuration,
        includeVisual: recipe.includeVisual,
        audio: audioItems,
        images: recipe.includeVisual ? images : [],
        videos: recipe.includeVisual ? videos : [],
        thumbnail: thumbPath || null,
        thumbnailPrompt: seo.thumbnailPrompt || input.chapterHooks?.thumbnailPrompt || '',
        thumbnailLine: seo.thumbnailLine || input.chapterHooks?.thumbnailLine || '',
        mediaCopyList,
        sceneCount: scenes.length,
        tts: {
          platform: criteria.tts.platform,
          voice: criteria.tts.voice,
          speed: criteria.tts.speed,
          pitch: criteria.tts.pitch,
        },
      },
      null,
      2,
    ),
  });

  files.push({
    relativePath: 'media_copy_manifest.json',
    content: JSON.stringify(
      {
        note: 'Copy sourcePath → suggestedName vào folder pack trước upload (thủ công hoặc tool).',
        items: mediaCopyList,
      },
      null,
      2,
    ),
  });

  if (recipe.includeChecklist) {
    files.push({
      relativePath: 'checklist.md',
      content: ['# Pre-upload checklist', '', ...checklist].join('\n'),
    });
    files.push({
      relativePath: 'UPLOAD_CHECKLIST.md',
      content: [
        '# Upload checklist (auto)',
        '',
        `- [ ] Kênh: ${input.channel.name}`,
        `- [ ] Mode: ${mode} · recipe ${recipe.aspectRatio} · user ${criteria.videoAspectRatio} · CapCut ${criteria.capCutAspect}`,
        `- [ ] Ảnh: ${criteria.imageProvider}/${criteria.imageModel} ${criteria.imageAspectRatio} ×${criteria.imageCount}`,
        `- [ ] Video: ${criteria.videoProvider}/${criteria.videoModel} ${criteria.videoAspectRatio} ${criteria.videoDuration}s`,
        `- [ ] TTS: ${criteria.tts.platform} / ${criteria.tts.voice} (spd ${criteria.tts.speed} pitch ${criteria.tts.pitch})`,
        `- [ ] Settings criteria eval: ${settingsEval.pass ? 'PASS' : 'FAIL'}`,
        `- [ ] Media DNA: ${mediaDnaReport.hasIssues ? `CẢNH BÁO ${mediaDnaReport.mismatches.length} lệch` : 'OK khớp toolbar'} (stamped ${mediaDnaReport.stamped}/${mediaDnaReport.checked})`,
        `- [ ] Title: ${seo.title.slice(0, 80)}`,
        `- [ ] SEO score: ${seo.scores.average}/10 (pass≥${YOUTUBE_META_PASS_SCORE}, source=${seo.source})`,
        `- [ ] Thumbnail line: ${seo.thumbnailLine || '(trống)'}`,
        `- [ ] Word-gate: ${wordGate.wordCount}/${wordGate.wordGoal} (min ${wordGate.wordMin}) ${wordGate.wordsOk ? 'OK' : 'FAIL'}`,
        `- [ ] Scenes parsed: ${scenes.length}`,
        `- [ ] Thumb file: ${thumbPath ? 'có path' : 'THIẾU — gen thumb trước'}`,
        `- [ ] Audio clips: ${audioItems.length}${audioItems.length === 0 ? ' — FAIL chỉ tiêu TTS' : ''}`,
        `- [ ] Images: ${images.length}${recipe.includeVisual && images.length === 0 ? ' — FAIL visual mode' : ''}`,
        `- [ ] Videos: ${videos.length}`,
        `- [ ] Copy media theo media_copy_manifest.json`,
        `- [ ] SRT / cast đã rà`,
        `- [ ] Anti-reuse hook/motif`,
        '',
        '## Copy list',
        ...mediaCopyList.map(
          (m) => `- [ ] \`${m.suggestedName}\` ← \`${(m.sourcePath || '').slice(0, 80)}\``,
        ),
      ].join('\n'),
    });
  }

  const manifest = {
    version: 1,
    builtAt: new Date().toISOString(),
    channelId: input.channel.id,
    channelName: input.channel.name,
    mode,
    recipe: {
      label: recipe.label,
      aspectRatio: recipe.aspectRatio,
      includeHook: recipe.includeHook,
      includeSrt: recipe.includeSrt,
      includeSeo: recipe.includeSeo,
      includeVisual: recipe.includeVisual,
    },
    workTitle: input.ten_tac_pham,
    chapter: {
      num: chapterNum,
      title: input.chapter.tieu_de,
    },
    dna: {
      visualDna: criteria.visualDna || input.channel.visualDna,
      narratorVoiceId: criteria.tts.voice || input.channel.narratorVoiceId,
      ttsPlatform: criteria.tts.platform || input.channel.ttsPlatform,
      language: input.channel.language,
      niche: input.channel.niche,
      /** Full toolbar DNA — chỉ tiêu đầu ra */
      outputDna: criteria.outputDna,
      ttsDna: criteria.tts,
    },
    criteria: {
      imageAspectRatio: criteria.imageAspectRatio,
      videoAspectRatio: criteria.videoAspectRatio,
      capCutAspect: criteria.capCutAspect,
      imageProvider: criteria.imageProvider,
      videoProvider: criteria.videoProvider,
      videoDuration: criteria.videoDuration,
      ttsPlatform: criteria.tts.platform,
      ttsVoice: criteria.tts.voice,
      ttsSpeed: criteria.tts.speed,
      ttsPitch: criteria.tts.pitch,
      lines: criteria.criteriaLines,
      settingsPass: settingsEval.pass,
    },
    stats: {
      scenes: scenes.length,
      audioClips: audioItems.length,
      images: images.length,
      videos: videos.length,
      files: 0, // filled below
    },
    quality: {
      wordGate: {
        wordCount: wordGate.wordCount,
        wordGoal: wordGate.wordGoal,
        wordMin: wordGate.wordMin,
        wordsOk: wordGate.wordsOk,
        scenesOk: wordGate.scenesOk || scenes.length >= 3,
      },
      seo: {
        average: seo.scores.average,
        pass: seo.scores.pass,
        passScore: YOUTUBE_META_PASS_SCORE,
        source: seo.source,
        titleLen: seo.title.length,
        thumbLen: seo.thumbnailLine.length,
      },
      media: {
        audioOk: audioItems.length > 0,
        visualRequired: recipe.includeVisual,
        visualOk: !recipe.includeVisual || images.length > 0 || videos.length > 0,
      },
      settings: {
        pass: settingsEval.pass,
        checks: settingsEval.checks,
      },
      mediaDna: {
        hasIssues: mediaDnaReport.hasIssues,
        stamped: mediaDnaReport.stamped,
        unstamped: mediaDnaReport.unstamped,
        checked: mediaDnaReport.checked,
        mismatchCount: mediaDnaReport.mismatches.length,
        samples: mediaDnaReport.mismatches.slice(0, 8).map((m) => ({
          key: m.key,
          field: m.field,
          message: m.message,
        })),
      },
    },
    fileList: [] as string[],
  };

  // Refresh README file list after all files known
  const fileList = files.map((f) => f.relativePath);
  manifest.stats.files = fileList.length + 1; // + manifest itself
  manifest.fileList = [...fileList, 'manifest.json'];

  files.push({
    relativePath: 'manifest.json',
    content: JSON.stringify(manifest, null, 2),
  });

  // Fix README with actual file list
  const readmeIdx = files.findIndex((f) => f.relativePath === 'README.md');
  if (readmeIdx >= 0) {
    files[readmeIdx] = {
      relativePath: 'README.md',
      content: [
        `# Ship Pack — ${input.ten_tac_pham}`,
        '',
        `- **Kênh:** ${input.channel.name} (\`${input.channel.id}\`)`,
        `- **Mode:** ${recipe.label} (\`${mode}\`)`,
        `- **Aspect recipe / user / CapCut:** ${recipe.aspectRatio} / ${criteria.videoAspectRatio} / ${criteria.capCutAspect}`,
        `- **Chương:** ${chapterNum} — ${input.chapter.tieu_de}`,
        `- **TTS:** ${criteria.tts.platform} / ${criteria.tts.voice}`,
        `- **Ảnh:** ${criteria.imageProvider} ${criteria.imageAspectRatio}`,
        `- **Video:** ${criteria.videoProvider} ${criteria.videoAspectRatio} ${criteria.videoDuration}s`,
        '',
        recipe.description,
        '',
        '## Chỉ tiêu từ cài đặt',
        ...criteria.criteriaLines.map((l) => `- ${l}`),
        '',
        '## Files',
        ...manifest.fileList.map((p) => `- \`${p}\``),
      ].join('\n'),
    };
  }

  return {
    mode,
    recipe,
    channelId: input.channel.id,
    channelName: input.channel.name,
    chapterNum,
    title: input.ten_tac_pham,
    folderName,
    files,
    checklist,
    manifest,
    mediaCopyList,
  };
}
