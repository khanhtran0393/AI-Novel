/**
 * AI Novel Flow Bridge — Chrome Extension Background Service Worker
 *
 * Connects to local AI Novel bridge via WebSocket (bridge runs WS server).
 * Captures bearer token, executes normal reCAPTCHA Enterprise tokens from the
 * authenticated Flow page, and pauses for human verification on google.com/sorry.
 */

importScripts('tabGuard.js');

// AI Novel Flow Bridge — ports offset from stock Flow Agent (9222/8100)
const AGENT_WS_URL = 'ws://127.0.0.1:9223';
const BRIDGE_BUILD = '2026-07-24-video-xhr-sw-fallback';
// NOTE: This is a browser-restricted public API key — safe to ship in extension bundles.
const API_KEY = 'AIzaSyBtrm0o5ab1c-Ec8ZuLcGt3oJAA5VWt3pY';

let ws = null;
let flowKey = null;
let callbackSecret = null;  // Auth secret for HTTP callback, received from server on WS connect
let state = 'off'; // off | idle | running
let manualDisconnect = false;
let metrics = {
  tokenCapturedAt: null,
  requestCount: 0,   // captcha-consuming requests only (gen image/video/upscale)
  successCount: 0,
  failedCount: 0,
  lastError: null,
};

// ─── URL → Log Type Classifier ─────────────────────────────

// Visible log types — only these appear in the request log
const _VISIBLE_TYPES = new Set(['GEN_IMG', 'GEN_VID', 'GEN_VID_REF', 'UPSCALE', 'TRACKING', 'URL_REFRESH']);

function _classifyApiUrl(url) {
  if (url.includes('uploadImage'))                     return 'UPLOAD';
  if (url.includes('batchGenerateImages'))              return 'GEN_IMG';
  if (url.includes('UpsampleVideo'))                   return 'UPSCALE';
  if (url.includes('ReferenceImages'))                 return 'GEN_VID_REF';
  if (url.includes('batchAsyncGenerateVideo'))          return 'GEN_VID';
  if (url.includes('batchCheckAsync'))                  return 'POLL';
  if (url.includes('upsampleImage'))                   return 'UPS_IMG';
  if (url.includes('/media/'))                         return 'MEDIA';
  if (url.includes('/credits'))                        return 'CREDITS';
  return 'API';
}

// ─── Request Log ────────────────────────────────────────────

let requestLog = [];

function addRequestLog(entry) {
  requestLog.unshift(entry);
  if (requestLog.length > 100) requestLog.pop();
  broadcastRequestLog();
}

function updateRequestLog(id, updates) {
  const entry = requestLog.find((e) => e.id === id);
  if (entry) Object.assign(entry, updates);
  broadcastRequestLog();
}

function broadcastRequestLog() {
  chrome.runtime.sendMessage({ type: 'REQUEST_LOG_UPDATE', log: requestLog }).catch(() => {});
}

// ─── Startup ────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'reconnect') connectToAgent();
  if (alarm.name === 'keepAlive') keepAlive();
  if (alarm.name === 'token-refresh') {
    await captureTokenFromFlowTab();
  }
  if (alarm.name === 'token-harvest') {
    if (!flowKey) {
      // Never open a new tab from alarm — user may be mid Google login
      await forceTokenHarvest({ allowOpenTab: false, reloadIfMissing: false });
    } else {
      chrome.alarms.clear('token-harvest');
    }
  }
});

const FLOW_TAB_URL = 'https://labs.google/fx/tools/flow';
const FLOW_TAB_PATTERNS = [
  'https://labs.google/fx/tools/flow*',
  'https://labs.google/fx/*/tools/flow*',
];
let _flowTabOpenPromise = null;
let _openingFlowTab = false;
let _initPromise = null;
let _lastAuthReloadAt = 0;
const HIDDEN_FLOW_WINDOW_BOUNDS = {
  left: -32000,
  top: -32000,
  width: 900,
  height: 700,
};

/** Captcha / bot interstitial only */
async function queryGoogleChallengeTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs.filter((tab) =>
    [tab.url, tab.pendingUrl].some((value) =>
      String(value || '').toLowerCase().includes('google.com/sorry'),
    ),
  );
}

/**
 * Soft-wake a tab/window for automation WITHOUT stealing OS focus.
 * Login path parks Chromium off-screen / minimized — page XHR dies there.
 * Normal gen must not flash the browser over the AI Novel window every shot.
 *
 * @param {number} tabId
 * @param {{ stealFocus?: boolean }} opts  stealFocus=true only for human captcha /sorry/
 */
async function wakeTabForAutomation(tabId, { stealFocus = false } = {}) {
  if (tabId == null) return false;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.windowId == null) return false;
    let win = null;
    try {
      win = await chrome.windows.get(tab.windowId);
    } catch {
      win = null;
    }
    if (stealFocus) {
      // Human captcha path only.
      await chrome.windows
        .update(tab.windowId, {
          focused: true,
          state: 'normal',
          left: 80,
          top: 60,
          width: 1100,
          height: 820,
        })
        .catch(async () => {
          await chrome.windows
            .update(tab.windowId, {
              focused: true,
              state: 'normal',
            })
            .catch(() => {});
        });
    } else if (win) {
      await chrome.windows
        .update(tab.windowId, {
          focused: false,
          state: 'normal',
          ...HIDDEN_FLOW_WINDOW_BOUNDS,
        })
        .catch(async () => {
          await chrome.windows
            .update(tab.windowId, { focused: false, state: 'minimized' })
            .catch(() => {});
        });
    }
    // Keep the Flow tab active inside its hidden window so page XHR stays alive.
    if (stealFocus || win) {
      await chrome.tabs.update(tabId, { active: true }).catch(() => {});
    }
    return true;
  } catch {
    return false;
  }
}

/** Bring Chromium to foreground — human captcha /sorry/ only. */
async function focusTabAndWindow(tabId) {
  return wakeTabForAutomation(tabId, { stealFocus: true });
}

function broadcastChallengeStatus(payload) {
  try {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'challenge_status',
          ...payload,
          at: Date.now(),
        }),
      );
    }
  } catch {
    /* ignore */
  }
}

/**
 * Resolve Google /sorry/ interstitial (checkbox / image reCAPTCHA).
 * 1) Restore + focus Chromium window
 * 2) Wait for the user to complete verification on the real browser profile
 *
 * AI Novel deliberately does not auto-click or solve Google /sorry/ challenges.
 * Healthy sessions continue by obtaining normal Enterprise tokens from Flow.
 */
async function resolveGoogleChallenge({
  timeoutMs = 180_000,
} = {}) {
  const start = Date.now();
  let tabs = await queryGoogleChallengeTabs();
  if (!tabs.length) {
    return { ok: true, resolved: false, reason: 'no_challenge', waitedMs: 0 };
  }

  const primaryId = tabs[0]?.id;
  // Human may need to tick image captcha — only THIS path steals focus.
  await focusTabAndWindow(primaryId);
  broadcastChallengeStatus({
    challengeRequired: true,
    message:
      'GOOGLE_SORRY_CHALLENGE — xác minh "Tôi không phải là người máy" trên cửa sổ Chromium của app, rồi chờ app tự resume.',
    tabId: primaryId,
  });

  // DOM / iframe load lag on cold /sorry/
  await sleep(2200);

  // Poll until interstitial is gone (redirect back to Flow / labs)
  let lastRefocus = 0;
  while (Date.now() - start < timeoutMs) {
    tabs = await queryGoogleChallengeTabs();
    if (!tabs.length) {
      await sleep(1500);
      // Confirm still clear
      tabs = await queryGoogleChallengeTabs();
      if (!tabs.length) {
        broadcastChallengeStatus({
          challengeRequired: false,
          message: 'challenge_cleared',
          waitedMs: Date.now() - start,
        });
        console.log(
          `[AI Novel Flow] Google /sorry/ cleared in ${Date.now() - start}ms`,
        );
        return {
          ok: true,
          resolved: true,
          waitedMs: Date.now() - start,
          method: 'human_verified',
        };
      }
    }

    const now = Date.now();
    if (now - lastRefocus > 18_000) {
      lastRefocus = now;
      const tid = tabs[0]?.id;
      await focusTabAndWindow(tid);
      broadcastChallengeStatus({
        challengeRequired: true,
        message:
          'Đang chờ xác minh reCAPTCHA trên google.com/sorry — hãy thao tác thủ công trong cửa sổ Chromium của app.',
        tabId: tid,
        waitedMs: now - start,
      });
    }

    await sleep(1800);
  }

  const stuck = await queryGoogleChallengeTabs();
  if (stuck[0]?.id != null) await focusTabAndWindow(stuck[0].id);
  broadcastChallengeStatus({
    challengeRequired: true,
    message: 'GOOGLE_CHALLENGE_TIMEOUT',
    waitedMs: Date.now() - start,
  });
  return {
    ok: false,
    resolved: false,
    error: 'GOOGLE_CHALLENGE_TIMEOUT',
    message:
      'Trang google.com/sorry vẫn còn sau thời gian chờ. Hãy tick "Tôi không phải là người máy" (và captcha ảnh nếu có) trên cửa sổ Chromium, rồi gen lại.',
    waitedMs: Date.now() - start,
  };
}

/**
 * User is mid Google sign-in (OAuth / account chooser / password).
 * The original Flow tab often navigates HERE — queryFlowTabs becomes empty.
 * Opening a NEW Flow tab mid-login steals focus and confuses the user.
 */
function isGoogleAuthUrl(raw) {
  const u = String(raw || '').toLowerCase();
  if (!u) return false;
  if (u.includes('google.com/sorry')) return true;
  if (u.includes('accounts.google.com')) return true;
  if (u.includes('accounts.youtube.com')) return true;
  if (u.includes('google.com/signin')) return true;
  if (u.includes('google.com/accountchooser')) return true;
  if (u.includes('oauth') && u.includes('google.')) return true;
  if (u.includes('googleapis.com/auth')) return true;
  // Chrome identity intermediate
  if (u.includes('chromewebdata') && u.includes('accounts')) return true;
  return false;
}

async function queryGoogleAuthTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs.filter((tab) =>
    [tab.url, tab.pendingUrl, tab.title].some((value) => isGoogleAuthUrl(value)),
  );
}

async function reloadFlowTabForAuth(tabId) {
  const now = Date.now();
  if (now - _lastAuthReloadAt < 60_000) return false;
  // Never reload a tab that is on Google login
  try {
    const tab = await chrome.tabs.get(tabId);
    if (isGoogleAuthUrl(tab?.url) || isGoogleAuthUrl(tab?.pendingUrl)) {
      console.log('[AI Novel Flow] skip reload — tab is Google login');
      return false;
    }
  } catch {
    /* ignore */
  }
  _lastAuthReloadAt = now;
  await chrome.tabs.reload(tabId);
  return true;
}

async function queryFlowTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs.filter((tab) => {
    const signals = [tab.url, tab.pendingUrl, tab.title]
      .map((value) => String(value || '').toLowerCase());
    return signals.some(
      (value) =>
        value.includes('labs.google/fx/tools/flow') ||
        (value.includes('labs.google/fx/') && value.includes('/tools/flow')) ||
        value.includes('google flow - ai creative studio') ||
        // broader: any Flow studio surface (project, home) counts as "already open"
        (value.includes('labs.google') && value.includes('flow')),
    );
  });
}

async function dedupeFlowTabs(tabs) {
  if (!Array.isArray(tabs) || tabs.length <= 1) return tabs || [];
  const keep =
    tabs.find((tab) => tab.active) ||
    tabs.find((tab) => tab.status === 'complete') ||
    tabs[0];
  const duplicateIds = tabs
    .filter((tab) => tab.id !== keep.id)
    .map((tab) => tab.id)
    .filter((id) => Number.isInteger(id));
  if (duplicateIds.length) {
    await chrome.tabs.remove(duplicateIds).catch((error) =>
      console.warn('[AI Novel Flow] close duplicate Flow tabs failed', error),
    );
    console.log(
      `[AI Novel Flow] Closed ${duplicateIds.length} duplicate Flow tab(s); kept tab=${keep.id}`,
    );
  }
  return [keep];
}

/**
 * Launcher and service-worker startup can race while Chromium is registering
 * the command-line Flow tab. Share one open attempt, wait, then de-duplicate.
 *
 * @param {{ active?: boolean, allowCreate?: boolean, resolveChallenge?: boolean, challengeTimeoutMs?: number }} opts
 *   allowCreate=false → never open a new tab (login / init / status poll)
 *   When Google auth tabs exist → NEVER create (user mid-login).
   *   resolveChallenge=true → focus + wait for the user to clear /sorry/ (gen path).
 */
async function ensureSingleFlowTab({
  active = false,
  allowCreate = true,
  resolveChallenge = false,
  challengeTimeoutMs = 180_000,
} = {}) {
  if (_flowTabOpenPromise) return _flowTabOpenPromise;
  _flowTabOpenPromise = (async () => {
    let challengeTabs = await queryGoogleChallengeTabs();
    if (challengeTabs.length) {
      if (resolveChallenge) {
        // Human path: focus + wait (only when gen needs it).
        console.log('[AI Novel Flow] sorry-challenge-resolve start');
        const resolved = await resolveGoogleChallenge({
          timeoutMs: challengeTimeoutMs,
        });
        if (!resolved.ok) {
          throw new Error(resolved.error || 'GOOGLE_CHALLENGE_REQUIRED');
        }
        challengeTabs = await queryGoogleChallengeTabs();
      } else {
        // Status/check path: report only. Do NOT auto-click/retry CAPTCHA here;
        // repeated background checks can make Google's /sorry/ risk loop worse.
        await wakeTabForAutomation(challengeTabs[0]?.id, {
          stealFocus: false,
        }).catch(() => {});
        broadcastChallengeStatus({
          challengeRequired: true,
          message:
            'GOOGLE_CHALLENGE_REQUIRED — mở cửa sổ Chromium của app và xác minh thủ công trước khi Sync/gen lại.',
          tabId: challengeTabs[0]?.id,
        });
      }
      if (challengeTabs.length && !resolveChallenge) {
        const existing = await dedupeFlowTabs(await queryFlowTabs());
        if (existing.length) return existing;
        throw new Error('GOOGLE_CHALLENGE_REQUIRED');
      }
      if ((await queryGoogleChallengeTabs()).length) {
        throw new Error('GOOGLE_CHALLENGE_REQUIRED');
      }
    }

    // Mid Google login on this profile → never open a second Flow tab
    const authTabs = await queryGoogleAuthTabs();
    if (authTabs.length) {
      console.log(
        `[AI Novel Flow] Google login in progress (${authTabs.length} tab) — skip open new Flow tab`,
      );
      let tabs = await queryFlowTabs();
      tabs = await dedupeFlowTabs(tabs);
      // Prefer keeping focus on the login tab, not a background Flow tab
      if (active && authTabs[0]?.id != null) {
        await chrome.tabs
          .update(authTabs[0].id, { active: true })
          .catch(() => {});
      }
      return tabs;
    }

    let tabs = await queryFlowTabs();
    if (!tabs.length) {
      await sleep(2500);
      tabs = await globalThis.AINOVEL_FLOW_TAB_GUARD.waitForExistingFlowTabs(
        queryFlowTabs,
        sleep,
        { attempts: 12, intervalMs: 250 },
      );
    }
    // Re-check auth after wait (user may have clicked Login during wait)
    const authAfterWait = await queryGoogleAuthTabs();
    if (authAfterWait.length) {
      console.log(
        '[AI Novel Flow] Google login appeared during wait — skip open new Flow tab',
      );
      return dedupeFlowTabs(await queryFlowTabs());
    }

    if (!tabs.length && allowCreate) {
      console.log('[AI Novel Flow] No Flow tab — creating one (allowCreate)');
      let created = null;
      try {
        created = await chrome.tabs.create({ url: FLOW_TAB_URL, active });
      } catch (error) {
        const message = String(error?.message || error || '');
        if (!/No current window/i.test(message)) throw error;
        // The extension worker may stay connected after Chromium's final
        // window closes. Recover a real window before the captcha/gen path.
        console.warn(
          '[AI Novel Flow] Extension alive without a window - creating a recovery window',
        );
        const recoveredWindow = await chrome.windows.create(
          active
            ? {
                url: FLOW_TAB_URL,
                focused: true,
                state: 'normal',
                type: 'normal',
                width: 1100,
                height: 820,
                left: 80,
                top: 60,
              }
            : {
                url: FLOW_TAB_URL,
                focused: false,
                state: 'normal',
                type: 'normal',
                ...HIDDEN_FLOW_WINDOW_BOUNDS,
              },
        );
        created = recoveredWindow?.tabs?.[0] || null;
      }
      tabs = created ? [created] : [];
      await sleep(1500);
      const registered = await queryFlowTabs();
      if (registered.length) tabs = registered;
    } else if (!tabs.length && !allowCreate) {
      console.log(
        '[AI Novel Flow] No Flow tab and allowCreate=false — not opening',
      );
    }
    tabs = await dedupeFlowTabs(tabs);
    if (active && tabs[0]?.id != null) {
      await chrome.tabs.update(tabs[0].id, { active: true }).catch(() => {});
    }
    return tabs;
  })();
  try {
    return await _flowTabOpenPromise;
  } finally {
    _flowTabOpenPromise = null;
  }
}

/**
 * Harvest session/token.
 * IMPORTANT: bare flowKey without labs session email is NOT "done" —
 * keep polling so Google login can complete (do not early-return on stale ya29).
 * During Google login: poll only — never open/reload a second Flow tab.
 */
async function forceTokenHarvest({
  reloadIfMissing = true,
  allowOpenTab = true,
} = {}) {
  console.log('[AI Novel Flow] forceTokenHarvest…', {
    reloadIfMissing,
    allowOpenTab,
  });
  let session = await pollSessionAndNotify();
  const hasEmail = !!(session?.email && String(session.email).includes('@'));

  if (flowKey && hasEmail) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'token_captured',
          flowKey,
          email: session.email,
        }),
      );
    }
    return { ok: true, flowKeyPresent: true, email: session.email || '' };
  }

  // User mid Google OAuth — only poll, do not open/focus a new Flow tab
  const authTabs = await queryGoogleAuthTabs();
  if (authTabs.length) {
    console.log(
      '[AI Novel Flow] forceTokenHarvest: login in progress — poll only',
    );
    for (let i = 0; i < 4; i++) {
      session = await pollSessionAndNotify();
      if (session?.email && String(session.email).includes('@')) break;
      await sleep(1200);
    }
    return {
      ok: true,
      flowKeyPresent: !!flowKey,
      email: session?.email || '',
      loginInProgress: true,
    };
  }

  let tabs = [];
  try {
    tabs = await ensureSingleFlowTab({
      active: false, // never steal focus from user during harvest
      allowCreate: allowOpenTab,
    });
  } catch (e) {
    if (String(e?.message || e).includes('GOOGLE_CHALLENGE')) {
      return {
        ok: false,
        flowKeyPresent: !!flowKey,
        email: session?.email || '',
        challengeRequired: true,
      };
    }
    console.warn('[AI Novel Flow] ensureSingleFlowTab', e);
  }

  if (!tabs.length) {
    console.warn(
      '[AI Novel Flow] Flow tab unavailable (login may still be in progress)',
    );
  } else {
    try {
      // Never reload during harvest if tab might be mid-auth navigation
      const tabUrl = String(tabs[0].url || tabs[0].pendingUrl || '');
      if (
        !flowKey &&
        reloadIfMissing &&
        tabs[0]?.id != null &&
        !isGoogleAuthUrl(tabUrl) &&
        tabUrl.includes('labs.google')
      ) {
        const reloaded = await reloadFlowTabForAuth(tabs[0].id);
        if (reloaded) await sleep(4500);
      }
      if (tabs[0]?.id != null && !isGoogleAuthUrl(tabUrl)) {
        await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          files: ['content.js'],
        });
      }
    } catch {
      /* ignore */
    }
  }

  // Retry session a few times while user may still be finishing login
  for (let i = 0; i < 4; i++) {
    session = await pollSessionAndNotify();
    if (session?.email && String(session.email).includes('@')) break;
    await sleep(1200);
  }

  if (flowKey && ws?.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: 'token_captured',
        flowKey,
        email: session?.email || '',
      }),
    );
  }
  return {
    ok: true,
    flowKeyPresent: !!flowKey,
    email: session?.email || '',
  };
}

async function init() {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    const data = await chrome.storage.local.get(['flowKey', 'metrics', 'callbackSecret']);
    if (data.flowKey) flowKey = data.flowKey;
    if (data.metrics) Object.assign(metrics, data.metrics);
    if (data.callbackSecret) callbackSecret = data.callbackSecret;
    connectToAgent();
    chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });
    // CLI already opens Flow URL — wait/dedupe only. NEVER create a 2nd tab on boot
    // (creating here races with user login redirect → extra tab).
    try {
      await ensureSingleFlowTab({ active: false, allowCreate: false });
    } catch (e) {
      console.warn('[AI Novel Flow] init ensure tab', e?.message || e);
    }
  })();
  try {
    return await _initPromise;
  } finally {
    _initPromise = null;
  }
}

// ─── Token Capture ──────────────────────────────────────────

function acceptBearerToken(raw, source) {
  if (!raw || typeof raw !== 'string') return false;
  const token = raw.replace(/^Bearer\s+/i, '').trim();
  // Match the working FlowAgent: generation bearer is captured from real Flow
  // API traffic and has Google's ya29 form. Do not substitute NextAuth tokens.
  if (!token.startsWith('ya29.') || token.length < 20) return false;
  if (token === flowKey) {
    // still refresh age
    metrics.tokenCapturedAt = Date.now();
    chrome.storage.local.set({ metrics });
    return true;
  }
  flowKey = token;
  metrics.tokenCapturedAt = Date.now();
  chrome.storage.local.set({ flowKey, metrics });
  console.log('[AI Novel Flow] Bearer token captured via', source || 'unknown', token.slice(0, 12) + '…');
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'token_captured', flowKey }));
  }
  return true;
}

async function clearFlowKey(reason = 'manual') {
  flowKey = null;
  metrics.tokenCapturedAt = null;
  await chrome.storage.local.remove(['flowKey']);
  await chrome.storage.local.set({ metrics });
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'token_rejected', reason }));
  }
  console.warn('[AI Novel Flow] Cleared rejected Bearer token:', reason);
}

async function refreshFlowAuthToken(reason = 'refresh') {
  await clearFlowKey(reason);
  const tabs = await ensureSingleFlowTab({ active: false });
  if (!tabs.length || tabs[0]?.id == null) {
    return { ok: false, error: 'NO_FLOW_TAB', flowKeyPresent: false };
  }
  const reloaded = await reloadFlowTabForAuth(tabs[0].id);
  if (reloaded) await sleep(5000);
  const session = await pollSessionAndNotify();
  if (!flowKey) {
    await forceTokenHarvest({ reloadIfMissing: false });
  }
  return {
    ok: Boolean(flowKey),
    error: flowKey ? undefined : 'NO_FRESH_FLOW_KEY',
    flowKeyPresent: Boolean(flowKey),
    email: session?.email || '',
  };
}

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (!details?.requestHeaders?.length) return;

    const match = details.url.match(/\/v1\/projects\/([0-9a-fA-F-]+)\//);
    if (match) {
      const projectId = match[1];
      chrome.storage.local.set({ projectId });
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'project_id_captured', projectId }));
      }
    }

    const authHeader = details.requestHeaders.find(
      (h) => h.name?.toLowerCase() === 'authorization',
    );
    const value = authHeader?.value || '';
    if (!/^bearer\s+/i.test(value)) return;
    acceptBearerToken(value, 'webRequest:' + (details.url || '').slice(0, 60));
  },
  {
    urls: [
      'https://aisandbox-pa.googleapis.com/*',
      'https://aisandbox-pa.sandbox.googleapis.com/*',
      'https://labs.google/*',
      'https://*.googleapis.com/*',
    ],
  },
  ['requestHeaders', 'extraHeaders'],
);

// When user finishes Google login, Flow pages load — poll session (more reliable than webRequest)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  const u = tab?.url || '';
  if (!u.includes('labs.google') && !u.includes('accounts.google.com')) return;
  // After redirect back to Flow, harvest session + token
  if (u.includes('labs.google')) {
    // OAuth may turn the Google-login tab into an additional Flow tab after
    // startup de-duplication already ran. Collapse again on every completed
    // Flow navigation, keeping the active/authenticated tab.
    queryFlowTabs()
      .then(dedupeFlowTabs)
      .catch((e) =>
        console.warn('[AI Novel Flow] post-login Flow tab de-dup failed', e),
      );
    pollSessionAndNotify().catch((e) =>
      console.warn('[AI Novel Flow] tab poll session', e),
    );
  }
});

async function captureTokenFromFlowTab() {
  // Mid Google login — do not open a second Flow tab
  const authTabs = await queryGoogleAuthTabs();
  if (authTabs.length) {
    console.log('[Flow Agent] token refresh skipped — Google login in progress');
    await pollSessionAndNotify().catch(() => undefined);
    return;
  }
  const tabs = await ensureSingleFlowTab({
    active: false,
    allowCreate: false,
  });
  if (!tabs.length) {
    // Only auto-open when NOT logging in (background token refresh after session ready)
    if (_openingFlowTab) {
      console.log('[Flow Agent] Flow tab already opening, skipping');
      return;
    }
    if (await queryGoogleAuthTabs().then((t) => t.length > 0)) {
      console.log('[Flow Agent] abort open — login started');
      return;
    }
    _openingFlowTab = true;
    try {
      console.log('[Flow Agent] No Flow tab found — opening one in background');
      await chrome.tabs.create({ url: 'https://labs.google/fx/tools/flow', active: false });
      await sleep(3000);
      const retryTabs = await chrome.tabs.query({
        url: ['https://labs.google/fx/tools/flow*', 'https://labs.google/fx/*/tools/flow*'],
      });
      if (!retryTabs.length) {
        console.log('[Flow Agent] Flow tab not ready yet after open');
        return;
      }
      await chrome.scripting.executeScript({
        target: { tabId: retryTabs[0].id },
        files: ['content.js'],
      });
      console.log('[Flow Agent] Token refresh triggered on newly opened Flow tab');
    } catch (e) {
      console.error('[Flow Agent] Token refresh failed after opening tab:', e);
    } finally {
      _openingFlowTab = false;
    }
    return;
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      files: ['content.js'],
    });
    console.log('[Flow Agent] Token refresh triggered on Flow tab');
  } catch (e) {
    console.error('[Flow Agent] Token refresh failed:', e);
  }
}

// ─── WebSocket to Agent ─────────────────────────────────────

function connectToAgent() {
  if (manualDisconnect) return;
  if (ws?.readyState === WebSocket.CONNECTING) return;
  if (ws?.readyState === WebSocket.OPEN) return;

  try {
    ws = new WebSocket(AGENT_WS_URL);
  } catch (e) {
    console.error('[Flow Agent] WS connect error:', e);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    console.log('[AI Novel Flow] Connected to bridge ws://127.0.0.1:9223');
    chrome.alarms.clear('reconnect');
    setState('idle');

    // Token refresh alarm — 45 min (không harvest 12s — gây spam reload/login)
    chrome.alarms.create('token-refresh', { periodInMinutes: 45 });
    chrome.alarms.clear('token-harvest');

    // Send ready once; only resend token if present (không force harvest loop)
    ws.send(JSON.stringify({
      type: 'extension_ready',
      build: BRIDGE_BUILD,
      flowKeyPresent: !!flowKey,
      tokenAge: flowKey && metrics.tokenCapturedAt ? Date.now() - metrics.tokenCapturedAt : null,
    }));
    if (flowKey) {
      // Debounce re-broadcast token on reconnect (tránh bridge close/relaunch)
      const now = Date.now();
      if (!globalThis.__lastTokenBroadcast || now - globalThis.__lastTokenBroadcast > 120000) {
        globalThis.__lastTokenBroadcast = now;
        ws.send(JSON.stringify({ type: 'token_captured', flowKey }));
      }
      chrome.storage.local.get(['projectId'], (data) => {
        if (data.projectId && ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'project_id_captured', projectId: data.projectId }));
        }
      });
    } else {
      // Chỉ harvest nhẹ 1 lần khi chưa có token (không tạo alarm lặp)
      pollSessionAndNotify().catch((e) =>
        console.warn('[AI Novel Flow] initial session poll failed', e),
      );
    }
  };

  ws.onmessage = async ({ data }) => {
    try {
      const msg = JSON.parse(data);

      if (msg.method === 'api_request') {
        await handleApiRequest(msg);
      } else if (msg.method === 'trpc_request') {
        await handleTrpcRequest(msg);
      } else if (msg.method === 'download_binary') {
        // App nhận đúng bytes account browser mở được (cookie + Bearer)
        await handleDownloadBinary(msg);
      } else if (msg.method === 'upload_video') {
        await handleUploadVideo(msg);
      } else if (msg.method === 'solve_captcha') {
        await handleSolveCaptcha(msg);
      } else if (msg.method === 'get_status') {
        if (!flowKey) {
          try {
            const stored = await chrome.storage.local.get(['flowKey']);
            if (stored.flowKey) {
              flowKey = stored.flowKey;
              if (ws?.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'token_captured', flowKey }));
              }
            }
          } catch {
            /* ignore */
          }
        }
        const challengeTabs = await queryGoogleChallengeTabs();
        const authTabs = await queryGoogleAuthTabs();
        // Status must NEVER create tabs (was opening Flow while user logged in)
        const currentFlowTabs = await dedupeFlowTabs(await queryFlowTabs());
        sendToAgent({
          id: msg.id,
          result: {
            build: BRIDGE_BUILD,
            state,
            flowKeyPresent: !!flowKey,
            flowTabCount: currentFlowTabs.length,
            flowTabIds: currentFlowTabs
              .map((tab) => tab.id)
              .filter((tabId) => Number.isInteger(tabId)),
            challengeRequired: challengeTabs.length > 0,
            challengeTabIds: challengeTabs
              .map((tab) => tab.id)
              .filter((tabId) => Number.isInteger(tabId)),
            loginInProgress: authTabs.length > 0,
            authTabCount: authTabs.length,
            manualDisconnect,
            tokenAge: metrics.tokenCapturedAt ? Date.now() - metrics.tokenCapturedAt : null,
            metrics,
          },
        });
      } else if (msg.method === 'inspect_flow_page') {
        try {
          sendToAgent({ id: msg.id, result: await inspectFlowPage() });
        } catch (e) {
          sendToAgent({ id: msg.id, error: e.message || 'FLOW_INSPECT_FAILED' });
        }
      } else if (msg.method === 'click_flow_onboarding') {
        try {
          const result = await clickFlowOnboardingButton(msg.params?.labels || []);
          sendToAgent({ id: msg.id, result });
        } catch (e) {
          sendToAgent({ id: msg.id, error: e.message || 'FLOW_CLICK_FAILED' });
        }
      } else if (msg.method === 'inject_flow_key') {
        // Bridge re-hydrates extension SW after restart / multi-profile drift
        try {
          const k = msg.params?.flowKey || msg.params?.accessToken || '';
          const ok = acceptBearerToken(String(k), 'bridge:inject_flow_key');
          sendToAgent({
            id: msg.id,
            result: { ok: !!ok || !!flowKey, flowKeyPresent: !!flowKey },
          });
        } catch (e) {
          sendToAgent({ id: msg.id, error: e.message || 'INJECT_FAILED' });
        }
      } else if (msg.method === 'force_token_harvest') {
        try {
          const allowOpenTab = msg.params?.allowOpenTab !== false;
          const reloadIfMissing = msg.params?.reloadIfMissing !== false;
          const harvest = await forceTokenHarvest({
            allowOpenTab,
            reloadIfMissing,
          });
          sendToAgent({
            id: msg.id,
            result: {
              ok: true,
              flowKeyPresent: !!flowKey,
              email: harvest?.email || '',
              sessionReady: !!(
                harvest?.email && String(harvest.email).includes('@')
              ),
              loginInProgress: !!harvest?.loginInProgress,
            },
          });
        } catch (e) {
          sendToAgent({ id: msg.id, error: e.message || 'HARVEST_FAILED' });
        }
      } else if (msg.method === 'close_login_session') {
        // AI Novel: after token/email captured — hide windows; Node kills + relaunches background
        console.log('[AI Novel Flow] close_login_session — minimize + off-screen');
        try {
          chrome.alarms.clear('token-harvest');
          const wins = await chrome.windows.getAll({ populate: false });
          let minimized = 0;
          for (const w of wins) {
            try {
              await chrome.windows.update(w.id, {
                state: 'minimized',
                focused: false,
                // off-screen backup if minimize is ignored by some Chromium builds
                left: -32000,
                top: -32000,
                width: 900,
                height: 700,
              });
              minimized++;
            } catch (e) {
              try {
                await chrome.windows.update(w.id, {
                  state: 'minimized',
                  focused: false,
                });
                minimized++;
              } catch {
                /* ignore */
              }
            }
          }
          sendToAgent({
            id: msg.id,
            result: { ok: true, minimized, windows: wins.length },
          });
        } catch (e) {
          sendToAgent({ id: msg.id, error: e.message || 'CLOSE_FAILED' });
        }
      } else if (msg.method === 'resolve_google_challenge') {
        try {
          const timeoutMs = Number(msg.params?.timeoutMs) || 180_000;
          const result = await resolveGoogleChallenge({ timeoutMs });
          if (!result.ok) {
            sendToAgent({
              id: msg.id,
              error: result.error || 'GOOGLE_CHALLENGE_TIMEOUT',
              result,
            });
          } else {
            sendToAgent({ id: msg.id, result });
          }
        } catch (e) {
          sendToAgent({
            id: msg.id,
            error: e?.message || 'RESOLVE_CHALLENGE_FAILED',
          });
        }
      } else if (msg.method === 'open_flow_tab') {
        // Warm Flow tab for gen — do NOT steal focus unless challenge / explicit
        console.log('[Flow Agent] Agent requested: open Flow tab');
        try {
          const challengeTimeoutMs =
            Number(msg.params?.challengeTimeoutMs) || 180_000;
          const stealFocus = msg.params?.stealFocus === true;
          // Clear /sorry/ first (only focuses when challenge page exists)
          const challenge = await resolveGoogleChallenge({
            timeoutMs: challengeTimeoutMs,
          });
          if (!challenge.ok) {
            sendToAgent({
              id: msg.id,
              error: challenge.error || 'GOOGLE_CHALLENGE_TIMEOUT',
              result: challenge,
            });
            return;
          }

          const tabs = await ensureSingleFlowTab({
            // Default false: gen path must not yank OS focus every shot
            active: stealFocus,
            resolveChallenge: true,
            challengeTimeoutMs,
          });
          if (tabs.length) {
            const u = String(tabs[0].url || tabs[0].pendingUrl || '').toLowerCase();
            // Soft-wake off-screen/minimized window without stealing focus
            if (tabs[0]?.id != null) {
              await wakeTabForAutomation(tabs[0].id, {
                stealFocus:
                  stealFocus || Boolean(challenge.resolved),
              });
            }
            // Never reload a /sorry/ tab; only refresh real Flow surfaces.
            // Skip reload when Bearer already live — hard reload + 5s sleep was
            // timing out bridge open_flow_tab and stalling video/image gen.
            const needReload =
              msg.params?.forceReload === true || !flowKey;
            if (
              needReload &&
              !u.includes('google.com/sorry') &&
              tabs[0]?.id != null
            ) {
              await chrome.tabs.reload(tabs[0].id);
              console.log('[Flow Agent] Refreshed existing Flow tab');
              await sleep(2500);
            } else {
              console.log(
                '[Flow Agent] Flow tab ready (skip reload, token=' +
                  !!flowKey +
                  ', stealFocus=' +
                  stealFocus +
                  ')',
              );
              await sleep(400);
            }
          } else {
            throw new Error('FLOW_TAB_UNAVAILABLE_AFTER_STARTUP_GUARD');
          }
          // If token was captured by webRequest during page load, send it
          if (flowKey && ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'token_captured', flowKey }));
            console.log('[Flow Agent] Sent stored token after tab open');
          } else {
            // Try reading from storage as fallback
            const data = await chrome.storage.local.get(['flowKey']);
            if (data.flowKey) {
              flowKey = data.flowKey;
              if (ws?.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'token_captured', flowKey }));
                console.log('[Flow Agent] Sent token from storage after tab open');
              }
            }
          }
          sendToAgent({
            id: msg.id,
            result: {
              ok: true,
              challenge,
              flowKeyPresent: !!flowKey,
              tabId: tabs[0]?.id ?? null,
            },
          });
        } catch (e) {
          sendToAgent({
            id: msg.id,
            error: e?.message || 'OPEN_FLOW_FAILED',
          });
        }
      } else if (msg.method === 'hard_reset') {
        try {
          await clearRecaptchaCookieAnchor();
          const currentFlowTabs = await dedupeFlowTabs(await queryFlowTabs());
          if (currentFlowTabs.length > 0 && currentFlowTabs[0]?.id) {
            const tabId = currentFlowTabs[0].id;
            const targetUrl = msg.params?.projectUrl || FLOW_TAB_URL;
            await chrome.tabs.update(tabId, { url: 'about:blank' });
            await sleep(1500);
            await chrome.tabs.update(tabId, { url: targetUrl });
            await sleep(5000);
          }
          sendToAgent({ id: msg.id, result: { ok: true, reset: 'hard_reset_ok' } });
        } catch (e) {
          sendToAgent({ id: msg.id, error: e?.message || 'HARD_RESET_FAILED' });
        }
      } else if (msg.method === 'refresh_flow_tab') {
        // Python bridge asks us to refresh token
        console.log('[Flow Agent] Agent requested: refresh token');
        const refreshed = await refreshFlowAuthToken('bridge_refresh_flow_tab');
        // Actively send token if we have one
        if (flowKey && ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'token_captured', flowKey }));
          console.log('[Flow Agent] Sent token after refresh');
        } else {
          const data = await chrome.storage.local.get(['flowKey']);
          if (data.flowKey) {
            flowKey = data.flowKey;
            if (ws?.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'token_captured', flowKey }));
              console.log('[Flow Agent] Sent token from storage after refresh');
            }
          }
        }
        sendToAgent({ id: msg.id, result: refreshed });
      } else if (msg.method === 'clear_flow_key') {
        await clearFlowKey('bridge_clear_flow_key');
        sendToAgent({
          id: msg.id,
          result: { ok: true, flowKeyPresent: false },
        });
      } else if (msg.method === 'sync_account') {
        // Full identity: session email + credits + projects (same as browser account)
        try {
          const result = await syncAccountIdentity();
          sendToAgent({ id: msg.id, result });
          // Push projects + identity to bridge for durable store
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: 'account_identity',
                ...result,
              }),
            );
          }
        } catch (e) {
          sendToAgent({ id: msg.id, error: e.message || 'SYNC_FAILED' });
        }
      } else if (msg.method === 'open_project') {
        // Mirror UI: open the same Flow project the user selected in app
        try {
          const projectId = msg.params?.projectId || '';
          const r = await openFlowProject(projectId);
          sendToAgent({ id: msg.id, result: r });
        } catch (e) {
          sendToAgent({ id: msg.id, error: e.message || 'OPEN_PROJECT_FAILED' });
        }
      } else if (msg.method === 'list_projects') {
        try {
          const projects = await listFlowProjects();
          sendToAgent({ id: msg.id, result: { projects } });
        } catch (e) {
          sendToAgent({ id: msg.id, error: e.message || 'LIST_PROJECTS_FAILED' });
        }
      } else if (msg.type === 'callback_secret') {
        callbackSecret = msg.secret;
        chrome.storage.local.set({ callbackSecret: msg.secret });
        console.log('[Flow Agent] Received callback secret');
      } else if (msg.type === 'pong') {
        // keepalive response
      }
    } catch (e) {
      console.error('[Flow Agent] Message error:', e);
    }
  };

  ws.onclose = () => {
    setState('off');
    chrome.alarms.clear('token-refresh');
    if (!manualDisconnect) scheduleReconnect();
  };

  ws.onerror = (e) => {
    console.error('[Flow Agent] WS error:', e);
    metrics.lastError = 'WS_ERROR';
    chrome.storage.local.set({ metrics });
  };
}

function scheduleReconnect() {
  chrome.alarms.create('reconnect', { delayInMinutes: 0.083 }); // ~5s
}

function keepAlive() {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ping' }));
  } else {
    connectToAgent();
  }
}

function sendToAgent(msg) {
  // API responses (with msg.id) go via HTTP — immune to WS disconnect
  if (msg.id) {
    if (ws?.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(msg));
      } catch {
        /* HTTP callback remains available */
      }
    }
    fetch('http://127.0.0.1:8101/api/ext/callback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Callback-Secret': callbackSecret || '',
      },
      body: JSON.stringify(msg),
    }).catch(() => {
      // HTTP failed — fallback to WS
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    });
    return;
  }
  // Non-response messages (ping, status) or no secret yet — use WS
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

async function inspectFlowPage() {
  const tabs = await ensureSingleFlowTab({ active: false });
  const tabId = tabs[0]?.id;
  if (tabId == null) throw new Error('NO_FLOW_TAB_FOR_INSPECTION');
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const rows = Array.from(
        document.querySelectorAll('button, a, [role="button"]'),
      )
        .map((element) => ({
          text: String(element.textContent || '').replace(/\s+/g, ' ').trim(),
          tag: element.tagName,
          disabled:
            'disabled' in element ? Boolean(element.disabled) : false,
          ariaDisabled: element.getAttribute('aria-disabled') || '',
        }))
        .filter((row) => row.text)
        .slice(0, 80);
      const links = Array.from(document.querySelectorAll('a[href]'))
        .map((element) => ({
          text: String(element.textContent || '').replace(/\s+/g, ' ').trim(),
          href: element.href,
        }))
        .filter((row) => row.href)
        .slice(0, 80);
      const projectCards = Array.from(document.querySelectorAll('button'))
        .filter((button) => {
          const text = String(button.textContent || '').toLocaleLowerCase();
          const aria = String(button.getAttribute('aria-label') || '')
            .toLocaleLowerCase();
          return (
            text.includes('chỉnh sửa dự án') ||
            text.includes('edit project') ||
            aria.includes('chỉnh sửa dự án') ||
            aria.includes('edit project')
          );
        })
        .map((button) => {
          let node = button.parentElement;
          for (let depth = 0; node && depth < 8; depth += 1) {
            const buttonCount = node.querySelectorAll('button').length;
            const href = node.querySelector('a[href]')?.href || '';
            const text = String(node.textContent || '')
              .replace(/\s+/g, ' ')
              .trim();
            if (href || buttonCount >= 2) {
              return {
                text: text.slice(0, 500),
                href,
                html: node.outerHTML.slice(0, 4000),
              };
            }
            node = node.parentElement;
          }
          return null;
        })
        .filter(Boolean)
        .slice(0, 12);
      return {
        url: location.href,
        title: document.title,
        readyState: document.readyState,
        bodyText: String(document.body?.innerText || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 6000),
        controls: rows,
        links,
        projectCards,
      };
    },
  });
  return results[0]?.result || null;
}

async function clickFlowOnboardingButton(labels) {
  const allowed = ['create with google flow', 'dự án mới', 'new project'];
  const requested = Array.isArray(labels) ? labels : [];
  const normalized = requested
    .map((value) => String(value || '').toLocaleLowerCase().trim())
    .filter((value) => allowed.includes(value));
  if (!normalized.length) throw new Error('FLOW_CLICK_LABEL_NOT_ALLOWED');
  const tabs = await ensureSingleFlowTab({ active: true });
  const tabId = tabs[0]?.id;
  if (tabId == null) throw new Error('NO_FLOW_TAB_FOR_CLICK');
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (targetLabels) => {
      const candidates = Array.from(
        document.querySelectorAll('button, a, [role="button"]'),
      );
      const element = candidates.find((candidate) => {
        const text = String(candidate.textContent || '')
          .replace(/\s+/g, ' ')
          .toLocaleLowerCase()
          .trim();
        return targetLabels.some(
          (label) => text === label || text.includes(label),
        );
      });
      if (!element) {
        return { ok: false, error: 'FLOW_ONBOARDING_BUTTON_NOT_FOUND' };
      }
      const disabled =
        ('disabled' in element && Boolean(element.disabled)) ||
        element.getAttribute('aria-disabled') === 'true';
      if (disabled) {
        return {
          ok: false,
          error: 'FLOW_ONBOARDING_BUTTON_DISABLED',
          text: String(element.textContent || '').trim(),
        };
      }
      element.scrollIntoView({ block: 'center', inline: 'center' });
      element.click();
      return {
        ok: true,
        text: String(element.textContent || '').replace(/\s+/g, ' ').trim(),
        tag: element.tagName,
        urlBefore: location.href,
      };
    },
    args: [normalized],
  });
  await sleep(2500);
  return {
    click: results[0]?.result || null,
    page: await inspectFlowPage(),
  };
}

// ─── reCAPTCHA Solving ──────────────────────────────────────

const ANCHOR_NAME_RE = /grecaptcha/i;
const ANCHOR_TOP_LEVEL_SITES = [
  'https://labs.google',
  'https://www.google.com',
  'https://google.com',
];

async function removeAnchorCookies(query, extra) {
  let removed = 0;
  try {
    const cookies = await chrome.cookies.getAll(query);
    for (const cookie of cookies) {
      if (!ANCHOR_NAME_RE.test(cookie.name)) continue;
      const host = cookie.domain.startsWith('.') ? `www${cookie.domain}` : cookie.domain;
      const url = `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path}`;
      try {
        const detail = await chrome.cookies.remove({
          url,
          name: cookie.name,
          storeId: cookie.storeId,
          ...extra,
        });
        if (detail !== null) removed++;
      } catch (_) {}
    }
  } catch (_) {}
  return removed;
}

async function clearRecaptchaCookieAnchor() {
  let removed = 0;
  let partitionedRemoved = 0;
  try {
    removed = await removeAnchorCookies({});
  } catch (e) {}

  for (const topLevelSite of ANCHOR_TOP_LEVEL_SITES) {
    try {
      const partitionKey = { topLevelSite };
      partitionedRemoved += await removeAnchorCookies({ partitionKey }, { partitionKey });
    } catch (_e) {}
  }

  if (chrome.browsingData?.remove) {
    try {
      await chrome.browsingData.remove(
        { origins: ['https://www.google.com', 'https://www.recaptcha.net'] },
        { cookies: true },
      );
    } catch (e) {}
  }
  console.log(`[AI Novel Flow] clearRecaptchaCookieAnchor: unpartitioned=${removed} partitioned=${partitionedRemoved}`);
}

async function requestCaptchaFromTab(tabId, requestId, pageAction) {
  // Execute in the page's MAIN world first. This avoids the fragile
  // isolated-world -> DOM CustomEvent -> injected script relay, which can be
  // present while its MAIN-world listener was removed by an SPA navigation.
  try {
    const direct = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: async (fallbackKey, action) => {
        // Discover the reCAPTCHA Enterprise site key DYNAMICALLY from the page.
        // Google rotates this key; SAT does the same via
        // `script[src*="recaptcha"]` -> `render=` param discovery.
        let siteKey = null;
        try {
          const scripts = document.querySelectorAll('script[src*="recaptcha"]');
          for (const s of scripts) {
            const m = (s.src || '').match(/[?&]render=([^&]+)/);
            if (m) {
              siteKey = m[1];
              break;
            }
          }
        } catch (_e) {
          /* ignore */
        }
        if (!siteKey) siteKey = fallbackKey || null;
        if (!siteKey) return { error: 'NO_SITE_KEY' };

        // Labs can be slow to inject enterprise grecaptcha after navigation
        const waitUntil = Date.now() + 25_000;
        while (!window.grecaptcha?.enterprise?.execute) {
          if (Date.now() >= waitUntil) {
            return { error: 'GRECAPTCHA_NOT_AVAILABLE' };
          }
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        try {
          const token = await Promise.race([
            window.grecaptcha.enterprise.execute(siteKey, { action }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('GRECAPTCHA_EXECUTE_TIMEOUT')), 45_000),
            ),
          ]);
          return token
            ? { token: String(token), key: siteKey }
            : { error: 'GRECAPTCHA_EMPTY_TOKEN' };
        } catch (error) {
          return {
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
      args: ['6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV', pageAction],
    });
    const result = direct?.[0]?.result;
    if (result?.token) return result;
    console.warn('[AI Novel Flow] direct captcha failed; trying content relay', result?.error);
  } catch (error) {
    console.warn('[AI Novel Flow] direct captcha execution failed; trying content relay', error);
  }

  try {
    return await chrome.tabs.sendMessage(tabId, {
      type: 'GET_CAPTCHA',
      requestId,
      pageAction,
    });
  } catch (error) {
    const msg = error?.message || '';
    const shouldInject =
      msg.includes('Receiving end does not exist') ||
      msg.includes('Could not establish connection');
    if (!shouldInject) throw error;

    // Inject content script and retry
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
    await sleep(200);
    return await chrome.tabs.sendMessage(tabId, {
      type: 'GET_CAPTCHA',
      requestId,
      pageAction,
    });
  }
}

async function solveCaptcha(requestId, captchaAction) {
  // /sorry/ interstitial blocks grecaptcha.enterprise — let the user clear it first.
  const challenge = await resolveGoogleChallenge({
    timeoutMs: 180_000,
  });
  if (!challenge.ok) {
    return {
      error: challenge.error || 'GOOGLE_CHALLENGE_TIMEOUT',
      challenge,
    };
  }

  const tabs = await chrome.tabs.query({
    url: ['https://labs.google/fx/tools/flow*', 'https://labs.google/fx/*/tools/flow*'],
  });

  if (!tabs.length) {
    // Auto-open Flow tab and wait briefly before returning error
    try {
      // Prefer ensure path (de-dupe + challenge guard) over raw create
      let openTabs = [];
      try {
        openTabs = await ensureSingleFlowTab({
          active: false,
          allowCreate: true,
          resolveChallenge: true,
          challengeTimeoutMs: 120_000,
        });
      } catch (e) {
        return { error: e?.message || 'NO_FLOW_TAB' };
      }
      if (!openTabs.length) {
        await chrome.tabs.create({
          url: 'https://labs.google/fx/tools/flow',
          active: false,
        });
        await sleep(3000);
      } else {
        if (openTabs[0]?.id != null) {
          await wakeTabForAutomation(openTabs[0].id, { stealFocus: false });
        }
        await sleep(2000);
      }
      // Retry tab query after opening
      const retryTabs = await chrome.tabs.query({
        url: ['https://labs.google/fx/tools/flow*', 'https://labs.google/fx/*/tools/flow*'],
      });
      if (!retryTabs.length) return { error: 'NO_FLOW_TAB' };
      const resp = await Promise.race([
        requestCaptchaFromTab(retryTabs[0].id, requestId, captchaAction),
        // Captcha on cold tab often needs >30s — was CAPTCHA_TIMEOUT false fail
        new Promise((_, rej) => setTimeout(() => rej(new Error('CAPTCHA_TIMEOUT')), 60_000)),
      ]);
      return resp;
    } catch (e) {
      return { error: e.message || 'NO_FLOW_TAB' };
    }
  }

  try {
    // Keep grecaptcha alive (unfreeze minimized) without stealing OS focus
    await wakeTabForAutomation(tabs[0].id, { stealFocus: false });
    const resp = await Promise.race([
      requestCaptchaFromTab(tabs[0].id, requestId, captchaAction),
      new Promise((_, rej) => setTimeout(() => rej(new Error('CAPTCHA_TIMEOUT')), 60_000)),
    ]);
    return resp;
  } catch (e) {
    return { error: e.message };
  }
}

async function handleSolveCaptcha(msg) {
  const { id, params } = msg;
  const result = await solveCaptcha(id, params?.captchaAction || 'VIDEO_GENERATION');

  // Standalone captcha solve counts as captcha-consuming
  metrics.requestCount++;
  if (result?.token) {
    metrics.successCount++;
  } else {
    metrics.failedCount++;
    metrics.lastError = result?.error || 'NO_TOKEN';
  }
  chrome.storage.local.set({ metrics });

  sendToAgent({ id, result });
}

// ─── API Request Proxy ──────────────────────────────────────

async function handleTrpcRequest(msg) {
  const { id, params } = msg;
  const {
    url,
    method = 'POST',
    headers = {},
    body,
    preferPageContext = false,
  } = params;

  if (!url || !url.startsWith('https://labs.google/')) {
    sendToAgent({ id, error: 'INVALID_TRPC_URL' });
    return;
  }

  setState('running');
  // TRPC calls don't consume captcha — don't count in metrics

  const logId = id;
  const logType = url.includes('createProject') ? 'CREATE_PROJECT' : 'TRPC';
  // TRPC calls are silent — don't show in request log

  try {
    const requestViaFlowPage = async ({ includeAuthorization = false } = {}) => {
      const tabs = await ensureSingleFlowTab({ active: false });
      if (!tabs.length || tabs[0]?.id == null) {
        throw new Error('NO_FLOW_TAB_FOR_TRPC');
      }
      const pageHeaders = { 'Content-Type': 'application/json', ...headers };
      if (includeAuthorization && flowKey) {
        pageHeaders.authorization = `Bearer ${flowKey}`;
      }
      try {
        const contentResult = await Promise.race([
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'FLOW_TRPC_REQUEST',
            request: { url, method, headers: pageHeaders, body },
          }),
          sleep(13000).then(() => ({ ok: false, error: 'TRPC_CONTENT_TIMEOUT' })),
        ]);
        if (contentResult?.ok) {
          return {
            response: {
              ok: Boolean(contentResult.responseOk),
              status: Number(contentResult.status),
            },
            responseData: contentResult.data,
          };
        }
      } catch (error) {
        console.warn(
          '[AI Novel Flow] content-script tRPC relay failed; trying MAIN world',
          error,
        );
      }
      const results = await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        world: 'MAIN',
        func: async (request) => {
          try {
            const result = await new Promise((resolve) => {
              const parsed = new URL(request.url);
              const target =
                parsed.origin === location.origin
                  ? `${parsed.pathname}${parsed.search}`
                  : request.url;
              const xhr = new XMLHttpRequest();
              xhr.open(request.method, target, true);
              xhr.withCredentials = true;
              xhr.timeout = 12000;
              for (const [name, value] of Object.entries(request.headers || {})) {
                xhr.setRequestHeader(name, String(value));
              }
              xhr.onload = () =>
                resolve({ status: xhr.status, text: xhr.responseText || '' });
              xhr.onerror = () =>
                resolve({ status: 0, error: 'TRPC_PAGE_XHR_NETWORK_ERROR' });
              xhr.ontimeout = () =>
                resolve({ status: 0, error: 'TRPC_PAGE_XHR_TIMEOUT' });
              xhr.send(request.body ? JSON.stringify(request.body) : null);
            });
            if (result.error) {
              return { ok: false, error: result.error };
            }
            const text = result.text;
            let data = null;
            try {
              data = text ? JSON.parse(text) : null;
            } catch {
              data = { raw: text.slice(0, 1000) };
            }
            return {
              ok: true,
              responseOk: result.status >= 200 && result.status < 300,
              status: result.status,
              data,
            };
          } catch (error) {
            return {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        },
        args: [{ url, method, headers: pageHeaders, body }],
      });
      const result = results[0]?.result;
      if (!result?.ok) {
        throw new Error(result?.error || 'TRPC_PAGE_FETCH_FAILED');
      }
      return {
        response: {
          ok: Boolean(result.responseOk),
          status: Number(result.status),
        },
        responseData: result.data,
      };
    };

    const requestOnce = async () => {
      const fetchHeaders = { 'Content-Type': 'application/json', ...headers };
      if (flowKey) {
        fetchHeaders['authorization'] = `Bearer ${flowKey}`;
      }
      try {
        const response = await fetch(url, {
          method,
          headers: fetchHeaders,
          body: body ? JSON.stringify(body) : undefined,
          credentials: 'include',
        });
        const responseData = await response.json();
        return { response, responseData };
      } catch (error) {
        console.warn(
          '[AI Novel Flow] service-worker tRPC fetch failed; retrying in Flow page context',
          error,
        );
        return requestViaFlowPage();
      }
    };

    const isUnauthorizedTrpc = (response, responseData) => {
      const trpcError = responseData?.error?.json;
      return (
        response.status === 401 ||
        trpcError?.status === 401 ||
        trpcError?.data?.httpStatus === 401 ||
        trpcError?.message === 'UNAUTHORIZED'
      );
    };

    let { response: resp, responseData: data } = preferPageContext
      ? await requestViaFlowPage()
      : await requestOnce();
    if (isUnauthorizedTrpc(resp, data)) {
      const refreshed = await refreshFlowAuthToken('trpc_401');
      // labs.google tRPC is authenticated by the page's same-origin cookies.
      // A stale Authorization header can override that valid browser session,
      // so retry in MAIN world without Bearer first.
      ({ response: resp, responseData: data } = await requestViaFlowPage());
      if (isUnauthorizedTrpc(resp, data) && refreshed.ok) {
        ({ response: resp, responseData: data } = await requestViaFlowPage({
          includeAuthorization: true,
        }));
      }
    }
    chrome.storage.local.set({ metrics });
    updateRequestLog(logId, {
      status: resp.ok ? 'success' : 'failed',
      ...(resp.ok ? {} : { error: `HTTP_${resp.status}` }),
    });
    sendToAgent({ id, status: resp.status, data });
  } catch (e) {
    console.error('[Flow Agent] tRPC request failed:', e);
    chrome.storage.local.set({ metrics });
    updateRequestLog(logId, { status: 'failed', error: e.message || 'TRPC_FETCH_FAILED' });
    sendToAgent({ id, error: e.message || 'TRPC_FETCH_FAILED' });
  } finally {
    setState('idle');
  }
}


async function handleUploadVideo(msg) {
  const { id, params } = msg;
  const { videoBase64, projectId, videoSize } = params;

  try {
    const tabs = await chrome.tabs.query({ url: '*://labs.google/*' });
    if (!tabs.length) {
      sendToAgent({ id, error: 'NO_FLOW_TAB' });
      return;
    }

    const size = videoSize || (videoBase64 ? Math.floor(videoBase64.length * 3 / 4) : 0);

    // Get session URL via page context XHR (needs session cookies)
    const startResults = await chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      world: 'MAIN',
      func: (projId, sz) => {
        return new Promise((resolve) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', '/fx/api/upload-video?action=start');
          xhr.setRequestHeader('X-Upload-Project-Id', projId);
          xhr.setRequestHeader('X-Upload-Content-Type', 'video/mp4');
          xhr.setRequestHeader('X-Upload-Content-Length', sz.toString());
          xhr.withCredentials = true;
          xhr.onload = () => {
            let data;
            try { data = JSON.parse(xhr.responseText); } catch { data = {}; }
            resolve({
              sessionUrl: data.sessionUrl || xhr.getResponseHeader('X-Upload-Session-Url') || '',
              status: xhr.status,
            });
          };
          xhr.onerror = () => resolve({ error: 'POST_FAILED' });
          xhr.send();
        });
      },
      args: [projectId, size],
    });

    const step1 = startResults?.[0]?.result;
    if (!step1 || step1.error || !step1.sessionUrl) {
      sendToAgent({ id, error: step1?.error || 'NO_SESSION_URL' });
      return;
    }

    // Return sessionUrl + token — caller handles PUT
    sendToAgent({
      id,
      result: {
        sessionUrl: step1.sessionUrl,
        token: flowKey || '',
      },
    });
  } catch (e) {
    sendToAgent({ id, error: `UPLOAD_ERROR: ${e.message}` });
  }
}

async function resolveApiRequestBody(params) {
  // Large uploadImage body is stashed on bridge HTTP (avoid multi-MB WS + executeScript args)
  const stashId = params?.bodyStashId ? String(params.bodyStashId).trim() : '';
  if (stashId) {
    const stashUrl = `http://127.0.0.1:8101/internal/body-stash/${encodeURIComponent(stashId)}`;
    const res = await fetch(stashUrl, {
      headers: { 'X-Callback-Secret': callbackSecret || '' },
    });
    if (!res.ok) {
      throw new Error(`BODY_STASH_FETCH_FAILED HTTP ${res.status}`);
    }
    return await res.json();
  }
  return params?.body ?? null;
}

async function handleApiRequest(msg) {
  const { id, params } = msg;
  const { url, method, headers, captchaAction } = params;
  let body = params?.body;

  if (!url) {
    sendToAgent({ id, error: 'MISSING_URL' });
    return;
  }

  if (!url.startsWith('https://aisandbox-pa.googleapis.com/')) {
    sendToAgent({ id, error: 'INVALID_URL' });
    return;
  }

  setState('running');
  const hasCaptcha = !!captchaAction;
  if (hasCaptcha) metrics.requestCount++;

  const logId = id;
  const logType = _classifyApiUrl(url);
  if (_VISIBLE_TYPES.has(logType) || logType === 'UPLOAD') {
    const payloadSummary = body
      ? JSON.stringify(body).slice(0, 200)
      : params?.bodyStashId
        ? `stash:${params.bodyStashId}`
        : null;
    addRequestLog({ id: logId, type: logType, time: new Date().toISOString(), status: 'processing', error: null, outputUrl: null, url, payloadSummary });
  }

  try {
    // Resolve stashed body early (uploadImage)
    try {
      body = await resolveApiRequestBody(params);
    } catch (e) {
      const em = e instanceof Error ? e.message : String(e);
      sendToAgent({ id, error: em });
      updateRequestLog(logId, { status: 'failed', error: em });
      setState('idle');
      return;
    }

    // Step 1: Solve captcha if needed
    let captchaToken = null;
    if (captchaAction) {
      const captchaResult = await solveCaptcha(id, captchaAction);
      captchaToken = captchaResult?.token || null;
      if (!captchaToken) {
        // Cannot proceed without captcha — API will 403
        const err = captchaResult?.error || 'CAPTCHA_FAILED';
        console.error(`[Flow Agent] Captcha failed for ${captchaAction}: ${err}`);
        sendToAgent({ id, status: 403, error: `CAPTCHA_FAILED: ${err}` });
        if (hasCaptcha) { metrics.failedCount++; metrics.lastError = `CAPTCHA_FAILED: ${err}`; }
        chrome.storage.local.set({ metrics });
        updateRequestLog(logId, { status: 'failed', error: `CAPTCHA_FAILED: ${err}` });
        setState('idle');
        return;
      }
    }

    // Step 2: Inject captcha token into body
    let finalBody = body;
    if (captchaToken && finalBody) {
      finalBody = JSON.parse(JSON.stringify(finalBody)); // deep clone
      if (finalBody.clientContext?.recaptchaContext) {
        finalBody.clientContext.recaptchaContext.token = captchaToken;
      }
      if (finalBody.requests && Array.isArray(finalBody.requests)) {
        for (const req of finalBody.requests) {
          if (req.clientContext?.recaptchaContext) {
            req.clientContext.recaptchaContext.token = captchaToken;
          }
        }
      }
    }

    // Step 3: Use flowKey for auth (memory → storage → bridge-supplied → harvest)
    let activeFlowKey = flowKey;
    if (!activeFlowKey) {
      try {
        const stored = await chrome.storage.local.get(['flowKey']);
        if (stored.flowKey) {
          flowKey = stored.flowKey;
          activeFlowKey = flowKey;
          console.log('[AI Novel Flow] Restored flowKey from storage before api_request');
        }
      } catch (e) {
        console.warn('[AI Novel Flow] storage restore failed', e);
      }
    }
    // Bridge may still hold a captured Bearer while SW memory was wiped
    if (!activeFlowKey && (params.flowKey || params.accessToken)) {
      const fromBridge = String(params.flowKey || params.accessToken || '').trim();
      if (fromBridge.length >= 20) {
        acceptBearerToken(fromBridge, 'bridge:api_request');
        activeFlowKey = flowKey || fromBridge;
      }
    }
    if (!activeFlowKey) {
      try {
        await forceTokenHarvest();
        activeFlowKey = flowKey;
      } catch (e) {
        console.warn('[AI Novel Flow] harvest before api_request failed', e);
      }
    }
    if (!activeFlowKey) {
      sendToAgent({ id, status: 503, error: 'NO_FLOW_KEY' });
      if (hasCaptcha) { metrics.failedCount++; metrics.lastError = 'NO_FLOW_KEY'; }
      chrome.storage.local.set({ metrics });
      updateRequestLog(logId, { status: 'failed', error: 'NO_FLOW_KEY' });
      setState('idle');
      return;
    }

    const fetchHeaders = { ...(headers || {}) };
    fetchHeaders['authorization'] = `Bearer ${activeFlowKey}`;

    // Step 4: API call
    // - uploadImage / telemetry: service-worker fetch (Bearer) — avoids huge
    //   executeScript args that caused Extension API timeout ~66s
    // - gen with captcha: MAIN-world XHR (page cookies + recaptcha context)
    let responseStatus = 0;
    let responseText = '';
    const isFrontendTelemetry =
      url.includes('/v1/flow:batchLogFrontendEvents') ||
      url.includes('/v1:batchLog');
    const isUploadImage = url.includes('uploadImage');
    if (isFrontendTelemetry || (isUploadImage && !hasCaptcha)) {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        isUploadImage ? 120_000 : 25_000,
      );
      try {
        if (!fetchHeaders['Content-Type'] && !fetchHeaders['content-type']) {
          fetchHeaders['Content-Type'] = 'application/json';
        }
        const workerResponse = await fetch(url, {
          method: method || 'POST',
          headers: fetchHeaders,
          credentials: 'include',
          body: method === 'GET' ? undefined : JSON.stringify(finalBody),
          signal: controller.signal,
        });
        responseStatus = workerResponse.status;
        responseText = await workerResponse.text();
      } finally {
        clearTimeout(timer);
      }
    } else {
      // Soft-wake only — do NOT steal OS focus on every image/video gen.
      // Page XHR needs non-frozen window; user keeps AI Novel in front.
      const flowTabs = await ensureSingleFlowTab({ active: false });
      const flowTabId = flowTabs[0]?.id;
      if (flowTabId == null) throw new Error('NO_FLOW_TAB');
      try {
        await wakeTabForAutomation(flowTabId, { stealFocus: false });
        await sleep(350);
      } catch (e) {
        console.warn('[AI Novel Flow] soft-wake Flow tab before XHR failed', e);
      }
      // Keep executeScript payload small: pass stash marker not multi-MB body
      const pageBodyArg =
        finalBody && JSON.stringify(finalBody).length > 80_000
          ? { __tooLarge: true }
          : finalBody;

      const swFetchOnce = async (timeoutMs = 120_000) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          if (!fetchHeaders['Content-Type'] && !fetchHeaders['content-type']) {
            fetchHeaders['Content-Type'] = 'application/json';
          }
          const workerResponse = await fetch(url, {
            method: method || 'POST',
            headers: fetchHeaders,
            credentials: 'include',
            body: method === 'GET' ? undefined : JSON.stringify(finalBody),
            signal: controller.signal,
          });
          return {
            status: workerResponse.status,
            text: await workerResponse.text(),
          };
        } finally {
          clearTimeout(timer);
        }
      };

      if (pageBodyArg && pageBodyArg.__tooLarge) {
        // Fallback: SW fetch even with captcha if body too large for executeScript
        const sw = await swFetchOnce(120_000);
        responseStatus = sw.status;
        responseText = sw.text;
      } else {
      const pageRequest = chrome.scripting.executeScript({
        target: { tabId: flowTabId },
        world: 'MAIN',
        func: (requestUrl, requestMethod, requestHeaders, requestBody) =>
          new Promise((resolve) => {
            try {
              const xhr = new XMLHttpRequest();
              xhr.open(requestMethod || 'POST', requestUrl, true);
              xhr.withCredentials = true;
              // Image/video gen on Labs often exceeds 80s under reCAPTCHA + queue
              xhr.timeout = 160_000;
              for (const [name, value] of Object.entries(requestHeaders || {})) {
                // The browser supplies these from the real page. Setting them in
                // JS is forbidden and can abort the request before it is sent.
                if (/^(user-agent|origin|referer|host|cookie|content-length|sec-)/i.test(name)) continue;
                try { xhr.setRequestHeader(name, String(value)); } catch {}
              }
              xhr.onload = () => resolve({
                status: xhr.status,
                text: xhr.responseText || '',
              });
              xhr.onerror = () => resolve({ error: 'AISANDBOX_PAGE_XHR_ERROR' });
              xhr.ontimeout = () => resolve({ error: 'AISANDBOX_PAGE_XHR_TIMEOUT' });
              xhr.onabort = () => resolve({ error: 'AISANDBOX_PAGE_XHR_ABORTED' });
              xhr.send(requestMethod === 'GET' ? null : JSON.stringify(requestBody));
            } catch (error) {
              resolve({ error: error instanceof Error ? error.message : String(error) });
            }
          }),
        args: [url, method || 'POST', fetchHeaders, pageBodyArg],
      });
      let pageResult;
      try {
        const pageResults = await Promise.race([
          pageRequest,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('AISANDBOX_PAGE_EXEC_TIMEOUT')), 170_000),
          ),
        ]);
        pageResult = pageResults?.[0]?.result;
      } catch (e) {
        pageResult = {
          error: e instanceof Error ? e.message : String(e),
        };
      }
      if (!pageResult || pageResult.error) {
        const pageErr = pageResult?.error || 'AISANDBOX_PAGE_XHR_NO_RESULT';
        console.warn(
          '[AI Novel Flow] page XHR failed — SW fetch fallback:',
          pageErr,
        );
        // Video/image often fails with PAGE_XHR_ERROR when window was minimized.
        // Bearer + recaptcha token in body still works via SW (same as upload).
        try {
          const sw = await swFetchOnce(150_000);
          responseStatus = sw.status;
          responseText = sw.text;
          console.log(
            '[AI Novel Flow] SW fallback status=',
            responseStatus,
            'bytes=',
            (responseText || '').length,
          );
        } catch (swErr) {
          throw new Error(
            `${pageErr}; SW_FALLBACK: ${
              swErr instanceof Error ? swErr.message : String(swErr)
            }`,
          );
        }
      } else {
        responseStatus = Number(pageResult.status) || 0;
        responseText = String(pageResult.text || '');
      }
      }
    }
    const response = {
      status: responseStatus,
      ok: responseStatus >= 200 && responseStatus < 300,
    };

    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = responseText;
    }

    sendToAgent({
      id,
      status: response.status,
      data: responseData,
    });

    const responseSummary = responseText ? responseText.slice(0, 300) : null;
    if (response.ok) {
      if (hasCaptcha) { metrics.successCount++; metrics.lastError = null; }
      updateRequestLog(logId, { status: 'success', httpStatus: response.status, responseSummary });
    } else {
      if (hasCaptcha) { metrics.failedCount++; metrics.lastError = `API_${response.status}`; }
      updateRequestLog(logId, { status: 'failed', error: `API_${response.status}`, httpStatus: response.status, responseSummary });
    }
  } catch (e) {
    sendToAgent({
      id,
      status: 500,
      error: e.message || 'API_REQUEST_FAILED',
    });
    if (hasCaptcha) { metrics.failedCount++; metrics.lastError = e.message; }
    updateRequestLog(logId, { status: 'failed', error: e.message || 'API_REQUEST_FAILED' });
  }

  chrome.storage.local.set({ metrics });
  setState('idle');
}

/**
 * Download binary as the logged-in account (cookies + Bearer).
 * App uses this when Node fetch cannot access fife/media URLs the browser can.
 * Returns base64 for files ≤ 28MB; larger → stream to local bridge HTTP sink.
 */
async function handleDownloadBinary(msg) {
  const id = msg.id;
  const params = msg.params || {};
  const url = String(params.url || '').trim();
  if (!url) {
    sendToAgent({ id, error: 'url required' });
    return;
  }
  try {
    let activeFlowKey = flowKey;
    if (!activeFlowKey) {
      try {
        const stored = await chrome.storage.local.get(['flowKey']);
        if (stored.flowKey) {
          flowKey = stored.flowKey;
          activeFlowKey = flowKey;
        }
      } catch {
        /* ignore */
      }
    }
    if (!activeFlowKey && (params.flowKey || params.accessToken)) {
      const fromBridge = String(params.flowKey || params.accessToken || '').trim();
      if (fromBridge.length >= 20) {
        acceptBearerToken(fromBridge, 'bridge:download_binary');
        activeFlowKey = flowKey || fromBridge;
      }
    }
    const headers = { ...(params.headers || {}) };
    if (activeFlowKey && !headers.authorization && !headers.Authorization) {
      headers.authorization = `Bearer ${activeFlowKey}`;
    }
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers,
    });
    if (!response.ok) {
      sendToAgent({
        id,
        status: response.status,
        error: `DOWNLOAD_HTTP_${response.status}`,
      });
      return;
    }
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const ab = await response.arrayBuffer();
    const byteLength = ab.byteLength;
    const MAX_B64 = 28 * 1024 * 1024;
    if (byteLength > MAX_B64) {
      // Stream large file to bridge sink so app still receives the media
      const sink =
        String(params.sinkUrl || '').trim() ||
        'http://127.0.0.1:8101/internal/receive-binary';
      const destHint = String(params.destPath || '').trim();
      try {
        const sinkRes = await fetch(sink, {
          method: 'POST',
          headers: {
            'Content-Type': contentType,
            'X-Dest-Path': destHint,
            'X-Callback-Secret': callbackSecret || '',
            'X-Byte-Length': String(byteLength),
          },
          body: ab,
        });
        const sinkText = await sinkRes.text();
        let sinkData = null;
        try {
          sinkData = JSON.parse(sinkText);
        } catch {
          sinkData = { raw: sinkText.slice(0, 200) };
        }
        sendToAgent({
          id,
          status: 200,
          result: {
            ok: sinkRes.ok,
            status: response.status,
            contentType,
            byteLength,
            via: 'sink',
            destPath: sinkData?.destPath || destHint || null,
            sink: sinkData,
          },
        });
      } catch (e) {
        sendToAgent({
          id,
          error: `LARGE_DOWNLOAD_SINK_FAILED: ${e.message || e}`,
          result: { byteLength, contentType },
        });
      }
      return;
    }
    // base64 encode
    const bytes = new Uint8Array(ab);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    const base64 = btoa(binary);
    sendToAgent({
      id,
      status: 200,
      result: {
        ok: true,
        status: response.status,
        contentType,
        byteLength,
        base64,
        via: 'base64',
      },
    });
  } catch (e) {
    sendToAgent({
      id,
      error: e.message || 'DOWNLOAD_BINARY_FAILED',
    });
  }
}

// ─── Account identity (RPA ký sinh = cùng session browser) ───

const API_KEY_PUBLIC = API_KEY;

async function fetchJsonSafe(url, opts = {}) {
  const { timeoutMs = 12000, ...fetchOpts } = opts;
  const ownsController = !fetchOpts.signal;
  const controller = ownsController ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), Number(timeoutMs) || 12000)
    : null;
  try {
    const res = await fetch(url, {
      credentials: 'include',
      ...fetchOpts,
      signal: fetchOpts.signal || controller?.signal,
      headers: {
        Accept: 'application/json',
        ...(fetchOpts.headers || {}),
      },
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text?.slice?.(0, 500) };
    }
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    // Network / CORS / offline — never throw (was "Failed to fetch" killing sync_account)
    return {
      ok: false,
      status: 0,
      data: null,
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function parseSessionPayload(d) {
  if (!d || typeof d !== 'object') {
    return { email: '', name: '', accessToken: '', expires: null };
  }
  const user = d.user || {};
  const accessToken = d.access_token || d.accessToken || '';
  return {
    email: user.email || d.email || '',
    name: user.name || d.name || '',
    image: user.image || '',
    accessToken: accessToken || '',
    expires: d.expires || null,
  };
}

/** Prefer page/tab cookies (content script) over SW fetch. */
async function fetchSessionFromActiveTab() {
  try {
    const tabs = await chrome.tabs.query({
      url: ['https://labs.google/*'],
    });
    if (!tabs.length) return null;
    for (const tab of tabs.slice(0, 3)) {
      try {
        // Ensure content script is present
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js'],
          });
        } catch {
          /* may already be injected */
        }
        const res = await chrome.tabs.sendMessage(tab.id, {
          type: 'FETCH_SESSION',
        });
        if (res?.ok && res.data) {
          return parseSessionPayload(res.data);
        }
      } catch (e) {
        console.warn('[AI Novel Flow] tab session', tab.id, e.message || e);
      }
    }
  } catch (e) {
    console.warn('[AI Novel Flow] fetchSessionFromActiveTab', e);
  }
  return null;
}

/** NextAuth session on labs.google — email + access_token (same as browser). */
async function fetchLabsSession() {
  // 1) Tab context first (has full cookie jar for labs.google)
  const fromTab = await fetchSessionFromActiveTab();
  if (fromTab && (fromTab.email || fromTab.accessToken)) {
    return { ...fromTab, status: 200, source: 'tab' };
  }
  // 2) Fallback: service worker fetch
  const r = await fetchJsonSafe('https://labs.google/fx/api/auth/session');
  if (!r.ok || !r.data) {
    return {
      email: '',
      name: '',
      accessToken: '',
      expires: null,
      status: r.status,
      source: 'sw',
      raw: r,
    };
  }
  return { ...parseSessionPayload(r.data), status: r.status, source: 'sw' };
}

/** Poll session and push identity to bridge — call after login / tab load. */
async function pollSessionAndNotify() {
  const session = await fetchLabsSession();
  if (session.email || session.accessToken || flowKey) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'session_poll',
          email: session.email || '',
          name: session.name || '',
          flowKeyPresent: !!flowKey,
          flowKey: flowKey || '',
          expires: session.expires || null,
          source: session.source || 'unknown',
        }),
      );
    }
  }
  return session;
}

// Content script → PAGE_SESSION (auto after Flow tab loads)
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === 'PAGE_SESSION' && msg.data) {
    const session = parseSessionPayload(msg.data);
    console.log(
      '[AI Novel Flow] PAGE_SESSION email=',
      session.email || '—',
      'token=',
      !!(session.accessToken || flowKey),
    );
    if (session.email || session.accessToken || flowKey) {
      pollSessionAndNotify().catch(() => undefined);
    }
    reply?.({ ok: true });
    return true;
  }
  return false;
});

async function fetchCredits() {
  if (!flowKey) return { credits: null, tier: null };
  const url = `https://aisandbox-pa.googleapis.com/v1/credits?key=${API_KEY_PUBLIC}`;
  const r = await fetchJsonSafe(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${flowKey}`,
      Origin: 'https://labs.google',
      Referer: 'https://labs.google/',
    },
  });
  if (!r.ok || !r.data) return { credits: null, tier: null, status: r.status };
  const d = r.data;
  const credits =
    typeof d.credits === 'number'
      ? d.credits
      : typeof d.remainingCredits === 'number'
        ? d.remainingCredits
        : typeof d.userCredits === 'number'
          ? d.userCredits
          : typeof d.creditBalance === 'number'
            ? d.creditBalance
            : null;
  const tier =
    d.userPaygateTier ||
    d.paygateTier ||
    d.tier ||
    d.subscriptionTier?.[0] ||
    null;
  return { credits, tier, raw: d, status: r.status };
}

function unwrapTrpc(data) {
  try {
    return data?.result?.data?.json ?? data?.result?.data ?? data;
  } catch {
    return data;
  }
}

/** Harvest project ids/titles from user history (same account as browser). */
async function listProjectsFromHistory() {
  const found = new Map();
  const types = ['PINHOLE', 'ASSET_MANAGER'];
  for (const type of types) {
    const input = JSON.stringify({
      json: {
        type,
        pageSize: 40,
        responseScope: 'RESPONSE_SCOPE_UNSPECIFIED',
        cursor: null,
      },
      meta: { values: { cursor: ['undefined'] } },
    });
    const url =
      'https://labs.google/fx/api/trpc/media.fetchUserHistoryDirectly?input=' +
      encodeURIComponent(input);
    const r = await fetchJsonSafe(url, {
      method: 'GET',
      headers: flowKey
        ? { Authorization: `Bearer ${flowKey}` }
        : {},
    });
    if (!r.ok) continue;
    const inner = unwrapTrpc(r.data);
    const workflows =
      inner?.result?.userWorkflows ||
      inner?.userWorkflows ||
      inner?.workflows ||
      [];
    if (!Array.isArray(workflows)) continue;
    for (const wf of workflows) {
      const media = wf?.media || {};
      const mg = media.mediaGenerationId || media.mediaGeneration || {};
      const pid =
        mg.projectId ||
        media.projectId ||
        wf.projectId ||
        wf.metadata?.projectId ||
        '';
      if (!pid || typeof pid !== 'string') continue;
      const title =
        wf.metadata?.displayName ||
        media.displayName ||
        wf.displayName ||
        `Project ${String(pid).slice(0, 8)}`;
      if (!found.has(pid)) {
        found.set(pid, {
          id: pid,
          title: String(title).slice(0, 120),
          source: 'capture',
        });
      }
    }
  }
  return [...found.values()];
}

/** Try official-ish project list tRPC variants (best-effort). */
async function listProjectsViaTrpc() {
  const candidates = [
    {
      path: 'projectSearch.searchProjects',
      body: { json: { query: '', pageSize: 50, toolName: 'PINHOLE' } },
    },
    {
      path: 'project.listUserProjects',
      body: { json: { toolName: 'PINHOLE', pageSize: 50 } },
    },
    {
      path: 'project.searchProjects',
      body: { json: { query: '', toolName: 'PINHOLE' } },
    },
  ];
  const found = new Map();
  for (const c of candidates) {
    try {
      const url = `https://labs.google/fx/api/trpc/${c.path}`;
      const r = await fetchJsonSafe(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(flowKey ? { Authorization: `Bearer ${flowKey}` } : {}),
        },
        body: JSON.stringify(c.body),
      });
      if (!r.ok) continue;
      const inner = unwrapTrpc(r.data);
      const list =
        inner?.result?.projects ||
        inner?.projects ||
        inner?.result?.items ||
        inner?.items ||
        (Array.isArray(inner) ? inner : null);
      if (!Array.isArray(list)) continue;
      for (const p of list) {
        const id = p.projectId || p.id || p.name || '';
        if (!id) continue;
        const title =
          p.projectTitle ||
          p.title ||
          p.projectInfo?.projectTitle ||
          p.displayName ||
          `Project ${String(id).slice(0, 8)}`;
        found.set(String(id), {
          id: String(id),
          title: String(title).slice(0, 120),
          source: 'capture',
        });
      }
      if (found.size) break;
    } catch {
      /* try next */
    }
  }
  return [...found.values()];
}

/**
 * The Flow home page already contains canonical project links even when its
 * createProject tRPC response never completes in an extension fetch. Harvest
 * those observable links as the primary, account-cookie-bound project source.
 */
async function listProjectsFromPage() {
  const tabs = await ensureSingleFlowTab({ active: false });
  const tabId = tabs[0]?.id;
  if (tabId == null) return [];
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const anchors = Array.from(
        document.querySelectorAll('a[href*="/tools/flow/project/"]'),
      );
      return anchors.map((anchor) => {
        const href = anchor.href;
        const match = href.match(/\/tools\/flow\/project\/([^/?#]+)/i);
        const id = match?.[1] || '';
        let title = String(anchor.textContent || '')
          .replace(/\s+/g, ' ')
          .trim();
        let node = anchor.parentElement;
        for (let depth = 0; node && depth < 10 && !title; depth += 1) {
          const lines = String(node.innerText || '')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(
              (line) =>
                line &&
                !/^(edit|delete|chỉnh sửa dự án|xoá dự án)$/i.test(line),
            );
          if (lines.length) title = lines[0];
          node = node.parentElement;
        }
        return {
          id,
          title: title || `Project ${id.slice(0, 8)}`,
          source: 'capture',
        };
      });
    },
  });
  return (results[0]?.result || []).filter((project) => project?.id);
}

async function listFlowProjects() {
  const fromPage = await listProjectsFromPage().catch(() => []);
  let fromTrpc = [];
  let fromHistory = [];
  if (!fromPage.length) {
    [fromTrpc, fromHistory] = await Promise.all([
      listProjectsViaTrpc(),
      listProjectsFromHistory(),
    ]);
  }
  const map = new Map();
  for (const p of [...fromPage, ...fromTrpc, ...fromHistory]) {
    if (!p?.id) continue;
    const prev = map.get(p.id);
    if (!prev || (p.title && p.title.length > (prev.title || '').length)) {
      map.set(p.id, p);
    }
  }
  // Merge stored projectId from extension storage
  try {
    const stored = await chrome.storage.local.get(['projectId', 'projectsCache']);
    if (stored.projectId && !map.has(stored.projectId)) {
      map.set(stored.projectId, {
        id: stored.projectId,
        title: `Project ${String(stored.projectId).slice(0, 8)}`,
        source: 'capture',
      });
    }
    if (Array.isArray(stored.projectsCache)) {
      for (const p of stored.projectsCache) {
        if (p?.id && !map.has(p.id)) map.set(p.id, p);
      }
    }
  } catch {
    /* ignore */
  }
  const projects = [...map.values()];
  chrome.storage.local.set({ projectsCache: projects });
  return projects;
}

async function openFlowProject(projectId) {
  const pid = String(projectId || '').trim();
  const url = pid
    ? `https://labs.google/fx/tools/flow/project/${pid}`
    : 'https://labs.google/fx/tools/flow';
  const tabs = await chrome.tabs.query({
    url: ['https://labs.google/fx/*tools/flow*', 'https://labs.google/fx/tools/flow*'],
  });
  if (tabs.length) {
    await chrome.tabs.update(tabs[0].id, { url, active: false });
    return { ok: true, tabId: tabs[0].id, url, action: 'navigated' };
  }
  const tab = await chrome.tabs.create({ url, active: false });
  return { ok: true, tabId: tab.id, url, action: 'created' };
}

async function syncAccountIdentity() {
  console.log('[AI Novel Flow] sync_account — harvest session/credits/projects');
  const steps = [];
  const challengeTabs = await queryGoogleChallengeTabs();
  if (challengeTabs.length) {
    return {
      ok: false,
      challengeRequired: true,
      email: '',
      name: '',
      flowKeyPresent: false,
      credits: null,
      paygateTier: null,
      projects: [],
      projectId: null,
      syncedAt: Date.now(),
      steps: ['GOOGLE_CHALLENGE_REQUIRED: complete verification in Chromium'],
    };
  }
  // Ensure we have a Flow context (cookies) when possible
  try {
    const tabs = await chrome.tabs.query({
      url: ['https://labs.google/*'],
    });
    if (!tabs.length) {
      const opened = await ensureSingleFlowTab({
        active: false,
        allowCreate: true,
      });
      if (opened[0]?.id != null) {
        await wakeTabForAutomation(opened[0].id, { stealFocus: false });
      }
      await sleep(3500);
      steps.push('Opened hidden Flow tab for session cookies');
    }
  } catch (e) {
    steps.push(
      `Open Flow tab: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Retry session a few times (login redirect may lag)
  let session = { email: '', name: '', accessToken: '', status: 0 };
  try {
    session = await fetchLabsSession();
  } catch (e) {
    steps.push(
      `fetchLabsSession: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  for (let i = 0; i < 6 && !session.email; i++) {
    await sleep(1500);
    try {
      session = await fetchLabsSession();
    } catch {
      /* ignore */
    }
  }
  // NextAuth session proves identity only. Generation Bearer must come from
  // actual aisandbox/Flow request headers captured by webRequest.
  if (!flowKey) {
    try {
      await forceTokenHarvest();
      await sleep(1500);
      session = await fetchLabsSession();
    } catch {
      /* ignore */
    }
  }

  let creditsInfo = { credits: null, tier: null, status: 0 };
  let projects = [];
  try {
    creditsInfo = await fetchCredits();
  } catch (e) {
    steps.push(
      `credits: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  try {
    projects = await listFlowProjects();
  } catch (e) {
    steps.push(
      `projects: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Prefer active project from storage if still in list
  let activeProjectId = null;
  try {
    const st = await chrome.storage.local.get(['projectId']);
    activeProjectId = st.projectId || null;
  } catch {
    /* ignore */
  }
  if (!activeProjectId && projects[0]) activeProjectId = projects[0].id;

  const email = session.email || '';
  const ready = !!(email && email.includes('@'));

  const identity = {
    ok: ready,
    email,
    name: session.name || '',
    image: session.image || '',
    sessionExpires: session.expires || null,
    flowKeyPresent: !!flowKey,
    credits:
      typeof creditsInfo.credits === 'number' ? creditsInfo.credits : null,
    paygateTier: creditsInfo.tier || null,
    projects,
    projectId: activeProjectId,
    syncedAt: Date.now(),
    steps: [
      email
        ? `Session: ${email}`
        : `Session HTTP ${session.status || session.source || '?'} (chưa email — đăng nhập Google trên tab Flow)`,
      typeof creditsInfo.credits === 'number'
        ? `Credits: ${creditsInfo.credits}`
        : `Credits: n/a (HTTP ${creditsInfo.status || '?'})`,
      `Projects: ${projects.length}`,
      ...steps,
    ],
  };

  chrome.storage.local.set({
    accountIdentity: identity,
    projectId: activeProjectId || undefined,
  });
  console.log('[AI Novel Flow] sync_account done', identity.steps);
  return identity;
}

// ─── State & Popup ──────────────────────────────────────────

function setState(newState) {
  state = newState;
  const badges = { idle: '●', running: '▶', off: '○' };
  const colors = { idle: '#22c55e', running: '#f59e0b', off: '#6b7280' };
  chrome.action.setBadgeText({ text: badges[state] || '' });
  chrome.action.setBadgeBackgroundColor({ color: colors[state] || '#000' });
  broadcastStatus();
}

function broadcastStatus() {
  chrome.runtime.sendMessage({ type: 'STATUS_PUSH' }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, _, reply) => {
  if (msg.type === 'STATUS') {
    reply({
      connected: ws?.readyState === WebSocket.OPEN,
      agentConnected: ws?.readyState === WebSocket.OPEN,
      flowKeyPresent: !!flowKey,
      manualDisconnect,
      tokenAge: metrics.tokenCapturedAt ? Date.now() - metrics.tokenCapturedAt : null,
      metrics: {
        requestCount: metrics.requestCount,
        successCount: metrics.successCount,
        failedCount: metrics.failedCount,
        lastError: metrics.lastError,
      },
      state,
    });
  }

  if (msg.type === 'DISCONNECT') {
    manualDisconnect = true;
    if (ws) ws.close();
    reply({ ok: true });
    return true;
  }

  if (msg.type === 'RECONNECT') {
    manualDisconnect = false;
    connectToAgent();
    reply({ ok: true });
    return true;
  }

  if (msg.type === 'REQUEST_LOG') {
    reply({ log: requestLog });
    return true;
    return true;
  }

  if (msg.type === 'TRPC_MEDIA_URLS') {
    handleTrpcMediaUrls(msg.trpcUrl, msg.body);
    reply({ ok: true });
    return true;
  }

  if (msg.type === 'SNIFFED_AISANDBOX_REQUEST') {
    console.log('[Flow Agent] SNIFFED aisandbox request:', msg.url);
    fetch('http://127.0.0.1:8101/api/ext/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'sniffed_video_request',
        url: msg.url,
        method: msg.method,
        payload: msg.payload,
        timestamp: msg.timestamp,
      }),
    }).catch((e) => console.error('[Flow Agent] Failed to forward sniffed request:', e));
    reply({ ok: true });
    return true;
  }

  return true;
});

// ─── TRPC Media URL Extractor ──────────────────────────────

function handleTrpcMediaUrls(trpcUrl, bodyText) {
  try {
    // Extract all fresh GCS signed URLs
    const urlRegex = /https:\/\/storage\.googleapis\.com\/ai-sandbox-videofx\/(?:image|video)\/[0-9a-f-]{36}\?[^"'\s]+/g;
    const matches = bodyText.match(urlRegex) || [];
    if (!matches.length) return;

    // Deduplicate and parse
    const urlMap = {};
    for (const rawUrl of matches) {
      // Unescape JSON-escaped URLs
      const url = rawUrl.replace(/\\u0026/g, '&').replace(/\\/g, '');
      const mediaMatch = url.match(/\/(image|video)\/([0-9a-f-]{36})\?/);
      if (mediaMatch) {
        const [, mediaType, mediaId] = mediaMatch;
        // Keep last occurrence (freshest)
        urlMap[mediaId] = { mediaType, url, mediaId };
      }
    }

    const entries = Object.values(urlMap);
    if (!entries.length) return;

    console.log(`[Flow Agent] Captured ${entries.length} fresh media URLs from TRPC`);
    // URL refresh is silent — don't show in request log

    // Forward to agent for DB update
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'media_urls_refresh',
        urls: entries,
      }));
    }
  } catch (e) {
    console.error('[Flow Agent] Failed to extract TRPC media URLs:', e);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Human-like Telemetry ──────────────────────────────────
// Periodically send tracking events to Google's analytics endpoints
// to mimic normal browser behavior.

const _UA = navigator.userAgent;
let _telemetrySessionId = `;${Date.now()}`;

function _rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function _buildBatchLogPayload() {
  const events = [];
  const types = ['FLOW_IMAGE_LATENCY', 'FLOW_VIDEO_LATENCY'];
  const count = _rand(1, 3);
  for (let i = 0; i < count; i++) {
    events.push({
      event: types[_rand(0, types.length - 1)],
      eventProperties: [
        { key: 'CURRENT_TIME_MS', doubleValue: Date.now() },
        { key: 'DURATION_MS', doubleValue: _rand(150, 800) },
        { key: 'USER_AGENT', stringValue: _UA },
        { key: 'IS_DESKTOP', booleanValue: true },
      ],
      eventMetadata: { sessionId: _telemetrySessionId },
      eventTime: new Date().toISOString(),
    });
  }
  return { appEvents: events };
}

function _buildFrontendEventsPayload() {
  const eventTypes = [
    'FLOW_IMAGE_LATENCY', 'FLOW_VIDEO_LATENCY', 'GRID_SCROLL_DEPTH',
    'FLOW_PROJECT_OPEN', 'FLOW_SCENE_VIEW',
  ];
  const count = _rand(1, 4);
  const events = [];
  for (let i = 0; i < count; i++) {
    const et = eventTypes[_rand(0, eventTypes.length - 1)];
    const params = {
      USER_AGENT: { '@type': 'type.googleapis.com/google.protobuf.StringValue', value: _UA },
      IS_DESKTOP: { '@type': 'type.googleapis.com/google.protobuf.StringValue', value: 'true' },
    };
    if (et.includes('LATENCY')) {
      params.CURRENT_TIME_MS = { '@type': 'type.googleapis.com/google.protobuf.StringValue', value: String(Date.now()) };
      params.DURATION_MS = { '@type': 'type.googleapis.com/google.protobuf.StringValue', value: String(_rand(100, 600)) };
    }
    if (et === 'GRID_SCROLL_DEPTH') {
      params.MEDIA_GENERATION_PAYGATE_TIER = { '@type': 'type.googleapis.com/google.protobuf.StringValue', value: 'PAYGATE_TIER_TWO' };
    }
    events.push({
      eventType: et,
      metadata: {
        sessionId: _telemetrySessionId,
        createTime: new Date().toISOString(),
        additionalParams: params,
      },
    });
  }
  return { events };
}

async function sendTelemetry() {
  if (!flowKey || state === 'off') return;

  const headers = {
    'Content-Type': 'text/plain;charset=UTF-8',
    'authorization': `Bearer ${flowKey}`,
  };

  // Telemetry is silent — don't show in request log
  try {
    if (Math.random() < 0.5) {
      await fetch(`https://aisandbox-pa.googleapis.com/v1:batchLog`, {
        method: 'POST', headers, credentials: 'include',
        body: JSON.stringify(_buildBatchLogPayload()),
      });
    } else {
      await fetch(`https://aisandbox-pa.googleapis.com/v1/flow:batchLogFrontendEvents`, {
        method: 'POST', headers, credentials: 'include',
        body: JSON.stringify(_buildFrontendEventsPayload()),
      });
    }
  } catch {}
}

// Send telemetry at random intervals (45-120s) to look organic
function scheduleTelemetry() {
  const delay = _rand(45, 120) * 1000;
  setTimeout(async () => {
    await sendTelemetry();
    scheduleTelemetry(); // reschedule with new random interval
  }, delay);
}

// Refresh session ID every ~30min like a real user
setInterval(() => { _telemetrySessionId = `;${Date.now()}`; }, _rand(25, 35) * 60 * 1000);

scheduleTelemetry();

// MV3 workers may be evaluated after an unpacked-extension update without an
// onInstalled/onStartup callback. Initialize on every worker evaluation too.
init().catch((error) =>
  console.error('[AI Novel Flow] startup init failed', error),
);

console.log('[AI Novel Flow Bridge] Extension loaded → ws://127.0.0.1:9223');
