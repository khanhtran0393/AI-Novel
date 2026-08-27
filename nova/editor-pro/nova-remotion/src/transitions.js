// 38 CHUYỂN CẢNH — dữ liệu bê từ video-creator của Fractal (transitions.json),
// phần DỰNG thì viết lại ở đây vì bên kia nằm trong runtime Composition Lab không bê được.
//
//   13 cái "builtin" → ánh xạ thẳng sang @remotion/transitions (fade/slide/wipe/flip/iris/clockWipe/none).
//   25 cái "custom"  → gom về 12 kiểu dựng, mỗi kiểu vài biến thể khác tham số.
//
// Quy ước của Remotion: presentationProgress chạy 0→1 suốt chuyển cảnh, CẢ HAI phía đều nhận
// cùng một giá trị; phân biệt bằng presentationDirection ('entering' | 'exiting').
'use strict';
const React = require('react');
const { AbsoluteFill, interpolate, Easing } = require('remotion');
const { fade } = require('@remotion/transitions/fade');
const { slide } = require('@remotion/transitions/slide');
const { wipe } = require('@remotion/transitions/wipe');
const { flip } = require('@remotion/transitions/flip');
const { iris } = require('@remotion/transitions/iris');
const { clockWipe } = require('@remotion/transitions/clock-wipe');
const { none } = require('@remotion/transitions/none');
const PRESETS = require('./transitions.json');

const h = React.createElement;
const clamp01 = (v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
const mix = (a, b, p) => a + (b - a) * clamp01(p);
const easeOut = Easing.out(Easing.cubic);
// Xung hình tam giác: 0 ở hai đầu, 1 ở giữa — dùng cho chớp sáng, nhúng màu, cháy mép.
const pulse = (p) => 1 - Math.abs(2 * clamp01(p) - 1);

// Bọc children trong 1 lớp phủ toàn khung với style tính sẵn.
const Wrap = (style, children, extra) =>
  h(AbsoluteFill, { style }, children, extra || null);

// ── 12 KIỂU DỰNG TỰ VIẾT ────────────────────────────────────────────────────
const CUSTOM = {

  // Nhúng qua một màu (đen/trắng) rồi hiện ra. Màu phủ đậm nhất ở giữa chuyển cảnh.
  'dip-color': (pp) => ({ children, presentationProgress: p, presentationDirection: d }) => {
    const color = pp.dipColor || '#000';
    const half = d === 'entering' ? clamp01(p * 2 - 1) : 1 - clamp01(p * 2);
    return Wrap({ opacity: half },
      children,
      d === 'entering' ? h(AbsoluteFill, { style: { background: color, opacity: pulse(p), pointerEvents: 'none' } }) : null);
  },

  // Phóng chéo: cảnh cũ phóng to bay ra, cảnh mới thu từ lớn về.
  'cross-zoom': (pp) => ({ children, presentationProgress: p, presentationDirection: d }) => {
    const amt = Number(pp.zoomAmount) || 0.35;
    const s = d === 'entering' ? mix(1 + amt, 1, easeOut(p)) : mix(1, 1 + amt * 1.6, p);
    return Wrap({ transform: `scale(${s})`, opacity: d === 'entering' ? clamp01(p * 1.4) : 1 - clamp01(p * 1.2) }, children);
  },

  // Quật ngang/dọc rất nhanh, kèm nhoè chuyển động — kiểu cắt cảnh vlog.
  whip: (pp) => ({ children, presentationProgress: p, presentationDirection: d }) => {
    const dir = pp.motionDirection || 'left';
    const axis = (dir === 'up' || dir === 'down') ? 'Y' : 'X';
    const sign = (dir === 'left' || dir === 'up') ? -1 : 1;
    const e = easeOut(p);
    const off = d === 'entering' ? mix(110 * -sign, 0, e) : mix(0, 110 * sign, e);
    const blur = pulse(p) * (Number(pp.blurPx) || 16);
    return Wrap({ transform: `translate${axis}(${off}%)`, filter: `blur(${blur}px)` }, children);
  },

  // Chớp sáng (loé đèn / choá / nhấp nháy). variant đổi số lần chớp.
  'flash-pulse': (pp) => ({ children, presentationProgress: p, presentationDirection: d }) => {
    const color = pp.flashColor || '#fff';
    const times = Math.max(1, Number(pp.pulses) || 1);
    const wave = times > 1 ? Math.abs(Math.sin(clamp01(p) * Math.PI * times)) : pulse(p);
    const op = d === 'entering' ? clamp01(p * 2 - 0.6) : 1 - clamp01(p * 2 - 0.4);
    return Wrap({ opacity: op },
      children,
      d === 'entering' ? h(AbsoluteFill, { style: { background: color, opacity: wave * (Number(pp.intensity) || 0.85), pointerEvents: 'none' } }) : null);
  },

  // Quét bằng mặt nạ chuyển sắc — mép quét mềm chứ không cắt thẳng như wipe.
  'mask-sweep': (pp) => ({ children, presentationProgress: p, presentationDirection: d }) => {
    const ang = Number(pp.angle) || 90;
    const soft = Number(pp.softness) || 18;      // % độ mềm của mép quét
    const q = d === 'entering' ? clamp01(p) : clamp01(p);
    const edge = mix(-soft, 100 + soft, q);
    const grad = d === 'entering'
      ? `linear-gradient(${ang}deg, #000 ${edge - soft}%, transparent ${edge + soft}%)`
      : `linear-gradient(${ang}deg, transparent ${edge - soft}%, #000 ${edge + soft}%)`;
    return Wrap({ WebkitMaskImage: grad, maskImage: grad }, children);
  },

  // Cửa chớp / khuôn phim: các dải ngang đóng lại rồi mở ra.
  'film-gate': (pp) => ({ children, presentationProgress: p, presentationDirection: d }) => {
    const bands = Math.max(2, Number(pp.bands) || 6);
    const reverse = !!pp.reverse;
    const q = reverse ? 1 - clamp01(p) : clamp01(p);
    const open = d === 'entering' ? q : 1 - q;
    const step = 100 / bands;
    // Mỗi dải mở dần từ giữa ra — dựng bằng repeating-linear-gradient làm mặt nạ.
    const half = Math.max(0.001, open * step / 2);
    const grad = `repeating-linear-gradient(0deg, #000 0 ${half}%, transparent ${half}% ${step / 2}%, transparent ${step / 2}% ${step - half}%, #000 ${step - half}% ${step}%)`;
    return Wrap({ WebkitMaskImage: grad, maskImage: grad }, children);
  },

  // Tách đôi: hai nửa trượt ra hai phía để lộ cảnh dưới.
  'split-reveal': (pp) => ({ children, presentationProgress: p, presentationDirection: d }) => {
    const vert = (pp.axis || 'vertical') === 'vertical';
    const q = easeOut(clamp01(p));
    if (d === 'entering') return Wrap({ opacity: clamp01(p * 1.6) }, children);
    const gap = mix(0, 52, q);
    const grad = vert
      ? `linear-gradient(90deg, #000 ${50 - gap}%, transparent ${50 - gap}%, transparent ${50 + gap}%, #000 ${50 + gap}%)`
      : `linear-gradient(0deg, #000 ${50 - gap}%, transparent ${50 - gap}%, transparent ${50 + gap}%, #000 ${50 + gap}%)`;
    return Wrap({ WebkitMaskImage: grad, maskImage: grad }, children);
  },

  // Nhiễu số: lệch kênh màu + nhoè + giật ngang.
  'glitch-split': (pp) => ({ children, presentationProgress: p, presentationDirection: d }) => {
    const off = (Number(pp.channelOffset) || 10) * pulse(p);
    const blur = (Number(pp.blurPx) || 0) * pulse(p);
    const jitter = Math.sin(clamp01(p) * Math.PI * 14) * off * 0.4;
    const op = d === 'entering' ? clamp01(p * 1.8 - 0.4) : 1 - clamp01(p * 1.8 - 0.2);
    return Wrap({
      opacity: op,
      transform: `translateX(${jitter}px)`,
      filter: `blur(${blur}px) drop-shadow(${off}px 0 rgba(255,0,60,.65)) drop-shadow(${-off}px 0 rgba(0,220,255,.65))`,
    }, children);
  },

  // Nhoè + phóng: chuyển mềm, hợp cảnh trầm.
  'blur-zoom': (pp) => ({ children, presentationProgress: p, presentationDirection: d }) => {
    const bmax = Number(pp.blurPx) || 22;
    const zoom = Number(pp.zoomAmount) || 0.18;
    const b = pulse(p) * bmax;
    const s = d === 'entering' ? mix(1 + zoom, 1, easeOut(p)) : mix(1, 1 - zoom * 0.5, p);
    return Wrap({ filter: `blur(${b}px)`, transform: `scale(${s})`, opacity: d === 'entering' ? clamp01(p * 1.5) : 1 - clamp01(p * 1.3) }, children);
  },

  // Cháy mép: viền sáng ăn dần vào giữa khung.
  'edge-burn': (pp) => ({ children, presentationProgress: p, presentationDirection: d }) => {
    const burn = pp.burnColor || '#fb923c', glow = pp.glowColor || '#fff7ed';
    const q = clamp01(p);
    const r = d === 'entering' ? mix(0, 140, easeOut(q)) : mix(140, 0, q);
    const grad = `radial-gradient(circle at 50% 50%, #000 ${Math.max(0, r - 22)}%, transparent ${r}%)`;
    return Wrap({ WebkitMaskImage: grad, maskImage: grad }, children,
      h(AbsoluteFill, {
        style: {
          background: `radial-gradient(circle at 50% 50%, transparent ${Math.max(0, r - 26)}%, ${burn} ${Math.max(0, r - 12)}%, ${glow} ${r}%, transparent ${r + 6}%)`,
          opacity: pulse(p) * 0.9, mixBlendMode: 'screen', pointerEvents: 'none',
        },
      }));
  },

  // Chồng ảnh: hai cảnh cùng hiện, hoà bằng blend — kiểu phim tài liệu.
  'double-exposure': (pp) => ({ children, presentationProgress: p, presentationDirection: d }) => {
    const op = d === 'entering' ? clamp01(p) : 1 - clamp01(p) * 0.55;
    return Wrap({ opacity: op, mixBlendMode: d === 'entering' ? (pp.blend || 'screen') : 'normal' }, children);
  },

  // Tờ giấy trượt lên bàn: cảnh mới vào ngang, hơi xoay, có bóng đổ ở mép dẫn.
  // Khác slide thuần ở chỗ có bóng + xoay nhẹ → ra chất cắt dán chứ không phải trình chiếu.
  'paper-slide': (pp) => ({ children, presentationProgress: p, presentationDirection: d }) => {
    const from = pp.motionDirection === 'right' ? -1 : 1;
    const e = easeOut(clamp01(p));
    if (d === 'exiting') return Wrap({ transform: `translateX(${mix(0, -12 * from, e)}%)`, filter: `brightness(${mix(1, .78, e)})` }, children);
    return Wrap({
      transform: `translateX(${mix(104 * from, 0, e)}%) rotate(${mix(3.4 * from, 0, e)}deg)`,
      boxShadow: `${-18 * from}px 0 42px rgba(0,0,0,.55)`,
    }, children);
  },

  // Thả tờ giấy từ trên xuống, nảy khẽ một nhịp rồi nằm im.
  'paper-drop': (pp) => ({ children, presentationProgress: p, presentationDirection: d }) => {
    const e = clamp01(p);
    if (d === 'exiting') return Wrap({ filter: `brightness(${mix(1, .82, easeOut(e))})` }, children);
    // vượt quá rồi lùi lại: 0→1.04→1 để có cú nảy
    const y = e < .82 ? mix(-114, 2.5, easeOut(e / .82)) : mix(2.5, 0, (e - .82) / .18);
    const r = e < .82 ? mix(-4.5, 1.1, easeOut(e / .82)) : mix(1.1, 0, (e - .82) / .18);
    return Wrap({ transform: `translateY(${y}%) rotate(${r}deg)`, boxShadow: '0 24px 54px rgba(0,0,0,.55)' }, children);
  },

  // Bóp về giữa rồi bung ra.
  'squeeze-center': (pp) => ({ children, presentationProgress: p, presentationDirection: d }) => {
    const amt = Number(pp.squeeze) || 0.85;
    const q = easeOut(clamp01(p));
    const sx = d === 'entering' ? mix(1 - amt, 1, q) : mix(1, 1 - amt, q);
    return Wrap({ transform: `scaleX(${Math.max(0.001, sx)})`, opacity: d === 'entering' ? clamp01(p * 1.6) : 1 - clamp01(p * 1.4) }, children);
  },
};

// Tham số riêng cho từng biến thể mà file dữ liệu chưa nói hết
// (bên kia suy ra từ tên preset, ở đây khai thẳng cho dễ đọc).
const EXTRA = {
  'dip-black': { dipColor: '#000' },
  'dip-white': { dipColor: '#fff' },
  glare: { flashColor: '#fff7ed', pulses: 1, intensity: 0.7 },
  flashbang: { flashColor: '#ffffff', pulses: 1, intensity: 1 },
  strobe: { flashColor: '#ffffff', pulses: 4, intensity: 0.9 },
  streamer: { angle: 90, softness: 26 },
  'gradient-wipe': { angle: 120, softness: 20 },
  erase: { angle: 0, softness: 12 },
  'film-roll': { bands: 8 },
  shutter: { bands: 5 },
  'reverse-shutter': { bands: 5, reverse: true },
  'split-vertical': { axis: 'vertical' },
  'split-horizontal': { axis: 'horizontal' },
  'lens-glitch': { channelOffset: 14, blurPx: 2 },
  'radial-blur': { blurPx: 26, zoomAmount: 0.1 },
  superimpose: { blend: 'screen' },
  converge: { squeeze: 0.85 },
};

// ── BUILTIN: ánh xạ sang @remotion/transitions ──────────────────────────────
function builtinOf(id, pp) {
  const dirOf = (v) => ({ left: 'from-right', right: 'from-left', up: 'from-bottom', down: 'from-top' }[v] || 'from-right');
  switch (id) {
    case 'none': return none();
    case 'fade': return fade();
    case 'slide': return slide({ direction: dirOf(pp.motionDirection) });
    case 'wipe': return wipe({ direction: dirOf(pp.motionDirection) });
    case 'flip': return flip({ direction: pp.flipDirection === 'from-left' ? 'from-left' : 'from-right' });
    case 'iris': return iris({ width: 1920, height: 1080 });
    case 'clock-wipe': return clockWipe({ width: 1920, height: 1080 });
    default: return null;
  }
}

const BY_ID = {};
PRESETS.forEach(p => { BY_ID[p.id] = p; (p.legacyAliases || []).forEach(a => { if (!BY_ID[a]) BY_ID[a] = p; }); });

// Tên cũ Nova đang dùng ở Tool 7 → preset mới, để dự án cũ không vỡ.
const LEGACY = { none: 'cut', fade: 'fade', dissolve: 'fade', slide: 'slide-left', wipe: 'wipe-left', circle: 'iris' };

// Trả TransitionPresentation cho 1 tên chuyển cảnh. Không nhận ra thì trả fade.
function presentationFor(name) {
  const key = LEGACY[name] || name;
  const p = BY_ID[key] || BY_ID.fade;
  if (!p) return fade();
  const pp = Object.assign({}, p.presentationProps || {}, EXTRA[p.id] || {});
  if (p.presentationKind === 'builtin') return builtinOf(p.presentationId, pp) || fade();
  const make = CUSTOM[p.presentationId];
  if (!make) return fade();
  return { component: make(pp), props: {} };
}

function durationFor(name, fallback) {
  const p = BY_ID[LEGACY[name] || name];
  const s = (p && Number(p.defaultDurationSec)) || Number(fallback) || 0.5;
  return Math.max(0.05, Math.min(12, s));
}

// Danh mục cho UI/AI: id · nhãn · mô tả · nhóm · thẻ phong cách.
function catalog() {
  return PRESETS.map(p => ({
    id: p.id, label: p.label, family: p.family,
    description: p.description || '', tags: p.styleTags || [],
    durationSec: p.defaultDurationSec,
  }));
}

module.exports = { presentationFor, durationFor, catalog, PRESETS, BY_ID, LEGACY };
