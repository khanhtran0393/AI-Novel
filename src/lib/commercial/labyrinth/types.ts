/**
 * Adversarial Labyrinth — multi-layer tamper surface (not a second license path).
 * One root cause (tamper/bypass), multiple surface layers for RE cost.
 * Legitimate users must get a single clear error — see cascade.ts.
 */

export const LABYRINTH_VERSION = 1 as const;

/** Root cause always the same for tamper cascade. */
export type TamperRootCode = 'INTEGRITY_OR_BYPASS';

/**
 * Surface layers shown to attackers (progressive).
 * T1 token → T2 integrity/canary → T3 dual-check → T4 heartbeat/ledger → T5 support lock.
 */
export type CascadeLayer = 1 | 2 | 3 | 4 | 5;

export type TamperStrength = 0 | 1 | 2 | 3 | 4;

export type TamperSignalCode =
  | 'CANARY_VERIFY_NOP'
  | 'KEYRING_INJECT'
  | 'KEYRING_PIN_MISS'
  | 'PACKAGED_MODE_OPEN'
  | 'PACKAGED_OWNER'
  | 'PACKAGED_SECRET_LEAK'
  | 'PACKAGED_HOST_OPEN'
  | 'INTEGRITY_FAIL'
  | 'SPLIT_BRAIN'
  | 'DECOY_UNLOCK_HIT'
  | 'DECOY_ENV_HIT'
  | 'CASCADE_DENY'
  | 'ANTI_TAMPER_FAIL'
  | 'MIRAGE_SERVED'
  | 'WRONG_PATH_RUN'
  | 'BYPASS_PROBE'
  | 'NODE_INJECT'
  | 'LICENSE_HOST'
  | 'MATRIX_PATCH'
  | 'CLOCK_TAMPER'
  | 'CLIENT_BYPASS';

export type FailOrigin =
  | 'integrity'
  | 'anti_tamper'
  | 'keyring'
  | 'token_verify'
  | 'pro_access'
  | 'feature_access'
  | 'heartbeat'
  | 'seat'
  | 'hwid_rebind'
  | 'recheck';

export type TamperSignal = {
  code: TamperSignalCode;
  strength: TamperStrength;
  origin?: FailOrigin;
  layer?: CascadeLayer;
  /** Short reason (no secrets / no project content) */
  detail?: string;
  ts: number;
};

export type LabyrinthSession = {
  key: string;
  attempt: number;
  maxStrength: TamperStrength;
  lastLayer: CascadeLayer;
  lastCode: TamperSignalCode | null;
  updatedAt: number;
};
