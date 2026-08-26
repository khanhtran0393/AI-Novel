// Kịch bản → scene JSON → MP4. Mỗi CÂU là một cảnh, icon vào đúng TỪ neo.
const fs = require('fs'); const path = require('path'); const os = require('os');
const { estimateWords, speechDur, findAnchor } = require('./align.js');

const LEAD = 0.12;   // icon chạm mắt TRƯỚC tai một nhịp; vào đúng lúc phát âm sẽ thấy trễ
const TAIL = 0.55;   // khoảng lặng cuối câu

// text · pose · icon neo vào từ nào · chuyển cảnh vào cảnh này · bố cục
const BEATS = [
  { t: 'For most people, the climb takes 1 to 3 months, in a few documented cases, years.',
    pose: { armR: 'point', eyes: 'normal', brow: 'neutral' },
    ic: [['months', 'calendar'], ['years', 'hourglass']] },

  { t: 'And the entire time there is nothing to feel and nothing to find.',
    pose: { armL: 'open', armR: 'open', eyes: 'side', brow: 'worried', mouth: 'frown' },
    ic: [['feel', 'flatline'], ['find', 'searchNo']], tr: 'cut' },

  { t: 'No cameras in the tunnels, remember?',
    pose: { armR: 'point', eyes: 'wide', brow: 'raised' },
    ic: [['cameras', 'cameraNo'], ['tunnels', 'tunnel']], tr: 'whip-pan' },

  { t: 'But those quiet months are the most important stretch of this whole video, so lock this in.',
    pose: { armL: 'chin', armR: 'hip', eyes: 'squint', brow: 'furrow' },
    ic: [['lock', 'lock']], tr: 'dissolve', hero: true },

  { t: 'While the virus is still in transit, it is completely beatable.',
    pose: { armR: 'point', eyes: 'normal', brow: 'raised', mouth: 'smile' },
    ic: [['virus', 'virus'], ['transit', 'transit'], ['beatable', 'shield']], tr: 'flash-cut' },

  { t: 'Because for exactly this window, a treatment exists.',
    pose: { armL: 'open', armR: 'open', eyes: 'wide', brow: 'raised' },
    ic: [['window', 'window']], tr: 'dip-white', hero: true },

  { t: 'A round of shots you get after the bite, a rabies vaccine, plus one extra injection.',
    pose: { armR: 'point', eyes: 'normal', brow: 'neutral' },
    ic: [['bite', 'bite'], ['vaccine', 'syringe'], ['injection', 'syringe2']], tr: 'cut' },

  { t: "And those shots don't improve your chances. They win close to 100% of the time.",
    pose: { armL: 'wave', armR: 'wave', eyes: 'sparkle', brow: 'raised', mouth: 'smile' },
    ic: [['chances', 'chartNo'], ['100%', 'badge100']], tr: 'push-left' },

  { t: "Here's how.",
    pose: { armL: 'chin', armR: 'hip', eyes: 'side', brow: 'furrow' },
    ic: [], tr: 'flash-cut' },

  { t: 'The vaccine is a wanted poster.',
    pose: { armR: 'point', eyes: 'wide', brow: 'raised', mouth: 'smile' },
    ic: [['poster', 'poster']], tr: 'zoom-through', hero: true },

  { t: "It shows your immune system the virus's face using harmless dead copies.",
    pose: { armL: 'chin', armR: 'open', eyes: 'normal', brow: 'neutral' },
    ic: [['immune', 'antibody'], ['dead', 'virusDead']], tr: 'dissolve' },
];

// Chỗ đặt icon: chia đều nửa phải, lệch cao thấp xen kẽ cho đỡ thẳng hàng như bảng biểu.
const SLOTS = {
  1: [{ x: 70, w: 24 }],
  2: [{ x: 62, w: 17 }, { x: 84, w: 17 }],
  3: [{ x: 56, w: 14 }, { x: 73, w: 14 }, { x: 89, w: 13 }],
};
const CHAR_H = 46, CHAR_ASPECT = 0.4167;      // khung rig 400x540 quy ra % trên khổ 16:9

const scenes = [];
BEATS.forEach((b, i) => {
  const sd = speechDur(b.t);
  const dur = Math.max(1.8, sd + TAIL);
  const words = estimateWords(b.t, 0.18);
  const layers = [];

  layers.push({ id: 'char', type: 'char', rig: 'ghost', pose: b.pose, blink: true, blinkSeed: i,
    box: { x: 20, y: 54, w: +(CHAR_H * CHAR_ASPECT).toFixed(2), h: CHAR_H, anchor: 'center' },
    in: { preset: 'fade', dur: 0.25 }, hold: { preset: 'drift', amp: 1.1 }, z: 10 });

  const slots = SLOTS[b.ic.length] || [];
  b.ic.forEach(([anchor, icon], k) => {
    const hit = findAnchor(words, anchor);
    if (!hit) { console.warn(`  ! không tìm thấy neo "${anchor}" trong câu ${i + 1}`); return; }
    const at = Math.max(0, hit.s - LEAD);
    const s = b.hero ? { x: 68, w: 30 } : slots[k];
    layers.push({ id: 'ic' + k, type: 'image', src: 'assets/ic_' + icon + '.svg', at,
      box: { x: s.x, y: b.hero ? 44 : (k % 2 ? 36 : 28), w: s.w, anchor: 'center' },
      in: { preset: 'pop', dur: 0.34 }, hold: { preset: 'drift', amp: 1.2 }, z: 30 });
  });

  // Gõ chữ khớp nhịp đọc: trải đúng bằng phần thời gian thực sự có tiếng.
  layers.push({ id: 'cap', type: 'text', text: b.t,
    box: { x: 50, y: 88, w: 84, align: 'center', anchor: 'center' },
    style: { size: 38, weight: 700, lineHeight: 1.3, color: '#1f2328',
      bg: 'rgba(255,255,255,.85)', pad: 12, radius: 12,
      reveal: 'type', revealSpread: Math.min(0.95, sd / dur) },
    in: { preset: 'rise', dur: 0.28 }, z: 90 });

  scenes.push({ id: 'b' + i, durationSec: +dur.toFixed(2),
    trans: b.tr, transDur: b.tr === 'cut' ? 0.01 : undefined,
    theme: { bg: '#f5f5f3', text: '#1f2328', accent: '#e8763a' }, layers });
});

fs.writeFileSync(path.join(__dirname, 'scene-script.json'), JSON.stringify({ scenes, globals: [] }, null, 2));
const total = scenes.reduce((s, x) => s + x.durationSec, 0);
console.log(`${scenes.length} cảnh · ${total.toFixed(1)}s · ${scenes.reduce((s,x)=>s+x.layers.length,0)} lớp`);

// ── render ──────────────────────────────────────────────────────────────────
const EDITOR = path.resolve(__dirname, '..', '..');
const BUNDLE = path.join(EDITOR, 'nova-remotion', 'bundle');
const COMPOSITOR = path.join(EDITOR, 'node_modules', '@remotion', 'compositor-darwin-arm64');
function findBrowser(root){const st=[root];while(st.length){const d=st.pop();let e=[];try{e=fs.readdirSync(d,{withFileTypes:true})}catch(_){continue}
  for(const x of e){const p=path.join(d,x.name); if(x.isDirectory())st.push(p); else if(x.name==='chrome-headless-shell')return p}}return null}
function stageAssets(){const src=path.join(__dirname,'assets'),dst=path.join(BUNDLE,'assets');fs.mkdirSync(dst,{recursive:true});
  let n=0;for(const f of fs.readdirSync(src)){fs.copyFileSync(path.join(src,f),path.join(dst,f));n++}return n}

(async () => {
  console.log('· asset →', stageAssets(), 'file');
  if (fs.existsSync(COMPOSITOR)) process.env.DYLD_LIBRARY_PATH = COMPOSITOR + (process.env.DYLD_LIBRARY_PATH ? ':' + process.env.DYLD_LIBRARY_PATH : '');
  const browserExecutable = findBrowser(path.join(EDITOR, 'remotion-browser')) || undefined;
  const { selectComposition, renderMedia } = require('@remotion/renderer');
  const inputProps = { scenes, globals: [] };
  const comp = await selectComposition({ serveUrl: BUNDLE, id: 'NovaSequence', inputProps, browserExecutable });
  console.log(`· ${comp.durationInFrames} frame = ${(comp.durationInFrames/comp.fps).toFixed(1)}s`);
  fs.mkdirSync(path.join(__dirname,'out'),{recursive:true});
  const out = path.join(__dirname, 'out', 'script-demo.mp4');
  let last=-1;
  await renderMedia({ composition: comp, serveUrl: BUNDLE, codec:'h264', outputLocation: out, inputProps, browserExecutable,
    concurrency: Math.max(2, Math.min(6, (os.cpus()||[]).length - 2)),
    onProgress: ({progress}) => { const p=Math.round(progress*100); if(p>=last+25){last=p;console.log('  render '+p+'%')} } });
  console.log('XONG →', out);
})().catch(e => { console.error('LỖI:', e && e.stack || e); process.exit(1); });
