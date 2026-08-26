// Rig nhân vật "ghost" — bộ phận rời, KHÔNG phải một hình chết.
// Pose = chọn tên bộ phận, nên số tư thế là TÍCH của các nhánh chứ không phải tổng.
//
// Tay vẽ theo ĐƯỜNG TÂM (centerline) rồi tô hai lần: nét đậm màu mực ở dưới, nét trắng
// mảnh hơn ở trên → ra hình có viền, đầu bo tròn, mà chỉ tốn 1 path. Vẽ tay dạng khối
// kín cho từng ngón sẽ đẹp hơn chút nhưng tốn gấp 5 công và rất dễ lệch nét giữa các biến thể.

const INK = '#1f2328';
const SKIN = '#ffffff';
const LIMB = 22;          // bề dày cánh tay
const OUT = 5;            // độ dày viền mực

// Chi (tay/chân) vẽ bằng nét: {outline:true} → renderer tự tô 2 lượt.
const limb = (d, w) => ({ d, w: w || LIMB, outline: true, cap: 'round' });
// Bàn tay: một cục bo tròn ở cuối cánh tay, cùng kiểu tô 2 lượt.
const hand = (x, y, r) => ({ d: `M${x} ${y} l0.01 0`, w: (r || 17) * 2, outline: true, cap: 'round' });

// ── THÂN + CHÂN ─────────────────────────────────────────────────────────────
// Vạt vải loe dần xuống, gấu lượn sóng; hai chân thò ra dưới gấu (vẽ TRƯỚC thân
// nên bị gấu vải che phần trên — đúng thứ tự lớp của bản gốc).
const BODY = {
  shadow: [{ d: 'M203 508 m-132 0 a132 17 0 1 0 264 0 a132 17 0 1 0 -264 0', fill: 'rgba(20,22,28,.13)' }],
  legs: [
    { d: 'M154 372 L154 468 Q154 494 176 494 Q198 494 198 468 L198 372 Z', fill: SKIN, stroke: INK, w: 5 },
    { d: 'M216 372 L216 468 Q216 494 238 494 Q260 494 260 468 L260 372 Z', fill: SKIN, stroke: INK, w: 5 },
  ],
  body: [{
    d: 'M105 205 C105 122 147 74 200 74 C253 74 295 122 295 205 L322 396 '
     + 'Q300 444 270 422 Q242 400 214 430 Q186 460 158 426 Q130 396 102 420 Q84 432 78 396 Z',
    fill: SKIN, stroke: INK, w: 5,
  }],
  // Nếp gấp vải — thứ làm nhân vật không bị "phẳng như dán".
  folds: [
    { d: 'M142 300 C132 350 130 390 138 420', stroke: '#d9dce2', w: 4, cap: 'round' },
    { d: 'M258 296 C270 346 272 386 264 418', stroke: '#d9dce2', w: 4, cap: 'round' },
    { d: 'M200 330 C198 368 199 396 203 420', stroke: '#e6e8ec', w: 3.5, cap: 'round' },
  ],
};

// ── TAY TRÁI (phía người xem) ───────────────────────────────────────────────
const ARM_L = {
  down:  [limb('M100 288 C80 324 74 356 84 384'), hand(84, 384)],
  chin:  [limb('M100 296 C86 346 116 342 152 302'), hand(155, 299, 16),
          limb('M162 290 L190 264', 11)],                       // ngón trỏ chạm mép miệng
  open:  [limb('M100 286 C74 300 52 318 38 340'), hand(36, 342)],
  wave:  [limb('M100 282 C76 248 60 212 65 176'), hand(65, 172)],
  hip:   [limb('M100 288 C74 302 66 330 96 342'), hand(100, 344, 15)],
  up:    [limb('M100 280 C92 230 106 182 140 154'), hand(142, 150)],
};

// ── TAY PHẢI ────────────────────────────────────────────────────────────────
const ARM_R = {
  down:  [limb('M300 288 C320 324 326 356 316 384'), hand(316, 384)],
  open:  [limb('M300 284 C328 298 352 314 368 334'), hand(370, 336),
          limb('M380 330 L406 322', 9), limb('M380 342 L404 340', 9)],
  point: [limb('M300 288 C330 290 356 282 376 270'), hand(378, 268, 15),
          limb('M390 264 L416 256', 11)],
  wave:  [limb('M300 282 C324 248 340 212 335 176'), hand(335, 172)],
  hip:   [limb('M300 288 C326 302 334 330 304 342'), hand(300, 344, 15)],
  up:    [limb('M300 280 C308 230 294 182 260 154'), hand(258, 150)],
};

// ── MẮT ─────────────────────────────────────────────────────────────────────
const eye = (cx, cy, rx, ry) => ({ d: `M${cx} ${cy} m-${rx} 0 a${rx} ${ry} 0 1 0 ${rx * 2} 0 a${rx} ${ry} 0 1 0 -${rx * 2} 0`, fill: INK });
const EYES = {
  normal:  [eye(176, 196, 16, 21), eye(236, 194, 16, 21)],
  wide:    [eye(176, 194, 19, 26), eye(236, 192, 19, 26)],
  squint:  [eye(176, 198, 16, 9),  eye(236, 196, 16, 9)],
  closed:  [{ d: 'M160 198 Q176 210 192 198', stroke: INK, w: 5, cap: 'round' },
            { d: 'M220 196 Q236 208 252 196', stroke: INK, w: 5, cap: 'round' }],
  side:    [eye(184, 196, 14, 20), eye(244, 194, 14, 20)],
  sparkle: [eye(176, 196, 17, 22), eye(236, 194, 17, 22),
            { d: 'M170 188 m-5 0 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0', fill: '#fff' },
            { d: 'M230 186 m-5 0 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0', fill: '#fff' }],
};

// ── CHÂN MÀY ────────────────────────────────────────────────────────────────
const BROW = {
  none:    [],
  neutral: [{ d: 'M160 160 Q176 152 192 159', stroke: INK, w: 4.5, cap: 'round' },
            { d: 'M220 158 Q236 150 252 157', stroke: INK, w: 4.5, cap: 'round' }],
  raised:  [{ d: 'M158 146 Q176 134 194 145', stroke: INK, w: 4.5, cap: 'round' },
            { d: 'M218 144 Q236 132 254 143', stroke: INK, w: 4.5, cap: 'round' }],
  furrow:  [{ d: 'M158 150 Q176 162 194 166', stroke: INK, w: 5, cap: 'round' },
            { d: 'M254 148 Q236 160 218 164', stroke: INK, w: 5, cap: 'round' }],
  worried: [{ d: 'M158 166 Q176 150 194 152', stroke: INK, w: 4.5, cap: 'round' },
            { d: 'M254 164 Q236 148 218 150', stroke: INK, w: 4.5, cap: 'round' }],
};

// ── MIỆNG ───────────────────────────────────────────────────────────────────
const oval = (cx, cy, rx, ry) => ({ d: `M${cx} ${cy} m-${rx} 0 a${rx} ${ry} 0 1 0 ${rx * 2} 0 a${rx} ${ry} 0 1 0 -${rx * 2} 0`, fill: INK });
const MOUTH = {
  neutral: [{ d: 'M192 252 Q206 246 220 252', stroke: INK, w: 5, cap: 'round' }],
  smile:   [{ d: 'M188 246 Q206 266 224 246', stroke: INK, w: 5, cap: 'round' }],
  frown:   [{ d: 'M190 258 Q206 240 222 258', stroke: INK, w: 5, cap: 'round' }],
  openS:   [oval(206, 252, 11, 9)],
  openM:   [oval(206, 254, 15, 15)],
  openL:   [oval(206, 256, 18, 23)],
};

// ── PHỤ KIỆN ────────────────────────────────────────────────────────────────
// Khăn bandana: cắt theo đúng vòm đầu (clip) nên ôm sát, không bị "dán đè".
const DOME_CLIP = 'M105 205 C105 122 147 74 200 74 C253 74 295 122 295 205 Z';
const ACC = {
  none: [],
  'bandana-us': {
    clip: DOME_CLIP,
    paths: [
      { d: 'M96 168 C120 96 170 66 214 68 C258 70 292 104 300 150 L300 176 L96 200 Z', fill: '#f2f2f2' },
      ...[0, 1, 2, 3, 4].map((i) => ({
        d: `M96 ${172 - i * 22} C130 ${112 - i * 20} 180 ${80 - i * 18} 300 ${132 - i * 20} L300 ${143 - i * 20} C180 ${91 - i * 18} 130 ${123 - i * 20} 96 ${183 - i * 22} Z`,
        fill: '#c8354a',
      })),
      { d: 'M96 172 C120 100 168 68 206 68 L214 152 L96 196 Z', fill: '#2c3d75' },
      ...[[124, 150], [156, 128], [188, 112], [138, 178], [170, 154], [200, 138]]
        .map(([x, y]) => ({ d: `M${x} ${y} m-6 0 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0`, fill: '#fff' })),
    ],
    // Đuôi khăn nằm NGOÀI vòm đầu nên không bị clip — tách ra lớp riêng.
    after: [
      { d: 'M292 150 C318 158 336 176 330 198 C324 220 306 214 296 196 Z', fill: '#c8354a', stroke: '#8f2233', w: 3 },
      { d: 'M300 186 C322 196 334 214 326 232 C318 250 302 242 296 224 Z', fill: '#2c3d75', stroke: '#1c2a55', w: 3 },
    ],
  },
};

module.exports = {
  id: 'ghost',
  viewBox: '0 0 400 540',
  ink: INK, skin: SKIN, outlineWidth: OUT,
  body: BODY,
  armL: ARM_L, armR: ARM_R,
  eyes: EYES, brow: BROW, mouth: MOUTH, acc: ACC,
  // Mặc định khi pose không nói gì.
  fallback: { armL: 'down', armR: 'down', eyes: 'normal', brow: 'neutral', mouth: 'neutral', acc: 'none' },
};
