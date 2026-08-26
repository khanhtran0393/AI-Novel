// Kho MẪU DỰNG SẴN cho NovaScene (bê từ thư viện CapCut-style của Fractal, viết lại theo lớp của Nova).
//
// Vì sao cần: nếu AI phải tự vẽ từng lớp cho mỗi cảnh thì mỗi lần một kiểu — toạ độ lệch, cỡ chữ
// đá nhau, bố cục không nhất quán. Với mẫu, AI chỉ nói TÊN MẪU + vài trường nội dung:
//     { "template": "lower-thirds", "text": "Trần Hưng Đạo", "subtitle": "1228–1300" }
// còn bố cục do người dựng mẫu quyết. Đúng nguyên tắc của NovaScene: AI mô tả DỮ LIỆU, engine diễn giải.
//
// Mỗi mẫu gồm:
//   params : tên trường → giá trị mặc định (AI bỏ trống thì lấy mặc định)
//   build  : (p, dur) → mảng lớp thật. dur = số giây của CẢNH, để mẫu tự co giãn theo cảnh.
// Cố tình dùng hàm build thay vì chuỗi "{{placeholder}}": tính được theo thời lượng cảnh và
// không phải viết bộ phân tích chuỗi lồng nhau.
'use strict';

const nz = (v, d) => (v === undefined || v === null || v === '' ? d : v);
const numOr = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

// Bốn góc quen thuộc → hộp %. Dùng chung cho các mẫu có tham số `position`.
const CORNER = {
  'bottom-left':  { x: 6,  y: 74, w: 55, align: 'left' },
  'bottom-right': { x: 39, y: 74, w: 55, align: 'right' },
  'top-left':     { x: 6,  y: 8,  w: 55, align: 'left' },
  'top-right':    { x: 39, y: 8,  w: 55, align: 'right' },
  center:         { x: 50, y: 50, w: 80, align: 'center', anchor: 'center' },
  top:            { x: 50, y: 14, w: 80, align: 'center', anchor: 'center' },
  bottom:         { x: 50, y: 80, w: 80, align: 'center', anchor: 'center' },
};
const cornerOf = (pos, def) => Object.assign({}, CORNER[nz(pos, def)] || CORNER[def]);

// Tên hiệu ứng của CapCut → tên trong bảng anim.js của Nova.
const ANIM_IN = { 'slide-in': 'slideL', 'fade-in': 'fade', 'pop-in': 'pop', typewriter: 'fade', 'bounce-in': 'pop', 'rise-in': 'rise' };
const inOf = (name, def) => ({ preset: ANIM_IN[name] || def || 'fade', dur: 0.45 });

// Bảng thiết kế dùng chung cho GÓI MẪU "doc-" (phim tài liệu khoa học) ở cuối file.
// Khoá cứng tại một chỗ: đổi accent/typeface ở đây là cả gói đổi theo, khỏi sửa từng mẫu.
const DOC = {
  display: 'Georgia, "Times New Roman", serif',
  label: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  ink: '#f4f1ea',
  dim: 'rgba(244,241,234,.66)',
  accent: '#e8763a',
  hot: '#e8763a',
  cold: '#5fb0dc',
};

const TEMPLATES = {
  /* ══ GÓI "TƯ LIỆU" — dựng theo lối phim tài liệu khoa học ═════════════════
     Bốn mẫu này bóc từ một video mẫu người dùng gửi. Nguyên tắc chung: HÌNH
     chiếm toàn khung, chữ chỉ làm nhãn — không có khối chữ nào che quá 1/3
     khung. Mọi mẫu tự co theo `dur` (số giây của cảnh).                      */

  // ── 1. Tư liệu toàn khung + dòng ghi nguồn góc dưới ─────────────────────
  // Dùng cho cảnh chỉ có một đoạn phim. Dòng ghi nguồn là BẮT BUỘC về mặt
  // giấy phép với CC BY, và cũng là thứ làm video trông có dẫn chứng.
  'tu-lieu': {
    label: 'Tư liệu toàn khung',
    params: { src: '', nguon: '', fit: 'cover', ken: 'kenIn' },
    build: (p, dur) => {
      const L = [{
        type: p.src && /\.(mp4|webm|mov|m4v)(\?|$)/i.test(p.src) ? 'video' : 'image',
        src: p.src, box: { x: 0, y: 0, w: 100, h: 100 }, style: { fit: nz(p.fit, 'cover') },
        at: 0, in: { preset: 'fade', dur: 0.4 }, hold: { preset: nz(p.ken, 'kenIn'), amp: 1 },
        out: { preset: 'fade', dur: 0.35 }, z: 1,
      }];
      if (p.nguon) L.push({
        type: 'text', text: String(p.nguon).toUpperCase(),
        box: { x: 42, y: 92, w: 55, align: 'right' },
        style: { size: 15, color: 'rgba(255,255,255,.62)', font: DOC.label, tracking: 0.14, weight: 600 },
        at: 0.3, in: { preset: 'fade', dur: 0.5 }, out: { preset: 'fade', dur: 0.4 }, z: 30,
      });
      return L;
    },
  },

  // ── 2. Chồng thẻ loài — mẫu đặc trưng nhất của lối dựng này ─────────────
  // Nền bị làm mờ, các thẻ ảnh trượt vào LẦN LƯỢT, mỗi thẻ một nhãn chữ hoa.
  // Nhận 1–4 thẻ; bố cục tự chia đều theo số thẻ chứ không kê toạ độ cứng.
  'chong-the': {
    label: 'Chồng thẻ (loài / hạng mục)',
    params: { nen: '', the: [], nhan: [], ghi: [], moiThe: 0.55 },
    build: (p, dur) => {
      const the = Array.isArray(p.the) ? p.the.filter(Boolean) : [];
      const nhan = Array.isArray(p.nhan) ? p.nhan : [];
      const ghi = Array.isArray(p.ghi) ? p.ghi : [];
      const n = Math.max(1, Math.min(4, the.length));
      const L = [];
      if (p.nen) L.push({
        type: /\.(mp4|webm|mov|m4v)(\?|$)/i.test(p.nen) ? 'video' : 'image',
        src: p.nen, box: { x: 0, y: 0, w: 100, h: 100 }, style: { fit: 'cover' },
        backdropBlur: 0, at: 0, in: { preset: 'fade', dur: 0.3 }, hold: { preset: 'kenIn', amp: 0.6 }, z: 1,
      });
      // Tấm mờ đè lên nền: thẻ mới đọc được, mà vẫn thấy cảnh phía sau.
      L.push({ type: 'shape', shape: 'rect', box: { x: 0, y: 0, w: 100, h: 100 },
        style: { fill: 'rgba(12,10,8,.42)' }, backdropBlur: 16,
        at: 0, in: { preset: 'fade', dur: 0.35 }, z: 2 });

      // Chia ngang đều: n thẻ, chừa mép 6%, khe 3%.
      const mep = 6, khe = 3;
      const w = (100 - mep * 2 - khe * (n - 1)) / n;
      const buoc = numOr(p.moiThe, 0.55);
      for (let k = 0; k < n; k++) {
        const x = mep + k * (w + khe);
        const t = 0.15 + k * buoc;                    // thẻ sau vào sau thẻ trước
        const nghieng = (k - (n - 1) / 2) * 1.6;      // xoè nhẹ như xếp tay
        L.push({ type: 'image', src: the[k],
          box: { x, y: 15, w, h: 53 },
          style: { fit: 'cover', radius: 4, shadow: 1.2, stroke: 'rgba(244,241,234,.9)', strokeWidth: 5 },
          rotate: nghieng, at: t, in: { preset: 'deal', dur: 0.5 },
          hold: { preset: 'drift', amp: 0.7 }, out: { preset: 'fade', dur: 0.3 }, z: 10 + k * 2 });
        // Cỡ nhãn co theo bề rộng thẻ: 3 thẻ thì hẹp, 1 thẻ thì rộng — kê cứng
        // một cỡ là 3 thẻ tràn chữ còn 1 thẻ trông hụt.
        const cn = Math.round(Math.min(46, Math.max(24, w * 1.28)));
        if (nhan[k]) L.push({ type: 'text', text: String(nhan[k]).toUpperCase(),
          box: { x, y: 70.5, w, align: 'left' },
          // Thanh nền mờ sau nhãn: chữ trắng đặt thẳng lên ảnh thì gặp vùng sáng
          // là mất chữ. Bản mẫu cũng làm đúng như vậy.
          style: { size: cn, color: DOC.ink, font: DOC.label, weight: 800, tracking: 0.02, lineHeight: 1.06,
                   bg: 'rgba(18,16,14,.55)', pad: 8, radius: 3 },
          at: t + 0.18, in: { preset: 'rise', dur: 0.4 }, out: { preset: 'fade', dur: 0.3 }, z: 11 + k * 2 });
        // Dòng ghi công đặt sau chỗ đủ cho nhãn HAI DÒNG. Tính theo số dòng thật
        // thì phải đo chữ — engine không đo được — mà đặt theo một dòng thì tên
        // loài dài (Burmese long-tailed macaque) tràn xuống đè lên nó.
        const yGhi = 70.5 + (cn * 1.06 * 2) / 1080 * 100 + 0.9;
        if (ghi[k]) L.push({ type: 'text', text: String(ghi[k]),
          box: { x, y: yGhi, w, align: 'left' },
          style: { size: Math.round(cn * 0.46), color: DOC.ink, font: DOC.label, weight: 400, tracking: 0.02,
                   italic: true, bg: 'rgba(18,16,14,.45)', pad: 6, radius: 3 },
          at: t + 0.26, in: { preset: 'fade', dur: 0.4 }, out: { preset: 'fade', dur: 0.3 }, z: 11 + k * 2 });
      }
      return L;
    },
  },

  // ── 3. Dẫn chứng: ảnh chụp bài báo + vệt bút dạ ─────────────────────────
  // Vệt bút dạ quét ngang bằng clipPath (nhịp wipeL) nên trông như tay tô.
  'dan-chung': {
    label: 'Dẫn chứng (bài báo + bút dạ)',
    params: { nen: '', anh: '', tieuDe: '', toDam: [], phu: '' },
    build: (p, dur) => {
      const L = [];
      if (p.nen) L.push({ type: /\.(mp4|webm|mov)(\?|$)/i.test(p.nen) ? 'video' : 'image',
        src: p.nen, box: { x: 0, y: 0, w: 100, h: 100 }, style: { fit: 'cover' },
        at: 0, hold: { preset: 'kenIn', amp: 0.5 }, in: { preset: 'fade', dur: 0.3 }, z: 1 });
      L.push({ type: 'shape', shape: 'rect', box: { x: 0, y: 0, w: 100, h: 100 },
        style: { fill: 'rgba(10,9,8,.5)' }, backdropBlur: 14, at: 0, in: { preset: 'fade', dur: 0.3 }, z: 2 });
      // Trang giấy đặt lệch phải, chừa chỗ trái cho tiêu đề — như video mẫu.
      if (p.anh) L.push({ type: 'image', src: p.anh,
        box: { x: 46, y: 10, w: 48, h: 78 }, style: { fit: 'contain', radius: 3, shadow: 1.3 },
        at: 0.2, in: { preset: 'slideR', dur: 0.55 }, hold: { preset: 'drift', amp: 0.5 },
        out: { preset: 'fade', dur: 0.3 }, z: 10 });
      if (p.tieuDe) {
        // Vệt bút dạ nằm DƯỚI chữ, quét ngang trước rồi chữ hiện đè lên.
        L.push({ type: 'shape', shape: 'rect', box: { x: 5, y: 34, w: 36, h: 11 },
          style: { fill: 'rgba(240,206,58,.82)' },
          at: 0.5, in: { preset: 'wipeL', dur: 0.45 }, out: { preset: 'fade', dur: 0.3 }, z: 11 });
        L.push({ type: 'text', text: p.tieuDe,
          box: { x: 6, y: 35.5, w: 34, align: 'left' },
          style: { size: 30, color: '#141210', font: DOC.display, weight: 700, lineHeight: 1.18 },
          at: 0.62, in: { preset: 'fade', dur: 0.35 }, out: { preset: 'fade', dur: 0.3 }, z: 12 });
      }
      if (p.phu) L.push({ type: 'text', text: p.phu,
        box: { x: 6, y: 49, w: 34, align: 'left' },
        style: { size: 15, color: DOC.dim, font: DOC.label, lineHeight: 1.45 },
        at: 0.9, in: { preset: 'rise', dur: 0.4 }, out: { preset: 'fade', dur: 0.3 }, z: 12 });
      return L;
    },
  },

  // ── 4. Mốc thời gian — dải ngang, đánh dấu một quãng ────────────────────
  // Cho câu "bắt đầu 3,4 triệu năm trước, kết thúc 2000 TCN". Quãng tô sáng
  // quét từ trái sang bằng wipeL nên mắt đi theo đúng chiều thời gian.
  'moc-thoi-gian': {
    label: 'Mốc thời gian (dải ngang)',
    params: { nen: '', tieuDe: '', moc: [], quang: null, nhanQuang: '' },
    build: (p, dur) => {
      const moc = Array.isArray(p.moc) ? p.moc.slice(0, 6) : [];
      const L = [];
      if (p.nen) L.push({ type: /\.(mp4|webm|mov)(\?|$)/i.test(p.nen) ? 'video' : 'image',
        src: p.nen, box: { x: 0, y: 0, w: 100, h: 100 }, style: { fit: 'cover' },
        at: 0, hold: { preset: 'kenIn', amp: 0.5 }, in: { preset: 'fade', dur: 0.3 }, z: 1 });
      L.push({ type: 'shape', shape: 'rect', box: { x: 0, y: 0, w: 100, h: 100 },
        style: { fill: 'rgba(10,9,8,.42)' }, backdropBlur: 7, at: 0, in: { preset: 'fade', dur: 0.3 }, z: 2 });
      if (p.tieuDe) L.push({ type: 'text', text: String(p.tieuDe).toUpperCase(),
        box: { x: 8, y: 26, w: 84, align: 'left' },
        style: { size: 22, color: DOC.dim, font: DOC.label, tracking: 0.16, weight: 600 },
        at: 0.1, in: { preset: 'rise', dur: 0.45 }, out: { preset: 'fade', dur: 0.3 }, z: 10 });
      // Trục
      L.push({ type: 'shape', shape: 'rect', box: { x: 8, y: 49.4, w: 84, h: 0.5 },
        style: { fill: 'rgba(244,241,234,.4)' },
        at: 0.3, in: { preset: 'wipeL', dur: 0.6 }, out: { preset: 'fade', dur: 0.3 }, z: 10 });
      // Quãng tô sáng: [đầu%, cuối%] tính trên trục
      if (Array.isArray(p.quang) && p.quang.length === 2) {
        const a = Math.max(0, Math.min(100, Number(p.quang[0])));
        const b = Math.max(0, Math.min(100, Number(p.quang[1])));
        const x = 8 + (Math.min(a, b) / 100) * 84, w = (Math.abs(b - a) / 100) * 84;
        L.push({ type: 'shape', shape: 'rect', box: { x, y: 46.5, w, h: 6.4 },
          style: { fill: DOC.accent, radius: 2 },
          at: 0.75, in: { preset: 'wipeL', dur: 0.55 }, out: { preset: 'fade', dur: 0.3 }, z: 11 });
        if (p.nhanQuang) L.push({ type: 'text', text: String(p.nhanQuang).toUpperCase(),
          box: { x, y: 47.4, w, align: 'center' },
          style: { size: 20, color: '#141210', font: DOC.label, weight: 800, tracking: 0.08 },
          at: 1.05, in: { preset: 'fade', dur: 0.35 }, out: { preset: 'fade', dur: 0.3 }, z: 12 });
      }
      moc.forEach((m, k) => {
        const x = 8 + (Math.max(0, Math.min(100, numOr(m.at, 0))) / 100) * 84;
        L.push({ type: 'shape', shape: 'rect', box: { x: x - 0.1, y: 44.5, w: 0.35, h: 10 },
          style: { fill: 'rgba(244,241,234,.55)' },
          at: 0.5 + k * 0.1, in: { preset: 'drop', dur: 0.3 }, out: { preset: 'fade', dur: 0.3 }, z: 11 });
        L.push({ type: 'text', text: String(m.nhan || ''),
          box: { x: x - 9, y: 56, w: 18, align: 'center' },
          style: { size: 15, color: DOC.ink, font: DOC.label, weight: 500, lineHeight: 1.3 },
          at: 0.58 + k * 0.1, in: { preset: 'rise', dur: 0.35 }, out: { preset: 'fade', dur: 0.3 }, z: 11 });
      });
      return L;
    },
  },
};


// Bung 1 lớp-mẫu thành các lớp thật. Trả mảng (1 mẫu có thể sinh nhiều lớp).
function expandOne(L, sceneDur) {
  const T = TEMPLATES[L.template];
  if (!T) return [Object.assign({}, L, { type: L.type || 'text' })];   // tên mẫu lạ → coi như lớp thường
  const p = Object.assign({}, T.params, L);                            // giá trị AI đưa ĐÈ mặc định
  let out;
  try { out = T.build(p, sceneDur) || []; } catch (_) { return []; }
  // Thời điểm sống của mẫu (at/until) và z do lớp gọi quyết định, không phải mẫu.
  // Nếu người dùng THẢ mẫu lên một điểm cụ thể trên khung, đè toạ độ đó lên lớp CHÍNH
  // (lớp đầu tiên không phải nền toàn khung). Không có bước này thì mẫu luôn nằm ở chỗ nó tự đặt.
  // Mẫu tự dựng bố cục của nó, nên muốn kéo/co lại phải ĐÈ lên lớp CHÍNH
  // (lớp đầu tiên không phải nền toàn khung). x/y = thả bằng chuột, w/h = kéo mép.
  const moved = (L.x != null && L.y != null);
  const sized = (L.w != null || L.h != null);
  let mainIdx = -1;
  if (moved || sized) {
    mainIdx = out.findIndex(x => !(x.box && Number(x.box.w) >= 100));
    if (mainIdx < 0) mainIdx = 0;
  }
  return out.map((x, i) => {
    const y = Object.assign({}, x);
    if (i === mainIdx) {
      if (moved) y.box = Object.assign({}, y.box, { x: Number(L.x), y: Number(L.y), anchor: 'center', align: (y.box && y.box.align) || 'center' });
      if (L.w != null) y.box = Object.assign({}, y.box, { w: Number(L.w) });
      if (L.h != null) y.box = Object.assign({}, y.box, { h: Number(L.h) });
    }
    if (L.at != null) y.at = L.at;
    if (L.until != null) y.until = L.until;
    if (L.z != null) y.z = Number(L.z) + i;
    if (!y.id) y.id = (L.id || L.template) + '_' + i;
    return y;
  });
}

function expandLayers(layers, sceneDur) {
  const list = Array.isArray(layers) ? layers : [];
  const out = [];
  for (const L of list) {
    if (L && L.template) out.push(...expandOne(L, sceneDur));
    else if (L) out.push(L);
  }
  return out;
}

// Danh mục gọn cho AI/UI: tên mẫu + các trường điền được. Không kèm phần dựng.
function catalog() {
  // Kèm GIÁ TRỊ MẶC ĐỊNH: giao diện suy ra kiểu ô nhập (chữ / số / màu / danh sách)
  // ngay từ đây, khỏi phải chép tay bảng tham số của 32 mẫu ở phía renderer —
  // thêm mẫu mới là bảng chỉnh tự có, không phải sửa hai chỗ.
  return Object.keys(TEMPLATES).map((k) => ({
    template: k, label: TEMPLATES[k].label, params: Object.keys(TEMPLATES[k].params),
    defaults: Object.assign({}, TEMPLATES[k].params),
  }));
}

module.exports = { TEMPLATES, expandLayers, expandOne, catalog };
