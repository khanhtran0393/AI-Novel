/**
 * Preload — cầu nối an toàn giữa web UI và Electron (contextBridge).
 * Giai đoạn 1 chưa cần API native; để sẵn để Giai đoạn 2 (gọi Flow trực tiếp,
 * proxy per-account, lưu file, FFmpeg…) expose hàm ra window.native qua đây.
 */
const { contextBridge, ipcRenderer } = require('electron');

// Kho cài đặt bền (API key…) — đọc NGAY tại preload (sendSync) để trang có dữ liệu
// từ dòng script đầu tiên. localStorage gắn với origin http://localhost:<port>,
// port đổi hoặc Chromium dọn kho là mất key; file trong userData thì không.
let _storeSeed = {};
try { _storeSeed = ipcRenderer.sendSync('settings-store-all') || {}; } catch (e) { _storeSeed = {}; }

contextBridge.exposeInMainWorld('novaStore', {
  seed: _storeSeed,
  set: (key, value) => { try { return ipcRenderer.sendSync('settings-store-set', { [key]: value }); } catch (e) { return false; } },
  del: (key) => { try { return ipcRenderer.sendSync('settings-store-set', { [key]: null }); } catch (e) { return false; } },
});

contextBridge.exposeInMainWorld('native', {
  isDesktop: true,
  platform: process.platform,
  // Phân tích đối thủ thông minh (outlier view + Claude gợi ý ý tưởng).
  analyzeCompetitor: (payload) => ipcRenderer.invoke('nova:analyzeCompetitor', payload),
  onCompetitorProgress: (cb) => ipcRenderer.on('nova:analyzeCompetitorProgress', (_e, s) => cb(s)),
  // Thumbnail tham chiếu: tìm outlier theo chủ đề / lấy từ link video.
  thumbOutliers: (payload) => ipcRenderer.invoke('nova:thumbOutliers', payload),
  thumbFromUrl: (payload) => ipcRenderer.invoke('nova:thumbFromUrl', payload),
  onThumbOutliersProgress: (cb) => ipcRenderer.on('nova:thumbOutliersProgress', (_e, s) => cb(s)),
  // Tìm Ngách (Niche Finder) — 6 module.
  niche: {
    attention: (p) => ipcRenderer.invoke('nova:niche:attention', p),
    hot: (p) => ipcRenderer.invoke('nova:niche:hot', p),
    scorecard: (p) => ipcRenderer.invoke('nova:niche:scorecard', p),
    similar: (p) => ipcRenderer.invoke('nova:niche:similar', p),
    bw: (p) => ipcRenderer.invoke('nova:niche:bw', p),
  },
  onNicheProgress: (cb) => ipcRenderer.on('nova:nicheProgress', (_e, s) => cb(s)),
  // Cầu nối Tool 2 → Editor Pro (đưa ảnh cảnh + thoại sang timeline).
  sceneBridgePush: (payload) => ipcRenderer.invoke('nova:sceneBridge:push', payload),
  // Tạo tự động (AI) — sinh video hoàn chỉnh từ chủ đề/kịch bản.
  autoVideo: (payload) => ipcRenderer.invoke('nova:autoVideo', payload),
  onAutoVideoProgress: (cb) => ipcRenderer.on('nova:autoVideoProgress', (_e, s) => cb(s)),
  // Cắt clip YouTube khớp cảnh (smart-clip: search+score+vision+golden-ratio).
  smartClip: (payload) => ipcRenderer.invoke('nova:smartClip', payload),
  probeVideo: (url) => ipcRenderer.invoke('nova:probeVideo', url),   // thời lượng + heatmap + storyboard, không cắt
  onSmartClipProgress: (cb) => ipcRenderer.on('nova:smartClipProgress', (_e, s) => cb(s)),
  parallaxClip: (payload) => ipcRenderer.invoke('nova:parallaxClip', payload),
  // 🌐 Nguồn web (50 nền tảng): fetch qua main vì Bing/DDG/Dailymotion không gửi header CORS.
  // Khớp lời: bóc băng video nguồn rồi tìm đúng giây khớp lời thoại cảnh.
  khopLoi: (payload) => ipcRenderer.invoke('nova:khopLoi', payload),
  onKhopLoiProgress: (cb) => ipcRenderer.on('nova:khopLoiProgress', (_e, s) => cb(s)),
  nguonWeb: {
    get: (p) => ipcRenderer.invoke('web:get', p),        // GET thô (API JSON hoặc trang HTML)
    info: (p) => ipcRenderer.invoke('web:info', p),      // yt-dlp đọc tiêu đề/thời lượng/ảnh của 1 URL bất kỳ
    search: (p) => ipcRenderer.invoke('web:search', p),  // ytsearch của yt-dlp
    clip: (p) => ipcRenderer.invoke('web:clip', p),      // tải + cắt đúng số giây của cảnh
  },
  onParallaxProgress: (cb) => ipcRenderer.on('nova:parallaxProgress', (_e, s) => cb(s)),
  renderRemotion: (payload) => ipcRenderer.invoke('remotion:renderVideo', payload),   // xuất video bằng Remotion (bit hiệu ứng) từ luồng auto
  renderNovaScenes: (payload) => ipcRenderer.invoke('remotion:renderNovaScenes', payload),   // xuất bằng engine Nova Scene (spec JSON do AI sinh)
  sceneTemplates: () => ipcRenderer.invoke('nova:sceneTemplates'),
  sceneTransitions: () => ipcRenderer.invoke('nova:sceneTransitions'),
  sceneBits: () => ipcRenderer.invoke('nova:sceneBits'),
  fxPreviews: () => ipcRenderer.invoke('nova:fxPreviews'),
  previewLayers: (p) => ipcRenderer.invoke('nova:previewLayers', p),                            // danh mục mẫu đồ hoạ cho AI chọn
  onRemotionProgress2: (cb) => ipcRenderer.on('remotion:progress', (_e, s) => cb(s)),
  onRemotionProgress: (cb) => ipcRenderer.on('remotion:progress', (_e, s) => cb && cb(s)),
  // Thư viện Hiệu ứng âm thanh (SFX) dựng sẵn.
  sfxLibrary: () => ipcRenderer.invoke('nova:sfxLibrary:list'),
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
  llmFetch: (opts) => ipcRenderer.invoke('llm-fetch', opts),
  ttsFetch: (opts) => ipcRenderer.invoke('tts-fetch', opts),   // như trên nhưng nhận audio nhị phân   // gọi LLM qua main process (né CORS)
  readFileB64: (p) => ipcRenderer.invoke('read-file-b64', p),
  // Tự động lưu ảnh/video về máy.
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  pickMediaFile: (kind) => ipcRenderer.invoke('pick-media-file', kind),   // chọn ảnh/video cho ô media của lớp
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
