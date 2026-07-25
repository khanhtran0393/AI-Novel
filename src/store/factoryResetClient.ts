/**
 * Client-side extras wiped by **Xóa tất cả / App mới tinh**.
 * Never removes commercial plan token (`ainovel.entitlementToken`).
 */

const ENTITLEMENT_LS_KEY = 'ainovel.entitlementToken';

/** Known app localStorage keys (besides Zustand store) — wipe on factory reset. */
const EXTRA_LS_KEYS = [
  'ainovel.nvencDriverPending',
  'ainovel.pipeline.quality.v1',
  'ainovel.pipeline.foreshadow.v1',
  'ainovel.pipeline.memoryPack.v1',
  'ainovel.pipeline.longform.v1',
  'ainovel.pipeline.arcFlags.v1',
  'ainovel_flow_video_quality',
  'ainovel_flow_image_quality',
  'ainovel.forcePro',
  'ainovel.crack',
  'ainovel.bypass',
  'pro_unlocked',
  'ainovel.supabase.access_token',
] as const;

/**
 * Clear Electron DPAPI credential vault (API keys / cookies / TTS secrets).
 * No-op in pure web without bridge.
 */
export async function clearCredentialVault(): Promise<void> {
  if (typeof window === 'undefined') return;
  const bridge = window.ainovelCredentials;
  if (!bridge?.set) return;
  try {
    await bridge.set({
      apiKey: '',
      apiKeys: [],
      openaiApiKey: '',
      openaiApiKeys: [],
      grokApiKey: '',
      grokApiKeys: [],
      claudeApiKey: '',
      claudeApiKeys: [],
      lumaApiKey: '',
      lumaApiKeys: [],
      runwayApiKey: '',
      runwayApiKeys: [],
      falaiApiKey: '',
      falaiApiKeys: [],
      imageApiKey: '',
      videoApiKey: '',
      videoApiBaseUrl: '',
      externalVideoApis: [],
      activeExternalVideoApiId: '',
      aiMasterApiKey: '',
      googleStudioCookie: '',
      googleStudioCookies: [],
      tiktokSessionIds: [],
      ttsSecrets: {
        tiktokSessionId: '',
        googleCloudApiKey: '',
        vbeeApiKey: '',
        vbeeAppId: '',
        vinaReferenceAudioB64: '',
      },
    });
  } catch (e) {
    console.warn('[factoryReset] credential vault clear failed:', e);
  }
}

/**
 * Remove non-store local extras. **Keeps** entitlement token (plan mode).
 */
export function clearAppLocalExtrasKeepEntitlement(): void {
  if (typeof window === 'undefined') return;
  try {
    for (const key of EXTRA_LS_KEYS) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    }
    // Sweep leftover ainovel.* except plan token + main zustand store (rewritten by factory action)
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k) continue;
      if (k === ENTITLEMENT_LS_KEY) continue;
      if (k === 'novel_generator_v2_store') continue;
      if (
        k.startsWith('ainovel.') ||
        k.startsWith('ainovel_') ||
        k === 'pro_unlocked'
      ) {
        doomed.push(k);
      }
    }
    for (const k of doomed) {
      try {
        window.localStorage.removeItem(k);
      } catch {
        /* ignore */
      }
    }
  } catch (e) {
    console.warn('[factoryReset] local extras clear failed:', e);
  }
}
