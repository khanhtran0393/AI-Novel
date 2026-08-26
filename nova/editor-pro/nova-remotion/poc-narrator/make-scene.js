// Sinh scene.json cho POC "nhân vật dẫn chuyện". Đây chính là TẦNG GIỮA của pipeline:
// kịch bản + mốc thời gian → spec JSON. Engine NovaScene có sẵn lo phần dựng hình.
const fs = require('fs');
const path = require('path');

const GHOST = JSON.parse(fs.readFileSync(path.join(__dirname, 'ghost.json'), 'utf8'));
const A = (f) => 'assets/' + f;   // đường dẫn tương đối trong bundle Remotion

// Nhân vật dẫn chuyện — đặt ở đâu, to bao nhiêu, vào lúc nào.
// h/w giữ đúng tỉ lệ khung 200x260 trên khổ 1920x1080 (w% * 1920 / (h% * 1080) ≈ 0.77).
function ghost({ x, y, h = 36, at = 0, hold = 'drift', amp = 1 }) {
  return {
    id: 'ghost', type: 'svg', at,
    viewBox: GHOST.viewBox, preserveAspectRatio: GHOST.preserveAspectRatio, paths: GHOST.paths,
    box: { x, y, w: +(h * 0.4327).toFixed(2), h, anchor: 'center' },
    in: { preset: 'fade', dur: 0.35 },
    hold: { preset: hold, amp },
    z: 20,
  };
}

// Phụ đề chạy từng ký tự — chỗ này về sau nối thẳng vào timestamp của Whisper.
function caption(text, { dark = false } = {}) {
  return {
    id: 'cap', type: 'text', text,
    box: { x: 50, y: 87, w: 78, align: 'center', anchor: 'center' },
    style: {
      size: 42, weight: 700, lineHeight: 1.35,
      color: dark ? '#f4f1ea' : '#1f2328',
      bg: dark ? 'rgba(0,0,0,.5)' : 'rgba(255,255,255,.82)',
      pad: 16, radius: 14,
      reveal: 'type', revealSpread: 0.35,
    },
    in: { preset: 'rise', dur: 0.4 },
    z: 90,
  };
}

// Thẻ media bay vào — ảnh có viền trắng + đổ bóng (kiểu ảnh dán), hoặc cutout nền trong.
function media({ id, src, x, y, w, at, card = false, rot = 0 }) {
  return {
    id, type: 'image', src: A(src), at, rotate: rot,
    box: { x, y, w },
    style: card
      ? { radius: 8, stroke: '#ffffff', strokeWidth: 12, shadow: 1.1 }
      : {},   // cutout: KHÔNG đổ bóng — boxShadow bám hộp nên lộ khung chữ nhật quanh hình nền trong
    in: { preset: 'pop', dur: 0.5 },
    hold: { preset: 'drift', amp: 1.1 },
    z: 30,
  };
}

const scenes = [];

// ── BEAT 1 — mở bằng cảnh nền photoreal + nhân vật, Ken Burns cho nền đỡ chết cứng ──
scenes.push({
  id: 's1', durationSec: 5.2,
  theme: { bg: '#0d1412', text: '#f4f1ea', accent: '#e8763a' },
  layers: [
    { id: 'bg', type: 'backdrop', src: A('poc_bedroom.svg'),
      in: { preset: 'fade', dur: 0.7 }, hold: { preset: 'kenIn', amp: 1 }, z: 0 },
    ghost({ x: 50, y: 56, h: 34, at: 0.7, hold: 'drift', amp: 1.4 }),
    caption('3 giờ 17 sáng. Bạn tỉnh giấc vì một tiếng động lạ ngoài cửa sổ.', { dark: true }),
  ],
});

// ── BEAT 2 — nền trắng, nhân vật dạt sang trái, 4 hình minh hoạ nảy vào lệch nhịp ──
scenes.push({
  id: 's2', durationSec: 5.4, trans: 'dissolve', transDur: 0.5,
  theme: { bg: '#f5f5f3', text: '#1f2328', accent: '#e8763a' },
  layers: [
    ghost({ x: 14, y: 54, h: 34, at: 0.1, hold: 'breathe', amp: 1.2 }),
    media({ id: 'm1', src: 'poc_dog.svg',     x: 33, y: 14, w: 26, at: 0.35, card: true, rot: -2 }),
    media({ id: 'm2', src: 'poc_map.svg',     x: 68, y: 12, w: 22, at: 0.80 }),
    media({ id: 'm3', src: 'poc_bat.svg',     x: 34, y: 52, w: 24, at: 1.25 }),
    media({ id: 'm4', src: 'poc_syringe.svg', x: 69, y: 50, w: 20, at: 1.70 }),
    caption('Chó, dơi, cáo — virus dại lây qua nước bọt của động vật có vú.'),
  ],
});

// ── BEAT 3 — dồn về một hình duy nhất, phóng to: nhịp "cận cảnh" giữa hai đoạn rộng ──
scenes.push({
  id: 's3', durationSec: 4.6, trans: 'dip-white', transDur: 0.45,
  theme: { bg: '#f5f5f3', text: '#1f2328', accent: '#e8763a' },
  layers: [
    { id: 'hero', type: 'image', src: A('poc_virus.svg'),
      box: { x: 50, y: 43, w: 44, anchor: 'center' },
      style: { radius: 10, stroke: '#ffffff', strokeWidth: 14, shadow: 1.3 },
      in: { preset: 'zoom', dur: 0.6 }, hold: { preset: 'kenIn', amp: 0.6 }, z: 10 },
    { id: 'kw', type: 'text', text: 'DỌC DÂY THẦN KINH', at: 1.2,
      box: { x: 50, y: 78, w: 60, align: 'center', anchor: 'center' },
      style: { size: 34, weight: 800, upper: true, tracking: 0.08, color: '#e8763a', reveal: 'kinetic', revealSpread: 0.14 },
      in: { preset: 'fade', dur: 0.4 }, z: 40 },
    caption('Nó không đi theo đường máu — nó bò dọc dây thần kinh, hướng lên não.'),
  ],
});

// ── BEAT 4 — nhân vật + thẻ dẫn nguồn trượt vào từ phải (kiểu "kết quả tra cứu") ──
// Ghi chú: ShapeLayer của engine chưa hỗ trợ boxShadow, nên bóng thẻ đang giả bằng
// một hình chữ nhật xám mờ nằm dưới, lệch 0.4%. Xem README để biết bản vá thật.
const CARD = { x: 37, y: 24, w: 54, h: 42 };
scenes.push({
  id: 's4', durationSec: 5.8, trans: 'dissolve', transDur: 0.5,
  theme: { bg: '#f5f5f3', text: '#1f2328', accent: '#e8763a' },
  layers: [
    ghost({ x: 15, y: 56, h: 34, at: 0.1, hold: 'drift', amp: 1.2 }),

    { id: 'card-shadow', type: 'shape', shape: 'rect', at: 0.4,
      box: { x: CARD.x + 0.35, y: CARD.y + 0.7, w: CARD.w, h: CARD.h },
      style: { fill: 'rgba(20,24,35,.16)', radius: 20 },
      in: { preset: 'slideR', dur: 0.55 }, z: 8 },
    { id: 'card', type: 'shape', shape: 'rect', at: 0.4,
      box: CARD,
      style: { fill: '#ffffff', stroke: '#e4e7ef', strokeWidth: 2, radius: 20 },
      in: { preset: 'slideR', dur: 0.55 }, z: 10 },

    { id: 'card-title', type: 'text', text: 'Ca bệnh năm 2004', at: 0.85,
      box: { x: 40, y: 28.5, w: 32 },
      style: { size: 40, weight: 800, color: '#1e3a8a', reveal: 'stagger', revealSpread: 0.5 },
      in: { preset: 'fade', dur: 0.3 }, z: 20 },
    { id: 'card-body', type: 'text', at: 1.1,
      text: 'Một thiếu nữ ở Wisconsin sống sót sau khi đã phát bệnh dại,\ndù chưa từng tiêm vắc-xin trước đó. Phác đồ dùng cho ca này\nvề sau trở thành một trong những tranh luận lớn của ngành\nbệnh truyền nhiễm.',
      box: { x: 40, y: 35.5, w: 34 },
      style: { size: 22, weight: 400, lineHeight: 1.55, color: '#3b4557' },
      in: { preset: 'fade', dur: 0.45 }, z: 20 },
    { id: 'card-thumb', type: 'image', src: A('poc_thumb.svg'), at: 1.0,
      box: { x: 79.5, y: 28, w: 8 },
      style: { radius: 10, shadow: 0.6 },
      in: { preset: 'pop', dur: 0.45 }, z: 20 },

    { id: 'src-bar', type: 'shape', shape: 'rect', at: 1.6,
      box: { x: 39, y: 54, w: 50, h: 9 },
      style: { fill: '#fdf6ec', radius: 10 },
      in: { preset: 'fade', dur: 0.35 }, z: 15 },
    { id: 'src-txt', type: 'text', text: 'Nguồn tham khảo · hồ sơ y văn', at: 1.75,
      box: { x: 41, y: 57 , w: 44 },
      style: { size: 21, weight: 700, color: '#1e3a8a' },
      in: { preset: 'fade', dur: 0.3 }, z: 20 },

    caption('Năm 2004, một ca bệnh hiếm đã làm thay đổi cách y học nhìn về bệnh dại.'),
  ],
});

const out = { scenes, globals: [] };
fs.writeFileSync(path.join(__dirname, 'scene.json'), JSON.stringify(out, null, 2));
const total = scenes.reduce((s, x) => s + x.durationSec, 0);
console.log(`scene.json OK — ${scenes.length} cảnh, ${total.toFixed(1)}s, ${scenes.reduce((s,x)=>s+x.layers.length,0)} lớp`);
