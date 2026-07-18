/**
 * AI Novel Flow Bridge — Chrome Extension Background Service Worker
 *
 * Connects to local AI Novel bridge via WebSocket (bridge runs WS server).
 * Captures bearer token, solves reCAPTCHA, proxies API calls through browser.
 */

// AI Novel Flow Bridge — ports offset from stock Flow Agent (9222/8100)
const AGENT_WS_URL = 'ws://127.0.0.1:9223';
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
      await forceTokenHarvest();
    } else {
      chrome.alarms.clear('token-harvest');
    }
  }
});

/**
 * Harvest session/token.
 * IMPORTANT: bare flowKey without labs session email is NOT "done" —
 * keep polling so Google login can complete (do not early-return on stale ya29).
 */
async function forceTokenHarvest() {
  console.log('[AI Novel Flow] forceTokenHarvest…');
  let session = await pollSessionAndNotify();
  const hasEmail = !!(session?.email && String(session.email).includes('@'));

  // Stale storage token without email: still open Flow tab to finish Google login
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

  const tabs = await chrome.tabs.query({
    url: [
      'https://labs.google/fx/tools/flow*',
      'https://labs.google/fx/*/tools/flow*',
      'https://labs.google/*',
    ],
  });
  if (!tabs.length) {
    try {
      await chrome.tabs.create({
        url: 'https://labs.google/fx/tools/flow',
        active: true,
      });
      await sleep(3500);
    } catch (e) {
      console.warn('[AI Novel Flow] open Flow failed', e);
    }
  } else {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        files: ['content.js'],
      });
    } catch {
      /* ignore */
    }
    // Soft reload once if no email yet (page may still be on accounts.google.com redirect)
    if (!hasEmail) {
      try {
        const u = tabs[0].url || '';
        if (u.includes('labs.google') && !u.includes('accounts.google')) {
          /* keep */
        }
      } catch {
        /* ignore */
      }
    }
  }

  // Retry session a few times while user may still be finishing login
  for (let i = 0; i < 4; i++) {
    session = await pollSessionAndNotify();
    if (session?.email && String(session.email).includes('@')) break;
    if (session?.accessToken || flowKey) {
      // token without email — keep waiting for Google
    }
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
  const data = await chrome.storage.local.get(['flowKey', 'metrics', 'callbackSecret']);
  if (data.flowKey) flowKey = data.flowKey;
  if (data.metrics) Object.assign(metrics, data.metrics);
  if (data.callbackSecret) callbackSecret = data.callbackSecret;
  connectToAgent();
  chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });
}

// ─── Token Capture ──────────────────────────────────────────

function acceptBearerToken(raw, source) {
  if (!raw || typeof raw !== 'string') return false;
  const token = raw.replace(/^Bearer\s+/i, '').trim();
  // Accept ya29 and other OAuth access tokens (not only ya29.)
  if (token.length < 20) return false;
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
    pollSessionAndNotify().catch((e) =>
      console.warn('[AI Novel Flow] tab poll session', e),
    );
  }
});

let _openingFlowTab = false;

async function captureTokenFromFlowTab() {
  const tabs = await chrome.tabs.query({
    url: ['https://labs.google/fx/tools/flow*', 'https://labs.google/fx/*/tools/flow*'],
  });
  if (!tabs.length) {
    if (_openingFlowTab) {
      console.log('[Flow Agent] Flow tab already opening, skipping');
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
        sendToAgent({
          id: msg.id,
          result: {
            state,
            flowKeyPresent: !!flowKey,
            manualDisconnect,
            tokenAge: metrics.tokenCapturedAt ? Date.now() - metrics.tokenCapturedAt : null,
            metrics,
          },
        });
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
          const harvest = await forceTokenHarvest();
          sendToAgent({
            id: msg.id,
            result: {
              ok: true,
              flowKeyPresent: !!flowKey,
              email: harvest?.email || '',
              sessionReady: !!(
                harvest?.email && String(harvest.email).includes('@')
              ),
            },
          });
        } catch (e) {
          sendToAgent({ id: msg.id, error: e.message || 'HARVEST_FAILED' });
        }
      } else if (msg.method === 'close_login_session') {
        // AI Novel: after token captured — minimize; Node kills login process shortly after
        console.log('[AI Novel Flow] close_login_session — minimize + blur windows');
        try {
          chrome.alarms.clear('token-harvest');
          const wins = await chrome.windows.getAll({ populate: false });
          for (const w of wins) {
            try {
              await chrome.windows.update(w.id, {
                state: 'minimized',
                focused: false,
              });
            } catch (e) {
              /* ignore */
            }
          }
          sendToAgent({ id: msg.id, result: { ok: true, minimized: wins.length } });
        } catch (e) {
          sendToAgent({ id: msg.id, error: e.message || 'CLOSE_FAILED' });
        }
      } else if (msg.method === 'open_flow_tab') {
        // Python bridge asks us to open/focus a Flow tab
        console.log('[Flow Agent] Agent requested: open Flow tab');
        const tabs = await chrome.tabs.query({
          url: ['https://labs.google/fx/tools/flow*', 'https://labs.google/fx/*/tools/flow*'],
        });
        if (tabs.length) {
          // Tab exists — refresh it to trigger fresh API calls → token capture
          await chrome.tabs.reload(tabs[0].id);
          console.log('[Flow Agent] Refreshed existing Flow tab');
        } else {
          // No tab — open one (active so it loads properly)
          await chrome.tabs.create({ url: 'https://labs.google/fx/tools/flow', active: true });
          console.log('[Flow Agent] Opened new Flow tab');
        }
        // Wait for page to load and make API calls that trigger token capture
        await sleep(5000);
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
      } else if (msg.method === 'refresh_flow_tab') {
        // Python bridge asks us to refresh token
        console.log('[Flow Agent] Agent requested: refresh token');
        await captureTokenFromFlowTab();
        await sleep(3000);
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
    fetch('http://127.0.0.1:8101/api/ext/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

// ─── reCAPTCHA Solving ──────────────────────────────────────

async function requestCaptchaFromTab(tabId, requestId, pageAction) {
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
  const tabs = await chrome.tabs.query({
    url: ['https://labs.google/fx/tools/flow*', 'https://labs.google/fx/*/tools/flow*'],
  });

  if (!tabs.length) {
    // Auto-open Flow tab and wait briefly before returning error
    try {
      await chrome.tabs.create({ url: 'https://labs.google/fx/tools/flow', active: false });
      await sleep(3000);
      // Retry tab query after opening
      const retryTabs = await chrome.tabs.query({
        url: ['https://labs.google/fx/tools/flow*', 'https://labs.google/fx/*/tools/flow*'],
      });
      if (!retryTabs.length) return { error: 'NO_FLOW_TAB' };
      const resp = await Promise.race([
        requestCaptchaFromTab(retryTabs[0].id, requestId, captchaAction),
        new Promise((_, rej) => setTimeout(() => rej(new Error('CAPTCHA_TIMEOUT')), 30000)),
      ]);
      return resp;
    } catch (e) {
      return { error: e.message || 'NO_FLOW_TAB' };
    }
  }

  try {
    const resp = await Promise.race([
      requestCaptchaFromTab(tabs[0].id, requestId, captchaAction),
      new Promise((_, rej) => setTimeout(() => rej(new Error('CAPTCHA_TIMEOUT')), 30000)),
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
  const { url, method = 'POST', headers = {}, body } = params;

  if (!url || !url.startsWith('https://labs.google/')) {
    sendToAgent({ id, error: 'INVALID_TRPC_URL' });
    return;
  }

  setState('running');
  // TRPC calls don't consume captcha — don't count in metrics

  const logId = id;
  const logType = url.includes('createProject') ? 'CREATE_PROJECT' : 'TRPC';
  // TRPC calls are silent — don't show in request log

  const fetchHeaders = { 'Content-Type': 'application/json', ...headers };
  if (flowKey) {
    fetchHeaders['authorization'] = `Bearer ${flowKey}`;
  }

  try {
    const resp = await fetch(url, {
      method,
      headers: fetchHeaders,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include',
    });
    const data = await resp.json();
    chrome.storage.local.set({ metrics });
    updateRequestLog(logId, { status: 'success' });
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

async function handleApiRequest(msg) {
  const { id, params } = msg;
  const { url, method, headers, body, captchaAction } = params;

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
  if (_VISIBLE_TYPES.has(logType)) {
    const payloadSummary = body ? JSON.stringify(body).slice(0, 200) : null;
    addRequestLog({ id: logId, type: logType, time: new Date().toISOString(), status: 'processing', error: null, outputUrl: null, url, payloadSummary });
  }

  try {
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

    // Step 4: Make the API call from browser context
    const response = await fetch(url, {
      method: method || 'POST',
      headers: fetchHeaders,
      credentials: 'include',
      body: method === 'GET' ? undefined : JSON.stringify(finalBody),
    });

    let responseData;
    const responseText = await response.text();
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
  try {
    const res = await fetch(url, {
      credentials: 'include',
      ...opts,
      headers: {
        Accept: 'application/json',
        ...(opts.headers || {}),
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
  }
}

function parseSessionPayload(d) {
  if (!d || typeof d !== 'object') {
    return { email: '', name: '', accessToken: '', expires: null };
  }
  const user = d.user || {};
  const accessToken = d.access_token || d.accessToken || '';
  if (accessToken) acceptBearerToken(String(accessToken), 'auth/session');
  return {
    email: user.email || d.email || '',
    name: user.name || d.name || '',
    image: user.image || '',
    accessToken: flowKey || accessToken || '',
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
          flowKey: flowKey || session.accessToken || '',
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

async function listFlowProjects() {
  const fromTrpc = await listProjectsViaTrpc();
  const fromHistory = await listProjectsFromHistory();
  const map = new Map();
  for (const p of [...fromTrpc, ...fromHistory]) {
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
  // Ensure we have a Flow context (cookies) when possible
  try {
    const tabs = await chrome.tabs.query({
      url: ['https://labs.google/*'],
    });
    if (!tabs.length) {
      await chrome.tabs.create({
        url: 'https://labs.google/fx/tools/flow',
        active: true,
      });
      await sleep(3500);
      steps.push('Opened Flow tab for session cookies');
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
  // Prefer session access_token over leftover webRequest scrap
  if (session.accessToken && session.accessToken.length >= 20) {
    acceptBearerToken(String(session.accessToken), 'sync:session');
  }
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
  }

  if (msg.type === 'OPEN_FLOW_TAB') {
    chrome.tabs.query({
      url: ['https://labs.google/fx/tools/flow*', 'https://labs.google/fx/*/tools/flow*'],
    }).then((tabs) => {
      if (tabs.length) {
        chrome.tabs.update(tabs[0].id, { active: true });
        reply({ ok: true, tabId: tabs[0].id });
      } else {
        chrome.tabs.create({ url: 'https://labs.google/fx/tools/flow' })
          .then((tab) => reply({ ok: true, tabId: tab.id }))
          .catch((e) => reply({ error: e.message }));
      }
    }).catch((e) => reply({ error: e.message }));
    return true;
  }

  if (msg.type === 'REFRESH_TOKEN') {
    captureTokenFromFlowTab()
      .then(() => reply({ ok: true }))
      .catch((e) => reply({ error: e.message }));
    return true;
  }

  if (msg.type === 'TEST_CAPTCHA') {
    solveCaptcha(`test-${Date.now()}`, msg.pageAction || 'IMAGE_GENERATION')
      .then((r) => reply(r))
      .catch((e) => reply({ error: e.message }));
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

console.log('[AI Novel Flow Bridge] Extension loaded → ws://127.0.0.1:9223');
