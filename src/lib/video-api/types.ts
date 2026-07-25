/**
 * External video API platforms — auto-detect + generate adapters.
 * Style/routing only for BYOK providers (HeyGen, Luma, Runway, …).
 * Flow stays separate (browser bridge).
 */

export type VideoApiProviderId =
  | 'heygen'
  | 'luma'
  | 'runway'
  | 'fal'
  | 'sora'
  | 'veo'
  | 'grok'
  | 'unknown';

export type VideoApiDetectMethod = 'base_url' | 'heuristic' | 'probe' | 'manual';

export type VideoApiDetectResult = {
  providerId: VideoApiProviderId;
  label: string;
  confidence: 'high' | 'medium' | 'low';
  method: VideoApiDetectMethod;
  baseUrl: string;
  /** Default model id for this platform (if any) */
  defaultModel: string;
  /** Suggested duration options (seconds) */
  durationsSec: number[];
  /** Auth header style hint */
  authStyle: 'x-api-key' | 'bearer' | 'api-key' | 'unknown';
  /** Probe / heuristic notes for UI */
  message: string;
  /** true when live probe accepted the key */
  verified: boolean;
};

export type ExternalVideoApiEntry = {
  id: string;
  /** User-facing label */
  label: string;
  providerId: VideoApiProviderId;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  detectedBy?: VideoApiDetectMethod;
  lastVerifiedAt?: number;
  status?: 'ok' | 'fail' | 'unknown';
};

export type ExternalVideoGenerateInput = {
  providerId: VideoApiProviderId;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  prompt: string;
  durationSec: number;
  aspectRatio: string;
  /** Public HTTPS URL when I2V is supported */
  publicImageUrl?: string | null;
  timeoutMs?: number;
};

export type ExternalVideoGenerateResult = {
  bytes: Buffer;
  method: string;
  jobId?: string;
  videoUrl?: string;
};
