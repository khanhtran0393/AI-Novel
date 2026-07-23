declare module 'tiktok-tts';
declare module 'fluent-ffmpeg';
declare module 'node-edge-tts';

interface AinovelPersistApi {
  storeKey: string;
  getStoreSync: () => string | null;
  setStore: (raw: string) => Promise<unknown>;
  setStoreSync: (raw: string) => { ok?: boolean; error?: string } | null;
  flush: () => Promise<unknown>;
  getPaths: () => Promise<Record<string, string>>;
  getBootInfo: () => {
    raw?: string | null;
    summary?: { score?: number };
    source?: string | null;
    paths?: Record<string, string> | null;
  };
  isElectron: boolean;
}

interface AinovelToolsApi {
  isElectron: boolean;
  writeTextFile: (payload: {
    relativePath: string;
    content: string;
    subdir?: string;
  }) => Promise<{ ok: boolean; path?: string; error?: string }>;
  setTtsQueue: (snapshot: unknown) => Promise<{ ok?: boolean; path?: string; error?: string }>;
  getTtsQueue: () => Promise<Record<string, unknown> | null>;
  openPath?: (targetPath: string) => Promise<{ ok?: boolean; error?: string }>;
}

interface AinovelCredentialsApi {
  isElectron: boolean;
  getSync: () => Record<string, unknown>;
  get: () => Promise<Record<string, unknown>>;
  set: (credentials: Record<string, unknown>) => Promise<{ ok?: boolean; error?: string }>;
}

interface AinovelUpdaterJustUpdated {
  fromVersion: string;
  toVersion: string;
  blocks?: Array<{
    version: string;
    date?: string;
    title?: string;
    items: string[];
  }>;
  items?: string[];
  releaseNotes?: string | null;
}

interface AinovelUpdaterApi {
  isElectron?: boolean;
  getStatus?: () => Promise<{
    justUpdated?: AinovelUpdaterJustUpdated | null;
    appVersion?: string;
    available?: boolean;
    downloaded?: boolean;
    version?: string | null;
    releaseNotes?: unknown;
    error?: string | null;
  }>;
  check?: () => Promise<unknown>;
  download?: () => Promise<unknown>;
  install?: () => Promise<unknown>;
  ackChangelog?: () => Promise<unknown>;
  onStatus?: (
    handler: (status: {
      justUpdated?: AinovelUpdaterJustUpdated | null;
    }) => void,
  ) => () => void;
}

interface Window {
  ainovelPersist?: AinovelPersistApi;
  ainovelTools?: AinovelToolsApi;
  ainovelCredentials?: AinovelCredentialsApi;
  ainovelUpdater?: AinovelUpdaterApi;
}
