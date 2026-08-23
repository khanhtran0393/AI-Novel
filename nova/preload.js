/**
 * Preload — cầu nối an toàn giữa web UI và Electron (contextBridge).
 * Giai đoạn 1 chưa cần API native; để sẵn để Giai đoạn 2 (gọi Flow trực tiếp,
 * proxy per-account, lưu file, FFmpeg…) expose hàm ra window.native qua đây.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('native', {
  isDesktop: true,
  platform: process.platform,
  // Flow tích hợp sẵn (trình duyệt nhúng) — UI gọi flowBridge → window.native.flow.
  flow: (action, payload) => ipcRenderer.invoke('flow', action, payload),
  // Flow qua Chrome Extension thật (bridge HTTP cục bộ).
  flowExt: (action, payload) => ipcRenderer.invoke('flowExt', action, payload),
  flowBridgeStatus: () => ipcRenderer.invoke('flowBridgeStatus'),
  // Native tools local: dựng video MP4 bằng FFmpeg.
  renderVideo: (payload) => ipcRenderer.invoke('render-video', payload),
  renderCancel: () => ipcRenderer.invoke('render-video-cancel'),
  ffmpegInfo: () => ipcRenderer.invoke('ffmpeg-info'),
  onRenderProgress: (cb) => ipcRenderer.on('render-video-progress', (_e, s) => cb(s)),
  // Nâng cấp ảnh (Real-ESRGAN local, offline).
  upscaleProbe: () => ipcRenderer.invoke('upscale-probe'),
  upscalePickImages: () => ipcRenderer.invoke('upscale-pick-images'),
  upscalePickFolder: () => ipcRenderer.invoke('upscale-pick-folder'),
  upscalePickOutdir: () => ipcRenderer.invoke('upscale-pick-outdir'),
  upscaleRun: (payload) => ipcRenderer.invoke('upscale-run', payload),
  wmInpaint: (base64, mime) => ipcRenderer.invoke('wm-inpaint', { base64, mime }),
  upscaleCancel: () => ipcRenderer.invoke('upscale-cancel'),
  onUpscaleProgress: (cb) => ipcRenderer.on('upscale-progress', (_e, s) => cb(s)),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  llmFetch: (opts) => ipcRenderer.invoke('llm-fetch', opts),   // gọi LLM qua main process (né CORS)
  readFileB64: (p) => ipcRenderer.invoke('read-file-b64', p),
  // Tự động lưu ảnh/video về máy.
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  saveFile: (payload) => ipcRenderer.invoke('save-file', payload),
  exportDir: () => ipcRenderer.invoke('export-dir'),
  loginWindow: (isLogin) => ipcRenderer.invoke('login-window', isLogin),
  flowCftAdd: () => ipcRenderer.invoke('flow-cft-add'),
  flowCftCancel: () => ipcRenderer.invoke('flow-cft-cancel'),
  onFlowCftProgress: (cb) => ipcRenderer.on('flow-cft-progress', (_e, o) => cb(o)),
  // Engine Chrome thật đa profile (GĐ1 test).
  flowChrome: (action, payload) => ipcRenderer.invoke('flowChrome', action, payload),
  // Bơm N token sang extension (chế độ 1 tab + N token).
  flowPushExt: () => ipcRenderer.invoke('flow-push-ext'),
  // Log tiến trình chính (làm mới token…) → tab Nhật ký.
  onNovaLog: (cb) => ipcRenderer.on('nova-log', (_e, line) => cb(line)),
  // Thông số hệ thống thật (RAM/CPU) cho thanh trạng thái.
  sysStats: () => ipcRenderer.invoke('sys-stats'),
  // Voice native (OmniVoice) — khởi động backend giọng nói.
  voiceStart: () => ipcRenderer.invoke('voice-start'),
  voiceStatus: () => ipcRenderer.invoke('voice-status'),
  voiceProbe: () => ipcRenderer.invoke('voice-probe'),
  voicePickRoot: () => ipcRenderer.invoke('voice-pick-root'),
  voiceInstallBackend: () => ipcRenderer.invoke('voice-install-backend'),
  flowExtExport: () => ipcRenderer.invoke('flow-ext-export'),
  onVoiceLog: (cb) => ipcRenderer.on('voice-log', (_e, s) => cb(s)),
  // Watermark native — xoá watermark/logo (đặc biệt watermark Flow/Veo).
  wmProbe: () => ipcRenderer.invoke('wm-probe'),
  wmRemoveFile: (input, output, opts) => ipcRenderer.invoke('wm-remove-file', { input, output, opts }),
  wmRemoveFolder: (input, output, opts) => ipcRenderer.invoke('wm-remove-folder', { input, output, opts }),
  wmPreview: (input, opts) => ipcRenderer.invoke('wm-preview', { input, opts }),
  wmCancel: () => ipcRenderer.invoke('wm-cancel'),
  wmPickRoot: () => ipcRenderer.invoke('wm-pick-root'),
  wmTestFile: (opts) => ipcRenderer.invoke('wm-test-file', { opts }),
  onWmLog: (cb) => ipcRenderer.on('wm-log', (_e, s) => cb(s)),
  // Phiên bản app + cập nhật (thông báo hiện ở góc trên phải).
  appVersion: () => ipcRenderer.invoke('app-version'),
  onUpdate: (cb) => ipcRenderer.on('update-status', (_e, s) => cb(s)),
  updateDownload: () => ipcRenderer.invoke('update-download'),
  updateInstall: () => ipcRenderer.invoke('update-install'),
});
