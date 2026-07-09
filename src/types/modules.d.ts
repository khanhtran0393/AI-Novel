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

interface Window {
  ainovelPersist?: AinovelPersistApi;
}
