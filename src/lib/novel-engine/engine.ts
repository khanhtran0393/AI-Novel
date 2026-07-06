import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import type { Chuong } from '@/store/useNovelStore';

export type EngineScope =
  | { kind: 'global' }
  | { kind: 'chapter'; chapter: number }
  | { kind: 'scene'; chapter: number; scene: number };

export interface EngineCheckpoint {
  id: string;
  scope: EngineScope;
  step: string;
  artifact: string;
  digest: string;
  createdAt: string;
  projectName?: string;
}

export interface EngineSnapshot {
  projectName: string;
  currentChapter: number;
  totalChapters: number;
  targetWords: number;
  chapters: Pick<Chuong, 'so_chuong' | 'tieu_de' | 'dan_y' | 'noi_dung' | 'trang_thai'>[];
  editorReviews?: Record<string, { verdict?: string; summary?: string }>;
  generatedAudioCount?: number;
  generatedImageCount?: number;
  generatedVideoCount?: number;
}

export interface EngineDiagnostic {
  severity: 'info' | 'warning' | 'critical';
  rule: string;
  message: string;
  evidence?: string;
}

export interface EngineStatus {
  root: string;
  checkpoints: EngineCheckpoint[];
  progress: EngineSnapshot | null;
  diagnostics: EngineDiagnostic[];
  diagPath: string;
  nextStep: string;
}

const ENGINE_DIR = '.ainovel-app';
const CHECKPOINTS_REL = 'meta/checkpoints.jsonl';
const PROGRESS_REL = 'meta/progress.json';
const DIAG_REL = 'meta/diag-export.md';

function rootDir(): string {
  return path.join(process.cwd(), ENGINE_DIR);
}

function abs(rel: string): string {
  return path.join(rootDir(), rel);
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJsonAtomic(rel: string, payload: unknown): void {
  const filePath = abs(rel);
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${stableStringify(payload)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function writeTextAtomic(rel: string, content: string): void {
  const filePath = abs(rel);
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, content, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value), null, 2);
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.keys(record)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = sortValue(record[key]);
      return acc;
    }, {});
}

function digest(value: unknown): string {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function scopeKey(scope: EngineScope): string {
  if (scope.kind === 'chapter') return `chapter-${String(scope.chapter).padStart(2, '0')}`;
  if (scope.kind === 'scene') {
    return `chapter-${String(scope.chapter).padStart(2, '0')}-scene-${String(scope.scene).padStart(2, '0')}`;
  }
  return 'global';
}

function safeStep(step: string): string {
  return step.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'event';
}

function artifactRel(step: string, scope: EngineScope): string {
  const normalizedStep = safeStep(step);
  if (normalizedStep === 'outline' || normalizedStep === 'foundation') return 'outline/foundation.json';
  if (normalizedStep === 'snapshot') return PROGRESS_REL;
  if (scope.kind === 'chapter') {
    const chapter = String(scope.chapter).padStart(2, '0');
    if (normalizedStep.includes('review')) return `reviews/ch${chapter}.json`;
    return `chapters/ch${chapter}.${normalizedStep}.json`;
  }
  if (scope.kind === 'scene') {
    return `media/${scopeKey(scope)}.${normalizedStep}.json`;
  }
  return `artifacts/${normalizedStep}.json`;
}

function readCheckpoints(): EngineCheckpoint[] {
  const filePath = abs(CHECKPOINTS_REL);
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as EngineCheckpoint];
      } catch {
        return [];
      }
    });
}

function appendCheckpoint(checkpoint: EngineCheckpoint): void {
  const filePath = abs(CHECKPOINTS_REL);
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(checkpoint)}\n`, 'utf8');
}

export function recordCheckpoint(input: {
  step: string;
  scope?: EngineScope;
  payload: unknown;
  projectName?: string;
}): EngineCheckpoint {
  const scope = normalizeScope(input.scope || { kind: 'global' });
  const artifact = artifactRel(input.step, scope);
  writeJsonAtomic(artifact, input.payload);

  const payloadDigest = digest(input.payload);
  const existing = readCheckpoints().find(
    (cp) => cp.step === input.step && cp.digest === payloadDigest && JSON.stringify(cp.scope) === JSON.stringify(scope),
  );
  if (existing) return existing;

  if (scope.kind === 'chapter' && isRecord(input.payload)) {
    const chapter = input.payload.chapter;
    const content = isRecord(chapter) ? stringValue(chapter.noi_dung ?? chapter.content) : '';
    if (content) {
      const chapterNum = String(scope.chapter).padStart(2, '0');
      writeTextAtomic(`chapters/ch${chapterNum}.md`, content);
    }
  }

  const checkpoint: EngineCheckpoint = {
    id: crypto.randomUUID(),
    scope,
    step: input.step,
    artifact,
    digest: payloadDigest,
    createdAt: new Date().toISOString(),
    projectName: input.projectName,
  };
  appendCheckpoint(checkpoint);
  return checkpoint;
}

export function recordSnapshot(snapshot: EngineSnapshot): EngineCheckpoint {
  const normalizedSnapshot = normalizeSnapshot(snapshot);
  const compactSnapshot = {
    ...normalizedSnapshot,
    chapters: normalizedSnapshot.chapters.map((chapter) => ({
      so_chuong: chapter.so_chuong,
      tieu_de: chapter.tieu_de,
      trang_thai: chapter.trang_thai,
      words: wordCount(chapter.noi_dung),
      hasContent: chapter.noi_dung.trim().length > 0,
    })),
  };
  writeJsonAtomic(PROGRESS_REL, normalizedSnapshot);
  const payloadDigest = digest(compactSnapshot);
  const existing = readCheckpoints().find(
    (cp) => cp.step === 'snapshot' && cp.digest === payloadDigest && cp.scope.kind === 'global',
  );
  const checkpoint = existing || {
    id: crypto.randomUUID(),
    scope: { kind: 'global' } as EngineScope,
    step: 'snapshot',
    artifact: PROGRESS_REL,
    digest: payloadDigest,
    createdAt: new Date().toISOString(),
    projectName: normalizedSnapshot.projectName,
  };
  if (!existing) appendCheckpoint(checkpoint);
  writeDiagnostics(normalizedSnapshot);
  return checkpoint;
}

export function getStatus(): EngineStatus {
  const progress = readProgress();
  const diagnostics = progress ? buildDiagnostics(progress) : [];
  if (progress) writeDiagnostics(progress);
  return {
    root: rootDir(),
    checkpoints: readCheckpoints(),
    progress,
    diagnostics,
    diagPath: abs(DIAG_REL),
    nextStep: routeNextStep(progress),
  };
}

export function resetEngine(): void {
  const dir = rootDir();
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function readProgress(): EngineSnapshot | null {
  const filePath = abs(PROGRESS_REL);
  if (!fs.existsSync(filePath)) return null;
  try {
    return normalizeSnapshot(JSON.parse(fs.readFileSync(filePath, 'utf8')) as EngineSnapshot);
  } catch {
    return null;
  }
}

function normalizeScope(scope: EngineScope): EngineScope {
  const raw = scope as EngineScope & Record<string, unknown>;
  if (scope.kind === 'global') return { kind: 'global' };
  if (scope.kind === 'chapter') {
    const chapter = toPositiveInt(raw.chapter ?? raw.chapterId ?? raw.so_chuong);
    if (!chapter) throw new Error('Invalid chapter scope.');
    return { kind: 'chapter', chapter };
  }
  if (scope.kind === 'scene') {
    const chapter = toPositiveInt(raw.chapter ?? raw.chapterId ?? raw.so_chuong);
    const scene = toPositiveInt(raw.scene ?? raw.sceneId ?? raw.sceneIndex);
    if (!chapter || !scene) throw new Error('Invalid scene scope.');
    return { kind: 'scene', chapter, scene };
  }
  throw new Error('Invalid engine scope.');
}

function normalizeSnapshot(snapshot: EngineSnapshot): EngineSnapshot {
  const raw: Record<string, unknown> = isRecord(snapshot) ? snapshot : {};
  const setup: Record<string, unknown> = isRecord(raw.setup) ? raw.setup : {};
  const rawChapters = raw.chapters ?? raw.danh_sach_chuong;
  const chapters = Array.isArray(rawChapters)
    ? rawChapters.map((chapter, index) => normalizeChapter(chapter, index))
    : [];
  const currentChapter = toPositiveInt(raw.currentChapter ?? raw.currentChapterId ?? raw.chuong_dang_chon) || chapters[0]?.so_chuong || 1;
  const totalChapters = toPositiveInt(raw.totalChapters ?? raw.so_chuong ?? setup.so_chuong) || chapters.length;
  const targetWords = toPositiveInt(raw.targetWords ?? raw.so_tu_chuong ?? setup.so_tu_chuong) || 4250;

  return {
    projectName: stringValue(raw.projectName ?? raw.ten_tac_pham),
    currentChapter,
    totalChapters,
    targetWords,
    chapters,
    editorReviews: normalizeEditorReviews(raw.editorReviews),
    generatedAudioCount: toPositiveInt(raw.generatedAudioCount) || countTruthy(raw.generatedAudioPaths),
    generatedImageCount: toPositiveInt(raw.generatedImageCount) || countTruthy(raw.generatedImages),
    generatedVideoCount: toPositiveInt(raw.generatedVideoCount) || countTruthy(raw.generatedVideos),
  };
}

function normalizeChapter(value: unknown, index: number): EngineSnapshot['chapters'][number] {
  const raw = isRecord(value) ? value : {};
  const soChuong = toPositiveInt(raw.so_chuong ?? raw.chapterNumber ?? raw.number ?? raw.id) || index + 1;
  const noiDung = stringValue(raw.noi_dung ?? raw.content);
  const rawStatus = stringValue(raw.trang_thai ?? raw.status);
  const trangThai =
    rawStatus === 'ready' || rawStatus === 'writing' || rawStatus === 'empty'
      ? rawStatus
      : raw.da_viet === true || noiDung.trim()
        ? 'ready'
        : 'empty';

  return {
    so_chuong: soChuong,
    tieu_de: stringValue(raw.tieu_de ?? raw.title) || `Chapter ${soChuong}`,
    dan_y: stringValue(raw.dan_y ?? raw.outline),
    noi_dung: noiDung,
    trang_thai: trangThai,
  };
}

function normalizeEditorReviews(value: unknown): EngineSnapshot['editorReviews'] {
  if (!isRecord(value)) return undefined;
  const reviews: NonNullable<EngineSnapshot['editorReviews']> = {};
  for (const [chapter, review] of Object.entries(value)) {
    if (!isRecord(review)) continue;
    reviews[chapter] = {
      verdict: stringValue(review.verdict),
      summary: stringValue(review.summary),
    };
  }
  return reviews;
}

function buildDiagnostics(snapshot: EngineSnapshot): EngineDiagnostic[] {
  const diagnostics: EngineDiagnostic[] = [];
  if (!snapshot.projectName.trim()) {
    diagnostics.push({ severity: 'warning', rule: 'MissingProjectName', message: 'Project name is empty.' });
  }
  if (snapshot.chapters.length === 0) {
    diagnostics.push({ severity: 'critical', rule: 'MissingOutline', message: 'No chapters are available.' });
  }

  const readyChapters = snapshot.chapters.filter((chapter) => chapter.trang_thai === 'ready');
  const minWords = Math.round(snapshot.targetWords * 0.92);
  for (const chapter of readyChapters) {
    const words = wordCount(chapter.noi_dung);
    if (words < minWords) {
      diagnostics.push({
        severity: 'warning',
        rule: 'WordGateBelowTarget',
        message: `Chapter ${chapter.so_chuong} is below the Word-Gate target.`,
        evidence: `${words}/${snapshot.targetWords} words`,
      });
    }
  }

  const reviews = snapshot.editorReviews || {};
  for (const [chapter, review] of Object.entries(reviews)) {
    if (review.verdict && review.verdict !== 'accept') {
      diagnostics.push({
        severity: review.verdict === 'rewrite' ? 'critical' : 'warning',
        rule: 'PendingEditorAction',
        message: `Chapter ${chapter} needs ${review.verdict}.`,
        evidence: review.summary,
      });
    }
  }

  if (readCheckpoints().length === 0) {
    diagnostics.push({ severity: 'warning', rule: 'NoCheckpoints', message: 'No checkpoints have been recorded yet.' });
  }

  return diagnostics;
}

function writeDiagnostics(snapshot: EngineSnapshot): EngineDiagnostic[] {
  const diagnostics = buildDiagnostics(snapshot);
  const lines = [
    '# diag-export',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Project: ${snapshot.projectName || '(unnamed)'}`,
    `Progress: chapter ${snapshot.currentChapter}/${snapshot.totalChapters}`,
    `Checkpoints: ${readCheckpoints().length}`,
    '',
    '## Findings',
    '',
    diagnostics.length === 0
      ? '- [info] No blocking diagnostics.'
      : diagnostics.map((item) => `- [${item.severity}] ${item.rule}: ${item.message}${item.evidence ? ` (${item.evidence})` : ''}`).join('\n'),
    '',
    '## Chapter Shape',
    '',
    ...snapshot.chapters.map((chapter) => {
      const words = wordCount(chapter.noi_dung);
      return `- ch${String(chapter.so_chuong).padStart(2, '0')} ${chapter.trang_thai}: ${words} words`;
    }),
    '',
  ];
  writeTextAtomic(DIAG_REL, lines.join('\n'));
  return diagnostics;
}

function routeNextStep(snapshot: EngineSnapshot | null): string {
  if (!snapshot) return 'Initialize project foundation.';
  if (snapshot.chapters.length === 0) return 'Generate outline.';

  const reviews = snapshot.editorReviews || {};
  for (const [chapter, review] of Object.entries(reviews)) {
    if (review.verdict === 'rewrite') return `Rewrite chapter ${chapter}.`;
    if (review.verdict === 'polish') return `Polish chapter ${chapter}.`;
  }

  const nextEmpty = snapshot.chapters.find((chapter) => chapter.trang_thai !== 'ready' || !chapter.noi_dung.trim());
  if (nextEmpty) return `Write chapter ${nextEmpty.so_chuong}.`;
  return 'All planned chapters are ready. Run final review/export.';
}

function wordCount(text: string): number {
  const cleaned = text.normalize('NFC').replace(/\[[^\]]*\]/g, '').trim();
  return cleaned ? cleaned.split(/\s+/).filter(Boolean).length : 0;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.normalize('NFC') : '';
}

function toPositiveInt(value: unknown): number | null {
  const num = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isFinite(num) || num < 1) return null;
  return Math.trunc(num);
}

function countTruthy(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined;
  return Object.values(value).filter(Boolean).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
