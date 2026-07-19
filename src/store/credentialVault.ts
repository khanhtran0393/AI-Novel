import type { StoreApi, UseBoundStore } from 'zustand';
import type { NovelStore, TTSConfig } from './novelTypes';

const CREDENTIAL_KEYS = [
  'apiKey',
  'apiKeys',
  'openaiApiKey',
  'openaiApiKeys',
  'grokApiKey',
  'grokApiKeys',
  'claudeApiKey',
  'claudeApiKeys',
  'lumaApiKey',
  'lumaApiKeys',
  'runwayApiKey',
  'runwayApiKeys',
  'falaiApiKey',
  'falaiApiKeys',
  'imageApiKey',
  'videoApiKey',
  'aiMasterApiKey',
  'googleStudioCookie',
  'googleStudioCookies',
  'tiktokSessionIds',
] as const;

type CredentialKey = (typeof CREDENTIAL_KEYS)[number];
type CredentialSnapshot = Partial<Pick<NovelStore, CredentialKey>> & {
  ttsSecrets?: Partial<TTSConfig>;
};

function api(): AinovelCredentialsApi | null {
  if (typeof window === 'undefined') return null;
  return window.ainovelCredentials || null;
}

function snapshotFromState(state: NovelStore): CredentialSnapshot {
  const snapshot: CredentialSnapshot = {};
  for (const key of CREDENTIAL_KEYS) {
    (snapshot as Record<string, unknown>)[key] = state[key];
  }
  snapshot.ttsSecrets = {
    tiktokSessionId: state.ttsConfig.tiktokSessionId,
    googleCloudApiKey: state.ttsConfig.googleCloudApiKey,
    vbeeApiKey: state.ttsConfig.vbeeApiKey,
    vbeeAppId: state.ttsConfig.vbeeAppId,
    vinaReferenceAudioB64: state.ttsConfig.vinaReferenceAudioB64,
  };
  return snapshot;
}

function patchFromSnapshot(
  current: NovelStore,
  snapshot: Record<string, unknown> | null | undefined,
): Partial<NovelStore> {
  if (!snapshot || typeof snapshot !== 'object') return {};
  const patch: Record<string, unknown> = {};
  for (const key of CREDENTIAL_KEYS) {
    const value = snapshot[key];
    if (value !== undefined && value !== null) patch[key] = value;
  }
  const ttsSecrets = snapshot.ttsSecrets;
  if (ttsSecrets && typeof ttsSecrets === 'object') {
    patch.ttsConfig = {
      ...current.ttsConfig,
      ...(ttsSecrets as Partial<TTSConfig>),
    };
  }
  return patch as Partial<NovelStore>;
}

export function installCredentialVault(
  store: UseBoundStore<StoreApi<NovelStore>>,
): void {
  const bridge = api();
  if (!bridge) return;

  try {
    const boot = bridge.getSync();
    const patch = patchFromSnapshot(store.getState(), boot);
    if (Object.keys(patch).length) store.setState(patch);
  } catch (error) {
    console.warn('[CredentialVault] hydrate failed:', error);
  }

  let lastSerialized = JSON.stringify(snapshotFromState(store.getState()));
  let timer: ReturnType<typeof setTimeout> | null = null;
  store.subscribe((state) => {
    const snapshot = snapshotFromState(state);
    const serialized = JSON.stringify(snapshot);
    if (serialized === lastSerialized) return;
    lastSerialized = serialized;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void bridge.set(snapshot as Record<string, unknown>).catch((error) => {
        console.warn('[CredentialVault] persist failed:', error);
      });
    }, 250);
  });
}
