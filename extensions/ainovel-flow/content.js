/**
 * Content script — bridge between background.js and injected.js
 * Injects injected.js into MAIN world to access window.grecaptcha
 * Also harvests labs.google auth/session with page cookies (SW fetch often misses them).
 */
(function () {
  const s = document.createElement('script');
  s.src = chrome.runtime.getURL('injected.js');
  s.onload = () => s.remove();
  (document.head || document.documentElement).appendChild(s);

  // After page load: push session once (không spam 3 lần → tránh logout/login loop)
  if (location.hostname === 'labs.google') {
    let pushed = false;
    const pushSession = () => {
      if (pushed) return;
      pushed = true;
      fetch('/fx/api/auth/session', { credentials: 'include', cache: 'no-store' })
        .then((r) => r.json().catch(() => ({})))
        .then((data) => {
          chrome.runtime
            .sendMessage({ type: 'PAGE_SESSION', data, url: location.href })
            .catch(() => {});
        })
        .catch(() => {});
    };
    if (document.readyState === 'complete') setTimeout(pushSession, 1200);
    else window.addEventListener('load', () => setTimeout(pushSession, 1200));
  }
})();

chrome.runtime.onMessage.addListener((msg, _, reply) => {
  if (msg.type === 'FETCH_SESSION') {
    // Prefer absolute URL — relative /fx/... fails if content script ran on non-labs origin
    const sessionUrls = [
      'https://labs.google/fx/api/auth/session',
      '/fx/api/auth/session',
    ];
    const tryOne = (i) => {
      if (i >= sessionUrls.length) {
        reply({ ok: false, error: 'Failed to fetch session' });
        return;
      }
      fetch(sessionUrls[i], { credentials: 'include', cache: 'no-store' })
        .then((r) => r.json().catch(() => ({})))
        .then((data) => reply({ ok: true, data, url: sessionUrls[i] }))
        .catch(() => tryOne(i + 1));
    };
    tryOne(0);
    return true;
  }

  if (msg.type === 'FLOW_TRPC_REQUEST') {
    const request = msg.request || {};
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    fetch(request.url, {
      method: request.method || 'POST',
      headers: request.headers || { 'Content-Type': 'application/json' },
      body: request.body ? JSON.stringify(request.body) : undefined,
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const text = await response.text();
        let data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = { raw: text.slice(0, 1000) };
        }
        reply({
          ok: true,
          responseOk: response.ok,
          status: response.status,
          data,
        });
      })
        .catch((error) =>
          reply({
            ok: false,
            error:
              error?.name === 'AbortError'
                ? 'TRPC_CONTENT_TIMEOUT'
                : error instanceof Error
                  ? error.message
                  : String(error),
          }),
        )
        .finally(() => clearTimeout(timeoutId));
    return true;
  }

  if (msg.type !== 'GET_CAPTCHA') return;

  const { requestId, pageAction } = msg;

  const handler = (e) => {
    if (e.detail?.requestId === requestId) {
      window.removeEventListener('CAPTCHA_RESULT', handler);
      clearTimeout(timer);
      reply({ token: e.detail.token, error: e.detail.error });
    }
  };

  const timer = setTimeout(() => {
    window.removeEventListener('CAPTCHA_RESULT', handler);
    reply({ error: 'CONTENT_TIMEOUT' });
  }, 25000);

  window.addEventListener('CAPTCHA_RESULT', handler);

  window.dispatchEvent(new CustomEvent('GET_CAPTCHA', {
    detail: { requestId, pageAction },
  }));

  return true; // keep channel open for async reply
});

// ─── TRPC Media URL Monitor ─────────────────────────────────
// Forward intercepted TRPC responses with media URLs to background.js
window.addEventListener('TRPC_MEDIA_URLS', (e) => {
  const { url, body } = e.detail || {};
  if (!body) return;
  chrome.runtime.sendMessage({
    type: 'TRPC_MEDIA_URLS',
    trpcUrl: url,
    body,
  }).catch(() => {});
});

// ─── Aisandbox Request Sniffer (via postMessage from MAIN world) ──
window.addEventListener('message', (e) => {
  if (e.data?.type !== '__FLOWKIT_SNIFF__') return;
  const { url, body, method } = e.data;
  if (!url) return;
  chrome.runtime.sendMessage({
    type: 'SNIFFED_AISANDBOX_REQUEST',
    url,
    method,
    payload: body,
    timestamp: Date.now(),
  }).catch(() => {});
});

// ─── Video Upload Relay ─────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _, reply) => {
  if (msg.type !== 'UPLOAD_VIDEO') return;

  const { requestId, videoBase64, projectId } = msg;

  const handler = (e) => {
    if (e.detail?.requestId === requestId) {
      window.removeEventListener('UPLOAD_VIDEO_RESULT', handler);
      clearTimeout(timer);
      reply(e.detail);
    }
  };

  const timer = setTimeout(() => {
    window.removeEventListener('UPLOAD_VIDEO_RESULT', handler);
    reply({ error: 'UPLOAD_TIMEOUT' });
  }, 120000); // 2 min timeout for large uploads

  window.addEventListener('UPLOAD_VIDEO_RESULT', handler);

  window.dispatchEvent(new CustomEvent('UPLOAD_VIDEO', {
    detail: { requestId, videoBase64, projectId },
  }));

  return true; // keep channel open for async reply
});
