/**
 * Shared h264_nvenc argv fragments for Phantom-X / video helpers.
 * Presets: modern p1–p7 preferred; probe may report 'hq' for older builds.
 */

export type NvencEncodeMode = 'quality' | 'turbo';

export type NvencEncodeOpts = {
  mode: NvencEncodeMode;
  /** CQ value (string or number) */
  cq: string | number;
  /** B-frames 0–3 (0 if probe bf2 failed) */
  bf: number;
  /** From probe: 'p6' | 'p4' | 'hq' … */
  presetHint?: string | null;
};

/**
 * Build encoder args AFTER '-c:v' (caller pushes '-c:v', 'h264_nvenc' first).
 */
export function buildH264NvencArgs(opts: NvencEncodeOpts): string[] {
  const cq = String(opts.cq);
  const bf = Math.max(0, Math.min(3, Math.round(opts.bf)));
  const hint = String(opts.presetHint || '').toLowerCase();

  if (opts.mode === 'turbo') {
    const preset =
      hint === 'hq' || hint === 'll' || hint === 'llhq' ? 'hq' : hint.startsWith('p') ? hint : 'p6';
    return [
      '-preset',
      preset,
      '-rc',
      'vbr',
      '-cq',
      cq,
      '-b:v',
      '0',
      '-maxrate',
      '5000k',
      '-bufsize',
      '10000k',
      '-bf',
      String(bf),
    ];
  }

  // Quality
  const preset =
    hint === 'hq' || hint === 'll' || hint === 'llhq'
      ? 'hq'
      : hint === 'p6' || hint === 'p5' || hint === 'p7'
        ? hint
        : 'p4';

  const args = [
    '-preset',
    preset,
    '-rc',
    'vbr',
    '-cq',
    cq,
    '-b:v',
    '0',
    '-maxrate',
    '12000k',
    '-bufsize',
    '24000k',
    '-bf',
    String(bf),
  ];

  // Only add tune/aq for modern p-presets (older hq path may ignore/fail)
  if (preset.startsWith('p')) {
    args.push('-tune', 'hq', '-spatial-aq', '1', '-temporal-aq', '1');
  }

  return args;
}
