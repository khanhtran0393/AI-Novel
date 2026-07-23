/**
 * Style axis (Phong cách) — world / jargon / visual / pacing material.
 */

import { MATRIX_STYLES, nfcLabel, normKey } from './catalog';
import type { StyleVector } from './types';

type StyleDef = Omit<StyleVector, 'name' | 'fromCatalog'>;

const DEFS: Record<string, StyleDef> = {
  'tu tiên / tiên hiệp': {
    world: 'Tiên môn, bí cảnh, thiên kiếp, đạo quả.',
    jargon: 'cảnh giới, linh căn, thần thức, pháp bảo, kiếp nạn, đạo tâm',
    visualDnaEn:
      'eastern cultivation fantasy, cyan-gold qi, immortal peaks, glowing swords, tactile robes, volumetric spirit light',
    colorGrade: 'Cyan / Gold Electric',
    wpmBias: 140,
    shotSecMin: 3.5,
    shotSecMax: 5.5,
    ttsTone: {
      narrator: 'Nam trầm hùng, có lực.',
      rolesHint: 'Lão tổ ồm khàn; NV chính lạnh kiêu; hệ thống panel rõ.',
    },
  },
  'huyền huyễn': {
    world: 'Huyết mạch thần thú, dị bảo, đại lục hỗn loạn.',
    jargon: 'huyết mạch, thần thú, dị hỏa, thiên tài địa bảo',
    visualDnaEn:
      'mythic fantasy continent, beast blood aura, ancient relics, dramatic sky, epic yet intimate faces',
    colorGrade: 'Amber Mythic',
    wpmBias: 142,
    shotSecMin: 3.5,
    shotSecMax: 5.5,
    ttsTone: {
      narrator: 'Trầm kể sử thi nhẹ.',
      rolesHint: 'Thú ngữ / tổ tiên vang; NV trẻ kiêu ngạo.',
    },
  },
  'đô thị': {
    world: 'Phố thị hiện đại, tầng lớp, ngầm và ánh đèn.',
    jargon: 'chủ tịch, hủy hôn, tập đoàn, dư luận, app, họp báo',
    visualDnaEn:
      'modern urban night, neon glass towers, luxury vs alley contrast, reaction close-ups, cinematic realism',
    colorGrade: 'Vibrant Neon Urban',
    wpmBias: 158,
    shotSecMin: 2.5,
    shotSecMax: 4.0,
    ttsTone: {
      narrator: 'Hiện đại, dồn, châm biếm nhẹ.',
      rolesHint: 'Phản diện chua; NV lạnh khi lộ bài.',
    },
  },
  'viễn tưởng': {
    world: 'Khoa học siêu tưởng, thiết bị lạ, xã hội tương lai gần.',
    jargon: 'module, AI, portal, năng lượng, thí nghiệm',
    visualDnaEn:
      'speculative sci-fi production design, practical screens, clean futurism with grit, volumetric light',
    colorGrade: 'Cool Speculative Blue',
    wpmBias: 145,
    shotSecMin: 3.5,
    shotSecMax: 5.5,
    ttsTone: {
      narrator: 'Rõ, hơi lạnh kỹ thuật.',
      rolesHint: 'Khoa học gia dứt; AI voice flat-electronic gợi ý.',
    },
  },
  dystopia: {
    world: 'Xã hội áp chế, thiếu thốn, kháng chiến.',
    jargon: 'khẩu phần, cấp bậc công dân, khu cấm, tuyên truyền',
    visualDnaEn:
      'dystopian oppression, concrete megastructures, ration lines, harsh practicals, teal-orange dark',
    colorGrade: 'Teal & Orange Dark',
    wpmBias: 148,
    shotSecMin: 3.0,
    shotSecMax: 4.5,
    ttsTone: {
      narrator: 'Kịch tính, dồn.',
      rolesHint: 'Quan chức lạnh; dân thường khàn mệt.',
    },
  },
  'cổ đại': {
    world: 'Triều đình / cổ phong lịch sử hóa (không cần niên đại thật).',
    jargon: 'chiếu chỉ, lạy, điện, thái giám, phủ',
    visualDnaEn:
      'historical palace drama, candlelight, silk hanfu, wood and stone tactility, royal gold crimson',
    colorGrade: 'Royal Gold Crimson',
    wpmBias: 135,
    shotSecMin: 4.0,
    shotSecMax: 6.5,
    ttsTone: {
      narrator: 'Truyền cảm cổ phong vừa phải.',
      rolesHint: 'Quan viên trang trọng; cung nhân thấp giọng mưu.',
    },
  },
  cyberpunk: {
    world: 'Megacity, corp, hack, chrome, mưa acid.',
    jargon: 'netrun, chrome, corp, ICE, street sam',
    visualDnaEn:
      'cyberpunk night rain, neon magenta cyan, chrome implants, dense signage, wet streets, holographic ads',
    colorGrade: 'Neon Magenta/Cyan',
    wpmBias: 155,
    shotSecMin: 2.5,
    shotSecMax: 4.0,
    ttsTone: {
      narrator: 'Nhanh, dry wit.',
      rolesHint: 'Fixer khàn; AI cold; street voice sắc.',
    },
  },
  steampunk: {
    world: 'Hơi nước, bánh răng, khí cầu, đế quốc công nghiệp.',
    jargon: 'nồi hơi, bánh răng, khí cầu, đồng hồ, invent',
    visualDnaEn:
      'steampunk brass copper, steam vents, clockwork, airships, Victorian-industrial grit',
    colorGrade: 'Brass Sepia',
    wpmBias: 140,
    shotSecMin: 3.5,
    shotSecMax: 5.5,
    ttsTone: {
      narrator: 'Kể chuyện phiêu lưu hơi cổ.',
      rolesHint: 'Kỹ sư hăng; quý tộc điệu.',
    },
  },
  'hắc ám': {
    world: 'Tàn khốc, moral gray, giá máu cho mọi thắng.',
    jargon: 'hy sinh, phản bội, vực thẳm, giá đắt',
    visualDnaEn:
      'dark grim atmosphere, low-key lighting, blood and mud tactility, crushed blacks, oppressive framing',
    colorGrade: 'Crushed Black Grim',
    wpmBias: 132,
    shotSecMin: 4.0,
    shotSecMax: 6.5,
    ttsTone: {
      narrator: 'Trầm, chậm, nặng.',
      rolesHint: 'Phản diện ấm áp giả; NV mệt mỏi thật.',
    },
  },
  'đồng nhân': {
    world: 'Theo IP/AU user mô tả — style chỉ tô màu.',
    jargon: 'theo canon user, AU rule, OC boundary',
    visualDnaEn:
      'match user IP visual bible if given; otherwise clean character-focused cinematic frames',
    colorGrade: 'Match Source / Neutral Cinematic',
    wpmBias: 145,
    shotSecMin: 3.5,
    shotSecMax: 5.5,
    ttsTone: {
      narrator: 'Bám giọng IP nếu user nêu.',
      rolesHint: 'Ưu tiên profile NV user; không đổi tính cách canon bừa.',
    },
  },
  'kiếm hiệp': {
    world: 'Võ lâm, quán rượu, spar, bí kíp.',
    jargon: 'nội lực, chiêu thức, danh hiệu, hạ sơn',
    visualDnaEn:
      'wuxia bamboo mist, flowing robes, sword trails, inn lanterns, martial clarity',
    colorGrade: 'Mist Teal Wuxia',
    wpmBias: 138,
    shotSecMin: 3.0,
    shotSecMax: 5.0,
    ttsTone: {
      narrator: 'Khoan thai có lực.',
      rolesHint: 'Cao thủ ồm; hậu sinh nóng.',
    },
  },
  'huyền nghi': {
    world: 'Bí ẩn tầng lớp, biểu tượng, điều tra.',
    jargon: 'manh mối, ẩn dụ, điều tra, mật mã',
    visualDnaEn:
      'mystery low-key, fog, flashlight practicals, symbolic props, negative space',
    colorGrade: 'Monochrome Low-key',
    wpmBias: 128,
    shotSecMin: 5.0,
    shotSecMax: 7.5,
    ttsTone: {
      narrator: 'Nhẹ, suspense, ngắt nghỉ.',
      rolesHint: 'NV thì thầm; kẻ lạ giọng lệch.',
    },
  },
  'tâm lý tội phạm': {
    world: 'Tội phạm nội tâm, interrogation, dual identity.',
    jargon: 'động cơ, alibi, trauma, thẩm vấn',
    visualDnaEn:
      'crime psychology interiors, harsh interview light, sweat detail, claustrophobic framing',
    colorGrade: 'Sickly Green Interrogate',
    wpmBias: 130,
    shotSecMin: 4.5,
    shotSecMax: 7.0,
    ttsTone: {
      narrator: 'Lạnh quan sát.',
      rolesHint: 'Thủ phạm điềm tĩnh; thám tử mệt.',
    },
  },
  'siêu anh hùng': {
    world: 'Thành phố siêu năng, media, costume identity.',
    jargon: 'bí danh, origin, villain monologue short, civilian',
    visualDnaEn:
      'superhero comic-cinematic, cape silhouette, city skyline, dynamic power FX restrained',
    colorGrade: 'Hero Primary Punch',
    wpmBias: 150,
    shotSecMin: 2.8,
    shotSecMax: 4.5,
    ttsTone: {
      narrator: 'Năng lượng trailer.',
      rolesHint: 'Hero quyết; villain ngông.',
    },
  },
  western: {
    world: 'Biên giới bụi, súng, thị trấn nhỏ, đạo đức hoang.',
    jargon: 'duel, sheriff, bounty, saloon',
    visualDnaEn:
      'western dust golden hour, wood town, revolver glint, wide desert, leather tactility',
    colorGrade: 'Desert Gold Dust',
    wpmBias: 135,
    shotSecMin: 3.5,
    shotSecMax: 6.0,
    ttsTone: {
      narrator: 'Chậm, dry.',
      rolesHint: 'Cao bồi khàn; chủ saloon cười giả.',
    },
  },
  'hải tặc': {
    world: 'Tàu, biển, kho báu, hải quân, mutiny.',
    jargon: 'thuyền trưởng, hải đồ, kho báu, bão',
    visualDnaEn:
      'pirate ship deck salt spray, treasure map, storm sea, rope wood iron',
    colorGrade: 'Salt Storm Teal',
    wpmBias: 145,
    shotSecMin: 3.0,
    shotSecMax: 5.0,
    ttsTone: {
      narrator: 'Phiêu, hơi lớn.',
      rolesHint: 'Thuyền trưởng vang; thủy thủ ồn.',
    },
  },
  'không gian': {
    world: 'Hạm đội, hành tinh, vacuum, station politics.',
    jargon: 'bridge, thruster, hull, colony, jump',
    visualDnaEn:
      'space opera practical cockpits, starfields, station corridors, soft UI glow',
    colorGrade: 'Deep Space Blue',
    wpmBias: 142,
    shotSecMin: 3.5,
    shotSecMax: 5.5,
    ttsTone: {
      narrator: 'Rõ bridge-report.',
      rolesHint: 'Captain vững; AI ship calm.',
    },
  },
  'xây dựng thế giới': {
    world: 'Colony rebuild, luật mới, tài nguyên, xã hội.',
    jargon: 'tài nguyên, hiến pháp, khu, logistics',
    visualDnaEn:
      'settlement construction, maps, warehouses, community halls, dawn over new walls',
    colorGrade: 'Dawn Rebuild Amber',
    wpmBias: 140,
    shotSecMin: 4.0,
    shotSecMax: 6.5,
    ttsTone: {
      narrator: 'Vững, planner.',
      rolesHint: 'Thủ lĩnh quyết; dân chúng lo.',
    },
  },
  'đông phương kỳ ảo': {
    world: 'Yêu ma sơn hải, phủ thủy đông, sơn thần.',
    jargon: 'yêu, bùa, sơn hải, linh thú',
    visualDnaEn:
      'eastern mythic creatures, ink-wash mountains, spirit fox fire, temple mist',
    colorGrade: 'Ink Mist Spirit',
    wpmBias: 136,
    shotSecMin: 4.0,
    shotSecMax: 6.5,
    ttsTone: {
      narrator: 'Kể chuyện huyền.',
      rolesHint: 'Yêu tinh ngọt nguy; đạo sĩ trầm.',
    },
  },
  'phương tây kỳ ảo': {
    world: 'Phù thủy, rồng, vương quốc, quest.',
    jargon: 'spell, dragon, realm, quest, mage tower',
    visualDnaEn:
      'western high fantasy, dragon scale, mage towers, forest light shafts, leather armor detail',
    colorGrade: 'Forest Emerald Gold',
    wpmBias: 138,
    shotSecMin: 3.5,
    shotSecMax: 6.0,
    ttsTone: {
      narrator: 'Epic ấm.',
      rolesHint: 'Pháp sư già; hiệp sĩ thẳng.',
    },
  },
  litrpg: {
    world: 'Level UI, skill tree, dungeon instance trong world.',
    jargon: 'level, XP, skill, dungeon, party, rank',
    visualDnaEn:
      'litRPG hybrid: grounded world plus subtle system UI holograms, dungeon stone, party formations',
    colorGrade: 'UI Green / Stone',
    wpmBias: 150,
    shotSecMin: 2.8,
    shotSecMax: 4.5,
    ttsTone: {
      narrator: 'Rõ stat, vẫn văn.',
      rolesHint: 'System voice electronic gợi; party đa giọng.',
    },
  },
  isekai: {
    world: 'Dị giới chuyển sinh, guild, starter town, king quest.',
    jargon: 'guild, skill, transferred, king, starter',
    visualDnaEn:
      'isekai fantasy town guild boards, otherworld sky, starter gear lived-in, soft epic',
    colorGrade: 'Soft Epic Otherworld',
    wpmBias: 145,
    shotSecMin: 3.5,
    shotSecMax: 5.5,
    ttsTone: {
      narrator: 'Phiêu lưu tươi + stakes.',
      rolesHint: 'NV hiện đại lệch; dân dị giới cổ.',
    },
  },
  noir: {
    world: 'Mưa, điều tra, femme fatale, thành phố thối.',
    jargon: 'case, dame, alibi, smoke, bribe',
    visualDnaEn:
      'neo-noir rain sodium neon, venetian blind shadows, cigarette practical, wet asphalt',
    colorGrade: 'Noir Sodium Neon',
    wpmBias: 125,
    shotSecMin: 5.0,
    shotSecMax: 7.5,
    ttsTone: {
      narrator: 'Khàn, chậm, monologue ngắn.',
      rolesHint: 'Thám tử mệt; người đẹp ngọt nguy.',
    },
  },
  'slice of life': {
    world: 'Đời thường, quán, trường, nhịp nhỏ.',
    jargon: 'thường ngày, mùa, quán, hàng xóm',
    visualDnaEn:
      'warm slice-of-life soft daylight, cozy interiors, food steam, gentle bokeh, lived-in clothes',
    colorGrade: 'Warm Soft Day',
    wpmBias: 125,
    shotSecMin: 5.5,
    shotSecMax: 8.0,
    ttsTone: {
      narrator: 'Ấm, chậm, mỉm cười.',
      rolesHint: 'NV đời thường; không over-dramatic trừ twist.',
    },
  },
  'epic / sử thi': {
    world: 'Vận mệnh thế giới, liên minh chủng tộc, chiến tranh lớn.',
    jargon: 'thiên mệnh, liên minh, đại chiến, di sản',
    visualDnaEn:
      'epic wide establishing armies and landscapes, then intimate character eyes, monumental scale',
    colorGrade: 'Epic Wide Gold',
    wpmBias: 138,
    shotSecMin: 4.0,
    shotSecMax: 7.0,
    ttsTone: {
      narrator: 'Sử thi vang vừa.',
      rolesHint: 'Lãnh đạo nặng; lính thầm.',
    },
  },
  gothic: {
    world: 'Lâu đài, u sầu, bí mật dòng họ, bóng tối đẹp.',
    jargon: 'lâu đài, lời nguyền dòng họ, hành lang, chân dung',
    visualDnaEn:
      'gothic castle candle soot, velvet decay, pale skin, ornate iron, blue moonlight',
    colorGrade: 'Moonlit Gothic Blue',
    wpmBias: 128,
    shotSecMin: 5.0,
    shotSecMax: 7.5,
    ttsTone: {
      narrator: 'U sầu, chậm.',
      rolesHint: 'Chủ lâu đài trầm; khách run nhẹ.',
    },
  },
  thriller: {
    world: 'Đuổi bắt, clock, conspiracy, trust fail.',
    jargon: 'countdown, chase, leak, safehouse',
    visualDnaEn:
      'thriller kinetic handheld energy, tight corridors, car glass reflections, urgent practicals',
    colorGrade: 'Cold Urgent Steel',
    wpmBias: 155,
    shotSecMin: 2.5,
    shotSecMax: 4.0,
    ttsTone: {
      narrator: 'Nhanh, gấp.',
      rolesHint: 'NV thở gấp; kẻ đuổi lạnh.',
    },
  },
  'military sci-fi': {
    world: 'Quân sự tương lai, dropship, armor, chain of command.',
    jargon: 'drop, armor, CO, recon, ordinance',
    visualDnaEn:
      'military sci-fi armor scuffs, dropship bay, HUD tints, muddy future battlefield',
    colorGrade: 'Olive HUD Future',
    wpmBias: 148,
    shotSecMin: 2.8,
    shotSecMax: 4.5,
    ttsTone: {
      narrator: 'Báo cáo chiến trường rõ.',
      rolesHint: 'CO gắt; lính thở nặng.',
    },
  },
  romantasy: {
    world: 'Kỳ ảo + romance tension, court hoặc realm.',
    jargon: 'bond, court, fae/realm, slow burn',
    visualDnaEn:
      'romantasy lush courts, soft bloom on faces, magical fauna, elegant wardrobe detail',
    colorGrade: 'Lush Rose Gold',
    wpmBias: 138,
    shotSecMin: 4.0,
    shotSecMax: 6.5,
    ttsTone: {
      narrator: 'Ấm cinematic.',
      rolesHint: 'Love interest trầm hút; NV chính sắc.',
    },
  },
  'hard sci-fi': {
    world: 'Khoa học nghiêm, constraint vật lý, engineering.',
    jargon: 'delta-v, radiation, protocol, mass, energy budget',
    visualDnaEn:
      'hard sci-fi grounded tech, no magic glow spam, realistic panels, industrial spacecraft',
    colorGrade: 'Industrial Cool Gray',
    wpmBias: 140,
    shotSecMin: 4.0,
    shotSecMax: 6.5,
    ttsTone: {
      narrator: 'Chính xác, ít hoa mỹ.',
      rolesHint: 'Engineer dứt; AI protocol flat.',
    },
  },
};

function softStyle(name: string): StyleVector {
  const n = nfcLabel(name) || 'Phong cách tùy chọn';
  return {
    name: n,
    world: `Bối cảnh mang màu "${n}" — chi tiết từ mo_ta/lore nếu có.`,
    jargon: `từ vựng bám nhãn "${n}"`,
    visualDnaEn: `cinematic look guided by style label "${n}", grounded production design, readable faces, 16:9 storytelling frames`,
    colorGrade: 'Cinematic Neutral',
    wpmBias: 140,
    shotSecMin: 3.5,
    shotSecMax: 6.0,
    ttsTone: {
      narrator: 'Trung tính rõ chữ, bám tone style.',
      rolesHint: 'Phân vai theo hồ sơ NV; narrator ổn định.',
    },
    fromCatalog: false,
  };
}

export function resolveStyleVector(phong_cach?: string | null): StyleVector {
  const name = nfcLabel(phong_cach || '');
  if (!name) return softStyle('');
  const key = normKey(name);
  const def = DEFS[key];
  if (def) return { name, fromCatalog: true, ...def };
  for (const s of MATRIX_STYLES) {
    const sk = normKey(s.name);
    if (key === sk || key.includes(sk) || sk.includes(key)) {
      const d = DEFS[sk];
      if (d) return { name: s.name, fromCatalog: true, ...d };
    }
  }
  return softStyle(name);
}

export function listStyleCatalogNames(): string[] {
  return MATRIX_STYLES.map((s) => s.name);
}
