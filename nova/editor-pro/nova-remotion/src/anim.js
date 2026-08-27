// Bảng hiệu ứng cho NovaScene. Mọi hiệu ứng nhận tiến độ p (0→1) và trả về style/transform.
// Tách riêng để BỘ THÔNG DỊCH cố định, còn AI chỉ chọn TÊN hiệu ứng — không sinh mã.
const { interpolate, Easing } = require('remotion');

const clamp01 = (v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
const mix = (a, b, p) => a + (b - a) * clamp01(p);
const easeOut = Easing.out(Easing.cubic);
const easeOutBack = Easing.out(Easing.back(1.7));

// ── VÀO ─────────────────────────────────────────────────────────────────────
// Mỗi hàm trả { opacity?, transform?, filter?, clipPath? } — gộp lên wrapper của lớp.
const IN = {
  none:   ()  => ({}),
  fade:   (p) => ({ opacity: easeOut(p) }),
  // Trượt vào — bốn hướng. Dùng % nên không phụ thuộc cỡ khung.
  slideL: (p) => ({ opacity: easeOut(p), transform: `translateX(${mix(-18, 0, easeOut(p))}%)` }),
  slideR: (p) => ({ opacity: easeOut(p), transform: `translateX(${mix(18, 0, easeOut(p))}%)` }),
  rise:   (p) => ({ opacity: easeOut(p), transform: `translateY(${mix(22, 0, easeOut(p))}%)` }),
  drop:   (p) => ({ opacity: easeOut(p), transform: `translateY(${mix(-22, 0, easeOut(p))}%)` }),
  // Thẻ ảnh nảy vào — dùng cho chồng thẻ loài vật.
  pop:    (p) => ({ opacity: clamp01(p * 2), transform: `scale(${mix(0.82, 1, easeOutBack(p))})` }),
  // Thẻ trượt vào kèm nghiêng nhẹ: chồng thẻ trông như xếp tay, không phải dán máy.
  deal:   (p) => ({ opacity: clamp01(p * 1.6),
    transform: `translateY(${mix(14, 0, easeOutBack(p))}%) rotate(${mix(-4, 0, easeOutBack(p))}deg) scale(${mix(0.9, 1, easeOutBack(p))})` }),
  // Nét vẽ quét ngang — cho vệt bút dạ và gạch chân.
  wipeL:  (p) => ({ opacity: 1, clipPath: `inset(0 ${mix(100, 0, easeOut(p))}% 0 0)` }),
  // Ảnh hiện ra từ mờ — hợp cảnh tư liệu cũ.
  defocus:(p) => ({ opacity: easeOut(p), filter: `blur(${mix(14, 0, easeOut(p))}px)` }),
  zoom:   (p) => ({ opacity: easeOut(p), transform: `scale(${mix(1.12, 1, easeOut(p))})` }),
};


// ── RA ──────────────────────────────────────────────────────────────────────
const OUT = {
  none:   ()  => ({}),
  fade:   (p) => ({ opacity: 1 - easeOut(p) }),
  sinkL:  (p) => ({ opacity: 1 - easeOut(p), transform: `translateX(${mix(0, -14, easeOut(p))}%)` }),
  sinkR:  (p) => ({ opacity: 1 - easeOut(p), transform: `translateX(${mix(0, 14, easeOut(p))}%)` }),
  fall:   (p) => ({ opacity: 1 - easeOut(p), transform: `translateY(${mix(0, 16, easeOut(p))}%)` }),
  shrink: (p) => ({ opacity: 1 - easeOut(p), transform: `scale(${mix(1, 0.9, easeOut(p))})` }),
  wipeR:  (p) => ({ opacity: 1, clipPath: `inset(0 0 0 ${mix(0, 100, easeOut(p))}%)` }),
};


// ── GIỮ (chạy suốt lớp) ─────────────────────────────────────────────────────
// p = tiến độ toàn lớp, f = frame cục bộ (cho dao động không phụ thuộc độ dài).
const HOLD = {
  none: () => '',
  // Ken Burns — ảnh tĩnh phải luôn có cái này, không thì cảnh chết cứng.
  kenIn:  (p, f, a) => `scale(${1 + 0.09 * a * clamp01(p)})`,
  kenOut: (p, f, a) => `scale(${1 + 0.09 * a * (1 - clamp01(p))})`,
  panL:   (p, f, a) => `scale(${1 + 0.06 * a}) translateX(${-2.5 * a * clamp01(p)}%)`,
  panR:   (p, f, a) => `scale(${1 + 0.06 * a}) translateX(${2.5 * a * clamp01(p)}%)`,
  panU:   (p, f, a) => `scale(${1 + 0.06 * a}) translateY(${-2.5 * a * clamp01(p)}%)`,
  panD:   (p, f, a) => `scale(${1 + 0.06 * a}) translateY(${2.5 * a * clamp01(p)}%)`,
  // Thanh chạy đầy — mọc từ mép nhờ transformOrigin trong originFor() của NovaScene.
  growX:  (p, f, a) => `scaleX(${clamp01(p / 0.6)})`,
  growY:  (p, f, a) => `scaleY(${clamp01(p / 0.6)})`,
  // Trôi rất nhẹ cho thẻ ảnh chồng — đủ để mắt biết lớp còn sống.
  drift:  (p, f, a) => `translateY(${Math.sin(f / 42) * 0.5 * a}%)`,
  // Nhịp thở cho nhãn/biểu tượng cần hút mắt mà không nhấp nháy.
  breathe:(p, f, a) => `scale(${1 + Math.sin(f / 30) * 0.012 * a})`,
};


// ── CHỮ THEO TỪNG KÝ TỰ ─────────────────────────────────────────────────────
// Trả style cho ký tự thứ i trong n ký tự. Cả cụm hiện dần thay vì fade nguyên khối.
//   mode: 'type'  gõ máy — ký tự hiện dứt khoát, không mờ
//         'stagger' lệch pha — từng ký tự fade + nhích lên
//         'kinetic' lệch pha mạnh — kèm phóng to
// spread = phần tiến độ dành cho việc trải đều các ký tự (0→spread), phần còn lại giữ nguyên.
const CHAR = {
  type: (q) => ({ opacity: q > 0 ? 1 : 0 }),
  stagger: (q) => ({ opacity: q, transform: `translateY(${mix(14, 0, easeOut(q))}px)` }),
  kinetic: (q) => ({ opacity: q, transform: `translateY(${mix(26, 0, easeOutBack(q))}px) scale(${mix(0.75, 1, easeOutBack(q))})` }),
};
function charStyleAt(mode, i, n, p, spread) {
  const fn = CHAR[mode] || CHAR.stagger;
  const sp = Math.max(0.05, Math.min(1, Number(spread) || 0.6));
  const total = Math.max(1, n);
  const step = sp / total;                       // mỗi ký tự lệch nhau step
  const q = clamp01((clamp01(p) - i * step) / Math.max(0.02, step * 1.8));
  return fn(q);
}

// Gộp style vào/ra/giữ của MỘT lớp tại frame hiện tại.
// t: giây trong cảnh · L: mô tả lớp · total: tổng giây của cảnh · fps
function layerStyleAt(L, t, total, fps) {
  const start = Math.max(0, Number(L.at) || 0);
  const end = L.until != null ? Math.min(total, Number(L.until)) : total;
  if (t < start || t > end) return null;                      // lớp chưa vào / đã hết

  const inDur = Math.max(0.01, Number((L.in && L.in.dur) != null ? L.in.dur : 0.45));
  const outDur = Math.max(0.01, Number((L.out && L.out.dur) != null ? L.out.dur : 0.4));
  const local = t - start;
  const span = Math.max(0.01, end - start);

  // Kho preset đang RỖNG → phải có hàm trơ, không thì undefined() ném lỗi và chết cả video.
  const TRO = () => ({}), TRO_TF = () => '';
  const inFn = IN[(L.in && L.in.preset) || 'fade'] || IN.fade || TRO;
  const outFn = OUT[(L.out && L.out.preset) || 'none'] || OUT.none || TRO;
  const holdFn = HOLD[(L.hold && L.hold.preset) || 'none'] || HOLD.none || TRO_TF;
  const amp = Math.max(0.25, Math.min(2, Number((L.hold && L.hold.amp) != null ? L.hold.amp : 1)));

  const inS = inFn(clamp01(local / inDur));
  const outStart = span - outDur;
  const outS = local > outStart ? outFn(clamp01((local - outStart) / outDur)) : {};
  const holdT = holdFn(clamp01(local / span), local * fps, amp);

  const transforms = [inS.transform, outS.transform, holdT].filter(Boolean).join(' ');
  const filters = [inS.filter, outS.filter].filter(Boolean).join(' ');
  const opacity = Math.min(
    inS.opacity != null ? inS.opacity : 1,
    outS.opacity != null ? outS.opacity : 1
  );
  return {
    opacity,
    transform: transforms || undefined,
    filter: filters || undefined,
    clipPath: outS.clipPath || inS.clipPath || undefined,
    p: clamp01(local / span),        // tiến độ toàn lớp — cho chữ chạy từng ký tự
    pIn: clamp01(local / inDur),     // tiến độ riêng đoạn VÀO
  };
}

module.exports = { IN, OUT, HOLD, CHAR, layerStyleAt, charStyleAt, clamp01, mix, interpolate };
