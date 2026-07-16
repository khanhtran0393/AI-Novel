/**
 * Disk persistence for Seedance project-state lite (per chapter).
 * Avoids bloating Zustand rehydrate with large sequence JSON.
 */
import fs from 'fs';
import path from 'path';
import { ensureWorkDirs, getIntegrationPaths } from './paths';
import type { SeedanceProjectStateLite } from './seedanceTypes';
import { buildProjectStateFromChapter } from './seedanceSequence';

function chapterKey(chapterNum: number, projectSlug?: string): string {
  const slug = (projectSlug || 'default')
    .replace(/[^\w\-]+/g, '_')
    .slice(0, 48);
  return `ch${chapterNum}_${slug}`;
}

export function seedanceStatePath(
  chapterNum: number,
  projectSlug?: string,
): string {
  const paths = getIntegrationPaths();
  ensureWorkDirs(paths);
  return path.join(
    paths.seedanceWork,
    `project_${chapterKey(chapterNum, projectSlug)}.json`,
  );
}

export function loadSeedanceProject(
  chapterNum: number,
  projectSlug?: string,
): SeedanceProjectStateLite | null {
  try {
    const file = seedanceStatePath(chapterNum, projectSlug);
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as SeedanceProjectStateLite;
    if (!parsed?.project_id || !Array.isArray(parsed.clips)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSeedanceProject(
  state: SeedanceProjectStateLite,
  projectSlug?: string,
): string {
  const chapterNum = state.chapter_num || 1;
  const file = seedanceStatePath(chapterNum, projectSlug);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const next = {
    ...state,
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
  return file;
}

/**
 * Ensure chapter has a Seedance project-state; create from scenes if missing.
 */
export function ensureSeedanceProject(input: {
  chapterNum: number;
  title: string;
  scenes: Array<{ index: number; text: string; title?: string }>;
  lorebook?: string;
  styleHint?: string;
  secondsPerBeat?: number;
  videoDuration?: number;
  projectSlug?: string;
  forceRebuild?: boolean;
}): { state: SeedanceProjectStateLite; path: string; created: boolean } {
  if (!input.forceRebuild) {
    const existing = loadSeedanceProject(input.chapterNum, input.projectSlug);
    if (existing) {
      return {
        state: existing,
        path: seedanceStatePath(input.chapterNum, input.projectSlug),
        created: false,
      };
    }
  }

  const state = buildProjectStateFromChapter({
    title: input.title,
    chapterNum: input.chapterNum,
    lorebook: input.lorebook,
    scenes: input.scenes,
    styleHint: input.styleHint,
    secondsPerBeat: input.secondsPerBeat,
    clipBudgetSec: input.videoDuration,
  });
  const pathSaved = saveSeedanceProject(state, input.projectSlug);
  return { state, path: pathSaved, created: true };
}

export function listSeedanceProjects(): Array<{
  file: string;
  chapterNum?: number;
  projectId?: string;
  updatedAt?: string;
}> {
  const paths = getIntegrationPaths();
  ensureWorkDirs(paths);
  if (!fs.existsSync(paths.seedanceWork)) return [];
  return fs
    .readdirSync(paths.seedanceWork)
    .filter((f) => f.startsWith('project_') && f.endsWith('.json'))
    .map((f) => {
      const full = path.join(paths.seedanceWork, f);
      try {
        const j = JSON.parse(fs.readFileSync(full, 'utf8')) as SeedanceProjectStateLite;
        return {
          file: full,
          chapterNum: j.chapter_num,
          projectId: j.project_id,
          updatedAt: j.updated_at,
        };
      } catch {
        return { file: full };
      }
    });
}
