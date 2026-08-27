// Ước lượng mốc từng TỪ khi chưa có audio thật.
// Khi cắm TTS: bỏ estimateWords(), thay bằng mảng {w,s,e} của asr_whisper.py — phần dưới giữ nguyên.
const WPS = 155 / 60;                       // ~155 từ/phút, nhịp kể chuyện explainer

// Từ dài đọc lâu hơn từ ngắn → chia theo số ký tự chứ không chia đều,
// nếu chia đều thì mốc lệch dần và emoji vào trước/sau lời cả nửa giây.
function estimateWords(text, start) {
  const raw = text.split(/\s+/).filter(Boolean);
  const cost = raw.map((w) => Math.max(2, w.replace(/[^\w%]/g, '').length));
  const total = cost.reduce((a, b) => a + b, 0);
  const dur = raw.length / WPS;
  let t = start;
  return raw.map((w, i) => {
    const d = dur * (cost[i] / total);
    const o = { w, s: +t.toFixed(3), e: +(t + d * 0.92).toFixed(3) };
    t += d;
    return o;
  });
}
const speechDur = (text) => text.split(/\s+/).filter(Boolean).length / WPS;

const norm = (s) => String(s).toLowerCase().replace(/[^\w%]/g, '');

// Tìm từ neo. Khớp đúng trước, không có thì khớp tiền tố — vì Whisper hay trả
// "months," / "100%." kèm dấu câu, và biến thể số ít/số nhiều.
function findAnchor(words, phrase) {
  const want = norm(phrase);
  let hit = words.findIndex((x) => norm(x.w) === want);
  if (hit < 0) hit = words.findIndex((x) => norm(x.w).startsWith(want) || want.startsWith(norm(x.w)));
  return hit < 0 ? null : words[hit];
}

module.exports = { estimateWords, speechDur, findAnchor, WPS };
