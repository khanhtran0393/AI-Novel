/**
 * Multishot grammar — D:\repo\seedance-2.0-main/references/multishot-grammar.md
 * + event-density.md: one visible beat per shot; ~4–6s official budget.
 * AI Novel maps user `secondsPerBeat` when provided (clamped into Seedance-safe range for video gens).
 */
import type { MultishotPlan, SeedanceShotStructure } from './seedanceTypes';

/**
 * Plan cuts inside ONE video generation.
 * - < 8s → single take
 * - 8–11s → 2 shots
 * - 12–15s+ → 2–3 shots (Seedance multishot sweet spot)
 * User secondsPerBeat influences seconds-per-shot when in 3–8 range.
 */
export function planMultishot(opts: {
  durationSec: number;
  /** User Media Config beat; used as soft preference for shot length */
  secondsPerBeat?: number;
}): MultishotPlan {
  const rawDur = Number(opts.durationSec);
  if (!Number.isFinite(rawDur) || rawDur <= 0) {
    throw new Error(
      'Thieu durationSec hop le cho multishot plan. App khong tu gan 5s.',
    );
  }
  const dur = Math.max(1, rawDur);
  // Official multishot: ~4–6s/shot; honor user beat if inside that band
  const userBeat = Number(opts.secondsPerBeat);
  const preferred =
    Number.isFinite(userBeat) && userBeat >= 3 && userBeat <= 10
      ? Math.min(6, Math.max(4, userBeat))
      : 5;

  if (dur < 8) {
    return {
      shotCount: 1,
      shotStructure: 'compact_single_take',
      secondsPerShot: dur,
      labels: ['Shot 1'],
    };
  }

  let shotCount = Math.max(2, Math.min(3, Math.round(dur / preferred)));
  if (dur >= 12 && shotCount < 2) shotCount = 2;
  if (dur >= 14) shotCount = Math.min(3, shotCount);
  const secondsPerShot = Math.max(3, Math.round((dur / shotCount) * 10) / 10);
  const shotStructure: SeedanceShotStructure =
    shotCount >= 2 ? 'dense_multishot' : 'compact_single_take';
  const labels = Array.from({ length: shotCount }, (_, i) => `Shot ${i + 1}`);
  return { shotCount, shotStructure, secondsPerShot, labels };
}

/**
 * Build multishot prose body (Seedance labels Shot N:).
 * Each shot: one primary action + one camera move + sound cue.
 */
export function formatMultishotProse(opts: {
  plan: MultishotPlan;
  subject: string;
  actionBeats: string[];
  cameraStack: string;
  lighting: string;
  performance: string;
  style: string;
  refuse: string;
  i2vLead?: string;
}): string {
  const {
    plan,
    subject,
    actionBeats,
    cameraStack,
    lighting,
    performance,
    style,
    refuse,
    i2vLead = '',
  } = opts;

  if (plan.shotCount <= 1) {
    const beat = actionBeats[0] || 'one clear visible action completes';
    return [
      i2vLead + subject + '.',
      `Single continuous take (${plan.secondsPerShot}s), no cuts: ${beat}.`,
      `Camera: ${cameraStack}.`,
      `Lighting/Style: ${lighting}; ${style}.`,
      `Performance: ${performance}.`,
      `Sound: sparse ambient + one motivated cue.`,
      `Constraints: one subject focus; refuse ${refuse}; no time-skip montage.`,
    ]
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  // Distribute action text across shots
  const beats =
    actionBeats.length >= plan.shotCount
      ? actionBeats.slice(0, plan.shotCount)
      : padBeats(actionBeats, plan.shotCount);

  const cameraVariants = splitCameraStack(cameraStack, plan.shotCount);
  const parts: string[] = [];
  if (i2vLead) parts.push(i2vLead.trim());
  parts.push(
    `${subject}. ${plan.shotCount}-shot sequence (~${plan.secondsPerShot}s each). Style: ${style}.`,
  );

  for (let i = 0; i < plan.shotCount; i++) {
    parts.push(
      `${plan.labels[i]}: ${beats[i]}. Camera: ${cameraVariants[i]}. Performance: ${performance}. Sound: sparse ambient + one motivated cue for this shot.`,
    );
  }
  parts.push(
    `Constraints: label cuts as Shot N; one primary action per shot; refuse ${refuse}; keep identity locks; no future beats; stop when final shot endpoint is reached.`,
  );
  return parts.join(' ').replace(/\s{2,}/g, ' ').trim();
}

function padBeats(beats: string[], n: number): string[] {
  if (beats.length === 0) {
    return Array.from({ length: n }, (_, i) =>
      i === 0
        ? 'establish subject and space'
        : i === n - 1
          ? 'complete the beat with a clear endpoint'
          : 'advance the action one step',
    );
  }
  if (beats.length === 1) {
    const core = beats[0];
    return Array.from({ length: n }, (_, i) => {
      if (i === 0) return `Begin: ${core}`;
      if (i === n - 1) return `Endpoint: finish the beat — ${core}`;
      return `Continue the same action — ${core}`;
    });
  }
  const out = [...beats];
  while (out.length < n) out.push(beats[beats.length - 1]);
  return out.slice(0, n);
}

function splitCameraStack(stack: string, n: number): string[] {
  if (n <= 1) return [stack];
  // Progressive coverage: wide → medium → close (classic grammar)
  const cycle = [
    `wide or medium-wide establishing, ${stack}`,
    `medium shot, ${stack}`,
    `close-up or insert, ${stack}`,
  ];
  return Array.from({ length: n }, (_, i) => cycle[i % cycle.length]);
}

/** Split long action prose into beat-sized chunks for multishot. */
export function splitActionBeats(action: string, shotCount: number): string[] {
  const cleaned = (action || '').replace(/\s+/g, ' ').trim();
  if (shotCount <= 1) return [cleaned];
  const bySentence = cleaned.split(/(?<=[.!?…。！？;；])\s+/).filter(Boolean);
  if (bySentence.length >= shotCount) {
    return padBeats(bySentence, shotCount);
  }
  // Split by comma / dash for dense Vietnamese lines
  const byClause = cleaned.split(/[,，]|\s+-\s+/).map((s) => s.trim()).filter((s) => s.length > 8);
  if (byClause.length >= shotCount) return padBeats(byClause, shotCount);
  return padBeats([cleaned], shotCount);
}
