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
  'videoApiBaseUrl',
  'externalVideoApis',
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

/** Cheap identity check — avoid JSON.stringify on every non-credential setState (GUI lag). */
function credentialsUnchanged(
  state: NovelStore,
  prev: CredentialSnapshot | null,
): boolean {
  if (!prev) return false;
  for (const key of CREDENTIAL_KEYS) {
    if (state[key] !== prev[key]) return false;
  }
  const t = prev.ttsSecrets || {};
  const c = state.ttsConfig;
  return (
    c.tiktokSessionId === t.tiktokSessionId &&
    c.googleCloudApiKey === t.googleCloudApiKey &&
    c.vbeeApiKey === t.vbeeApiKey &&
    c.vbeeAppId === t.vbeeAppId &&
    c.vinaReferenceAudioB64 === t.vinaReferenceAudioB64
  );
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

  let lastSnap: CredentialSnapshot | null = snapshotFromState(store.getState());
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Debounce vault IPC — typing/stream setState must not thrash credentials disk. */
  const VAULT_DEBOUNCE_MS = 800;
  store.subscribe((state) => {
    if (credentialsUnchanged(state, lastSnap)) return;
    const snapshot = snapshotFromState(state);
    lastSnap = snapshot;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void bridge.set(snapshot as Record<string, unknown>).catch((error) => {
        console.warn('[CredentialVault] persist failed:', error);
      });
    }, VAULT_DEBOUNCE_MS);
  });
}
