/**
 * Native Tools — chạy LOCAL trong app (không cần cloud/API):
 *   - renderVideo: ghép ảnh (theo độ dài từng cảnh) + audio → MP4 bằng FFmpeg (ffmpeg-static).
 *   - (sắp có) transcribe: Whisper local để căn timing, thay Groq/OpenAI.
 * Gọi từ renderer qua window.native.renderVideo(...) → ipc 'render-video'.
 */

const { app, dialog, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

// ffmpeg-static trả path tới binary; khi đóng gói (asar) cần trỏ vào bản unpack.
function binPath(mod) {
  let p;
  try { p = require(mod); } catch { return null; }
  if (p && typeof p === 'object') p = p.path;               // ffprobe-static trả {path}
  if (!p) return null;
  // Trong app đóng gói: node_modules nằm trong app.asar.unpacked
  return p.replace('app.asar', 'app.asar.unpacked');
}
const FFMPEG = binPath('ffmpeg-static');
const { gpuEncoder, qualityArgs: gpuQualityArgs, label: gpuLabel } = require('./editor-pro/gpu-encoder');
const FFPROBE = binPath('ffprobe-static');

function run(bin, args, onLog, onChild) {
  return new Promise((resolve, reject) => {
    if (!bin || !fs.existsSync(bin)) return reject(new Error('Không tìm thấy FFmpeg binary'));
    const cp = spawn(bin, args, { windowsHide: true });
    if (onChild) try { onChild(cp); } catch (e) {}
    let err = '';
    cp.stderr.on('data', (d) => { err += d; if (onLog) onLog(String(d)); });
    cp.on('error', reject);
    cp.on('close', (code) => code === 0 ? resolve(err) : reject(new Error('FFmpeg lỗi (' + code + '): ' + err.slice(-500))));
  });
}

// Đo độ dài (giây) 1 file media bằng ffprobe. Trả 0 nếu không đo được.
function probeDur(file) {
  return new Promise((resolve) => {
    if (!FFPROBE || !fs.existsSync(file)) return resolve(0);
    const cp = spawn(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { windowsHide: true });
    let out = '';
    cp.stdout.on('data', (d) => { out += d; });
    cp.on('error', () => resolve(0));
    cp.on('close', () => resolve(Math.max(0, Number(String(out).trim()) || 0)));
  });
}

// Tiến trình render hiện tại (để Hủy).
const _render = { proc: null, canceled: false, outPath: null };
function cancelRender() {
  if (!_render.proc) return { ok: false, reason: 'no-proc' };
  _render.canceled = true;
  try { _render.proc.kill('SIGKILL'); } catch (e) {}
  return { ok: true };
}

function dataUrlToBuffer(dataUrl) {
  const s = String(dataUrl || '');
  const comma = s.indexOf(',');
  const b64 = comma >= 0 ? s.slice(comma + 1) : s;
  return Buffer.from(b64, 'base64');
}

/**
 * payload = {
 *   images: [{ dataUrl, dur }],   // dur = giây cho ảnh đó
 *   audioDataUrl?: string,        // audio nền (mp3/wav) — tùy chọn
 *   width=1920, height=1080, fps=30,
 *   crf=20,                       // chất lượng (thấp = nét hơn)
 *   defaultDur=4                  // độ dài mặc định nếu ảnh thiếu dur
 * }
 * Mở hộp thoại Lưu → xuất MP4. Trả { ok, path } hoặc { canceled } / { error }.
 */
// Hiệu ứng Ken Burns cho 1 ảnh tĩnh (zoom/pan). df = số frame xuất ra.
function _kenBurns(effect, i, W, H, fps, df) {
  const pad = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`;
  let eff = effect;
  if (eff === 'random') eff = ['zoom-in', 'zoom-out', 'pan-left', 'pan-right'][i % 4];
  if (eff === 'none') return `${pad},fps=${fps},format=yuv420p`;
  const up = `${pad},scale=${W * 2}:${H * 2}`;    // phóng 2x cho zoompan mượt
  const dz = 0.15;
  let z, x, y;
  if (eff === 'zoom-in') { z = `1+${dz}*on/${df}`; x = `iw/2-(iw/zoom/2)`; y = `ih/2-(ih/zoom/2)`; }
  else if (eff === 'zoom-out') { z = `${1 + dz}-${dz}*on/${df}`; x = `iw/2-(iw/zoom/2)`; y = `ih/2-(ih/zoom/2)`; }
  else if (eff === 'pan-left') { z = `1.08`; x = `(iw-iw/zoom)*on/${df}`; y = `ih/2-(ih/zoom/2)`; }
  else if (eff === 'pan-right') { z = `1.08`; x = `(iw-iw/zoom)*(1-on/${df})`; y = `ih/2-(ih/zoom/2)`; }
  else if (eff === 'pan-up') { z = `1.08`; x = `iw/2-(iw/zoom/2)`; y = `(ih-ih/zoom)*(1-on/${df})`; }
  else { z = `1.08`; x = `iw/2-(iw/zoom/2)`; y = `(ih-ih/zoom)*on/${df}`; }  // pan-down
  return `${up},zoompan=z='${z}':x='${x}':y='${y}':d=${df}:s=${W}x${H}:fps=${fps},setsar=1,format=yuv420p`;
}
// 🎨 Bộ lọc màu: Gốc/Ấm/Lạnh/Phim (áp cho cả ảnh & video).
function _colorFilter(f) {
  const eff = String(f || 'none').toLowerCase();
  if (eff === 'warm' || eff === 'am' || eff === 'ấm') return ',colorbalance=rs=.10:gs=.03:bs=-.12,eq=saturation=1.12:gamma=1.02';
  if (eff === 'cool' || eff === 'lanh' || eff === 'lạnh') return ',colorbalance=rs=-.12:gs=0:bs=.14,eq=saturation=1.04:contrast=1.03';
  if (eff === 'film' || eff === 'phim' || eff === 'cine') return ',curves=r=\'0/0.03 0.5/0.5 1/0.96\':b=\'0/0.06 1/0.94\',eq=saturation=0.88:contrast=1.08';
  return '';
}
// 🔍 Tỷ lệ ảnh: phóng to (>1 → cắt giữa) hoặc thu nhỏ (<1 → viền đen). Áp SAU khi khung đã đúng WxH.
function _scaleZoom(scale, W, H) {
  const f = Number(scale) || 1;
  if (!(f > 0) || Math.abs(f - 1) < 0.001) return '';
  const ev = (n) => Math.max(2, Math.round(n / 2) * 2);
  const w = ev(W * f), h = ev(H * f);
  if (f > 1) return `,scale=${w}:${h},crop=${W}:${H}`;
  return `,scale=${w}:${h},pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`;
}
function _xfadeName(t) {
  return ({ fade: 'fade', slide: 'slideleft', wipe: 'wipeleft', dissolve: 'dissolve', circle: 'circleopen' })[t] || 'fade';
}

async function renderVideo(payload, win) {
  if (!FFMPEG) return { error: 'Thiếu FFmpeg (ffmpeg-static chưa cài).' };
  const imgs = Array.isArray(payload?.images) ? payload.images.filter((x) => x && x.dataUrl) : [];
  if (!imgs.length) return { error: 'Không có ảnh để dựng.' };

  const W = Math.round(payload.width || 1920);
  const H = Math.round(payload.height || 1080);
  const fps = Math.round(payload.fps || 30);
  const crf = Math.round(payload.crf || 20);
  const defDur = Math.max(0.3, Number(payload.defaultDur) || 4);
  const vcodec = payload.vcodec === 'h265' ? 'libx265' : 'libx264';
  const vbitK = payload.videoBitrateK ? Math.max(200, Math.round(payload.videoBitrateK)) : 0;   // 0 = dùng CRF

  // Nơi lưu: có outPath thì dùng thẳng (khung Xuất tự chọn), không thì mở hộp thoại.
  let outPath = payload.outPath;
  if (!outPath) {
    const save = await dialog.showSaveDialog(win || BrowserWindow.getFocusedWindow(), {
      title: 'Lưu video MP4', defaultPath: path.join(app.getPath('downloads'), 'video-' + Date.now() + '.mp4'),
      filters: [{ name: 'MP4', extensions: ['mp4'] }],
    });
    if (save.canceled || !save.filePath) return { canceled: true };
    outPath = save.filePath;
  } else {
    try { fs.mkdirSync(path.dirname(outPath), { recursive: true }); } catch (e) {}
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ckm-video-'));
  try {
    const isVid = (im) => im && im.kind === 'video';
    // Ghi từng input ra file (ảnh .png / video .mp4).
    const files = imgs.map((im, i) => {
      const f = path.join(tmp, 'in' + String(i).padStart(4, '0') + '.' + (isVid(im) ? 'mp4' : 'png'));
      fs.writeFileSync(f, dataUrlToBuffer(im.dataUrl));
      return f;
    });
    // Danh sách concat (chỉ dùng ở nhánh nhanh khi TOÀN ảnh tĩnh).
    let listTxt = '';
    imgs.forEach((im, i) => { const d = Math.max(0.3, Number(im.dur) || defDur); listTxt += `file '${files[i].replace(/'/g, "'\\''")}'\nduration ${d.toFixed(3)}\n`; });
    listTxt += `file '${files[imgs.length - 1].replace(/'/g, "'\\''")}'\n`;
    const listPath = path.join(tmp, 'list.txt');
    fs.writeFileSync(listPath, listTxt);

    // Phụ đề: ghi file .srt → hậu tố filter subtitles (libass), dùng chung 2 nhánh.
    let subFilter = '';
    if (payload.subtitlesSrt) {
      const sp = path.join(tmp, 'subs.srt');
      fs.writeFileSync(sp, String(payload.subtitlesSrt), 'utf8');
      const esc = sp.replace(/\\/g, '/').replace(/'/g, "\\'").replace(/:/g, '\\:');
      const fsStyle = payload.subStyle ? `:force_style='${String(payload.subStyle).replace(/'/g, '')}'` : '';
      subFilter = `,subtitles='${esc}'${fsStyle}`;
    }

    // Per-clip: fx (Ken Burns) + trans (chuyển sang clip sau) + transDur.
    const fxOf = (im) => String(im.fx || payload.effect || 'none');
    const trOf = (im) => String(im.trans || 'none');
    const tdOf = (im) => Math.min(2, Math.max(0.1, Number(im.transDur) || 0.5));
    const durs = imgs.map((im) => Math.max(0.3, Number(im.dur) || defDur));
    // tail_i = độ dài chuyển cảnh SAU clip i (0 nếu cắt thẳng / clip cuối)
    const tails = imgs.map((im, i) => (i < imgs.length - 1 && trOf(im) !== 'none') ? tdOf(im) : 0);
    const needFx = imgs.some((im, i) => isVid(im) || fxOf(im) !== 'none' || tails[i] > 0 || (Number(im.scale) || 1) !== 1);

    // Độ dài output = MAX(tổng cảnh, GIỌNG ĐỌC). Giọng DÀI hơn cảnh → KÉO DÀI video (giữ khung cuối) cho ĐỦ
    // giọng → KHÔNG cắt cụt narration ("thiếu 1 đoạn"). Giọng NGẮN hơn → đệm im lặng cho đủ cảnh.
    const _videoLen = durs.reduce((a, b) => a + b, 0);
    // Ghi file giọng SỚM để đo độ dài (dùng lại ở phần input audio bên dưới).
    let _voFile = null, _audioLen = 0;
    if (payload.audioDataUrl) {
      try { _voFile = path.join(tmp, 'vo.dat'); fs.writeFileSync(_voFile, dataUrlToBuffer(payload.audioDataUrl)); _audioLen = (await probeDur(_voFile)) || 0; }
      catch (e) { _voFile = null; _audioLen = 0; }
    }
    const _outDur = Math.max(_videoLen, _audioLen);
    const _holdTail = Math.max(0, _outDur - _videoLen);   // phần video phải GIỮ KHUNG CUỐI để phủ hết giọng
    // CHẨN ĐOÁN: in tổng + clip dài bất thường (clip bị "kéo dài" sẽ lộ ở đây). Xem trong /tmp/nova-start.log.
    try {
      let _mx = 0, _mi = -1; durs.forEach((d, i) => { if (d > _mx) { _mx = d; _mi = i; } });
      const _big = durs.map((d, i) => ({ i, d })).filter(x => x.d > 12).map(x => `#${x.i}=${x.d.toFixed(1)}s`).join(', ');
      console.error(`[render] clips=${imgs.length} videoLen=${_videoLen.toFixed(2)}s audioLen=${_audioLen.toFixed(2)}s outDur=${_outDur.toFixed(2)}s holdTail=${_holdTail.toFixed(2)}s needFx=${needFx} maxClip=${_mx.toFixed(2)}s@#${_mi}${_big ? ' · clip>12s: ' + _big : ''}`);
    } catch (e) {}

    // 🎞 NỐI VIDEO THỨ 2: cảnh video stock ngắn hơn độ dài cảnh + có video "nối thêm"
    // (im.fillDataUrls) → ghép các video lại thành 1 file cho vừa/đủ cảnh (không chia cảnh).
    for (let i = 0; i < imgs.length; i++) {
      const im = imgs[i];
      if (!isVid(im)) continue;
      const fills = Array.isArray(im.fillDataUrls) ? im.fillDataUrls.filter(Boolean) : [];
      if (!fills.length) continue;
      const L = durs[i] + tails[i];
      const vd0 = Number(im.vidDur) || (await probeDur(files[i]));
      if (!(vd0 > 0.1) || vd0 >= L - 0.05) continue;               // đã đủ/dài → không cần nối
      // Ghi các video nối thêm ra file, gộp dần cho tới khi ĐỦ độ dài cảnh (hoặc hết ứng viên).
      const segFiles = [files[i]];
      let total = vd0;
      for (const du of fills) {
        if (total >= L - 0.05) break;
        const ff = path.join(tmp, `fill${i}_${segFiles.length}.mp4`);
        fs.writeFileSync(ff, dataUrlToBuffer(du));
        segFiles.push(ff);
        total += (await probeDur(ff)) || 0;
      }
      if (segFiles.length < 2) continue;                           // không có gì để nối
      // Chuẩn hoá từng video về cùng WxH/fps rồi concat → 1 file.
      const combined = path.join(tmp, `comb${i}.mp4`);
      const inArgs = [];
      segFiles.forEach((f) => inArgs.push('-i', f));
      const norm = segFiles.map((f, k) => `[${k}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${fps},format=yuv420p[c${k}]`);
      const concatIn = segFiles.map((f, k) => `[c${k}]`).join('');
      const fcp = `${norm.join(';')};${concatIn}concat=n=${segFiles.length}:v=1:a=0[v]`;
      try {
        await run(FFMPEG, ['-y', ...inArgs, '-filter_complex', fcp, '-map', '[v]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-an', combined],
          (s) => { if (win && !win.isDestroyed()) win.webContents.send('render-video-progress', s); });
        files[i] = combined;
        im.vidDur = (await probeDur(combined)) || total;           // độ dài mới sau khi nối
      } catch (e) { /* nối lỗi → giữ video gốc, nhánh lặp/cắt bên dưới lo tiếp */ }
    }

    const args = ['-y'];
    let fc = '', vfinal = '', audioBase = 1;

    if (!needFx) {
      // ---- nhánh CHÍNH XÁC (ảnh tĩnh): MỖI ảnh 1 input -loop -t (đúng độ dài TỪNG cảnh) → 1 concat.
      // (KHÔNG dùng concat demuxer nữa — nó nối 193 ảnh bị LỆCH FRAME tích luỹ → kéo cảnh trước dài ra, rớt cảnh sau.)
      imgs.forEach((im, i) => { args.push('-loop', '1', '-t', Math.max(0.3, durs[i]).toFixed(3), '-i', files[i]); });
      audioBase = imgs.length;
      const scale = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${fps},format=yuv420p`;
      const parts = imgs.map((im, i) => `[${i}:v]${scale}[v${i}]`);
      const inLabels = imgs.map((im, i) => `[v${i}]`).join('');
      if (subFilter) { parts.push(`${inLabels}concat=n=${imgs.length}:v=1:a=0[vc]`); parts.push(`[vc]${subFilter.replace(/^,/, '')}[v]`); }
      else parts.push(`${inLabels}concat=n=${imgs.length}:v=1:a=0[v]`);
      fc = parts.join(';');
      vfinal = '[v]';
    } else {
      // ---- nhánh hiệu ứng: mỗi ảnh 1 input, Ken Burns per-clip + xfade/concat per-boundary ----
      imgs.forEach((im, i) => {
        const f = files[i];
        const L = durs[i] + tails[i];
        if (isVid(im)) args.push('-i', f);                              // video: dùng khung thật
        else if (fxOf(im) === 'none') args.push('-loop', '1', '-t', L.toFixed(3), '-i', f);
        else args.push('-i', f);                                        // ảnh + zoompan tự sinh frame
      });
      audioBase = imgs.length;
      const parts = [];
      imgs.forEach((im, i) => {
        const df = Math.max(1, Math.round((durs[i] + tails[i]) * fps));
        if (isVid(im)) {
          // GIỮ NGUYÊN TỐC ĐỘ: video DÀI hơn cảnh → CẮT; NGẮN hơn cảnh → LẶP cho đủ (không tua nhanh/chậm).
          const L = durs[i] + tails[i];
          const vd = Number(im.vidDur) || 0;
          const spd = Math.max(0.5, Math.min(2, Number(im.speed) || 1));
          const spf = Math.abs(spd - 1) > 0.01 ? `,setpts=${(1 / spd).toFixed(3)}*PTS` : '';   // tốc độ video (0.5–2×)
          let ch = `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${fps},format=yuv420p${spf}`;
          if (vd > 0.1 && vd < L - 0.05) {
            const nf = Math.max(1, Math.round(vd * fps));
            // ngắn hơn cảnh → lặp video cho đủ độ dài. PHẢI viết lại PTS sau loop (loop giữ nguyên timestamp cũ → trim chỉ lấy vòng đầu → ra sai độ dài).
            ch += `,loop=loop=-1:size=${nf}:start=0,setpts=N/FRAME_RATE/TB`;
          } else if (!(vd > 0.1) && tails[i] > 0) {
            ch += `,tpad=stop_mode=clone:stop_duration=${tails[i].toFixed(3)}`; // không rõ độ dài → giữ khung cuối cho phần chuyển cảnh
          }
          ch += `,trim=duration=${L.toFixed(3)},setpts=PTS-STARTPTS`;          // cắt đúng độ dài cảnh
          ch += _colorFilter(im.filter);
          parts.push(`${ch}[v${i}]`);
        } else {
          parts.push(`[${i}:v]${_kenBurns(fxOf(im), i, W, H, fps, df)}${_scaleZoom(im.scale, W, H)}${_colorFilter(im.filter)}[v${i}]`);
        }
      });
      if (imgs.length === 1) {
        vfinal = '[v0]';
      } else {
        let last = 'v0', running = durs[0];
        for (let k = 1; k < imgs.length; k++) {
          const out = 'vx' + k;
          const prevTrans = trOf(imgs[k - 1]);      // chuyển cảnh giữa k-1 và k
          if (prevTrans !== 'none') {
            const D = tdOf(imgs[k - 1]);
            parts.push(`[${last}][v${k}]xfade=transition=${_xfadeName(prevTrans)}:duration=${D.toFixed(3)}:offset=${running.toFixed(3)}[${out}]`);
          } else {
            parts.push(`[${last}][v${k}]concat=n=2:v=1:a=0[${out}]`);
          }
          last = out; running += durs[k];
        }
        vfinal = '[' + last + ']';
      }
      if (subFilter) { parts.push(`${vfinal}${subFilter.replace(/^,/, '')}[vs]`); vfinal = '[vs]'; }
      fc = parts.join(';');
    }

    // 🕒 Giọng dài hơn cảnh → GIỮ KHUNG CUỐI cho phần dư (tpad) → video phủ hết giọng, không cắt narration.
    if (_holdTail > 0.05) {
      fc += `;${vfinal}tpad=stop_mode=clone:stop_duration=${_holdTail.toFixed(3)}[vhold]`;
      vfinal = '[vhold]';
    }

    // inputs âm thanh (sau video) — dùng lại file giọng đã ghi sớm ở trên.
    let voIdx = -1, musIdx = -1, n = audioBase;
    if (_voFile) {
      args.push('-i', _voFile); voIdx = n++;
    }
    if (payload.musicDataUrl) {
      const mf = path.join(tmp, 'music.dat');
      fs.writeFileSync(mf, dataUrlToBuffer(payload.musicDataUrl));
      args.push('-i', mf); musIdx = n++;
    }
    // 🖼 Lớp trên (overlay full-frame) — đè lên video theo khoảng thời gian [start, start+dur].
    const overlays = Array.isArray(payload.overlays) ? payload.overlays.filter((o) => o && o.dataUrl && (Number(o.dur) || 0) > 0) : [];
    overlays.forEach((o, k) => {
      const of = path.join(tmp, `ov${k}.png`);
      fs.writeFileSync(of, dataUrlToBuffer(o.dataUrl));
      args.push('-i', of);
      const idx = n++;
      const s = Math.max(0, Number(o.start) || 0), e = s + Math.max(0.1, Number(o.dur) || 3);
      const scaled = `[ovs${k}]`, out = `[ovo${k}]`;
      fc += `;[${idx}:v]format=rgba,scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x00000000,setsar=1${scaled};${vfinal}${scaled}overlay=0:0:format=auto:enable='between(t\\,${s.toFixed(3)}\\,${e.toFixed(3)})'${out}`;
      vfinal = out;
    });
    // 🔊 Hiệu ứng âm thanh (SFX) — mỗi cái phát đúng thời điểm start (adelay), rồi trộn vào audio cuối.
    const sfxList = Array.isArray(payload.sfx) ? payload.sfx.filter((s) => s && s.dataUrl) : [];
    const sfxLabels = [];
    sfxList.forEach((s, k) => {
      const sf = path.join(tmp, `sfx${k}.dat`); fs.writeFileSync(sf, dataUrlToBuffer(s.dataUrl));
      args.push('-i', sf); const idx = n++;
      const del = Math.max(0, Math.round((Number(s.start) || 0) * 1000));
      const vol = Math.max(0, s.volume != null ? Number(s.volume) : 0.9);
      fc += `;[${idx}:a]adelay=${del}|${del},volume=${vol}[sfx${k}]`;
      sfxLabels.push(`[sfx${k}]`);
    });
    const musVol = payload.musicVolume != null ? Math.max(0, Number(payload.musicVolume)) : 0.22;
    const hasAudio = voIdx >= 0 || musIdx >= 0 || sfxLabels.length > 0;
    let maps;
    const musFadeChain = `volume=${musVol},afade=t=in:st=0:d=1.5,areverse,afade=t=in:st=0:d=2,areverse`;
    const duck = payload.duckMusic !== false;   // mặc định BẬT: nhạc tự né giọng đọc
    const pad = `apad=whole_dur=${_outDur.toFixed(3)}`;
    // Nhãn audio NỀN (giọng + nhạc) trước khi trộn SFX + đệm im lặng.
    let abase = null;
    if (voIdx >= 0 && musIdx >= 0) {
      if (duck) fc += `;[${voIdx}:a]asplit=2[vo1][vok];[${musIdx}:a]${musFadeChain}[mf];[mf][vok]sidechaincompress=threshold=0.06:ratio=8:attack=20:release=350[mduck];[vo1][mduck]amix=inputs=2:duration=first:dropout_transition=0[abase]`;
      else fc += `;[${voIdx}:a]volume=1[va];[${musIdx}:a]${musFadeChain}[ma];[va][ma]amix=inputs=2:duration=first:dropout_transition=0[abase]`;
      abase = '[abase]';
    } else if (voIdx >= 0) { abase = `[${voIdx}:a]`; }
    else if (musIdx >= 0) { fc += `;[${musIdx}:a]${musFadeChain}[abase]`; abase = '[abase]'; }

    if (abase && sfxLabels.length) {
      fc += `;${abase}${sfxLabels.join('')}amix=inputs=${1 + sfxLabels.length}:duration=first:dropout_transition=0:normalize=0[amx];[amx]${pad}[aout]`;
      maps = ['-map', vfinal, '-map', '[aout]'];
    } else if (abase) {
      fc += `;${abase}${pad}[aout]`;
      maps = ['-map', vfinal, '-map', '[aout]'];
    } else if (sfxLabels.length) {
      if (sfxLabels.length > 1) fc += `;${sfxLabels.join('')}amix=inputs=${sfxLabels.length}:duration=first:normalize=0[sm];[sm]${pad}[aout]`;
      else fc += `;${sfxLabels[0]}${pad}[aout]`;
      maps = ['-map', vfinal, '-map', '[aout]'];
    } else {
      maps = ['-map', vfinal];
    }
    // Bộ mã hoá: ưu tiên GPU của CHÍNH máy đang chạy (NVENC/QuickSync/AMF/VideoToolbox),
    // không có mới rơi về CPU. Trước đây chỉ bật GPU trên macOS nên khách Windows
    // luôn encode bằng libx264 dù máy có card rời.
    const isHevc = payload.vcodec === 'h265';
    const wantHw = payload.gpu !== false;              // mặc định BẬT, ai muốn tắt thì gửi gpu:false
    const hwEnc = wantHw ? gpuEncoder(isHevc ? 'h265' : 'h264') : null;
    const cpuEnc = isHevc ? 'libx265' : 'libx264';

    // Dựng args theo encoder → đổi encoder là dựng lại, không vá tay giữa mảng.
    const buildArgs = (enc) => {
      const a = args.slice();
      a.push('-filter_complex', fc, ...maps);
      a.push('-c:v', enc || cpuEnc, '-pix_fmt', 'yuv420p');
      a.push(...gpuQualityArgs(enc, { bitrateK: vbitK, crf }));
      if (isHevc) a.push('-tag:v', 'hvc1');   // MP4/QuickTime nhận diện H.265
      if (hasAudio) a.push('-c:a', 'aac', '-b:a', '192k');
      // ÉP CỨNG độ dài output = tổng thời lượng cảnh (clip-sum) → KHÔNG bao giờ dài hơn/ngắn hơn preview, dù apad/concat có gì lạ.
      a.push('-t', _outDur.toFixed(3), '-movflags', '+faststart', outPath);
      return a;
    };

    const onLog = (s) => { if (win && !win.isDestroyed()) win.webContents.send('render-video-progress', s); };
    _render.canceled = false; _render.outPath = outPath;
    let used = hwEnc;
    try {
      onLog('[nova] Bộ mã hoá: ' + gpuLabel(hwEnc) + (hwEnc ? '' : ' (' + cpuEnc + ')') + '\n');
      await run(FFMPEG, buildArgs(hwEnc), onLog, (cp) => { _render.proc = cp; });
    } catch (e) {
      // GPU chết giữa chừng (hết phiên encode, khung hình lẻ, driver dở) — vẫn phải
      // ra được video. Người dùng không cần biết, chỉ thấy chậm hơn.
      if (!hwEnc || _render.canceled) throw e;
      onLog('[nova] GPU encode lỗi, chuyển sang CPU: ' + String(e.message || e).slice(-200) + '\n');
      used = null;
      await run(FFMPEG, buildArgs(null), onLog, (cp) => { _render.proc = cp; });
    }
    _render.proc = null;
    return { ok: true, path: outPath, encoder: used || cpuEnc, gpu: !!used };
  } catch (e) {
    _render.proc = null;
    if (_render.canceled) { try { if (outPath && fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (e2) {} return { canceled: true }; }
    return { error: e.message || String(e) };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
  }
}

function ffmpegInfo() {
  let enc = null; try { enc = gpuEncoder('h264'); } catch (_) {}
  return { ffmpeg: !!FFMPEG, ffprobe: !!FFPROBE, ffmpegPath: FFMPEG, gpuEncoder: enc, gpuLabel: gpuLabel(enc), gpu: !!enc };
}

module.exports = { renderVideo, ffmpegInfo, cancelRender, probeDur };
