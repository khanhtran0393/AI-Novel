// Bộ icon dùng chung MỘT style: cùng độ dày nét, cùng bảng màu, cùng khung 100x100.
// Đây chính là bước "chuẩn hoá" — không có nó thì hình từ nhiều nguồn đá nhau ngay trên màn hình.
const fs = require('fs'); const path = require('path');

const INK = '#1f2328', W = 5.5;
const RED = '#e0524a', BLU = '#3b6fd4', AMB = '#eaa63c', TEA = '#2fa39b', GRN = '#46a86f', VIO = '#7a5cc4';

const S  = (d, w) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w || W}" stroke-linecap="round" stroke-linejoin="round"/>`;
const FS = (d, c, w) => `<path d="${d}" fill="${c}" stroke="${INK}" stroke-width="${w || W}" stroke-linecap="round" stroke-linejoin="round"/>`;
const F  = (d, c) => `<path d="${d}" fill="${c}"/>`;
const CI = (x, y, r, c) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c || 'none'}" stroke="${INK}" stroke-width="${W}"/>`;
const DOT = (x, y, r, c) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`;
const TX = (x, y, s, t, c) => `<text x="${x}" y="${y}" font-family="Helvetica,Arial,sans-serif" font-size="${s}" font-weight="800" fill="${c || INK}" text-anchor="middle">${t}</text>`;
const SLASH = () => S('M20 80 L80 20', 7);

// Con virus dùng lại nhiều chỗ → tách hàm, đổi màu/toạ độ được.
const virus = (cx, cy, r, c) => [
  ...[0,45,90,135,180,225,270,315].map(a => {
    const rad = a * Math.PI / 180;
    return S(`M${(cx + Math.cos(rad) * r).toFixed(1)} ${(cy + Math.sin(rad) * r).toFixed(1)} L${(cx + Math.cos(rad) * (r + 11)).toFixed(1)} ${(cy + Math.sin(rad) * (r + 11)).toFixed(1)}`, 4.5);
  }),
  CI(cx, cy, r, c),
].join('');

const ICONS = {
  // ── đoạn 1 ────────────────────────────────────────────────────────────────
  calendar: [FS('M14 26 h72 a5 5 0 0 1 5 5 v52 a5 5 0 0 1 -5 5 h-72 a5 5 0 0 1 -5 -5 v-52 a5 5 0 0 1 5 -5 z', '#fff'),
    FS('M9 31 a5 5 0 0 1 5 -5 h72 a5 5 0 0 1 5 5 v13 h-82 z', AMB), S('M28 30 v-14'), S('M72 30 v-14'),
    DOT(28, 58, 5, INK), DOT(50, 58, 5, AMB), DOT(72, 58, 5, INK), DOT(28, 74, 5, INK), DOT(50, 74, 5, INK)],
  hourglass: [S('M24 12 h52'), S('M24 88 h52'), FS('M30 14 h40 l-20 34 z', AMB), FS('M30 86 h40 l-20 -34 z', '#fff'),
    S('M30 14 L50 48 L30 86'), S('M70 14 L50 48 L70 86')],
  flatline: [FS('M10 50 h18 l7 -22 l10 44 l8 -30 l6 8 h41', 'none', 6), DOT(84, 50, 6, RED)],
  searchNo: [CI(44, 44, 26, '#fff'), S('M63 63 L84 84', 7), S('M34 44 h20', 6)],
  cameraNo: [FS('M12 34 h20 l7 -10 h22 l7 10 h20 a5 5 0 0 1 5 5 v34 a5 5 0 0 1 -5 5 h-76 a5 5 0 0 1 -5 -5 v-34 a5 5 0 0 1 5 -5 z', '#fff'),
    CI(50, 56, 15, '#e9edf5'), SLASH()],
  tunnel: [FS('M14 88 v-34 a36 36 0 0 1 72 0 v34 z', '#2b3550'),
    FS('M34 88 v-26 a16 16 0 0 1 32 0 v26 z', '#5a6a8c'), FS('M44 88 v-16 a6 6 0 0 1 12 0 v16 z', '#c3ccdd')],
  lock: [S('M32 46 v-12 a18 18 0 0 1 36 0 v12', 7), FS('M18 46 h64 a4 4 0 0 1 4 4 v34 a4 4 0 0 1 -4 4 h-64 a4 4 0 0 1 -4 -4 v-34 a4 4 0 0 1 4 -4 z', AMB),
    DOT(50, 64, 6, INK), S('M50 68 v10', 6)],
  virus: [virus(50, 50, 22, TEA)],
  transit: [S('M14 50 h44', 7), S('M46 36 L60 50 L46 64', 7), S('M66 36 L80 50 L66 64', 7)],
  shield: [FS('M50 10 L84 24 v30 c0 20 -16 32 -34 38 c-18 -6 -34 -18 -34 -38 v-30 z', GRN), S('M35 50 L46 62 L67 40', 7)],
  // ── đoạn 2 ────────────────────────────────────────────────────────────────
  window: [S('M6 52 h88', 5), S('M18 46 v12', 4), S('M30 47 v10', 4), S('M76 47 v10', 4), S('M88 46 v12', 4),
    FS('M36 40 h30 a6 6 0 0 1 6 6 v12 a6 6 0 0 1 -6 6 h-30 a6 6 0 0 1 -6 -6 v-12 a6 6 0 0 1 6 -6 z', GRN)],
  bite: [FS('M12 40 a38 26 0 0 1 76 0 a38 26 0 0 1 -76 0 z', '#f6dcd6'),
    ...[26,38,50,62,74].map(x => FS(`M${x} 34 l6 12 l-6 10 l-6 -10 z`, '#fff', 4)),
    S('M20 74 q30 14 60 0', 6)],
  syringe: [S('M14 86 L34 66', 7), FS('M30 62 h34 a3 3 0 0 1 3 3 v14 a3 3 0 0 1 -3 3 h-34 z', '#fff', 5),
    F('M34 66 h22 v10 h-22 z', BLU), FS('M62 58 l16 -16 l14 14 l-16 16 z', '#c8d3ea'), S('M74 32 L88 46', 6)],
  syringe2: [S('M14 86 L34 66', 7), FS('M30 62 h34 a3 3 0 0 1 3 3 v14 a3 3 0 0 1 -3 3 h-34 z', '#fff', 5),
    F('M34 66 h22 v10 h-22 z', VIO), FS('M62 58 l16 -16 l14 14 l-16 16 z', '#c8d3ea'),
    DOT(76, 22, 17, VIO), S('M76 14 v16', 5.5).replace(INK, '#fff'), S('M68 22 h16', 5.5).replace(INK, '#fff')],
  badge100: [FS('M50 8 l11 8 l13 -2 l4 13 l11 8 l-6 12 l6 12 l-11 8 l-4 13 l-13 -2 l-11 8 l-11 -8 l-13 2 l-4 -13 l-11 -8 l6 -12 l-6 -12 l11 -8 l4 -13 l13 2 z', GRN),
    TX(50, 58, 24, '100%', '#fff')],
  poster: [FS('M16 10 h68 a4 4 0 0 1 4 4 v76 a4 4 0 0 1 -4 4 h-68 a4 4 0 0 1 -4 -4 v-76 a4 4 0 0 1 4 -4 z', '#f6efe0'),
    F('M12 18 h76 v14 h-76 z', RED), TX(50, 30, 12, 'WANTED', '#fff'),
    virus(50, 58, 14, TEA), S('M26 84 h48', 5)],
  virusDead: [virus(50, 50, 22, '#b9c0c9'), S('M40 44 L48 52', 4.5), S('M48 44 L40 52', 4.5),
    S('M52 44 L60 52', 4.5), S('M60 44 L52 52', 4.5), S('M42 62 q8 -6 16 0', 4.5)],
  antibody: [S('M50 88 V52', 8), S('M50 52 L28 24', 8), S('M50 52 L72 24', 8),
    DOT(26, 20, 8, BLU), DOT(74, 20, 8, BLU)],
  chartNo: [S('M14 84 V16', 5), S('M14 84 H84', 5), S('M24 70 L42 50 L56 60 L76 30', 6),
    S('M64 30 h12 v12', 5),
    `<circle cx="56" cy="56" r="29" fill="none" stroke="${RED}" stroke-width="9"/>`,
    `<path d="M36 36 L76 76" fill="none" stroke="${RED}" stroke-width="9" stroke-linecap="round"/>`],
};

const dir = path.join(__dirname, 'assets');
fs.mkdirSync(dir, { recursive: true });
let n = 0;
for (const [name, parts] of Object.entries(ICONS)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="200" height="200">${[].concat(parts).join('')}</svg>`;
  fs.writeFileSync(path.join(dir, 'ic_' + name + '.svg'), svg);
  n++;
}
console.log(`${n} icon → assets/ic_*.svg`);
