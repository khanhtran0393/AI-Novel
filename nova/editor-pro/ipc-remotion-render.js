// Render Remotion ĐẦY ĐỦ (text/motion/composition) bằng @remotion/renderer + bundle tĩnh + chrome vendored.
// Bundle tĩnh: editor-pro/remotion-bundle. Compositor đã ký ad-hoc (gỡ hardened) → set DYLD cho ffmpeg con.
const { dialog, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const DIR = __dirname;
// Trong app đóng gói, __dirname nằm TRONG app.asar — chỉ đọc được, KHÔNG ghi được, và Remotion
// cần phục vụ file thật từ đĩa. Các thư mục nặng đã nằm trong asarUnpack nên trỏ sang bản đã bung.
const UNPACKED = DIR.includes('app.asar') && !DIR.includes('app.asar.unpacked')
  ? DIR.replace('app.asar', 'app.asar.unpacked') : DIR;
function onDisk(rel) {
  const a = path.join(UNPACKED, rel);
  if (fs.existsSync(a)) return a;
  return path.join(DIR, rel);            // chạy từ mã nguồn (dev)
}
const BUNDLE = onDisk('remotion-bundle');
const COMPOSITOR = path.join(DIR, 'node_modules', '@remotion', 'compositor-darwin-arm64');
const TMP = path.join(os.tmpdir(), 'nova-editor-pro');
try { fs.mkdirSync(TMP, { recursive: true }); } catch (_) {}

function findBrowser() {
  const root = onDisk('remotion-browser');
  const stack = [root];
  while (stack.length) {
    const d = stack.pop();
    let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { continue; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name === 'chrome-headless-shell') return p;
    }
  }
  return null;
}
const BROWSER = findBrowser();

async function renderRemotionFull({ composition, outputPath, onProgress }) {
  // remotion-bundle đã gỡ khỏi bản này (chỉ bàn dựng Editor Pro dùng, mà bàn
  // dựng đó không còn lối vào). App chính xuất video bằng renderNovaScenes.
  if (!fs.existsSync(BUNDLE)) return { ok: false, error: 'Đường render Remotion cũ đã gỡ — dùng Dựng Video (Nova Scene) để xuất.' };
  // ffmpeg con (đã gỡ hardened) cần DYLD trỏ dylib compositor — set trước khi renderMedia spawn nó
  if (fs.existsSync(COMPOSITOR)) {
    process.env.DYLD_LIBRARY_PATH = COMPOSITOR + (process.env.DYLD_LIBRARY_PATH ? ':' + process.env.DYLD_LIBRARY_PATH : '');
  }
  const { selectComposition, renderMedia } = require('@remotion/renderer');
  const inputProps = { composition };
  const browserExecutable = BROWSER || undefined;
  const comp = await selectComposition({ serveUrl: BUNDLE, id: 'VideoShuffleComposition', inputProps, browserExecutable });
  const out = outputPath || path.join(TMP, `nova-export-${Date.now()}.mp4`);
  await renderMedia({
    composition: comp, serveUrl: BUNDLE, codec: 'h264', outputLocation: out, inputProps, browserExecutable,
    concurrency: Math.max(2, Math.min(6, (os.cpus() || []).length - 2)),
    onProgress: ({ progress }) => { try { onProgress && onProgress(Math.round(progress * 100), 'Đang render (Remotion)…'); } catch (_) {} },
  });
  return { ok: true, outputPath: out, engine: 'remotion' };
}

// ── NOVA SCENE ENGINE ───────────────────────────────────────────────────────
// Bundle riêng (nova-remotion) thông dịch SPEC JSON do AI sinh cho từng cảnh.
// Thời lượng do calculateMetadata tính từ spec → luôn khớp giây của cảnh.
const NOVA_BUNDLE = onDisk(path.join('nova-remotion', 'bundle'));

// Remotion CHỈ tải được asset qua http/https hoặc đường dẫn tương đối trong thư mục phục vụ —
// ném file:// hay đường dẫn tuyệt đối vào <OffthreadVideo> sẽ lỗi "Can only download URLs starting with http".
// Nên: chép file cục bộ vào bundle/assets/ rồi đổi src thành đường dẫn tương đối.
// (Ảnh thì Tool 7 đã nhúng sẵn dạng data URL nên không qua đây.)
function stageLocalAssets(scenes) {
  const dir = path.join(NOVA_BUNDLE, 'assets');
  let staged = 0;
  const map = new Map();
  const fix = (src) => {
    const s = String(src || '');
    if (!s || /^(https?:|data:|assets\/)/i.test(s)) return s;     // đã dùng được, để nguyên
    const abs = s.replace(/^file:\/\//, '');
    if (!path.isAbsolute(abs) || !fs.existsSync(abs)) return s;
    if (map.has(abs)) return map.get(abs);
    try {
      fs.mkdirSync(dir, { recursive: true });
      const name = 'a' + staged + '_' + path.basename(abs).replace(/[^\w.-]/g, '_');
      fs.copyFileSync(abs, path.join(dir, name));
      const rel = 'assets/' + name;
      map.set(abs, rel); staged++;
      return rel;
    } catch (_) { return s; }
  };
  /* Quét MỌI trường chuỗi của lớp, không chỉ `src`.
     Lớp thường mang đường dẫn ở `src`, nhưng lớp MẪU mang ở tên tham số riêng
     của mẫu — `nen`, `anh`, và cả mảng `the[]`. Bản cũ chỉ sửa `src` nên mọi
     mẫu dùng media ở trường khác đều 404 lúc render (đã đo: mẫu moc-thoi-gian,
     chong-the, dan-chung đều chết). Quét chung thì thêm mẫu mới cũng không phải
     nhớ khai báo lại ở đây.                                                  */
  const walk = (L) => {
    if (!L || typeof L !== 'object') return;
    for (const k of Object.keys(L)) {
      const v = L[k];
      if (typeof v === 'string') { const r = fix(v); if (r !== v) L[k] = r; }
      else if (Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) if (typeof v[i] === 'string') { const r = fix(v[i]); if (r !== v[i]) v[i] = r; }
      }
    }
  };
  (Array.isArray(scenes) ? scenes : []).forEach(sp => (sp && Array.isArray(sp.layers) ? sp.layers : []).forEach(walk));
  return staged;
}

// Nova Scene render ra video CÂM (Remotion chỉ dựng hình từ spec). Ghép giọng đọc + nhạc nền
// bằng ffmpeg ngay sau đó, để bản xuất dùng được luôn chứ không phải tự ghép tay.
function muxAudio({ videoPath, voiceB64, musicB64, musicVolume = 0.22 }) {
  if (!voiceB64 && !musicB64) return videoPath;
  const FFMPEG = require('./ff-path').FFMPEG;   // đường dẫn đã gỡ khỏi app.asar (spawn được)
  const { spawnSync } = require('child_process');
  const write = (b64, ext) => {
    if (!b64) return null;
    const raw = String(b64).replace(/^data:[^,]+,/, '');
    const f = path.join(TMP, `au-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`);
    try { fs.writeFileSync(f, Buffer.from(raw, 'base64')); return f; } catch (_) { return null; }
  };
  const voice = write(voiceB64, 'mp3'), music = write(musicB64, 'mp3');
  if (!voice && !music) return videoPath;
  const out = videoPath.replace(/\.mp4$/i, '') + '-audio.mp4';
  const args = ['-y', '-i', videoPath];
  if (voice) args.push('-i', voice);
  if (music) args.push('-i', music);
  if (voice && music) {
    // Nhạc nền hạ âm lượng và cắt theo độ dài video; giọng đọc giữ nguyên.
    args.push('-filter_complex', `[2:a]volume=${musicVolume}[m];[1:a][m]amix=inputs=2:duration=first:dropout_transition=0[a]`, '-map', '0:v', '-map', '[a]');
  } else {
    args.push('-map', '0:v', '-map', '1:a');
    if (music && !voice) args.push('-filter:a', `volume=${musicVolume}`);
  }
  args.push('-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', out);
  const r = spawnSync(FFMPEG, args, { stdio: 'ignore' });
  [voice, music].forEach(f => { if (f) try { fs.unlinkSync(f); } catch (_) {} });
  if (r.status !== 0 || !fs.existsSync(out)) return videoPath;      // ghép hỏng → trả bản câm, đừng mất công render lại
  try { fs.unlinkSync(videoPath); } catch (_) {}
  try { fs.renameSync(out, videoPath); return videoPath; } catch (_) { return out; }
}

async function renderNovaScenes({ scenes, globals, outputPath, onProgress, voiceB64, musicB64, musicVolume }) {
  if (!fs.existsSync(NOVA_BUNDLE)) return { ok: false, error: 'Thiếu nova-remotion/bundle — chạy: node editor-pro/nova-remotion/build.js' };
  try { const n = stageLocalAssets(scenes); if (n) onProgress && onProgress(1, `Đã đưa ${n} file media vào bundle…`); } catch (_) {}
  if (fs.existsSync(COMPOSITOR)) {
    process.env.DYLD_LIBRARY_PATH = COMPOSITOR + (process.env.DYLD_LIBRARY_PATH ? ':' + process.env.DYLD_LIBRARY_PATH : '');
  }
  const { selectComposition, renderMedia } = require('@remotion/renderer');
  const inputProps = { scenes: Array.isArray(scenes) ? scenes : [], globals: Array.isArray(globals) ? globals : [] };
  const browserExecutable = BROWSER || undefined;
  const comp = await selectComposition({ serveUrl: NOVA_BUNDLE, id: 'NovaSequence', inputProps, browserExecutable });
  const out = outputPath || path.join(TMP, `nova-scene-${Date.now()}.mp4`);
  await renderMedia({
    composition: comp, serveUrl: NOVA_BUNDLE, codec: 'h264', outputLocation: out, inputProps, browserExecutable,
    concurrency: Math.max(2, Math.min(6, (os.cpus() || []).length - 2)),
    onProgress: ({ progress }) => { try { onProgress && onProgress(Math.round(progress * 100), 'Đang render (Nova Scene)…'); } catch (_) {} },
  });
  let finalPath = out;
  if (voiceB64 || musicB64) {
    try { onProgress && onProgress(98, 'Ghép giọng đọc + nhạc nền…'); finalPath = muxAudio({ videoPath: out, voiceB64, musicB64, musicVolume }); } catch (_) {}
  }
  return { ok: true, outputPath: finalPath, engine: 'nova-scene', durationInFrames: comp.durationInFrames, fps: comp.fps, hasAudio: !!(voiceB64 || musicB64) };
}

function registerEditorProRemotion(ipcMain) {
  // Danh mục mẫu đồ hoạ — renderer hỏi để nhồi vào prompt cho AI. Lấy thẳng từ templates.js
  // thay vì chép sang index.html, để hai nơi không lệch nhau khi thêm mẫu mới.
  const chCat = 'nova:sceneTemplates';
  try { ipcMain.removeHandler(chCat); } catch (_) {}
  ipcMain.handle(chCat, async () => {
    try { return { ok: true, items: require('./nova-remotion/src/templates').catalog() }; }
    catch (err) { return { ok: false, error: String(err && err.message || err).slice(0, 200) }; }
  });

  // Lớp đồ hoạ tại 1 thời điểm, đã tính sẵn CSS — để bản xem trước ở Tool 7 vẽ bằng DOM.
  const chPv = 'nova:previewLayers';
  try { ipcMain.removeHandler(chPv); } catch (_) {}
  ipcMain.handle(chPv, async (e, payload = {}) => {
    try {
      delete require.cache[require.resolve('./nova-remotion/src/preview')];
      const { previewAt } = require('./nova-remotion/src/preview');
      return { ok: true, items: previewAt(payload.spec, Number(payload.t) || 0, payload.sceneSrc) };
    } catch (err) { return { ok: false, error: String(err && err.message || err).slice(0, 200) }; }
  });

  // Ảnh xem trước của kho hiệu ứng — trả DATA URL để renderer khỏi lo đường dẫn asar.
  // 60 ảnh × ~5KB = 292KB, nạp 1 lần rồi cache trong renderer.
  const chPrev = 'nova:fxPreviews';
  try { ipcMain.removeHandler(chPrev); } catch (_) {}
  ipcMain.handle(chPrev, async () => {
    try {
      const dir = onDisk(path.join('nova-remotion', 'previews'));
      if (!fs.existsSync(dir)) return { ok: true, items: {} };
      const out = {};
      for (const f of fs.readdirSync(dir)) {
        if (!/\.jpg$/i.test(f)) continue;
        const key = f.replace(/\.jpg$/i, '');
        try { out[key] = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(dir, f)).toString('base64'); } catch (_) {}
      }
      return { ok: true, items: out };
    } catch (err) { return { ok: false, error: String(err && err.message || err).slice(0, 200) }; }
  });

  // Danh sách bit Remotion dùng được — đọc thẳng từ BitRegistry.tsx bằng regex
  // (file .tsx nên main process không require được, nhưng chỉ cần LẤY TÊN nên đọc văn bản là đủ).
  const chBit = 'nova:sceneBits';
  try { ipcMain.removeHandler(chBit); } catch (_) {}
  ipcMain.handle(chBit, async () => {
    try {
      const f = path.join(__dirname, 'nova-remotion', 'src', 'bits', 'BitRegistry.tsx');
      const src = fs.readFileSync(f, 'utf8');
      const i = src.indexOf('export const BIT_REGISTRY');
      const ids = [...src.slice(i).matchAll(/'([a-z0-9][a-z0-9-]{2,30})'\s*:\s*\{\s*\n?\s*id:/g)].map(m => m[1]);
      // connecting-lines thiếu tham số bắt buộc → render lỗi, loại khỏi danh sách cho người dùng.
      return { ok: true, items: [...new Set(ids)].filter(x => x !== 'connecting-lines').sort() };
    } catch (err) { return { ok: false, error: String(err && err.message || err).slice(0, 200) }; }
  });

  // Danh mục 38 chuyển cảnh (bê từ video-creator Fractal, phần dựng viết lại ở transitions.js).
  const chTr = 'nova:sceneTransitions';
  try { ipcMain.removeHandler(chTr); } catch (_) {}
  ipcMain.handle(chTr, async () => {
    try { return { ok: true, items: require('./nova-remotion/src/transitions').catalog() }; }
    catch (err) { return { ok: false, error: String(err && err.message || err).slice(0, 200) }; }
  });

  // Kênh riêng cho engine Nova Scene — KHÔNG đụng 'remotion:renderVideo' (bundle cũ) để hai luồng sống song song.
  const chNova = 'remotion:renderNovaScenes';
  try { ipcMain.removeHandler(chNova); } catch (_) {}
  ipcMain.handle(chNova, async (e, payload = {}) => {
    try {
      try { fs.writeFileSync(path.join(TMP, 'last-nova-scenes.json'), JSON.stringify(payload.scenes || [], null, 2)); } catch (_) {}
      let outputPath = payload.outputPath;
      if (!outputPath) {
        const w = BrowserWindow.fromWebContents(e.sender) || BrowserWindow.getFocusedWindow();
        const r = await dialog.showSaveDialog(w, { defaultPath: `nova-scene-${Date.now()}.mp4`, filters: [{ name: 'MP4', extensions: ['mp4'] }] });
        if (r.canceled) return { ok: false, error: 'Đã huỷ' };
        outputPath = r.filePath;
      }
      const onProgress = (p, msg) => { try { e.sender.send('remotion:progress', { percent: p, message: msg }); } catch (_) {} };
      return await renderNovaScenes({ scenes: payload.scenes, globals: payload.globals, outputPath, onProgress, voiceB64: payload.voiceB64, musicB64: payload.musicB64, musicVolume: payload.musicVolume });
    } catch (err) { return { ok: false, error: String(err && err.message || err).slice(0, 300) }; }
  });

  const ch = 'remotion:renderVideo';
  try { ipcMain.removeHandler(ch); } catch (_) {}
  ipcMain.handle(ch, async (e, payload = {}) => {
    try {
      try { fs.writeFileSync(path.join(TMP, 'last-composition.json'), JSON.stringify(payload.composition || payload, null, 2)); } catch (_) {}
      let outputPath = payload.outputPath;
      if (!outputPath) {
        const w = BrowserWindow.fromWebContents(e.sender) || BrowserWindow.getFocusedWindow();
        const r = await dialog.showSaveDialog(w, { defaultPath: `nova-export-${Date.now()}.mp4`, filters: [{ name: 'MP4', extensions: ['mp4'] }] });
        if (r.canceled) return { ok: false, error: 'Đã huỷ' };
        outputPath = r.filePath;
      }
      const onProgress = (p, msg) => { try { e.sender.send('remotion:progress', { percent: p, message: msg }); } catch (_) {} };
      const composition = payload.composition || payload;
      try {
        return await renderRemotionFull({ composition, outputPath, onProgress });
      } catch (err) {
        // fallback ffmpeg MVP nếu Remotion lỗi
        try {
          const { renderComposition } = require('./ipc-render');
          const r = await renderComposition({ composition, outputPath, onProgress });
          return { ...r, engine: 'ffmpeg-fallback', remotionError: String(err && err.message || err) };
        } catch (_) { return { ok: false, error: 'Remotion: ' + String(err && err.message || err).slice(0, 300) }; }
      }
    } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  });
  return [ch, chNova];
}

module.exports = { registerEditorProRemotion, renderRemotionFull, renderNovaScenes };
