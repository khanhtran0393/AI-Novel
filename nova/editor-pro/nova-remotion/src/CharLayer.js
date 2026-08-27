// CharLayer — dựng NHÂN VẬT CÓ RIG. Khác lớp 'svg' ở ba điểm:
//   1. Bộ phận rời, chọn theo TÊN → pose là tổ hợp, không phải hình vẽ sẵn.
//   2. Chớp mắt tự động, tính theo frame nên mọi worker render ra y hệt nhau
//      (dùng Math.random ở đây là hỏng: render song song sẽ chớp lệch từng frame).
//   3. Nhép miệng theo mốc tiếng nói — thứ lớp 'svg' không có khái niệm.
const React = require('react');
const { useCurrentFrame, useVideoConfig } = require('remotion');

const h = React.createElement;
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

const RIGS = { ghost: () => require('./rigs/ghost') };
function resolveRig(r) {
  if (r && typeof r === 'object') return r;                 // rig nhét thẳng vào spec
  const f = RIGS[r || 'ghost'];
  try { return f ? f() : null; } catch (_) { return null; }
}

// Một path → phần tử SVG. outline:true nghĩa là "vẽ theo đường tâm": tô hai lượt,
// nét mực dày ở dưới + nét trắng mảnh ở trên, ra hình có viền với đầu bo tròn.
function emit(P, key, ink, skin, outW) {
  const cap = P.cap || 'round';
  if (P.outline) {
    return [
      h('path', { key: key + 'o', d: P.d, fill: 'none', stroke: P.stroke || ink,
        strokeWidth: num(P.w, 22) + outW * 2, strokeLinecap: cap, strokeLinejoin: 'round' }),
      h('path', { key: key + 'f', d: P.d, fill: 'none', stroke: P.fill || skin,
        strokeWidth: num(P.w, 22), strokeLinecap: cap, strokeLinejoin: 'round' }),
    ];
  }
  return [h('path', { key: key, d: P.d,
    fill: P.fill || 'none', stroke: P.stroke || 'none', strokeWidth: num(P.w, 0),
    strokeLinecap: cap, strokeLinejoin: 'round', opacity: P.alpha != null ? P.alpha : undefined })];
}
const emitAll = (list, key, ink, skin, outW) =>
  (Array.isArray(list) ? list : []).reduce((acc, P, i) => acc.concat(emit(P, key + i, ink, skin, outW)), []);

// Chớp mắt: chu kỳ cố định + lệch pha băm từ số thứ tự → đều đặn nhưng không máy móc.
function blinking(t, every, dur, seed) {
  const k = Math.floor(t / every);
  const jitter = (((k + seed) * 37) % 11) / 11 * (every * 0.45);
  const at = k * every + jitter;
  return t >= at && t < at + dur;
}

// Nhép miệng: mốc [{t, v}] với v là độ mở 0→1. Lấy giá trị tại thời điểm t, chia 4 bậc.
// Nguồn v về sau là biên độ tiếng / khoảng từ của Whisper.
function mouthFromTrack(track, t) {
  if (!Array.isArray(track) || !track.length) return null;
  let v = 0;
  for (let i = 0; i < track.length; i++) {
    if (num(track[i].t, 0) > t) break;
    v = num(track[i].v, 0);
  }
  if (v < 0.12) return 'neutral';
  if (v < 0.42) return 'openS';
  if (v < 0.72) return 'openM';
  return 'openL';
}

function CharLayer({ L }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rig = resolveRig(L.rig);
  if (!rig) {
    return h('div', { style: { padding: '8px 12px', border: '2px dashed #ff9a9a', borderRadius: 8,
      color: '#ff9a9a', fontFamily: 'monospace', fontSize: 20 } }, 'rig? ' + String(L.rig || ''));
  }

  const t = frame / fps - (num(L.at, 0));
  const fb = rig.fallback || {};
  const pose = Object.assign({}, fb, L.pose || {});
  const ink = rig.ink || '#1f2328';
  const skin = rig.skin || '#ffffff';
  const outW = num(rig.outlineWidth, 5);

  // Mắt: chớp ĐÈ lên biểu cảm đang chọn, trừ khi pose vốn đã nhắm.
  const canBlink = L.blink !== false && pose.eyes !== 'closed';
  const blink = canBlink && blinking(t, num(L.blinkEvery, 3.4), num(L.blinkDur, 0.13), num(L.blinkSeed, 0));
  const eyesKey = blink ? 'closed' : pose.eyes;

  // Miệng: có mốc tiếng thì mốc tiếng thắng, không thì theo pose.
  const mouthKey = mouthFromTrack(L.mouthTrack, t) || pose.mouth;

  const pick = (bag, key, dflt) => (bag && (bag[key] || bag[dflt])) || [];
  const B = rig.body || {};
  const accRaw = (rig.acc || {})[pose.acc] || [];
  const accIsObj = accRaw && !Array.isArray(accRaw);
  const clipId = 'accclip_' + (L.id || 'c');

  const kids = [];
  if (accIsObj && accRaw.clip) {
    kids.push(h('defs', { key: 'defs' },
      h('clipPath', { id: clipId }, h('path', { d: accRaw.clip }))));
  }
  kids.push(h('g', { key: 'sh' }, emitAll(B.shadow, 'sh', ink, skin, outW)));
  kids.push(h('g', { key: 'lg' }, emitAll(B.legs, 'lg', ink, skin, outW)));
  kids.push(h('g', { key: 'bd' }, emitAll(B.body, 'bd', ink, skin, outW)));
  kids.push(h('g', { key: 'fd' }, emitAll(B.folds, 'fd', ink, skin, outW)));
  if (accIsObj) {
    kids.push(h('g', { key: 'ac', clipPath: accRaw.clip ? 'url(#' + clipId + ')' : undefined },
      emitAll(accRaw.paths, 'ac', ink, skin, outW)));
    kids.push(h('g', { key: 'at' }, emitAll(accRaw.after, 'at', ink, skin, outW)));
  } else {
    kids.push(h('g', { key: 'ac' }, emitAll(accRaw, 'ac', ink, skin, outW)));
  }
  kids.push(h('g', { key: 'br' }, emitAll(pick(rig.brow, pose.brow, 'neutral'), 'br', ink, skin, outW)));
  kids.push(h('g', { key: 'ey' }, emitAll(pick(rig.eyes, eyesKey, 'normal'), 'ey', ink, skin, outW)));
  kids.push(h('g', { key: 'mo' }, emitAll(pick(rig.mouth, mouthKey, 'neutral'), 'mo', ink, skin, outW)));
  kids.push(h('g', { key: 'al' }, emitAll(pick(rig.armL, pose.armL, 'down'), 'al', ink, skin, outW)));
  kids.push(h('g', { key: 'ar' }, emitAll(pick(rig.armR, pose.armR, 'down'), 'ar', ink, skin, outW)));

  // Lật mặt nhân vật: lật quanh trục giữa của viewBox, không phải quanh gốc toạ độ.
  const vb = String(rig.viewBox || '0 0 400 540').trim().split(/\s+/).map(Number);
  const W = vb[2] || 400;
  const inner = L.flip ? h('g', { transform: `translate(${W},0) scale(-1,1)` }, kids) : kids;

  return h('svg', {
    viewBox: rig.viewBox,
    preserveAspectRatio: L.preserveAspectRatio || 'xMidYMid meet',
    style: { width: '100%', height: '100%', overflow: 'visible', display: 'block' },
  }, inner);
}

module.exports = { CharLayer };
