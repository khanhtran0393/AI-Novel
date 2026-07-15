export type FlowAccountStatus =
  | 'idle'
  | 'connecting'
  | 'active'
  | 'cooldown'
  | 'error'
  | 'offline';

export type FlowTaskKind = 'image' | 'video';
export type FlowTaskStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled';

export type FlowExecutionMode = 'parallel' | 'sequential';

export type RetryCategory =
  | 'token_401'
  | 'quota'
  | 'forbidden_403'
  | 'rate_429'
  | 'network'
  | 'content'
  | 'other';

export type FlowAccount = {
  id: string;
  name: string;
  email?: string;
  projectId?: string;
  /** chromium = clean Chromium/Ungoogled/Brave; mullvad = Firefox family */
  engine: 'chromium' | 'mullvad' | 'chrome';
  browserExe?: string;
  status: FlowAccountStatus;
  flowKeyPresent: boolean;
  tokenAgeMs?: number | null;
  credits?: number | null;
  cooldownUntil?: number | null;
  lastError?: string | null;
  createdAt: number;
  updatedAt: number;
};

export type FlowTask = {
  id: string;
  kind: FlowTaskKind;
  status: FlowTaskStatus;
  prompt: string;
  accountId?: string;
  progress: number;
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
  resultPaths?: string[];
  mediaIds?: string[];
  createdAt: number;
  updatedAt: number;
  attempts: number;
};

export type BridgeSnapshot = {
  running: boolean;
  wsPort: number;
  httpPort: number;
  extensionConnected: boolean;
  flowKeyPresent: boolean;
  projectId?: string | null;
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
