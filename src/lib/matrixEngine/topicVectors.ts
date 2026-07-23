/**
 * Topic axis (Chủ đề) — conflict / motive / reward material.
 * Dynamic encoding: one vector per catalog theme; free-text → soft vector.
 */

import { MATRIX_THEMES, nfcLabel, normKey } from './catalog';
import type { TopicVector } from './types';

type TopicDef = Omit<TopicVector, 'name' | 'fromCatalog'>;

const DEFS: Record<string, TopicDef> = {
  'xuyên không': {
    conflict: 'Lạc thế giới / timeline; bản sắc cũ va đập luật mới.',
    motive: 'Sống sót + tìm đường về hoặc thống trị không gian mới.',
    reward: 'Hiểu luật thế giới mới → công cụ / địa vị / đồng minh.',
    subvertHints: [
      'Không “trúng số VIP ngay giây 1” nếu không có giá.',
      'Luật thế giới mới phải đụng vào điểm yếu cũ của NV.',
    ],
    scoreMotifs: ['xuyên không', 'dị giới', 'timeline', 'lạc'],
  },
  'trùng sinh': {
    conflict: 'Biết trước tương lai nhưng bị chặn bởi lựa chọn / người khác.',
    motive: 'Sửa sai / báo thù / bảo vệ người quan trọng.',
    reward: 'Thay đổi một nhánh định mệnh → domino cảm xúc.',
    subvertHints: [
      'Tương lai nhớ được đã lệch — cấm butterfly effect “muốn gì được nấy”.',
      'Kẻ thù cũng có thể đã thay đổi.',
    ],
    scoreMotifs: ['trùng sinh', 'trọng sinh', 'kiếp trước', 'làm lại'],
  },
  'hệ thống': {
    conflict: 'Nhiệm vụ / panel ép NV vào lựa chọn khó; giá của thăng cấp.',
    motive: 'Hoàn nhiệm vụ để sống / mạnh / trả nợ hệ thống.',
    reward: 'Skill / rank / điểm — luôn kèm side-effect.',
    subvertHints: [
      'Hệ thống không phải ATM — có bug, cooldown, trade-off.',
      'Phần thưởng “thần cấp” phải đổi bằng thứ NV sợ mất.',
    ],
    scoreMotifs: ['hệ thống', 'nhiệm vụ', 'thăng cấp', 'skill'],
  },
  'sinh tồn': {
    conflict: 'Thiếu tài nguyên; môi trường / người / quái cùng giết.',
    motive: 'Sống qua đêm / bảo vệ nhóm / xây nơi an toàn.',
    reward: 'Vật tư, căn cứ, thông tin an toàn.',
    subvertHints: [
      'Đồng đội có thể phản bội vì đói — không chỉ quái bên ngoài.',
      'Cấm “kho vô hạn” không có chi phí bảo vệ.',
    ],
    scoreMotifs: ['sinh tồn', 'mạt thế', 'tích trữ', 'căn cứ'],
  },
  'võ hiệp': {
    conflict: 'Ân oán giang hồ, danh dự, môn phái, nợ máu.',
    motive: 'Trả nợ / bảo danh / đoạt bí kíp chính nghĩa theo NV.',
    reward: 'Danh vọng, nội lực, minh oan.',
    subvertHints: [
      'Chính tà không đen-trắng; ân oán có lớp.',
      'Tuyệt kỹ không giải quyết mọi xung đột xã hội.',
    ],
    scoreMotifs: ['giang hồ', 'môn phái', 'nợ máu', 'kiếm'],
  },
  'trinh thám': {
    conflict: 'Án / bí ẩn; manh mối mâu thuẫn; thủ phạm che dấu.',
    motive: 'Tìm sự thật dù đụng quyền lực.',
    reward: 'Clue mới, lời thú, lật tẩy.',
    subvertHints: [
      'Red herring thật — không dump clue artificial.',
      'Thủ phạm có logic người, không “điên vì điên”.',
    ],
    scoreMotifs: ['án', 'manh mối', 'thủ phạm', 'bí ẩn'],
  },
  'dị năng': {
    conflict: 'Năng lực mới vs kiểm soát / xã hội kỳ thị / tổ chức săn.',
    motive: 'Làm chủ sức mạnh hoặc che giấu.',
    reward: 'Awaken stage, đồng minh dị năng, vũ khí counter.',
    subvertHints: ['Sức mạnh có giá thể chất/tâm lý rõ.', 'Không one-shot mọi boss.'],
    scoreMotifs: ['dị năng', 'thức tỉnh', 'siêu năng', 'kiểm soát'],
  },
  'linh khí khôi phục': {
    conflict: 'Thế giới đột biến linh khí; kẻ yếu / mạnh đảo chiều.',
    motive: 'Chiếm tài nguyên linh khí / bảo người thân.',
    reward: 'Cảnh giới, linh vật, lãnh địa.',
    subvertHints: [
      'Linh khí khôi phục ≠ mọi người thành thần ngay.',
      'Xã hội hiện đại vỡ luật trước khi “tu luyện chuẩn textbook”.',
    ],
    scoreMotifs: ['linh khí', 'thức tỉnh', 'cảnh giới', 'khôi phục'],
  },
  'kinh dị': {
    conflict: 'Quy tắc sinh tồn / thực thể / sợ hãi không giải bằng bạo lực thuần.',
    motive: 'Sống / cứu / hiểu quy tắc trước khi vỡ.',
    reward: 'Quy tắc mới, lối thoát tạm, truth horror.',
    subvertHints: [
      'Sợ từ quy tắc + chi tiết đời thường, không chỉ máu.',
      'Cấm jump-scare lặp không hệ quả.',
    ],
    scoreMotifs: ['quy tắc', 'đừng mở', '2h đêm', 'rùng'],
  },
  'hài hước': {
    conflict: 'Tình huống absurd; nhân vật nghiêm túc trong thế giới lệch.',
    motive: 'Giải quyết việc “nghiêm” bằng cách hài / hoặc ngược lại.',
    reward: 'Punchline + escalate stakes vẫn thật.',
    subvertHints: [
      'Hài từ tính cách + tình huống, không meme rẻ.',
      'Vẫn có stakes — cười rồi vẫn nguy.',
    ],
    scoreMotifs: ['hài', 'tấu hài', 'lầy', 'bẽ mặt'],
  },
  'cơ giáp / mecha': {
    conflict: 'Máy / pilot / năng lượng / chính trị quân sự quanh mecha.',
    motive: 'Chiến thắng trận / cứu unit / làm chủ cockpit.',
    reward: 'Upgrade frame, ammo, rank pilot.',
    subvertHints: ['Mecha hỏng, nóng máy, logistics — không bất tử.', 'Pilot bond có giá.'],
    scoreMotifs: ['mecha', 'cơ giáp', 'cockpit', 'frame'],
  },
  'ngôn tình': {
    conflict: 'Khoảng cách cảm xúc, hiểu lầm, đối thủ, gia đình/xã hội.',
    motive: 'Gần người kia hoặc tự bảo vệ trái tim.',
    reward: 'Bước tiến quan hệ + twist cảm xúc.',
    subvertHints: ['Không HE ép nếu dàn ý tragedy; chemistry từ hành động.', 'Cấm tường thuật “yêu vì đẹp”.'],
    scoreMotifs: ['tình', 'hủy hôn', 'trái tim', 'gặp lại'],
  },
  'báo thù': {
    conflict: 'Nợ máu / sỉ nhục công khai; kẻ thù mạnh hơn.',
    motive: 'Trả đủ / hơn — hoặc nhận ra trả thù phá NV.',
    reward: 'Vả mặt công khai, mất mát đối phương, danh dự.',
    subvertHints: ['Trả thù tốn thứ NV yêu; không win clean 100%.', 'Kẻ thù có lý do riêng.'],
    scoreMotifs: ['báo thù', 'trả nợ máu', 'vả mặt', 'sỉ nhục'],
  },
  'phản công': {
    conflict: 'Bị dồn đáy; hệ thống áp lực; “phế” bị khinh.',
    motive: 'Lật bàn, chứng minh, giành lại quyền.',
    reward: 'Reveal sức mạnh / thân phận / quân cờ.',
    subvertHints: ['Phản công có setup — không power từ hư không.', 'Khinh bỉ phải có hậu quả xã hội.'],
    scoreMotifs: ['phản công', 'phế vật', 'lật bàn', 'thức tỉnh'],
  },
  'nông trường': {
    conflict: 'Đất / mùa / thị trường / quái / chính quyền cướp mùa.',
    motive: 'Xây trang trại / thôn ấp giàu & an toàn.',
    reward: 'Mùa bội, công nghệ canh tác, liên minh thương.',
    subvertHints: ['Nông nghiệp có thời vụ & rủi ro — không “click = vàng”.', 'Đất đai = chính trị.'],
    scoreMotifs: ['nông trường', 'mùa màng', 'tích lũy', 'trang trại'],
  },
  'thương chiến': {
    conflict: 'Thâu tóm, phá giá, nội gián, pháp lý, dư luận.',
    motive: 'Thắng thị phần / cứu công ty / báo thù thương trường.',
    reward: 'Hợp đồng, cổ phiếu, phá sản đối thủ.',
    subvertHints: ['Số liệu & đòn tâm lý — không chỉ “la hét trong họp”.', 'Đồng minh hôm nay phản bội ngày mai.'],
    scoreMotifs: ['thương chiến', 'thâu tóm', 'cổ phiếu', 'phá sản'],
  },
  'quân sự': {
    conflict: 'Trận đánh, tiếp tế, mệnh lệnh sai, lòng quân.',
    motive: 'Hoàn thành nhiệm vụ / cứu đơn vị / đổi cục diện.',
    reward: 'Chiến thắng chiến thuật, thông tin tình báo, cấp bậc.',
    subvertHints: ['Chiến tranh có logistics & thương vong — không anime one-man army free.', 'Lệnh trên có thể sai.'],
    scoreMotifs: ['chiến trường', 'mệnh lệnh', 'binh pháp', 'tiếp tế'],
  },
  'cung đấu': {
    conflict: 'Hậu cung / triều chính: độc, mật chỉ, phe phái.',
    motive: 'Sống / bảo con / đoạt sủng / lật ngôi theo dàn ý.',
    reward: 'Địa vị, minh chứng, quân cờ mới.',
    subvertHints: ['Mưu sâu qua chi tiết nhỏ (trà, lụa, sổ sách) — không monologue “ta sẽ diệt”.', 'Phe ta cũng bẩn.'],
    scoreMotifs: ['cung đấu', 'hậu cung', 'mật chỉ', 'sủng'],
  },
  'học đường': {
    conflict: 'Cạnh tranh điểm / clb / bắt nạt / bí mật mái trường.',
    motive: 'Top rank, bảo bạn, vạch mặt.',
    reward: 'Thắng cuộc thi, danh tiếng, clue trường.',
    subvertHints: ['Tuổi học đường ≠ ngây thơ vô spoiler adult crime trừ dàn ý.', 'Áp lực gia đình thật.'],
    scoreMotifs: ['học đường', 'thi', 'bắt nạt', 'lớp'],
  },
  'thể thao': {
    conflict: 'Đối thủ, chấn thương, ban huấn luyện, doping nghi.',
    motive: 'Vô địch / phục thù sân đấu / chứng minh.',
    reward: 'Kỷ lục, HCV, hợp đồng.',
    subvertHints: ['Thể thao = tập luyện + thất bại — không “bẩm sinh thắng”.', 'Đội ngũ quan trọng hơn solo.'],
    scoreMotifs: ['đấu trường', 'kỷ lục', 'chung kết', 'chấn thương'],
  },
  'ẩm thực': {
    conflict: 'Nguyên liệu, khẩu vị khách, đối thủ bếp, bí mật công thức.',
    motive: 'Chinh phục vị giác / cứu quán / danh đầu bếp.',
    reward: 'Review, sao Michelin-like, công thức truyền.',
    subvertHints: ['Nấu ăn có thất bại & thời gian — không magic pot every plate.', 'Vị giác gắn ký ức NV.'],
    scoreMotifs: ['ẩm thực', 'công thức', 'quán', 'vị'],
  },
  'y học': {
    conflict: 'Ca khó, đạo đức y, bệnh viện chính trị, dịch.',
    motive: 'Cứu người / phá án y / tìm thuốc.',
    reward: 'Chẩn đúng, bệnh nhân sống, breakthrough.',
    subvertHints: ['Y khoa có giới hạn & sai sót — không thần y 100%.', 'Đạo đức > cool surgery shot.'],
    scoreMotifs: ['y học', 'phẫu thuật', 'chẩn đoán', 'bệnh'],
  },
  'game / vô hạn lưu': {
    conflict: 'Ải chết, luật instance, PvP, countdown.',
    motive: 'Clear ải / bảo team / mang đồ về hiện thực.',
    reward: 'Loot, rank, clue meta-game.',
    subvertHints: ['Luật ải phải nhất quán; chết có giá.', 'Cấm inventory cheat không setup.'],
    scoreMotifs: ['vô hạn lưu', 'ải', 'sảnh', 'clear'],
  },
  'kỳ ảo mạo hiểm': {
    conflict: 'Bí cảnh, boss, curse, party conflict.',
    motive: 'Đoạt bảo / phá lời nguyền / khám phá.',
    reward: 'Artifact, map, danh hiệu mạo hiểm giả.',
    subvertHints: ['Dungeon có logic; không corridor vô hạn filler.', 'Bảo vật có giá/curse.'],
    scoreMotifs: ['bí cảnh', 'bảo vật', 'mạo hiểm', 'curse'],
  },
  'thần thoại': {
    conflict: 'Thần-người, lời nguyền cổ, vận mệnh thiên mệnh.',
    motive: 'Phá thiên mệnh / trở thành thần / cứu chúng sinh theo dàn ý.',
    reward: 'Thần khí, sủng ái thần, đổi myth.',
    subvertHints: ['Thần không NPC shop; myth có giá văn hóa.', 'Vận mệnh bẻ được phải tốn.'],
    scoreMotifs: ['thần', 'thiên mệnh', 'huyền sử', 'thần khí'],
  },
  'đồng nhân': {
    conflict: 'Canon vs OC; AU luật; fan expectation vs twist.',
    motive: 'Tôn trọng IP gốc + story mới của user (mo_ta tối cao).',
    reward: 'Beat fan-service có lý + arc mới.',
    subvertHints: [
      'Ưu tiên mo_ta/lore user — không “sửa canon” bừa.',
      'Tag chỉ định giọng & màu — không cướp plot fanfic.',
    ],
    scoreMotifs: ['đồng nhân', 'fanfic', 'AU', 'canon'],
  },
  'đạo tặc / heist': {
    conflict: 'Kế hoạch cướp, phản gián, double-cross, timer.',
    motive: 'Cướp mục tiêu / trả nợ / lừa kẻ mạnh.',
    reward: 'Loot, thoát thân, twist “ai là nội gián”.',
    subvertHints: ['Heist cần plan–fail–adapt; không perfect run.', 'Mỗi thành viên có dual motive.'],
    scoreMotifs: ['cướp', 'kế hoạch', 'nội gián', 'két'],
  },
  'chính trị': {
    conflict: 'Phe phái, dư luận, bầu cử/triều, đàm phán bẩn.',
    motive: 'Giữ ghế / lật đổ / cải cách có giá.',
    reward: 'Liên minh, mật ước, thắng phiếu/chiếu.',
    subvertHints: ['Chính trị = trade-off công khai; không speech win all.', 'Đồng minh có giá.'],
    scoreMotifs: ['quyền lực', 'phe phái', 'mưu', 'nghị viện'],
  },
  'tình báo': {
    conflict: 'Danh tính kép, phản gián, tài liệu mật, trust no one.',
    motive: 'Hoàn thành mission / không lộ cover.',
    reward: 'Intel, burn notice tránh được, asset mới.',
    subvertHints: ['Cover identity có chi phí cảm xúc.', 'Cấm omniscient spy god.'],
    scoreMotifs: ['gián điệp', 'mật', 'cover', 'phản gián'],
  },
  'du hành / di cư': {
    conflict: 'Đường dài, tài nguyên, biên giới, người lạ đất lạ.',
    motive: 'Đến đích / tìm nhà mới / hộ tống.',
    reward: 'Chặng an toàn, bản đồ, cộng đồng mới.',
    subvertHints: ['Hành trình có mỏi & mất — không montage trống.', 'Đất mới có luật lạ.'],
    scoreMotifs: ['hành trình', 'di cư', 'đất mới', 'đường dài'],
  },
};

function softTopic(name: string): TopicVector {
  const n = nfcLabel(name) || 'Chủ đề tùy chọn';
  return {
    name: n,
    conflict: `Xung đột cốt lõi xoay quanh chủ đề "${n}" (do user đặt) — bám mo_ta nếu có.`,
    motive: `Động lực NV gắn "${n}"; không thay bằng thể loại khác.`,
    reward: `Phần thưởng / tiến triển phải cảm thấy thuộc "${n}".`,
    subvertHints: [
      `Tránh rập khuôn sáo của nhãn "${n}" — bẻ 1 kỳ vọng fan.`,
      'Ưu tiên mo_ta & dàn ý user nếu mâu thuẫn trope phổ biến.',
    ],
    scoreMotifs: n
      .toLowerCase()
      .split(/[\s/·|,]+/)
      .filter((w) => w.length >= 2)
      .slice(0, 6),
    fromCatalog: false,
  };
}

export function resolveTopicVector(chu_de?: string | null): TopicVector {
  const name = nfcLabel(chu_de || '');
  if (!name) {
    return softTopic('');
  }
  const key = normKey(name);
  const def = DEFS[key];
  if (def) {
    return { name, fromCatalog: true, ...def };
  }
  // fuzzy: catalog name contains / contained
  for (const t of MATRIX_THEMES) {
    const tk = normKey(t.name);
    if (key === tk || key.includes(tk) || tk.includes(key)) {
      const d = DEFS[tk];
      if (d) return { name: t.name, fromCatalog: true, ...d };
    }
  }
  return softTopic(name);
}

export function listTopicCatalogNames(): string[] {
  return MATRIX_THEMES.map((t) => t.name);
}
