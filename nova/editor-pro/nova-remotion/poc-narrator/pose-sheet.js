// Bảng pose — render 1 khung tĩnh để soi nét. Mỗi ô là MỘT tổ hợp bộ phận, không hình nào vẽ sẵn.
const fs = require('fs'); const path = require('path'); const os = require('os');
const EDITOR = path.resolve(__dirname, '..', '..');
const BUNDLE = path.join(EDITOR, 'nova-remotion', 'bundle');
const COMPOSITOR = path.join(EDITOR, 'node_modules', '@remotion', 'compositor-darwin-arm64');
function findBrowser(root){const st=[root];while(st.length){const d=st.pop();let e=[];try{e=fs.readdirSync(d,{withFileTypes:true})}catch(_){continue}
  for(const x of e){const p=path.join(d,x.name); if(x.isDirectory())st.push(p); else if(x.name==='chrome-headless-shell')return p}}return null}

const POSES = [
  ['chống cằm · lo lắng',  { armL:'chin', armR:'open',  eyes:'normal',  brow:'worried', mouth:'frown',   acc:'bandana-us' }],
  ['chỉ tay · kinh ngạc',  { armL:'down', armR:'point', eyes:'wide',    brow:'raised',  mouth:'openM' }],
  ['vẫy tay · vui',        { armL:'wave', armR:'down',  eyes:'sparkle', brow:'raised',  mouth:'smile' }],
  ['chống nạnh · nghi ngờ',{ armL:'hip',  armR:'hip',   eyes:'squint',  brow:'furrow',  mouth:'neutral' }],
  ['giơ tay · hoảng',      { armL:'up',   armR:'up',    eyes:'wide',    brow:'raised',  mouth:'openL' }],
  ['xoè tay · chịu thua',  { armL:'open', armR:'open',  eyes:'side',    brow:'worried', mouth:'frown' }],
  ['buông · bình thản',    { armL:'down', armR:'down',  eyes:'closed',  brow:'neutral', mouth:'smile' }],
  ['suy nghĩ · cau mày',   { armL:'chin', armR:'hip',   eyes:'side',    brow:'furrow',  mouth:'neutral' }],
];

const COLS = [13, 37.5, 62, 86.5];
const layers = [];
POSES.forEach(([label, pose], i) => {
  const x = COLS[i % 4];
  const yc = i < 4 ? 27 : 73;
  layers.push({ id: 'c' + i, type: 'char', rig: 'ghost', pose, blink: false,
    box: { x, y: yc, w: 16.7, h: 40, anchor: 'center' }, in: { preset: 'none' }, z: 10 });
  layers.push({ id: 'l' + i, type: 'text', text: label,
    box: { x, y: yc + 25, w: 22, align: 'center', anchor: 'center' },
    style: { size: 22, weight: 700, color: '#5b6270' }, in: { preset: 'none' }, z: 20 });
});
const spec = { durationSec: 2, theme: { bg: '#ffffff', text: '#1f2328' }, layers };

(async () => {
  if (fs.existsSync(COMPOSITOR)) process.env.DYLD_LIBRARY_PATH = COMPOSITOR + (process.env.DYLD_LIBRARY_PATH ? ':' + process.env.DYLD_LIBRARY_PATH : '');
  const browserExecutable = findBrowser(path.join(EDITOR, 'remotion-browser')) || undefined;
  const { selectComposition, renderStill } = require('@remotion/renderer');
  const inputProps = { spec };
  const comp = await selectComposition({ serveUrl: BUNDLE, id: 'NovaScene', inputProps, browserExecutable });
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  const out = path.join(__dirname, 'out', 'pose-sheet.png');
  await renderStill({ composition: comp, serveUrl: BUNDLE, output: out, inputProps, browserExecutable, frame: 1 });
  console.log('XONG →', out);
})().catch(e => { console.error('LỖI:', e && e.stack || e); process.exit(1); });
