// Sơ đồ RIÊNG cho từng câu — khác icon ở chỗ nó tải CƠ CHẾ của câu, không chỉ đánh dấu danh từ.
// Vẫn cùng nét bút với nhân vật (cùng INK, cùng độ dày) nên không lạc style.
const fs = require('fs'); const path = require('path');
const INK = '#1f2328', W = 5, RED = '#e0524a', BLU = '#3b6fd4', TEA = '#2fa39b', GRN = '#46a86f', GRY = '#b9c0c9';
const S  = (d, w, c) => `<path d="${d}" fill="none" stroke="${c || INK}" stroke-width="${w || W}" stroke-linecap="round" stroke-linejoin="round"/>`;
const FS = (d, f, w, c) => `<path d="${d}" fill="${f}" stroke="${c || INK}" stroke-width="${w || W}" stroke-linecap="round" stroke-linejoin="round"/>`;
const DOT = (x, y, r, c) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`;
const CI = (x, y, r, f, w) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${f || 'none'}" stroke="${INK}" stroke-width="${w || W}"/>`;
const spikes = (cx, cy, r, n, len) => Array.from({length: n}, (_, i) => {
  const a = i * 2 * Math.PI / n;
  return S(`M${(cx+Math.cos(a)*r).toFixed(1)} ${(cy+Math.sin(a)*r).toFixed(1)} L${(cx+Math.cos(a)*(r+len)).toFixed(1)} ${(cy+Math.sin(a)*(r+len)).toFixed(1)}`, 3.5);
}).join('');
const virus = (cx, cy, r, c) => spikes(cx, cy, r, 8, 8) + CI(cx, cy, r, c, 4);

// ── "No cameras in the tunnels" ─────────────────────────────────────────────
// MỘT hình mang cả ba ý của câu: đường hầm · virus đang đi trong đó · không có camera.
// Bản icon cũ phải dùng HAI hình rời (cameraNo + tunnel) mà vẫn không nói được "virus đang đi".
const tunnel = [
  FS('M22 56 h276 a10 10 0 0 1 10 10 v46 a10 10 0 0 1 -10 10 h-276 a10 10 0 0 1 -10 -10 v-46 a10 10 0 0 1 10 -10 z', '#f2f4f7'),
  ...[70, 118, 166, 214, 262].map(x => S(`M${x} 58 v62`, 2.5, '#cfd6e0')),
  virus(58, 89, 11, TEA), virus(96, 89, 11, TEA), virus(134, 89, 11, TEA),
  S('M156 89 h44', 5), S('M192 80 L202 89 L192 98', 5),
  FS('M228 74 h12 l5 -7 h14 l5 7 h12 a4 4 0 0 1 4 4 v24 a4 4 0 0 1 -4 4 h-48 a4 4 0 0 1 -4 -4 v-24 a4 4 0 0 1 4 -4 z', '#fff', 4),
  CI(252, 91, 9, '#e9edf5', 4),
  S('M228 68 L280 116', 6, RED),
].join('');

// ── "shows your immune system the virus's face using dead copies" ───────────
// Ba ô nối bằng mũi tên = đúng trình tự câu nói: cho xem bản chết → nhận diện → bắt bản sống.
const wanted = [
  virus(48, 62, 17, GRY), S('M40 56 L48 64', 3.5), S('M48 56 L40 64', 3.5),
  S('M56 56 L64 64', 3.5), S('M64 56 L56 64', 3.5), S('M42 76 q6 -5 12 0', 3.5),
  `<text x="48" y="112" font-family="Helvetica,Arial" font-size="15" font-weight="700" fill="#7b828e" text-anchor="middle">bản chết</text>`,
  S('M84 62 h26', 4.5), S('M104 55 L112 62 L104 69', 4.5),
  S('M158 92 V64', 6, BLU), S('M158 64 L142 44', 6, BLU), S('M158 64 L174 44', 6, BLU),
  DOT(140, 41, 6, BLU), DOT(176, 41, 6, BLU),
  `<text x="158" y="112" font-family="Helvetica,Arial" font-size="15" font-weight="700" fill="#7b828e" text-anchor="middle">ghi nhớ</text>`,
  S('M194 62 h26', 4.5), S('M214 55 L222 62 L214 69', 4.5),
  S('M262 92 V66', 6, BLU), S('M262 66 L246 48', 6, BLU), S('M262 66 L278 48', 6, BLU),
  virus(262, 40, 13, TEA),
  S('M288 58 L296 68 L312 46', 6, GRN),
  `<text x="272" y="112" font-family="Helvetica,Arial" font-size="15" font-weight="700" fill="#7b828e" text-anchor="middle">bắt bản sống</text>`,
].join('');

const out = { dg_tunnel: [tunnel, '0 0 320 178'], dg_wanted: [wanted, '0 0 330 126'] };
for (const [name, [body, vb]] of Object.entries(out)) {
  fs.writeFileSync(path.join(__dirname, 'assets', name + '.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">${body}</svg>`);
}
console.log('2 sơ đồ → assets/dg_*.svg');
