export type FlowAccountStatus =
  | 'idle'
  | 'connecting'
  | 'active'
  | 'cooldown'
  | 'error'
  | 'offline';

export type FlowTaskKind = 'image' | 'video' | 'extend' | 'edit';
export type FlowTaskStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled';

/** Video gen strategy inside queue */
export type FlowVideoMode = 'auto' | 't2v' | 'i2v' | 'ingredients' | 'extend';

export type FlowExecutionMode = 'parallel' | 'sequential';

export type RetryCategory =
  | 'token_401'
  | 'quota'
  | 'forbidden_403'
  | 'rate_429'
  | 'network'
  | 'content'
  | 'other';

/** Standard Google Flow gen progress steps (queue + UI). */
export type FlowTaskStep =
  | 'queued'
  | 'account'
  | 'captcha'
  | 'submit'
  | 'poll'
  | 'download'
  | 'saving'
  | 'done'
  | 'error';

export type FlowProjectInfo = {
  id: string;
  title: string;
  source: 'create' | 'capture' | 'manual';
  createdAt: number;
  updatedAt: number;
};

export type FlowAccount = {
  id: string;
  name: string;
  email?: string;
  /** Google display name from labs session */
  displayName?: string;
  projectId?: string;
  /** Projects bound to this profile (from sync/create on its session) */
  projects?: FlowProjectInfo[];
  /** chromium = clean Chromium/Ungoogled/Brave; mullvad = Firefox family */
  engine: 'chromium' | 'mullvad' | 'chrome';
  browserExe?: string;
  proxy?: string;
  status: FlowAccountStatus;
  flowKeyPresent: boolean;
  /**
   * True only after real labs session harvest (email present).
   * UI "Hoạt động" requires this — never green from stale/global token alone.
   */
  sessionVerified?: boolean;
  tokenAgeMs?: number | null;
  credits?: number | null;
  paygateTier?: string | null;
  sessionExpires?: string | null;
  lastSyncedAt?: number | null;
  /** Round-robin: last time this profile ran a gen task */
  lastTaskAt?: number | null;
  /** Live: Chrome process for this profile is running (snapshot only) */
  browserAlive?: boolean;
  /**
   * Live per-profile session (UI manages ALL of these on the card, not global):
   * Bridge / Extension / Token / Project / Login
   */
  bridgeRunning?: boolean;
  extensionConnected?: boolean;
  loginSessionOpen?: boolean;
  /** True when this profile has a projectId bound */
  projectReady?: boolean;
  /**
   * Chrome --user-data-dir for this profile (cookies/cache/fingerprint live here).
   * App inherits the whole browser session from this path.
   */
  profileDir?: string;
  /** Last successful full inherit (token+email+credits+projects from browser) */
  sessionInheritedAt?: number | null;
  /**
   * What this Google account can do — mirrored into app so UI/gen match Flow web.
   * Updated on inherit + after each gen task.
   */
  capabilities?: {
    canGenerateImage: boolean;
    canGenerateVideo: boolean;
    canUpload: boolean;
    canListProjects: boolean;
    paygateTier: string | null;
    credits: number | null;
    projectCount: number;
    flowKeyPresent: boolean;
    browserCookies: boolean;
    proxyParity: boolean;
    updatedAt: number;
  } | null;
  cooldownUntil?: number | null;
  lastError?: string | null;
  /** P3: 0–100 health (token age, errors, credits) */
  healthScore?: number | null;
  /** P3: soft credit budget for this account (null = unlimited) */
  creditBudget?: number | null;
  /** P3: estimated credits spent this session/day */
  creditsSpent?: number | null;
  /** P3: enable auto re-login on 401 for this profile */
  autoRelogin?: boolean;
  successCount?: number;
  failCount?: number;
  createdAt: number;
  updatedAt: number;
};

/** Live identity harvested from the parasitic browser session (same as Veo/Flow UI). */
export type FlowAccountIdentity = {
  email?: string;
  name?: string;
  image?: string;
  credits?: number | null;
  paygateTier?: string | null;
  sessionExpires?: string | null;
  lastSyncedAt?: number | null;
  projectCount?: number;
};

export type FlowTask = {
  id: string;
  kind: FlowTaskKind;
  status: FlowTaskStatus;
  prompt: string;
  accountId?: string;
  progress: number;
  /** Standard step for Google Flow runtime UX */
  step?: FlowTaskStep;
  /** VN progress line for UI */
  progressMessage?: string;
  error?: string;
  retryCategory?: RetryCategory;
  /** Storyboard coords */
  chapterNum?: number;
  sceneIndex?: number;
  promptIndex?: number;
  aspectRatio?: string;
  imageCount?: number;
  imageModel?: string;
  videoModel?: string;
  durationSec?: number;
  quality?: string;
  referenceImagePath?: string;
  startImagePath?: string;
  endImagePath?: string;
  /** P0: 1–3 local paths for ingredients-to-video */
  ingredientPaths?: string[];
  /** P0: extend from Flow media id or local video path resolved to media */
  extendMediaId?: string;
  extendVideoPath?: string;
  videoMode?: FlowVideoMode;
  /** P1: structured camera (serialized plain object) */
  camera?: {
    move?: string;
    angle?: string;
    focal?: string;
    scaleIndex?: number;
  };
  /** Estimated credits for budget accounting */
  estimatedCredits?: number;
  resultPaths?: string[];
  mediaIds?: string[];
  createdAt: number;
  updatedAt: number;
  attempts: number;
  /**
   * App-path finalize target (animatic filename under public/video).
   * Async generate-video sets this so poll can copy bridge output → UI path.
   */
  appSavePath?: string;
  /** Correlation id from Next request for structured logs */
  correlationId?: string;
  /** Pending jobs ahead of this task when enqueued (UI “còn X trước bạn”) */
  queueAhead?: number;
};

export type BridgeSnapshot = {
  running: boolean;
  wsPort: number;
  httpPort: number;
  extensionConnected: boolean;
  flowKeyPresent: boolean;
  /** Profile currently bound to the open Chrome/extension session */
  activeAccountId?: string | null;
  projectId?: string | null;
  projects?: FlowProjectInfo[];
  /** Real Google account identity from browser session */
  identity?: FlowAccountIdentity | null;
  tokenAgeMs?: number | null;
  /** True while visible login Chrome is open (waiting for Google login) */
  loginSessionOpen?: boolean;
  metrics?: {
    requestCount: number;
    successCount: number;
    failedCount: number;
    lastError?: string | null;
  };
  accounts: FlowAccount[];
  queue: {
    mode: FlowExecutionMode;
    running: boolean;
    pending: number;
    activeWorkers?: number;
    tasks: FlowTask[];
  };
};

export type ExtApiResponse = {
  id: string;
  status?: number;
  data?: unknown;
  error?: string;
  result?: unknown;
};
