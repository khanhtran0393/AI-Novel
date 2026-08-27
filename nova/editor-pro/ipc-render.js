// Xuất video bằng ffmpeg (MVP): ghép tuần tự lớp video/ảnh + trộn audio → MP4.
// Bỏ qua lớp text/shape/composition/bit (Remotion React) — báo số lớp bỏ.
const { dialog, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const FFMPEG = require('./ff-path').FFMPEG;   // đường dẫn đã gỡ khỏi app.asar (spawn được)

const TMP = path.join(os.tmpdir(), 'nova-editor-pro');
try { fs.mkdirSync(TMP, { recursive: true }); } catch (_) {}
const stripFileUrl = (p) => String(p || '').replace(/^file:\/\//i, '');
const g = (o, ...keys) => { for (const k of keys) if (o && o[k] != null) return o[k]; return undefined; };

function ffrun(args, onLine, onChild) {
  return new Promise((resolve, reject) => {
    const ps = spawn(FFMPEG, args, { windowsHide: true });
    if (onChild) onChild(ps);
    let err = '';
    ps.stderr.on('data', d => { const s = d.toString(); err += s; if (onLine) onLine(s); });
    ps.on('error', reject);
    ps.on('close', code => code === 0 ? resolve() : reject(new Error(err.split('\n').slice(-6).join('\n'))));
  });
}

async function renderComposition({ composition, outputPath, onProgress }) {
  const W = Math.round(g(composition, 'width') || 1920);
  const H = Math.round(g(composition, 'height') || 1080);
  const fps = Math.round(g(composition, 'fps') || 30);
  const layers = Array.isArray(g(composition, 'layers', 'items')) ? g(composition, 'layers', 'items') : [];
  const totalFrames = g(composition, 'durationInFrames') || Math.round((g(composition, 'duration') || 0) * fps);
  const totalDur = totalFrames ? totalFrames / fps : null;

  const typeOf = (l) => String(g(l, 'type', 'kind') || '').toLowerCase();
  // thời điểm bắt đầu (giây): from là FRAME → /fps (nếu >100000 coi như ms)
  const startSec = (l) => { const f = g(l, 'from', 'startFrame', 'start', 'fromFrame'); if (f == null) return g(l, 'startSec') || 0; return f > 100000 ? f / 1000 : f / fps; };
  // độ dài (giây): ưu tiên durationInFrames/fps, fallback durationSec
  const durSec = (l) => { const d = g(l, 'durationInFrames', 'durationFrames'); if (d != null) return d / fps; return g(l, 'durationSec', 'duration', 'seconds') || 3; };

  const visual = layers.filter(l => ['video', 'image'].includes(typeOf(l)))
    .map(l => ({ type: typeOf(l), src: stripFileUrl(g(l, 'src', 'source', 'url', 'file')), from: startSec(l), dur: durSec(l), l }))
    .filter(x => x.src && fs.existsSync(x.src))
    .sort((a, b) => a.from - b.from);
  const audios = layers.filter(l => typeOf(l) === 'audio')
    .map(l => ({ src: stripFileUrl(g(l, 'src', 'source', 'url', 'file')), from: startSec(l), vol: g(l, 'volume') != null ? g(l, 'volume') : 1 }))
    .filter(x => x.src && fs.existsSync(x.src));
  const skipped = layers.length - visual.length - audios.length;

  if (!visual.length && !audios.length) return { ok: false, error: 'Không có lớp video/ảnh/audio hợp lệ để xuất.' };

  const emit = (p, msg) => { try { onProgress && onProgress(p, msg); } catch (_) {} };
  emit(5, 'Chuẩn bị…');

  // Build filtergraph: mỗi clip scale về WxH,fps; nối concat tuần tự.
  const inputs = [];
  const vparts = [];
  visual.forEach((c, i) => {
    if (c.type === 'image') inputs.push('-loop', '1', '-t', String(c.dur), '-i', c.src);
    else inputs.push('-t', String(c.dur), '-i', c.src);
    vparts.push(`[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p[v${i}]`);
  });
  const nV = visual.length;
  let filter = vparts.join(';');
  let map = [];
  if (nV) {
    filter += (filter ? ';' : '') + visual.map((_, i) => `[v${i}]`).join('') + `concat=n=${nV}:v=1:a=0[outv]`;
    map = ['-map', '[outv]'];
  }
  // audio: đưa vào sau các input video, mix (adelay theo from)
  const aBase = nV;
  audios.forEach((a) => { inputs.push('-i', a.src); });
  if (audios.length) {
    const aparts = audios.map((a, k) => `[${aBase + k}:a]adelay=${Math.round(a.from * 1000)}|${Math.round(a.from * 1000)},volume=${a.vol}[a${k}]`);
    filter += (filter ? ';' : '') + aparts.join(';') + ';' + audios.map((_, k) => `[a${k}]`).join('') + `amix=inputs=${audios.length}:normalize=0[outa]`;
    map.push('-map', '[outa]');
  }

  const out = outputPath || path.join(TMP, `export_${Date.now()}.mp4`);
  const args = [...inputs, '-filter_complex', filter, ...map,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '20'];
  if (audios.length) args.push('-c:a', 'aac', '-b:a', '192k');
  if (totalDur) args.push('-t', String(totalDur));
  args.push('-y', out);

  emit(15, 'Đang render bằng ffmpeg…');
  let lastP = 15;
  await ffrun(args, (line) => {
    const m = line.match(/time=(\d+):(\d+):(\d+\.?\d*)/);
    if (m && totalDur) {
      const t = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
      const p = Math.min(95, 15 + Math.round((t / totalDur) * 80));
      if (p > lastP) { lastP = p; emit(p, 'Đang render…'); }
    }
  });
  emit(100, 'Hoàn tất');
  return { ok: true, outputPath: out, skippedLayers: skipped, note: skipped > 0 ? `${skipped} lớp text/motion (Remotion) đã bỏ qua.` : '' };
}

function registerEditorProRender(ipcMain) {
  const H = {
    'remotion:renderVideo': async (e, payload = {}) => {
      try {
        // dump composition để debug field-name lần đầu
        try { fs.writeFileSync(path.join(TMP, 'last-composition.json'), JSON.stringify(payload.composition || payload, null, 2)); } catch (_) {}
        let outputPath = payload.outputPath;
        if (!outputPath) {
          const w = BrowserWindow.fromWebContents(e.sender) || BrowserWindow.getFocusedWindow();
          const r = await dialog.showSaveDialog(w, { defaultPath: `nova-export-${Date.now()}.mp4`, filters: [{ name: 'MP4', extensions: ['mp4'] }] });
          if (r.canceled) return { ok: false, error: 'Đã huỷ' };
          outputPath = r.filePath;
        }
        const onProgress = (p, msg) => { try { e.sender.send('remotion:progress', { percent: p, message: msg }); } catch (_) {} };
        return await renderComposition({ composition: payload.composition || payload, outputPath, onProgress });
      } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
    },
  };
  for (const [ch, fn] of Object.entries(H)) { try { ipcMain.removeHandler(ch); } catch (_) {} ipcMain.handle(ch, fn); }
  return Object.keys(H);
}

module.exports = { registerEditorProRender, renderComposition };
