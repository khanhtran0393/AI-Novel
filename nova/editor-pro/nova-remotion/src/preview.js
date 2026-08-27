// Tính SẴN vị trí + CSS của từng lớp đồ hoạ tại một thời điểm, để bản xem trước ở renderer
// vẽ lại được bằng DOM thường (không cần chạy Remotion).
//
// Vì sao đặt ở main mà không viết lại bên renderer: luật bố cục nằm trong NovaScene/templates/anim.
// Viết lại lần hai là chắc chắn lệch — xem trước một đằng, xuất ra một nẻo.
'use strict';
const { expandLayers } = require('./templates');
const { layerStyleAt, charStyleAt } = require('./anim');

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

function boxOf(L) {
  const b = L.box || {};
  const s = {
    left: num(b.x, 8) + '%', top: num(b.y, 8) + '%',
    width: b.w != null ? num(b.w, 40) + '%' : 'auto',
    height: b.h != null ? num(b.h, 0) + '%' : 'auto',
    justifyContent: b.vAlign === 'center' ? 'center' : b.vAlign === 'bottom' ? 'flex-end' : 'flex-start',
    alignItems: b.align === 'center' ? 'center' : b.align === 'right' ? 'flex-end' : 'flex-start',
  };
  if (b.anchor === 'center') s.transformBase = 'translate(-50%,-50%)';
  else if (b.anchor === 'bottom') s.transformBase = 'translate(-50%,-100%)';
  return s;
}

// Cỡ chữ trong NovaScene tính theo khung 1080p → quy về % chiều cao để renderer scale đúng.
const REF_H = 1080;

function textCss(L, theme) {
  const st = L.style || {};
  return {
    fontFamily: st.font || theme.font,
    fontStyle: st.italic ? 'italic' : 'normal',
    fontSize: (num(st.size, 54) / REF_H * 100) + 'cqh',
    fontWeight: num(st.weight, 800),
    lineHeight: num(st.lineHeight, 1.15),
    letterSpacing: (st.tracking != null ? st.tracking : -0.01) + 'em',
    color: st.color || theme.text,
    textTransform: st.upper ? 'uppercase' : 'none',
    textShadow: st.shadow ? '0 0.4cqh 2cqh rgba(0,0,0,.45)' : 'none',
    background: st.bg || 'transparent',
    padding: st.bg ? (num(st.pad, 14) / REF_H * 100) + 'cqh ' + (num(st.pad, 14) * 1.6 / REF_H * 100) + 'cqh' : '0',
    borderRadius: st.bg ? (num(st.radius, 10) / REF_H * 100) + 'cqh' : '0',
    borderLeft: st.rule ? '0.5cqh solid ' + (st.ruleColor || theme.accent) : 'none',
    WebkitTextStroke: st.outline ? (num(st.outlineWidth, 3) / REF_H * 100) + 'cqh ' + (st.outlineColor || '#000') : '',
    whiteSpace: 'pre-wrap', margin: '0', maxWidth: '100%',
  };
}

const GRAIN = "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/></filter><rect width='120' height='120' filter='url(%23n)' opacity='0.5'/></svg>\")";
function shapeCss(L, theme) {
  const st = L.style || {}, kind = L.shape || 'rect';
  let bg = st.fill || theme.accent;
  if (st.fillType === 'gradient') bg = `linear-gradient(${num(st.angle, 90)}deg, ${st.fill || theme.accent}, ${st.fill2 || 'transparent'})`;
  else if (st.fillType === 'radial') bg = `radial-gradient(ellipse at center, ${st.fill || 'transparent'} ${num(st.inner, 45)}%, ${st.fill2 || 'rgba(0,0,0,.75)'} 100%)`;
  else if (st.fillType === 'noise') bg = GRAIN;
  return {
    width: '100%',
    height: (L.box && L.box.h != null) ? '100%' : (num(st.thickness, 6) / REF_H * 100) + 'cqh',
    background: bg,
    backgroundSize: st.fillType === 'noise' ? '3cqh 3cqh' : '',
    borderRadius: kind === 'circle' ? '50%' : (num(st.radius, kind === 'pill' ? 999 : 8) / REF_H * 100) + 'cqh',
    border: st.stroke ? (num(st.strokeWidth, 2) / REF_H * 100) + 'cqh solid ' + st.stroke : 'none',
    opacity: num(st.alpha, 1),
    mixBlendMode: st.blend || '',
  };
}

// Giống hệt shadowOf của NovaScene — xem trước và bản xuất phải cùng một luật.
function shadowOf(v) {
  if (!v) return undefined;
  if (typeof v === 'string') return v;
  const k = Math.max(0.2, Math.min(2, Number(v) || 1));
  return `0 ${(18 * k / REF_H * 100).toFixed(2)}cqh ${(44 * k / REF_H * 100).toFixed(2)}cqh rgba(0,0,0,${0.4 * k})`;
}

// Giống hệt manualTf của NovaScene — xem trước và bản xuất phải cùng một luật.
function manualTf(L) {
  const out = [];
  if (L.dx != null || L.dy != null) out.push(`translate(${num(L.dx, 0)}%, ${num(L.dy, 0)}%)`);
  if (L.scale != null && num(L.scale, 1) !== 1) out.push(`scale(${num(L.scale, 1)})`);
  if (L.rotate != null && num(L.rotate, 0) !== 0) out.push(`rotate(${num(L.rotate, 0)}deg)`);
  return out.join(' ');
}

// t: giây trong cảnh. Trả mảng lớp đã có sẵn style, renderer chỉ gán thẳng.
function previewAt(spec, t, sceneSrc) {
  const s = spec || {};
  const dur = Math.max(0.1, Number(s.durationSec) || 3);
  const theme = Object.assign({ bg: '#0d0c0b', text: '#ffffff', accent: '#e07a46', font: 'Helvetica Neue, Helvetica, Arial, sans-serif' }, s.theme || {});
  // '@scene' là chỗ giữ cho ảnh của cảnh — bản xuất thay ở Tool 7, xem trước thay ở đây.
  const raw = (Array.isArray(s.layers) ? s.layers : []).map(L =>
    (L && L.src === '@scene') ? Object.assign({}, L, { src: sceneSrc || '' }) : L);
  const layers = expandLayers(raw, dur);
  const out = [];
  layers.forEach((L, i) => {
    if (!L || L.type === 'backdrop') return;              // ảnh nền do preview sẵn có lo
    const a = layerStyleAt(L, Math.max(0, Math.min(dur, t)), dur, 30);
    if (!a) return;
    const b = boxOf(L);
    const wrap = {
      position: 'absolute', left: b.left, top: b.top, width: b.width, height: b.height,
      display: 'flex', flexDirection: 'column', justifyContent: b.justifyContent, alignItems: b.alignItems,
      opacity: a.opacity * num(L.opacity, 1), filter: a.filter || '', clipPath: a.clipPath || '',
      transform: [b.transformBase, a.transform, manualTf(L)].filter(Boolean).join(' '),
      transformOrigin: (L.hold && L.hold.preset === 'growX') ? 'left center' : ((L.hold && L.hold.preset === 'growY') ? 'bottom center' : ''),
      zIndex: num(L.z, i), pointerEvents: 'none',
      backdropFilter: L.backdropBlur ? `blur(${num(L.backdropBlur, 12) / REF_H * 100}cqh)` : '',
    };
    if (L.type === 'text' || (!L.type && L.text != null)) {
      const st = L.style || {};
      let chars = null;
      if (st.reveal) {
        const raw = String(L.text == null ? '' : L.text);
        chars = Array.from(raw).map((ch, k) => {
          const cs = charStyleAt(st.reveal, k, Array.from(raw).length, a.p || 0, st.revealSpread);
          return { ch, opacity: cs.opacity, transform: cs.transform || '' };
        });
      }
      out.push({ kind: 'text', wrap, css: textCss(L, theme), text: String(L.text == null ? '' : L.text), chars, align: (L.box && L.box.align) || 'left' });
    } else if (L.type === 'shape') {
      out.push({ kind: 'shape', wrap, css: shapeCss(L, theme) });
    } else if (L.type === 'image' || L.type === 'video') {
      // Ô ảnh của mẫu có thể chứa file .mp4 — renderer phải dựng <video>, không phải <img>.
      const isVid = L.type === 'video' || /\.(mp4|mov|webm|m4v|mkv)(\?|#|$)/i.test(String(L.src || ''));
      const mst = L.style || {};
      out.push({ kind: 'media', isVideo: isVid, wrap, src: L.src || '', css: { width: '100%', height: (L.box && L.box.h != null) ? '100%' : 'auto', objectFit: mst.fit || 'cover', objectPosition: mst.pos || undefined, borderRadius: (num(mst.radius, 0) / REF_H * 100) + 'cqh', boxShadow: shadowOf(mst.shadow), border: mst.stroke ? (num(mst.strokeWidth, 3) / REF_H * 100) + 'cqh solid ' + mst.stroke : 'none', display: 'block' } });
    } else if (L.type === 'bit') {
      // Bit là component React, DOM thường không dựng lại được → vẽ ô báo hiệu có mặt.
      out.push({ kind: 'bit', wrap, name: String(L.bit || '') });
    }
  });
  return out;
}

module.exports = { previewAt };
