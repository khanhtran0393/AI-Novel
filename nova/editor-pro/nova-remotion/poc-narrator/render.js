// Render POC bằng ĐÚNG đường render của app: bundle nova-remotion + @remotion/renderer + chrome vendored.
// Chạy:  node editor-pro/nova-remotion/poc-narrator/render.js
const fs = require('fs');
const path = require('path');
const os = require('os');

const HERE = path.join(__dirname);
const EDITOR = path.resolve(HERE, '..', '..');            // editor-pro
const BUNDLE = path.join(EDITOR, 'nova-remotion', 'bundle');
const COMPOSITOR = path.join(EDITOR, 'node_modules', '@remotion', 'compositor-darwin-arm64');

// Chrome headless vendored — Remotion tải sẵn trong repo, khỏi phụ thuộc Chrome máy người dùng.
function findBrowser(root) {
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

// Asset phải nằm TRONG bundle thì Remotion mới phục vụ được qua http.
// Chép sang bundle/assets/ với tiền tố poc_ để dễ dọn, không đụng asset cũ của app.
function stageAssets() {
  const src = path.join(HERE, 'assets');
  const dst = path.join(BUNDLE, 'assets');
  fs.mkdirSync(dst, { recursive: true });
  let n = 0;
  for (const f of fs.readdirSync(src)) {
    fs.copyFileSync(path.join(src, f), path.join(dst, f));
    n++;
  }
  return n;
}

(async () => {
  if (!fs.existsSync(BUNDLE)) {
    console.error('Thiếu bundle — chạy trước: node editor-pro/nova-remotion/build.js');
    process.exit(1);
  }
  console.log('· asset →', stageAssets(), 'file vào bundle/assets/');

  if (fs.existsSync(COMPOSITOR)) {
    process.env.DYLD_LIBRARY_PATH = COMPOSITOR + (process.env.DYLD_LIBRARY_PATH ? ':' + process.env.DYLD_LIBRARY_PATH : '');
  }
  const browserExecutable = findBrowser(path.join(EDITOR, 'remotion-browser')) || undefined;
  console.log('· chrome  →', browserExecutable ? path.basename(browserExecutable) : '(dùng mặc định)');

  const { selectComposition, renderMedia } = require('@remotion/renderer');
  const inputProps = JSON.parse(fs.readFileSync(path.join(HERE, 'scene.json'), 'utf8'));

  const comp = await selectComposition({ serveUrl: BUNDLE, id: 'NovaSequence', inputProps, browserExecutable });
  console.log(`· cảnh    → ${comp.durationInFrames} frame @ ${comp.fps}fps = ${(comp.durationInFrames / comp.fps).toFixed(1)}s, ${comp.width}x${comp.height}`);

  const outDir = path.join(HERE, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, 'poc-narrator.mp4');

  let last = -1;
  await renderMedia({
    composition: comp, serveUrl: BUNDLE, codec: 'h264', outputLocation: out, inputProps, browserExecutable,
    concurrency: Math.max(2, Math.min(6, (os.cpus() || []).length - 2)),
    onProgress: ({ progress }) => {
      const pc = Math.round(progress * 100);
      if (pc >= last + 20) { last = pc; console.log('  render ' + pc + '%'); }
    },
  });
  console.log('XONG →', out);
})().catch((e) => { console.error('LỖI:', e && e.stack || e); process.exit(1); });
