/**
 * Content script — cầu nối giữa background.js và injected.js (chạy trên tab
 * labs.google/fx/tools/flow). Nhiệm vụ duy nhất: nhờ injected.js (MAIN world)
 * chạy grecaptcha.enterprise.execute rồi trả token về cho background.
 */
(function () {
  const s = document.createElement('script');
  s.src = chrome.runtime.getURL('injected.js');
  s.onload = () => s.remove();
  (document.head || document.documentElement).appendChild(s);
})();

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
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
  window.dispatchEvent(new CustomEvent('GET_CAPTCHA', { detail: { requestId, pageAction } }));

  return true; // giữ kênh mở cho reply bất đồng bộ
});
