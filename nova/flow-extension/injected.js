/**
 * Chạy trong MAIN world trên labs.google — có quyền truy cập window.grecaptcha.
 * Giải reCAPTCHA Enterprise cho mỗi lần gọi API tạo ảnh/video.
 * NÂNG CẤP: TỰ DÒ site key hiện tại của Flow (bền hơn hardcode — Flow đổi key vẫn chạy).
 * Bọc IIFE + cờ chặn để không lỗi khi bị tiêm lại nhiều lần.
 */
(function () {
  if (window.__flowGenCaptchaReady) return;   // đã đăng ký rồi → bỏ qua lần tiêm sau
  window.__flowGenCaptchaReady = true;

  const FALLBACK_SITE_KEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';

  // Dò site key HIỆN TẠI của trang Flow: ưu tiên ___grecaptcha_cfg, rồi thẻ script recaptcha, cuối cùng fallback.
  function detectSiteKey() {
    try {
      if (typeof ___grecaptcha_cfg !== 'undefined' && ___grecaptcha_cfg.clients) {
        const cs = ___grecaptcha_cfg.clients;
        for (const id of Object.keys(cs)) {
          const c = cs[id];
          for (const k in c) {
            const o = c[k];
            if (o && typeof o === 'object') {
              for (const k2 in o) {
                const v = o[k2];
                if (v && typeof v === 'object' && v.sitekey) return v.sitekey;
              }
            }
          }
        }
      }
    } catch (e) {}
    try {
      const sc = document.querySelectorAll('script[src*="recaptcha"]');
      for (const s of sc) {
        const m = s.src.match(/[?&]render=([^&]+)/);
        if (m && m[1] && m[1] !== 'explicit') return m[1];
      }
    } catch (e) {}
    return FALLBACK_SITE_KEY;
  }

  window.addEventListener('GET_CAPTCHA', async ({ detail }) => {
    const { requestId, pageAction } = detail;
    try {
      await waitForGrecaptcha();
      const token = await window.grecaptcha.enterprise.execute(detectSiteKey(), { action: pageAction });
      window.dispatchEvent(new CustomEvent('CAPTCHA_RESULT', { detail: { requestId, token } }));
    } catch (e) {
      window.dispatchEvent(new CustomEvent('CAPTCHA_RESULT', { detail: { requestId, error: e.message } }));
    }
  });

  function waitForGrecaptcha(timeout = 12000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        if (window.grecaptcha?.enterprise?.execute) return resolve();
        if (Date.now() - start > timeout) return reject(new Error('grecaptcha not available'));
        setTimeout(check, 200);
      };
      check();
    });
  }
})();
