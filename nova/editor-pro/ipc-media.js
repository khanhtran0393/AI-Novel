// Handler media/file cho Editor Pro: file dialogs + ffprobe/ffmpeg (spawn trực tiếp).
const { dialog, shell, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const url = require('url');
const { spawn } = require('child_process');

const { FFMPEG, FFPROBE } = require('./ff-path');   // đường dẫn đã gỡ khỏi app.asar (spawn được)
const TMP = path.join(os.tmpdir(), 'nova-editor-pro');
try { fs.mkdirSync(TMP, { recursive: true }); } catch (_) {}

const fileUrl = (p) => { try { return url.pathToFileURL(p).href; } catch (_) { return 'file://' + p; } };
const winOf = (e) => BrowserWindow.fromWebContents(e.sender) || BrowserWindow.getFocusedWindow();

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const ps = spawn(bin, args, { windowsHide: true });
    let out = '', err = '';
    ps.stdout.on('data', d => out += d);
    ps.stderr.on('data', d => err += d);
    ps.on('error', reject);
    ps.on('close', code => code === 0 ? resolve(out) : reject(new Error(err || ('exit ' + code))));
  });
}

async function probe(filePath) {
  const out = await run(FFPROBE, ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath]);
  return JSON.parse(out);
}

const FILTERS = {
  video: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'] }],
  image: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
  audio: [{ name: 'Audio', extensions: ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac'] }],
  json:  [{ name: 'JSON', extensions: ['json'] }],
};

async function openDlg(e, filters) {
  const w = winOf(e);
  const r = await dialog.showOpenDialog(w, { properties: ['openFile', 'multiSelections'], filters: filters || [] });
  return r.canceled ? [] : r.filePaths;
}

function registerEditorProMedia(ipcMain) {
  const TEST_VIDEO = process.env.EDITOR_PRO_TEST_VIDEO || '';
  const H = {
    'dialog:openFiles': (e) => TEST_VIDEO ? [TEST_VIDEO] : openDlg(e),
    'dialog:openVideoFiles': (e) => TEST_VIDEO ? [TEST_VIDEO] : openDlg(e, FILTERS.video),
    'dialog:openImageFiles': (e) => openDlg(e, FILTERS.image),
    'dialog:openAudioFiles': (e) => openDlg(e, FILTERS.audio),
    'dialog:openDirectory': async (e) => {
      const r = await dialog.showOpenDialog(winOf(e), { properties: ['openDirectory', 'createDirectory'] });
      return r.canceled ? null : r.filePaths[0];
    },
    'dialog:openSaveLocation': async (e) => {
      const r = await dialog.showOpenDialog(winOf(e), { properties: ['openDirectory', 'createDirectory'] });
      return r.canceled ? null : r.filePaths[0];
    },
    'dialog:openJson': async (e) => {
      const r = await dialog.showOpenDialog(winOf(e), { properties: ['openFile'], filters: FILTERS.json });
      if (r.canceled || !r.filePaths[0]) return null;
      try { return { filePath: r.filePaths[0], data: JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')) }; }
      catch (_) { return { filePath: r.filePaths[0], data: null }; }
    },
    'dialog:saveJson': async (e, options) => {
      const r = await dialog.showSaveDialog(winOf(e), { filters: FILTERS.json, defaultPath: (options && options.defaultPath) || 'project.json' });
      return r.canceled ? null : r.filePath;
    },
    'path:join': (_e, ...parts) => path.join(...parts.map(String)),
    'file:mkdirp': (_e, dir) => { try { fs.mkdirSync(dir, { recursive: true }); return { ok: true }; } catch (err) { return { ok: false, error: String(err) }; } },
    'file:exists': (_e, p) => { try { return fs.existsSync(String(p || '')); } catch (_) { return false; } },
    'file:readJson': (_e, p) => { try { return JSON.parse(fs.readFileSync(String(p), 'utf8')); } catch (_) { return null; } },
    'file:saveJson': (_e, p, data) => { try { fs.writeFileSync(String(p), JSON.stringify(data, null, 2)); return { ok: true, filePath: p }; } catch (err) { return { ok: false, error: String(err) }; } },
    'file:readBuffer': (_e, p) => { try { return fs.readFileSync(String(p)); } catch (_) { return null; } },
    'file:unlink': (_e, p) => { try { fs.unlinkSync(String(p)); return true; } catch (_) { return false; } },
    'app:openExternal': (_e, u) => { try { shell.openExternal(String(u)); return { ok: true }; } catch (err) { return { ok: false }; } },
    'video:open': (_e, p) => { try { shell.openPath(String(p)); return { ok: true }; } catch (_) { return { ok: false }; } },
    'video:reveal': (_e, p) => { try { shell.showItemInFolder(String(p)); return { ok: true }; } catch (_) { return { ok: false }; } },
    'video:deleteFile': (_e, p) => { try { fs.unlinkSync(String(p)); return true; } catch (_) { return false; } },
    'audio:getDuration': async (_e, p) => {
      try { const m = await probe(String(p)); return parseFloat(m.format && m.format.duration) || 0; } catch (_) { return 0; }
    },
    'video:getMetadata': async (_e, filePath) => {
      try {
        const abs = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
        const st = fs.statSync(abs);
        const m = await probe(abs);
        const v = (m.streams || []).find(s => s.codec_type === 'video') || {};
        const fpsParts = String(v.r_frame_rate || '30/1').split('/');
        const fps = fpsParts.length === 2 ? (parseFloat(fpsParts[0]) / parseFloat(fpsParts[1])) : parseFloat(fpsParts[0]);
        return {
          filePath: abs,
          duration: parseFloat(m.format && m.format.duration) || 0,
          width: v.width || 0, height: v.height || 0,
          codec: v.codec_name || 'unknown',
          bitrate: parseInt(m.format && m.format.bit_rate) || 0,
          fps: Number.isFinite(fps) && fps > 0 ? fps : 30,
          fileSize: st.size, mtime: st.mtimeMs, cachedAt: Date.now(),
        };
      } catch (_) { return null; }
    },
    'video:generateThumbnail': async (_e, filePath, timeSec, options) => {
      try {
        const w = (options && options.width) || 320;
        const out = path.join(TMP, `thumb_${Buffer.from(String(filePath)).toString('hex').slice(0, 16)}_${Math.round((timeSec || 0) * 1000)}.png`);
        if (!fs.existsSync(out)) {
          await run(FFMPEG, ['-ss', String(timeSec || 0), '-i', String(filePath), '-frames:v', '1', '-vf', `scale=${w}:-1`, '-y', out]);
        }
        return fileUrl(out);
      } catch (_) { return null; }
    },
    'extractAudioFromVideo': async (_e, videoPath) => {
      try {
        const out = path.join(TMP, `audio_${Buffer.from(String(videoPath)).toString('hex').slice(0, 16)}.mp3`);
        if (!fs.existsSync(out)) {
          await run(FFMPEG, ['-i', String(videoPath), '-vn', '-acodec', 'libmp3lame', '-y', out]);
        }
        return out;
      } catch (_) { return null; }
    },
    // proxy: chưa transcode — dùng luôn file gốc để phát
    'videos:getProxy': (_e, file) => ({ ok: true, proxyPath: file, url: fileUrl(String(file || '')) }),
    'videos:refreshSegment': () => ({ ok: true }),
  };
  for (const [ch, fn] of Object.entries(H)) {
    try { ipcMain.removeHandler(ch); } catch (_) {}
    ipcMain.handle(ch, fn);
  }
  return Object.keys(H);
}

module.exports = { registerEditorProMedia };
