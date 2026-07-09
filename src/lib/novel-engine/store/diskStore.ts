/**
 * Disk store for native AI Novel engine artifacts under .ainovel-app/
 */
import fs from 'fs';
import path from 'path';
import {
  type EngineChapter,
  type EngineProgress,
  createInitialProgress,
  wordCount,
} from '../domain';

const ENGINE_DIR = '.ainovel-app';

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
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
}

/** Public write helper for tools/summaries */
export function writeJsonAtomicSafe(rel: string, payload: unknown): void {
  writeJsonAtomic(rel, payload);
}

function writeTextAtomic(rel: string, content: string): void {
  const filePath = abs(rel);
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, content, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function readJson<T>(rel: string): T | null {
  const filePath = abs(rel);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function getEngineRoot(): string {
  return rootDir();
}

export function loadProgress(): EngineProgress | null {
  return readJson<EngineProgress>('meta/engine-progress.json');
}

export function saveProgress(progress: EngineProgress): void {
  writeJsonAtomic('meta/engine-progress.json', {
    ...progress,
    updatedAt: new Date().toISOString(),
  });
}

export function ensureProgress(projectName: string, totalChapters: number): EngineProgress {
  const existing = loadProgress();
  if (existing) {
    return {
      ...existing,
      projectName: projectName || existing.projectName,
      totalChapters: totalChapters || existing.totalChapters,
    };
  }
  const created = createInitialProgress({ projectName, totalChapters });
  saveProgress(created);
  return created;
}

export function listChapters(): EngineChapter[] {
  const dir = abs('chapters');
  if (!fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^ch\d+\.json$/i.test(f))
    .sort();
  const chapters: EngineChapter[] = [];
  for (const f of files) {
    const data = readJson<EngineChapter>(`chapters/${f}`);
    if (data?.id) chapters.push(data);
  }
  return chapters.sort((a, b) => a.id - b.id);
}

export function loadChapter(id: number): EngineChapter | null {
  const n = String(id).padStart(2, '0');
  return readJson<EngineChapter>(`chapters/ch${n}.json`);
}

export function saveChapter(chapter: EngineChapter): void {
  const n = String(chapter.id).padStart(2, '0');
  const payload: EngineChapter = {
    ...chapter,
    wordCount: wordCount(chapter.content),
    updatedAt: new Date().toISOString(),
  };
  writeJsonAtomic(`chapters/ch${n}.json`, payload);
  if (payload.content?.trim()) {
    writeTextAtomic(`chapters/ch${n}.md`, `# Chương ${payload.id}: ${payload.title}\n\n${payload.content}\n`);
  }
}

export function loadConfigFile(): { env: string; config: string } {
  const envPath = abs('config/.env');
  const configPath = abs('config/config.json');
  ensureDir(abs('config'));
  const env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : defaultEnvTemplate();
  const config = fs.existsSync(configPath)
    ? fs.readFileSync(configPath, 'utf8')
    : defaultConfigTemplate();
  return { env, config };
}

export function saveConfigFile(input: { env?: string; config?: string }): void {
  ensureDir(abs('config'));
  if (typeof input.env === 'string') {
    writeTextAtomic('config/.env', input.env);
  }
  if (typeof input.config === 'string') {
    writeTextAtomic('config/config.json', input.config);
  }
}

function defaultEnvTemplate(): string {
  return `# AI Novel native engine (không cần ainovel-gui :8080)
# API keys ưu tiên lấy từ store app (Header). File này chỉ override tùy chọn.
# GEMINI_API_KEY=
# OPENAI_API_KEY=
`;
}

function defaultConfigTemplate(): string {
  return JSON.stringify(
    {
      engine: 'native-ts',
      note: 'Cấu hình native AI Novel — độc lập khỏi ainovel-cli Go backend',
      maxChaptersPerRun: 3,
      wordGoal: 4250,
    },
    null,
    2,
  );
}

/** Parse key=value lines from config/.env */
export function parseEnvFile(envText: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of envText.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}
