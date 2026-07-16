/**
 * Structured camera / shot scale → English prompt suffix (P1).
 * Does not replace user prompt — appends cinematic directives.
 */

export type CameraMove =
  | 'static'
  | 'pan_left'
  | 'pan_right'
  | 'tilt_up'
  | 'tilt_down'
  | 'dolly_in'
  | 'dolly_out'
  | 'orbit'
  | 'crane'
  | 'handheld';

export type CameraAngle =
  | 'eye'
  | 'low'
  | 'high'
  | 'bird'
  | 'dutch'
  | 'over_shoulder';

export type CameraFocal = 'wide' | 'normal' | 'tele' | 'macro';

export type CameraShot = {
  move?: CameraMove;
  angle?: CameraAngle;
  focal?: CameraFocal;
  /** Shot scale index: 0=ECU … 5=ELS (YouTube shot graph) */
  scaleIndex?: number;
};

const MOVE_TEXT: Record<CameraMove, string> = {
  static: 'locked-off tripod, stable frame',
  pan_left: 'slow pan left',
  pan_right: 'slow pan right',
  tilt_up: 'gentle tilt up',
  tilt_down: 'gentle tilt down',
  dolly_in: 'smooth dolly-in push toward subject',
  dolly_out: 'smooth dolly-out pull away',
  orbit: 'subtle orbital arc around subject',
  crane: 'crane rise revealing environment',
  handheld: 'subtle handheld micro-motion, documentary feel',
};

const ANGLE_TEXT: Record<CameraAngle, string> = {
  eye: 'eye-level camera',
  low: 'low-angle hero framing',
  high: 'high-angle downward look',
  bird: "bird's-eye top-down",
  dutch: 'slight dutch tilt for tension',
  over_shoulder: 'over-the-shoulder framing',
};

const FOCAL_TEXT: Record<CameraFocal, string> = {
  wide: 'wide-angle lens, environmental context',
  normal: 'standard 35–50mm look',
  tele: 'telephoto compression, shallow depth',
  macro: 'tight macro detail',
};

const SCALE_TEXT = [
  'extreme close-up (ECU)',
  'close-up (CU)',
  'medium close-up (MCU)',
  'medium shot (MS)',
  'wide / full shot',
  'extreme long shot (ELS)',
] as const;

export function cameraShotToEnglish(cam?: CameraShot | null): string {
  if (!cam) return '';
  const parts: string[] = [];
  if (cam.move && MOVE_TEXT[cam.move]) parts.push(MOVE_TEXT[cam.move]);
  if (cam.angle && ANGLE_TEXT[cam.angle]) parts.push(ANGLE_TEXT[cam.angle]);
  if (cam.focal && FOCAL_TEXT[cam.focal]) parts.push(FOCAL_TEXT[cam.focal]);
  if (
    typeof cam.scaleIndex === 'number' &&
    cam.scaleIndex >= 0 &&
    cam.scaleIndex < SCALE_TEXT.length
  ) {
    parts.push(SCALE_TEXT[cam.scaleIndex]);
  }
  if (!parts.length) return '';
  return `Camera: ${parts.join('; ')}.`;
}

/** Append camera block once; avoid doubling if already present. */
export function applyCameraToPrompt(
  prompt: string,
  cam?: CameraShot | null,
): string {
  const base = String(prompt || '').trim();
  const camLine = cameraShotToEnglish(cam);
  if (!camLine) return base;
  if (/camera\s*:/i.test(base)) return base;
  return base ? `${base}\n${camLine}` : camLine;
}

/** Infer light camera from shot index when user did not set camera. */
export function cameraFromScaleIndex(scaleIndex: number): CameraShot {
  const i = Math.max(0, Math.min(5, Math.floor(scaleIndex)));
  const focal: CameraFocal =
    i <= 1 ? 'tele' : i >= 4 ? 'wide' : 'normal';
  const move: CameraMove =
    i === 0 ? 'static' : i >= 4 ? 'dolly_out' : 'dolly_in';
  return { scaleIndex: i, focal, move, angle: 'eye' };
}
