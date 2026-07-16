/**
 * VinaVoice Runtime — independent app facade inside AI Novel.
 *
 * Pipeline (MainWindow equivalent):
 *   1. Bootstrap env (data dirs, profiles, samples)
 *   2. Load session (rules, pauses, seeds)
 *   3. Apply text rules
 *   4. Chunk + pause schedule
 *   5. Synth (selected Zero-Shot/clone engine; no builtin Edge fallback)
 *   6. Post-process prosody
 *   7. Concat with pauses
 *
 * ZERO dependency on Vina-Voice.exe.
 */
import fs from 'fs';
import path from 'path';
import { ensureVinaEnvironment, vinaPaths } from './paths';
import { loadVinaSession, sessionToVoiceSettings, saveVinaSessionPartial } from './session';
import { synthesizeVinaVoice } from './engine';
import {
  loadVinaProfiles,
  applyProfileToSettings,
  mergeSettings,
} from './profiles';
import { applyVinaTextRules } from './textPipeline';
import { chunkVinaText } from './chunking';
import { ffmpegAvailable } from './audioPost';
import type { VinaSynthesizeResult, VinaVoiceSettings } from './types';

export interface RuntimeStatus {
  ok: boolean;
  independent: boolean;
  dependsOnVinaExe: false;
  env: ReturnType<typeof ensureVinaEnvironment>;
  ffmpeg: boolean;
  profilesCount: number;
  samplesCount: number;
  userClonesCount: number;
  engine: {
    url: string;
    reachable: boolean;
    xtts?: boolean;
    error?: string;
  };
  session: {
    max_chars_per_chunk: number;
    rulesCount: number;
    pause_dot_ms: number;
  };
  modules: string[];
}

export async function probeEngine(
  url: string,
): Promise<{ reachable: boolean; xtts?: boolean; error?: string }> {
  const base = (url || '').replace(/\/$/, '');
  if (!base) return { reachable: false, error: 'no engine url' };
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 2500);
    const res = await fetch(`${base}/health`, { signal: ac.signal });
    clearTimeout(t);
    if (!res.ok) return { reachable: false, error: `HTTP ${res.status}` };
    const j = (await res.json().catch(() => ({}))) as {
      xtts_available?: boolean;
    };
    return { reachable: true, xtts: !!j.xtts_available };
  } catch (e) {
    return {
      reachable: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function getRuntimeStatus(cwd = process.cwd()): Promise<RuntimeStatus> {
  const env = ensureVinaEnvironment(cwd);
  const p = vinaPaths(cwd);
  const session = loadVinaSession(cwd);
  const profiles = loadVinaProfiles(cwd);
  let samplesCount = 0;
  let userClonesCount = 0;
  try {
    samplesCount = fs
      .readdirSync(p.samples)
      .filter((f) => /\.(wav|mp3)$/i.test(f)).length;
  } catch {
    /* ignore */
  }
  try {
    userClonesCount = fs
      .readdirSync(p.userClones)
      .filter((f) => /\.(wav|mp3)$/i.test(f)).length;
  } catch {
    /* ignore */
  }

  const engine = await probeEngine(session.engine_url);

  return {
    ok: env.ok && ffmpegAvailable(cwd),
    independent: true,
    dependsOnVinaExe: false,
    env,
    ffmpeg: ffmpegAvailable(cwd),
    profilesCount: profiles.length,
    samplesCount,
    userClonesCount,
    engine: {
      url: session.engine_url,
      reachable: engine.reachable,
      xtts: engine.xtts,
      error: engine.error,
    },
    session: {
      max_chars_per_chunk: session.max_chars_per_chunk,
      rulesCount: session.custom_rules?.length || 0,
      pause_dot_ms: session.pause_dot_ms,
    },
    modules: [
      'paths',
      'session',
      'textPipeline',
      'chunking',
      'profiles',
      'profileFilter',
      'audioPost',
      'engine',
      'runtime',
      'clone-api',
    ],
  };
}

export interface RuntimeSynthRequest {
  text: string;
  profileName?: string;
  settings?: Partial<VinaVoiceSettings>;
  /** Use session defaults as base */
  useSession?: boolean;
  forceBuiltin?: boolean;
  outDir?: string;
}

/**
 * Full MainWindow-style synthesis entrypoint for the independent runtime.
 */
export async function runtimeSynthesize(
  req: RuntimeSynthRequest,
  cwd = process.cwd(),
): Promise<VinaSynthesizeResult & { preview?: { cleaned: string; chunkCount: number } }> {
  ensureVinaEnvironment(cwd);
  const session = loadVinaSession(cwd);
  let settings = req.useSession !== false
    ? sessionToVoiceSettings(session)
    : mergeSettings({}, cwd);

  if (req.settings) {
    settings = mergeSettings({ ...settings, ...req.settings }, cwd);
  }

  if (req.profileName) {
    const profiles = loadVinaProfiles(cwd);
    const hit = profiles.find((p) => p.name === req.profileName);
    if (hit) settings = applyProfileToSettings(settings, hit, cwd);
  }

  const cleaned = applyVinaTextRules(req.text, settings.custom_rules);
  const chunks = chunkVinaText(cleaned, settings);

  const result = await synthesizeVinaVoice(
    {
      text: req.text,
      profileName: req.profileName,
      settings,
      forceBuiltin: req.forceBuiltin,
    },
    {
      cwd,
      outDir:
        req.outDir ||
        path.join(vinaPaths(cwd).temp, `job_${Date.now()}`),
    },
  );

  return {
    ...result,
    preview: { cleaned, chunkCount: chunks.length },
  };
}

export function runtimeSaveSettings(
  partial: Partial<VinaVoiceSettings>,
  cwd = process.cwd(),
) {
  return saveVinaSessionPartial(
    {
      gender: partial.gender,
      area: partial.area,
      group: partial.group,
      emotion: partial.emotion,
      speed: partial.speed,
      speaker_seed: partial.speaker_seed,
      style_seed: partial.style_seed,
      pitch_shift: partial.pitch_shift,
      formant: partial.formant,
      treble_boost: partial.treble_boost,
      use_clone: partial.use_clone,
      reference_audio: partial.reference_audio,
      reference_text: partial.reference_text,
      max_chars_per_chunk: partial.max_chars_per_chunk,
      pause_dot_ms: partial.pause_dot_ms,
      pause_comma_ms: partial.pause_comma_ms,
      engine_url: partial.engine_url,
      samples_dir: partial.samples_dir,
      custom_rules: partial.custom_rules,
    },
    cwd,
  );
}
