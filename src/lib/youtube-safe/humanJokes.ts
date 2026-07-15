/**
 * Câu đùa "người nói với người" - giọng hội bạn đời.
 * Bâng quơ với cốt truyện; không phải note đạo diễn / SFX.
 */
export const DEFAULT_HUMAN_JOKE_ASIDES = [
  'Đề nghị mọi người đi vệ sinh nhớ chùi đít',
  'Thằng nào vừa ị hơi thì xin lỗi đi, hôi cả phòng',
  'Ai đang cắn móng tay nhả ra giúp cái, tao ghê quá',
  'Có ai cho mượn 50k không? Đùa đấy, đừng ai chuyển',
  'Tao đếm được mấy đứa đang gãi chỗ nhạy cảm lúc này',
  'Mẹ ơi con đói… à lộn, mẹ không có ở đây',
  'Xin phép tạm dừng 3 giây để tao tìm remote… thôi kệ',
  'Ai biết mật khẩu wifi nhà hàng xóm không? Tao đang thử dò',
  'Đề nghị cả lũ ngậm miệng nhai, tiếng lộp bộp văng cả mic',
  'Có đứa nào đang xem cùng bố mẹ thì… chúc may mắn',
  'Tao thề không cười — mẹ, cười sặc rồi',
  'Ai đang cầm đũa mà không có đồ ăn thì… chịu khó',
] as const;

/** Note đạo diễn / SFX - không tính là câu đùa người */
const DIRECTOR_NOTE_RE =
  /^(cười|cười khẩy|thở dài|im lặng|nghỉ|pause|nhạc|âm thanh|sfx|fx|cut|fade|zoom|close.?up|off|os|v\.o\.|nhấn mạnh|to|nhỏ|whisper)/i;

export function isHumanJokeAsideInner(inner: string): boolean {
  const t = (inner || '').normalize('NFC').trim();
  if (t.length < 8 || t.length > 120) return false;
  if (DIRECTOR_NOTE_RE.test(t)) return false;
  if (/^[A-Za-zÀ-ỹ\s.]{1,12}$/.test(t) && t.split(/\s+/).length <= 2) return false;
  return true;
}

/** Đếm câu đùa dạng (... ) đã có trong kịch bản */
export function countHumanJokeAsides(script: string): number {
  const text = (script || '').normalize('NFC');
  let n = 0;
  const re = /\(([^)]{8,120})\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (isHumanJokeAsideInner(m[1])) n++;
  }
  return n;
}

function pickJokeAside(seed: string, used: Set<string>): string {
  const pool = DEFAULT_HUMAN_JOKE_ASIDES.filter((j) => !used.has(j));
  const list = pool.length ? pool : [...DEFAULT_HUMAN_JOKE_ASIDES];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return list[h % list.length];
}

/**
 * Bảo đảm có >= minCount câu đùa người-nói-với-người trong kịch bản.
 * Chèn sau dấu câu, trước thoại tiếp theo.
 */
export function injectHumanJokeAsides(
  script: string,
  options?: { minCount?: number; enabled?: boolean },
): string {
  const enabled = options?.enabled !== false;
  const minCount = Math.max(0, options?.minCount ?? 1);
  if (!enabled || minCount === 0) return script || '';

  let text = (script || '').normalize('NFC');
  if (!text.trim()) return text;

  const existing = countHumanJokeAsides(text);
  if (existing >= minCount) return text;

  const need = minCount - existing;
  const used = new Set<string>();
  const reExist = /\(([^)]{8,120})\)/g;
  let em: RegExpExecArray | null;
  while ((em = reExist.exec(text)) !== null) {
    if (isHumanJokeAsideInner(em[1])) used.add(em[1].trim());
  }

  type Slot = { insertPos: number; eatSpaces: number };
  const slots: Slot[] = [];

  const closeOpen = /(["”»])(\s+)(["“«])/g;
  let bm: RegExpExecArray | null;
  while ((bm = closeOpen.exec(text)) !== null) {
    slots.push({ insertPos: bm.index + 1, eatSpaces: bm[2].length });
  }

  const periodOut = /(["”»])\.(\s+)(["“«])/g;
  while ((bm = periodOut.exec(text)) !== null) {
    slots.push({ insertPos: bm.index + 2, eatSpaces: bm[2].length });
  }

  if (slots.length === 0) {
    const afterDialogue = /(["”»])(\s+)(?=[A-ZÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬĐÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴ])/g;
    while ((bm = afterDialogue.exec(text)) !== null) {
      slots.push({ insertPos: bm.index + 1, eatSpaces: bm[2].length });
    }
  }

  if (slots.length === 0) {
    const endRe = /[.!?…](\s+)(?=[^\s\[\"“«])/g;
    while ((bm = endRe.exec(text)) !== null) {
      slots.push({ insertPos: bm.index + 1, eatSpaces: bm[1].length });
    }
  }

  const insertAt: Slot[] = [];
  if (slots.length > 0) {
    for (let i = 0; i < need; i++) {
      const pick = slots[Math.floor(((i + 1) * slots.length) / (need + 1)) % slots.length];
      insertAt.push(pick);
    }
  } else {
    const para = text.indexOf('\n\n');
    insertAt.push({ insertPos: para > 40 ? para : Math.min(80, text.length), eatSpaces: 0 });
  }

  const uniqueSorted = [...insertAt]
    .sort((a, b) => b.insertPos - a.insertPos)
    .filter((s, i, arr) => i === 0 || s.insertPos !== arr[i - 1].insertPos);

  let inserted = 0;
  for (const slot of uniqueSorted) {
    if (inserted >= need) break;
    const pos = slot.insertPos;
    const slice = text.slice(pos, pos + 80);
    if (/^\s*\([^)]{8,120}\)/.test(slice)) continue;
    const before = text.slice(Math.max(0, pos - 40), pos);
    if (/\[[^\]]*$/.test(before)) continue;

    const joke = pickJokeAside(text.slice(Math.max(0, pos - 24), pos + 24) + String(pos), used);
    used.add(joke);
    const eat = Math.max(0, slot.eatSpaces);
    const snippet = ` (${joke}) `;
    text = text.slice(0, pos) + snippet + text.slice(pos + eat);
    inserted++;
  }

  if (inserted < need) {
    const joke = pickJokeAside(text + 'tail', used);
    text = text.trimEnd() + ` (${joke})`;
  }

  return text;
}

export function buildHumanJokeAsideBlock(enabled: boolean): string {
  if (!enabled) return '';
  const samples = DEFAULT_HUMAN_JOKE_ASIDES.slice(0, 5)
    .map((s) => `   · (${s})`)
    .join('\n');
  return `
--- CÂU ĐÙA “NGƯỜI NÓI VỚI NGƯỜI” (BẮT BUỘC, TÍNH NGƯỜI) ---
I. Mỗi chương / Hook PHẢI có khoảng 1–3 câu đùa ngắn dạng NGOẶC ĐƠN (...), giọng bạn bè
   xen ngang khi đang kể — không phải lời nhân vật, không phải note đạo diễn.
II. Chèn GIỮA nhịp thoại/kể (sau dấu chấm, trước câu thoại tiếp), ví dụ:
   "Không. Không phải. Mình... mình hơi mệt." (Đề nghị mọi người đi vệ sinh nhớ chùi đít) "Mệt hả?..."
III. GIỌNG HỘI BẠN ĐỜI — PHẢI VUI (BẮT BUỘC):
   - Như đứa bạn ngồi cạnh xen ngang: bẩn nhẹ, absurde, “đề nghị” vớ vẩn, troll phòng — nghe người thật.
   - CẤM mùi AI / setup–punchline công thức: lương về, crush nhắn ok, gym no pain, Google cách giàu,
     giảm giá 50%, ăn kiêng–bụng nói, “tiết kiệm năng lượng cho ngủ”…
   - CẤM nhắc nhạt không hài: uống nước, ngồi thẳng, đổ rác, sạc pin, muỗi bay, quạt kêu…
IV. BÂNG QUƠ VỚI CỐT TRUYỆN (vẫn bắt buộc):
   - KHÔNG dính nội dung, chủ đề, nhân vật, twist, bối cảnh kịch bản.
   - CẤM meta plot: "cảnh này căng", "đoán twist", "nhân vật này…", "đoạn vừa rồi…".
V. CẤM nhầm với SFX/note đạo diễn: (Cười), (thở dài), [âm thanh gió], (nhạc nền)...
VI. Giọng: mày–tao / đề nghị / xin lỗi vớ vẩn — thả 1 câu rồi im, không giảng.
VII. Mỗi câu ≤ 1 dòng; không phá beat bằng cả đoạn hài dài.
VIII. Gợi ý phong cách (tự viết biến thể cùng giọng, đừng copy máy móc cả chương):
${samples}`;
}
