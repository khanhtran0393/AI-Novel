/**
 * Cầu nối Flow Image Gen ↔ trang novastudio.
 *
 * Chạy như content script trên novastudio.web.app. Trang web KHÔNG gọi trực
 * tiếp được extension (khác context), nên trao đổi qua window.postMessage:
 *
 *   Trang  →  { source:'FLOWGEN_PAGE', id, action, payload }
 *   Bridge →  { source:'FLOWGEN_EXT',  id, ok, result | error }
 *
 * Bridge chuyển tiếp action tới background service worker qua chrome.runtime,
 * rồi trả kết quả về trang. Cũng phát 'READY' để trang biết đã cài extension.
 */

const ALLOWED_ACTIONS = new Set(['GET_STATUS', 'GET_ACCOUNTS', 'SCAN', 'OPEN_FLOW_TAB', 'CREATE_PROJECT', 'GEN_IMAGE', 'UPLOAD_IMAGE', 'POOL_RESET', 'POOL_GEN', 'GET_BEARER', 'DOWNLOAD_FILE', 'GEN_VIDEO', 'GEN_VIDEO_FROM_IMAGE']);

function announce() {
  window.postMessage({ source: 'FLOWGEN_EXT', type: 'READY', version: chrome.runtime.getManifest().version }, window.location.origin);
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || msg.source !== 'FLOWGEN_PAGE') return;

  const { id, action, payload } = msg;

  // Trang chỉ hỏi "có extension không?"
  if (action === 'PING') { announce(); return; }

  if (!ALLOWED_ACTIONS.has(action)) {
    window.postMessage({ source: 'FLOWGEN_EXT', id, ok: false, error: 'ACTION_NOT_ALLOWED' }, window.location.origin);
    return;
  }

  let bgMsg;
  if (action === 'CREATE_PROJECT') bgMsg = { type: 'CREATE_PROJECT', title: payload?.title };
  else if (action === 'GEN_IMAGE') bgMsg = { type: 'GEN_IMAGE', params: payload };
  else if (action === 'UPLOAD_IMAGE') bgMsg = { type: 'UPLOAD_IMAGE', params: payload };
  else if (action === 'POOL_GEN') bgMsg = { type: 'POOL_GEN', params: payload };
  else if (action === 'DOWNLOAD_FILE') bgMsg = { type: 'DOWNLOAD_FILE', params: payload };
  else if (action === 'GEN_VIDEO') bgMsg = { type: 'GEN_VIDEO', params: payload };
  else if (action === 'GEN_VIDEO_FROM_IMAGE') bgMsg = { type: 'GEN_VIDEO_FROM_IMAGE', params: payload };
  else bgMsg = { type: action };

  try {
    chrome.runtime.sendMessage(bgMsg, (result) => {
      const err = chrome.runtime.lastError;
      if (err) {
        window.postMessage({ source: 'FLOWGEN_EXT', id, ok: false, error: err.message || 'RUNTIME_ERROR' }, window.location.origin);
        return;
      }
      window.postMessage({ source: 'FLOWGEN_EXT', id, ok: true, result }, window.location.origin);
    });
  } catch (e) {
    window.postMessage({ source: 'FLOWGEN_EXT', id, ok: false, error: e.message || 'SEND_FAILED' }, window.location.origin);
  }
});

// Phát READY khi tải xong (và lại lần nữa khi trang đã sẵn sàng nghe).
announce();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', announce);
}
