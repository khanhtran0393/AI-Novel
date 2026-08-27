// Demo: mỗi CÂU một pose, cộng chớp mắt + nhép miệng.
// mouthTrack ở đây dựng từ danh sách từ có mốc thời gian — ĐÚNG định dạng
// asr_whisper.py đang trả về ({w, s, e}), nên khi cắm TTS thật là chạy luôn.
const fs = require('fs'); const path = require('path'); const os = require('os');
const EDITOR = path.resolve(__dirname, '..', '..');
const BUNDLE = path.join(EDITOR, 'nova-remotion', 'bundle');
const COMPOSITOR = path.join(EDITOR, 'node_modules', '@remotion', 'compositor-darwin-arm64');
function findBrowser(root){const st=[root];while(st.length){const d=st.pop();let e=[];try{e=fs.readdirSync(d,{withFileTypes:true})}catch(_){continue}
  for(const x of e){const p=path.join(d,x.name); if(x.isDirectory())st.push(p); else if(x.name==='chrome-headless-shell')return p}}return null}

// Từ có mốc → mốc độ mở miệng. Nguyên âm mở to hơn phụ âm; giữa hai từ thì khép.
const VOWEL = /[aàáảãạăằắẳẵặâầấẩẫậeèéẻẽẹêềếểễệiìíỉĩịoòóỏõọôồốổỗộơờớởỡợuùúủũụưừứửữựyỳýỷỹỵ]/gi;
function mouthTrackFromWords(words) {
  const track = [];
  words.forEach((w) => {
    const v = Math.min(1, 0.3 + ((String(w.w).match(VOWEL) || []).length) * 0.3);
    track.push({ t: +w.s.toFixed(3), v });
    track.push({ t: +(w.s + (w.e - w.s) * 0.62).toFixed(3), v: v * 0.55 });
    track.push({ t: +w.e.toFixed(3), v: 0 });
  });
  return track;
}
// Rải từ đều trong câu — chỗ này thật ra là output của Whisper.
function fakeWords(text, start, end) {
  const ws = text.split(/\s+/).filter(Boolean);
  const step = (end - start) / ws.length;
  return ws.map((w, i) => ({ w, s: start + i * step, e: start + (i + 0.82) * step }));
}

const BEATS = [
  { text: 'Khoan đã, bạn vừa nói con dơi cắn vào tay bạn à?',
    pose: { armL: 'down', armR: 'point', eyes: 'wide', brow: 'raised', mouth: 'neutral' } },
  { text: 'Virus dại không đi theo đường máu, nó bò dọc dây thần kinh.',
    pose: { armL: 'chin', armR: 'hip', eyes: 'side', brow: 'furrow', mouth: 'neutral' } },
  { text: 'Và khi đã lên tới não thì y học gần như không còn cách nào.',
    pose: { armL: 'open', armR: 'open', eyes: 'normal', brow: 'worried', mouth: 'frown' } },
];

const scenes = BEATS.map((b, i) => {
  const dur = 4.2;
  const words = fakeWords(b.text, 0.35, dur - 0.5);
  return {
    id: 'p' + i, durationSec: dur, trans: i ? 'dissolve' : undefined, transDur: 0.4,
    theme: { bg: '#f5f5f3', text: '#1f2328', accent: '#e8763a' },
    layers: [
      { id: 'char', type: 'char', rig: 'ghost', pose: b.pose,
        blink: true, blinkSeed: i, mouthTrack: mouthTrackFromWords(words),
        box: { x: 30, y: 52, w: 21, h: 50, anchor: 'center' },
        in: { preset: 'fade', dur: 0.3 }, hold: { preset: 'drift', amp: 1.1 }, z: 10 },
      { id: 'cap', type: 'text', text: b.text,
        box: { x: 68, y: 50, w: 40, align: 'left', anchor: 'center' },
        style: { size: 40, weight: 700, lineHeight: 1.35, color: '#1f2328', reveal: 'type', revealSpread: 0.42 },
        in: { preset: 'slideR', dur: 0.4 }, z: 20 },
      { id: 'tag', type: 'text', text: `pose:  armL=${b.pose.armL} · armR=${b.pose.armR} · eyes=${b.pose.eyes} · brow=${b.pose.brow}`,
        box: { x: 50, y: 92, w: 80, align: 'center', anchor: 'center' },
        style: { size: 20, weight: 600, color: '#9aa1ad', font: 'Menlo, monospace' },
        in: { preset: 'fade', dur: 0.3 }, z: 30 },
    ],
  };
});

(async () => {
  if (fs.existsSync(COMPOSITOR)) process.env.DYLD_LIBRARY_PATH = COMPOSITOR + (process.env.DYLD_LIBRARY_PATH ? ':' + process.env.DYLD_LIBRARY_PATH : '');
  const browserExecutable = findBrowser(path.join(EDITOR, 'remotion-browser')) || undefined;
  const { selectComposition, renderMedia } = require('@remotion/renderer');
  const inputProps = { scenes, globals: [] };
  const comp = await selectComposition({ serveUrl: BUNDLE, id: 'NovaSequence', inputProps, browserExecutable });
  console.log(`· ${comp.durationInFrames} frame = ${(comp.durationInFrames/comp.fps).toFixed(1)}s`);
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  const out = path.join(__dirname, 'out', 'pose-demo.mp4');
  let last=-1;
  await renderMedia({ composition: comp, serveUrl: BUNDLE, codec: 'h264', outputLocation: out, inputProps, browserExecutable,
    concurrency: Math.max(2, Math.min(6, (os.cpus()||[]).length - 2)),
    onProgress: ({progress}) => { const p=Math.round(progress*100); if(p>=last+25){last=p;console.log('  render '+p+'%')} } });
  console.log('XONG →', out);
})().catch(e => { console.error('LỖI:', e && e.stack || e); process.exit(1); });
