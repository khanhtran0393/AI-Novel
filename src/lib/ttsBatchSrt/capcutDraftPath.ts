/**
 * Resolve CapCut PC drafts folder (com.lveditor.draft).
 * Same convention as CapAssistant user_configs.capcut_draft_path.
 */
import fs from 'fs';
import path from 'path';

export function resolveCapCutDraftsDir(override?: string): string {
  const raw = String(override || '').trim();
  if (raw) {
    fs.mkdirSync(raw, { recursive: true });
    return raw;
  }
  const env = String(process.env.CAPCUT_DRAFT_PATH || process.env.CAPCUT_DRAFTS_DIR || '').trim();
  if (env) {
    fs.mkdirSync(env, { recursive: true });
    return env;
  }
  const local = process.env.LOCALAPPDATA || '';
  if (local) {
    const p = path.join(
      local,
      'CapCut',
      'User Data',
      'Projects',
      'com.lveditor.draft',
    );
    fs.mkdirSync(p, { recursive: true });
    return p;
  }
  // Fallback: project-local drafts (still openable if user copies to CapCut)
  const fallback = path.join(process.cwd(), 'public', 'audio', 'srt-batch', '_capcut_drafts');
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}
