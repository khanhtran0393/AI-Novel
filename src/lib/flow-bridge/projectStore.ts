/**
 * Local catalog of Google Flow projects (id + display title).
 * Captured from network + created via tRPC project.createProject.
 */
import fs from 'fs';
import path from 'path';

export type FlowProject = {
  id: string;
  title: string;
  source: 'create' | 'capture' | 'manual';
  createdAt: number;
  updatedAt: number;
};

/**
 * Real Flow project ids are UUIDs (or long opaque ids).
 * Reject placeholders like "abc-111", "default", empty junk,
 * and sequential smoke UUIDs (a1b2c3d4-e5f6-…, c1d2e3f4-…) that
 * pass UUID regex but never exist on labs.google (→ 2nd/3rd gen hang).
 */
export function isPlausibleProjectId(id: string | null | undefined): boolean {
  const s = String(id || '').trim();
  if (!s || s.length < 8) return false;
  if (/^(abc-?111|default|none|null|undefined|test|demo)$/i.test(s)) {
    return false;
  }
  // Smoke / inherited fake UUIDs (a1b2c3d4-e5f6-7890-abcd-ef1234567890 family)
  if (/^[a-f0-9]1[a-f0-9]2[a-f0-9]3[a-f0-9]4-[a-f0-9]{4}-7890-abcd-ef1234567890$/i.test(s)) {
    return false;
  }
  // Sequential hex-pair prefix generators (a1b2c3d4-…, c1d2e3f4-…)
  if (/^(a1b2c3d4|b1c2d3e4|c1d2e3f4|d1e2f3a4|e1f2a3b4|f1a2b3c4)-/i.test(s)) {
    return false;
  }
  // UUID v4-ish or long hex/opaque
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
  ) {
    return true;
  }
  if (/^[0-9a-f-]{16,}$/i.test(s)) return true;
  // numeric project ids sometimes used by Flow
  if (/^\d{6,}$/.test(s)) return true;
  // opaque base64-ish
  if (s.length >= 12 && !/\s/.test(s) && !/^abc/i.test(s)) return true;
  return false;
}

function storePath(): string {
  const root = process.env.AI_NOVEL_ROOT || process.cwd();
  const dir = path.join(root, 'data', 'flow-bridge');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'projects.json');
}

function activePath(): string {
  const root = process.env.AI_NOVEL_ROOT || process.cwd();
  const dir = path.join(root, 'data', 'flow-bridge');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'active-project.json');
}

export function loadProjects(): FlowProject[] {
  try {
    const p = storePath();
    if (!fs.existsSync(p)) return [];
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!Array.isArray(raw)) return [];
    const list = raw
      .map((x) => ({
        id: String(x.id || '').trim(),
        title: String(x.title || x.id || 'Project').trim() || 'Project',
        source:
          x.source === 'create' || x.source === 'manual' || x.source === 'capture'
            ? x.source
            : ('capture' as const),
        createdAt: Number(x.createdAt) || Date.now(),
        updatedAt: Number(x.updatedAt) || Date.now(),
      }))
      .filter((x) => x.id && isPlausibleProjectId(x.id));
    // Purge fake ids from disk once
    if (list.length !== raw.length) {
      try {
        saveProjects(list);
      } catch {
        /* ignore */
      }
    }
    const active = getActiveProjectId();
    if (active && !isPlausibleProjectId(active)) {
      setActiveProjectId(list[0]?.id || null);
    }
    return list;
  } catch {
    return [];
  }
}

export function saveProjects(list: FlowProject[]): void {
  fs.writeFileSync(storePath(), JSON.stringify(list, null, 2), 'utf8');
}

export function upsertProject(
  input: { id: string; title?: string; source?: FlowProject['source'] },
): FlowProject {
  const id = String(input.id || '').trim();
  if (!id) throw new Error('project id required');
  if (!isPlausibleProjectId(id)) {
    throw new Error(
      `Project id không hợp lệ (placeholder?): ${id}. Sync/chọn project thật từ account Flow.`,
    );
  }
  const list = loadProjects();
  const i = list.findIndex((p) => p.id === id);
  const now = Date.now();
  if (i >= 0) {
    list[i] = {
      ...list[i],
      title: (input.title || list[i].title || id).trim(),
      source: input.source || list[i].source,
      updatedAt: now,
    };
    saveProjects(list);
    return list[i];
  }
  const row: FlowProject = {
    id,
    title: (input.title || `Project ${id.slice(0, 8)}`).trim(),
    source: input.source || 'capture',
    createdAt: now,
    updatedAt: now,
  };
  list.unshift(row);
  saveProjects(list);
  return row;
}

export function getActiveProjectId(): string | null {
  try {
    const p = activePath();
    if (!fs.existsSync(p)) return null;
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as { projectId?: string };
    const id = String(raw.projectId || '').trim();
    return id || null;
  } catch {
    return null;
  }
}

export function setActiveProjectId(projectId: string | null): void {
  const id = projectId ? String(projectId).trim() : '';
  fs.writeFileSync(
    activePath(),
    JSON.stringify({ projectId: id || null, updatedAt: Date.now() }, null, 2),
    'utf8',
  );
}

export function removeProject(id: string): boolean {
  const list = loadProjects();
  const next = list.filter((p) => p.id !== id);
  if (next.length === list.length) return false;
  saveProjects(next);
  if (getActiveProjectId() === id) setActiveProjectId(next[0]?.id || null);
  return true;
}
