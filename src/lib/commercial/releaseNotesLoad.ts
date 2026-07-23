/**
 * Load release-notes.json from packaged resources or repo (Node only).
 */
import fs from 'fs';
import path from 'path';
import {
  BUNDLED_RELEASE_NOTES,
  type ReleaseNotesDoc,
} from './releaseNotes';

function candidatePaths(): string[] {
  const roots: string[] = [];
  const env = (process.env.AI_NOVEL_ROOT || '').trim();
  if (env) roots.push(env);
  try {
    const res = (process as NodeJS.Process & { resourcesPath?: string })
      .resourcesPath;
    if (res) roots.push(res);
  } catch {
    /* ignore */
  }
  roots.push(process.cwd());
  const out: string[] = [];
  for (const r of roots) {
    out.push(path.join(r, 'commercial', 'release-notes.json'));
    out.push(path.join(r, 'resources', 'commercial', 'release-notes.json'));
  }
  return out;
}

export function loadReleaseNotesDoc(): ReleaseNotesDoc {
  for (const p of candidatePaths()) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as ReleaseNotesDoc;
      if (raw?.versions && typeof raw.versions === 'object') {
        return raw;
      }
    } catch {
      /* next */
    }
  }
  return BUNDLED_RELEASE_NOTES;
}
