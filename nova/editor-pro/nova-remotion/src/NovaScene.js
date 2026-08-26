// NovaScene — BỘ THÔNG DỊCH cảnh. Nhận 1 spec JSON (do AI sinh theo từng cảnh) và dựng ra hình.
// Cố ý KHÔNG nhận mã: AI chỉ mô tả DỮ LIỆU (lớp, hộp, hiệu ứng theo tên), engine cố định diễn giải.
// → không eval, không build lại bundle, và thời lượng LUÔN bằng đúng thời lượng cảnh.
const React = require('react');
const { AbsoluteFill, Img, OffthreadVideo, useCurrentFrame, useVideoConfig } = require('remotion');
const { evolvePath } = require('@remotion/paths');
const { layerStyleAt, charStyleAt } = require('./anim');
const { expandLayers } = require('./templates');
const { CharLayer } = require('./CharLayer');

const h = React.createElement;
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

// Hộp đặt theo % khung hình → đổi khung 16:9/9:16 vẫn đúng bố cục.
function boxStyle(box) {
  const b = box || {};
  const s = {
    position: 'absolute',
    left: num(b.x, 8) + '%',
    top: num(b.y, 8) + '%',
    width: b.w != null ? num(b.w, 40) + '%' : undefined,
    height: b.h != null ? num(b.h, 0) + '%' : undefined,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: b.vAlign === 'center' ? 'center' : b.vAlign === 'bottom' ? 'flex-end' : 'flex-start',
    alignItems: b.align === 'center' ? 'center' : b.align === 'right' ? 'flex-end' : 'flex-start',
  };
  if (b.anchor === 'center') { s.transform = 'translate(-50%,-50%)'; }
  else if (b.anchor === 'bottom') { s.transform = 'translate(-50%,-100%)'; }
  return s;
}

// Biến đổi TĨNH do người dùng chỉnh tay ở bảng thuộc tính (ngoài hiệu ứng).
function manualTf(L) {
  const out = [];
  if (L.dx != null || L.dy != null) out.push(`translate(${num(L.dx, 0)}%, ${num(L.dy, 0)}%)`);
  if (L.scale != null && num(L.scale, 1) !== 1) out.push(`scale(${num(L.scale, 1)})`);
  if (L.rotate != null && num(L.rotate, 0) !== 0) out.push(`rotate(${num(L.rotate, 0)}deg)`);
  return out.join(' ');
}

function TextLayer({ L, theme, anim }) {
  const st = L.style || {};
  const raw = String(L.text == null ? '' : L.text);
  // Viền chữ (meme kiểu Impact): dùng -webkit-text-stroke, Chromium của Remotion hỗ trợ sẵn.
  const strokeCss = st.outline
    ? { WebkitTextStroke: num(st.outlineWidth, 3) + 'px ' + (st.outlineColor || '#000'), paintOrder: 'stroke fill' }
    : null;
  const boxCss = {
      fontFamily: st.font || theme.font,
      fontStyle: st.italic ? 'italic' : 'normal',
      fontSize: num(st.size, 54) + 'px',
      fontWeight: num(st.weight, 800),
      lineHeight: num(st.lineHeight, 1.15),
      letterSpacing: (st.tracking != null ? st.tracking : -0.01) + 'em',
      color: st.color || theme.text,
      textAlign: (L.box && L.box.align) || 'left',
      textTransform: st.upper ? 'uppercase' : 'none',
      textShadow: st.shadow ? '0 4px 24px rgba(0,0,0,.45)' : 'none',
      background: st.bg || 'transparent',
      padding: st.bg ? num(st.pad, 14) + 'px ' + num(st.pad, 14) * 1.6 + 'px' : 0,
      borderRadius: st.bg ? num(st.radius, 10) + 'px' : 0,
      borderLeft: st.rule ? '5px solid ' + (st.ruleColor || theme.accent) : 'none',
      paddingLeft: st.rule ? num(st.pad, 14) * 1.4 + 'px' : undefined,
      maxWidth: '100%',
      whiteSpace: 'pre-wrap',
      margin: 0,
  };
  Object.assign(boxCss, strokeCss || {});

  // Không yêu cầu chạy từng ký tự → đổ nguyên chuỗi (rẻ hơn, giữ nguyên hành vi cũ).
  const mode = st.reveal;
  if (!mode || !raw) return h('div', { style: boxCss }, raw);

  // Chạy từng ký tự: tách thành span, mỗi span lệch pha theo vị trí.
  // Khoảng trắng vẫn phải chiếm chỗ nên dùng  , không thì chữ dồn cục.
  const p = (anim && anim.p) || 0;
  const chars = Array.from(raw);
  return h('div', { style: boxCss },
    chars.map((c, i) => {
      // Xuống dòng phải thành <br>: nhét '\n' vào span inline-block thì trình duyệt nuốt mất,
      // hai dòng dính liền nhau ("HOTTEST\nMOMENTS" → "HOTTESTMOMENTS").
      if (c === '\n') return h('br', { key: i });
      const cs = charStyleAt(mode, i, chars.length, p, st.revealSpread);
      return h('span', {
        key: i,
        style: { display: 'inline-block', whiteSpace: 'pre', opacity: cs.opacity, transform: cs.transform },
      }, c === ' ' ? ' ' : c);
    })
  );
}

// Nhiễu hạt phim: SVG feTurbulence nhúng thẳng làm ảnh nền — không cần file kèm theo.
const GRAIN_URL = "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/></filter><rect width='120' height='120' filter='url(%23n)' opacity='0.5'/></svg>\")";

// Kiểu tô: màu đặc (mặc định) · gradient thẳng · gradient toả tròn (vignette) · nhiễu hạt.
function fillOf(st, theme) {
  const f = st.fillType;
  if (f === 'gradient') {
    const a = st.fill || theme.accent, b = st.fill2 || 'transparent';
    return `linear-gradient(${num(st.angle, 90)}deg, ${a}, ${b})`;
  }
  if (f === 'radial') {
    // Vignette: giữa trong suốt, mép tối dần.
    const a = st.fill || 'transparent', b = st.fill2 || 'rgba(0,0,0,.75)';
    return `radial-gradient(ellipse at center, ${a} ${num(st.inner, 45)}%, ${b} 100%)`;
  }
  if (f === 'noise') return GRAIN_URL;
  return st.fill || theme.accent;
}

function ShapeLayer({ L, theme }) {
  const st = L.style || {};
  const kind = L.shape || 'rect';
  const base = {
    width: '100%',
    height: L.box && L.box.h != null ? '100%' : num(st.thickness, 6) + 'px',
    background: fillOf(st, theme),
    backgroundSize: st.fillType === 'noise' ? '120px 120px' : undefined,
    backgroundRepeat: st.fillType === 'noise' ? 'repeat' : undefined,
    borderRadius: kind === 'circle' ? '50%' : num(st.radius, kind === 'pill' ? 999 : 8) + 'px',
    border: st.stroke ? num(st.strokeWidth, 2) + 'px solid ' + st.stroke : 'none',
    opacity: num(st.alpha, 1),
    mixBlendMode: st.blend || undefined,
  };
  return h('div', { style: base });
}

// growX/growY co giãn từ MÉP chứ không từ tâm, không thì thanh tiến trình nở ra hai bên.
// Đặt ở wrapper vì transform của hiệu ứng nằm ở wrapper, không nằm trong ShapeLayer.
function originFor(L) {
  const p = L.hold && String(L.hold.preset || '');
  if (p === 'growX') return 'left center';
  if (p === 'growY') return 'bottom center';
  return undefined;
}

// shadow: số → độ mạnh (1 = vừa), chuỗi → dùng nguyên văn CSS, rỗng → không bóng.
function shadowOf(v) {
  if (!v) return undefined;
  if (typeof v === 'string') return v;
  const k = Math.max(0.2, Math.min(2, Number(v) || 1));
  return `0 ${Math.round(18 * k)}px ${Math.round(44 * k)}px rgba(0,0,0,${0.4 * k})`;
}

function ImageLayer({ L }) {
  if (isVideoSrc(L.src)) return h(VideoLayer, { L });   // chọn .mp4 vào ô ảnh của mẫu vẫn chạy
  const st = L.style || {};
  return h(Img, {
    src: L.src,
    style: {
      width: '100%',
      height: L.box && L.box.h != null ? '100%' : 'auto',
      objectFit: st.fit || 'cover',
      // Điểm neo khi ảnh bị cắt. Thiếu nó thì ảnh KHỔ DỌC (chân dung, tượng) luôn bị
      // cắt giữa → mất đầu nhân vật. vd pos: 'center 12%' để giữ phần trên.
      objectPosition: st.pos || undefined,
      borderRadius: num(st.radius, 0) + 'px',
      border: st.stroke ? num(st.strokeWidth, 3) + 'px solid ' + st.stroke : 'none',
      // Đổ bóng: thẻ ảnh chồng lên nhau không có bóng thì trông như dán phẳng,
      // không ra lớp. Nhận số (độ mạnh 0-2) hoặc chuỗi CSS đầy đủ.
      boxShadow: shadowOf(st.shadow),
      display: 'block',
    },
  });
}

// Clip video (Tool 2 xen clip YouTube/stock). OffthreadVideo: Remotion trích frame bằng ffmpeg,
// chuẩn xác theo frame và không phụ thuộc trình phát — khác <Video> vốn dựa vào thẻ <video>.
function VideoLayer({ L }) {
  const st = L.style || {};
  return h(OffthreadVideo, {
    src: L.src,
    startFrom: L.startFrom != null ? num(L.startFrom, 0) : undefined,
    muted: L.muted !== false,               // mặc định TẮT tiếng: cảnh đã có giọng đọc riêng
    volume: L.muted === false ? num(L.volume, 1) : 0,
    style: {
      width: '100%',
      height: L.box && L.box.h != null ? '100%' : 'auto',
      objectFit: st.fit || 'cover',
      borderRadius: num(st.radius, 0) + 'px',
      boxShadow: shadowOf(st.shadow),
      display: 'block',
    },
  });
}

// Ô ảnh của mẫu cũng nhận VIDEO — mẫu khai type:'image' cứng, người dùng chọn
// file .mp4 vào đó thì trước đây ra <Img src="x.mp4"> = ô vỡ. Nhận theo ĐUÔI FILE.
const isVideoSrc = (src) => /\.(mp4|mov|webm|m4v|mkv)(\?|#|$)/i.test(String(src || ''));

// Ảnh nền tràn khung — tách riêng vì cần phủ kín, không theo hộp %.
function BackdropLayer({ L }) {
  const st = L.style || {};
  const full = { width: '100%', height: '100%', objectFit: st.fit || 'cover', objectPosition: st.pos || undefined, display: 'block' };
  // Nền cũng có thể là VIDEO (cảnh xen clip) — nhận biết qua đuôi file hoặc cờ kind.
  const isVid = L.kind === 'video' || isVideoSrc(L.src);
  if (isVid) return h(OffthreadVideo, { src: L.src, muted: L.muted !== false, volume: L.muted === false ? num(L.volume, 1) : 0, style: full });
  return h(Img, { src: L.src, style: full });
}

// ── LỚP SVG VẼ NÉT ──────────────────────────────────────────────────────────
// Đường kẻ/mũi tên/biểu đồ TỰ BÒ ra thay vì hiện nguyên khối. Trước đây muốn có
// hiệu ứng này phải xuất ảnh PNG rồi wipe một dải chữ nhật qua — nét bị "cắt thẳng"
// chứ không phải đang được vẽ. evolvePath (@remotion/paths, đã có sẵn trong node_modules)
// tính strokeDasharray/Dashoffset theo tiến độ, nên nét bò ra đúng theo chiều của path.
//
// Spec:  { type:'svg', viewBox:'0 0 1920 1080', gradient:[{o,c},…],
//          paths:[ { d, stroke, width, at, dur, fill, cap, alpha } ] }
// Mỗi path có at/dur riêng → xếp thứ tự vẽ mà không cần tách thành nhiều lớp.
function SvgLayer({ L, theme }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps - (Number(L.at) || 0);          // giây tính từ lúc lớp sống
  const list = Array.isArray(L.paths) ? L.paths : [];
  const gid = 'g' + (L.id || 'svg');
  const grad = Array.isArray(L.gradient) && L.gradient.length > 1 ? L.gradient : null;

  return h('svg', {
    viewBox: L.viewBox || '0 0 1920 1080',
    preserveAspectRatio: L.preserveAspectRatio || 'none',
    style: { width: '100%', height: '100%', overflow: 'visible', display: 'block' },
  },
    grad ? h('defs', null,
      h('linearGradient', { id: gid, x1: '0', y1: '0', x2: '1', y2: '0' },
        grad.map((g, i) => h('stop', { key: i, offset: (num(g.o, i / (grad.length - 1)) * 100) + '%', stopColor: g.c })))
    ) : null,
    list.map((P, i) => {
      const dur = Math.max(0.01, num(P.dur, num(L.draw && L.draw.dur, 1.2)));
      const p = Math.max(0, Math.min(1, (t - num(P.at, 0)) / dur));
      if (p <= 0) return null;                            // chưa tới lượt path này
      const evolve = evolvePath(p, P.d);
      return h('path', {
        key: i,
        d: P.d,
        fill: P.fill || 'none',
        stroke: P.stroke || (grad ? 'url(#' + gid + ')' : (theme && theme.accent) || '#fff'),
        strokeWidth: num(P.width, 8),
        strokeLinecap: P.cap || 'round',
        strokeLinejoin: 'round',
        opacity: num(P.alpha, 1),
        strokeDasharray: evolve.strokeDasharray,
        strokeDashoffset: evolve.strokeDashoffset,
      });
    })
  );
}

// ── LỚP "BIT" — 64 hiệu ứng bê từ videoshuffle (MIT) + gói npm remotion-bits ──
// Nạp CHẬM và có bọc try: bộ bit kéo theo three.js/prism, hỏng một cái thì cả bundle chết.
// Không nạp được → lớp bit bị bỏ qua, các lớp còn lại vẫn dựng bình thường.
let _BITS = undefined;
function bitRegistry() {
  if (_BITS !== undefined) return _BITS;
  try { _BITS = require('./bits/BitRegistry').BIT_REGISTRY || null; }
  catch (e) { _BITS = null; }
  return _BITS;
}
function BitLayer({ L }) {
  const reg = bitRegistry();
  const def = reg && reg[L.bit];
  if (!def || !def.component) {
    // Tên bit sai/không nạp được → vẽ ô cảnh báo thay vì crash cả video.
    return h('div', { style: { padding: '8px 12px', border: '2px dashed rgba(255,120,120,.8)', borderRadius: 8, color: '#ff9a9a', fontSize: 20, fontFamily: 'monospace' } }, 'bit? ' + String(L.bit || ''));
  }
  const props = Object.assign({}, def.defaultProps || {}, L.props || {});
  if (L.text != null && props.children === undefined) props.children = String(L.text);
  return h(def.component, props);
}

const RENDERERS = { text: TextLayer, shape: ShapeLayer, image: ImageLayer, video: VideoLayer, backdrop: BackdropLayer, bit: BitLayer, svg: SvgLayer, char: CharLayer };

function NovaScene({ spec }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const s = spec || {};
  const theme = Object.assign(
    { bg: '#0d0c0b', text: '#ffffff', accent: '#e07a46', font: 'Helvetica Neue, Helvetica, Arial, sans-serif' },
    s.theme || {}
  );
  // Bung template trước khi vẽ: lớp nào có {template:'lower-thirds', text:…} → đổi thành các lớp thật.
  const total = durationInFrames / fps;
  const layers = expandLayers(s.layers, total);
  const t = frame / fps;

  return h(AbsoluteFill, { style: { backgroundColor: theme.bg, overflow: 'hidden' } },
    layers.map((L, i) => {
      const anim = layerStyleAt(L, t, total, fps);
      if (!anim) return null;                                  // ngoài khoảng sống của lớp
      const Renderer = RENDERERS[L.type] || TextLayer;
      const isBackdrop = L.type === 'backdrop';
      const wrapStyle = isBackdrop
        ? { position: 'absolute', inset: 0 }
        : boxStyle(L.box);
      // Chỉnh tay: opacity/scale/rotate/nudge đặt thẳng trên lớp, NHÂN vào kết quả
      // của hiệu ứng (không đè) — kéo mờ 50% thì lúc fade vào vẫn mờ dần tới 50%.
      const man = manualTf(L);
      return h('div', {
        key: L.id || ('L' + i),
        style: Object.assign({}, wrapStyle, {
          opacity: anim.opacity * num(L.opacity, 1),
          transform: [wrapStyle.transform, anim.transform, man].filter(Boolean).join(' ') || undefined,
          transformOrigin: originFor(L),
          filter: anim.filter,
          clipPath: anim.clipPath,
          zIndex: num(L.z, i),
          overflow: L.clip ? 'hidden' : undefined,
          // Làm mờ HẬU CẢNH phía dưới lớp (blur-background), khác filter vốn làm mờ chính lớp đó.
          backdropFilter: L.backdropBlur ? `blur(${num(L.backdropBlur, 12)}px)` : undefined,
        }),
      }, h(Renderer, { L, theme, anim }));
    })
  );
}

module.exports = { NovaScene };
