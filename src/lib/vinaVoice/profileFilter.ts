/**
 * Lọc catalog Clone Voice theo giới tính / vùng miền / phong cách / cảm xúc
 * (suy ra từ tên profile Vina — không có metadata riêng).
 */

export type CloneFilterInput = {
  gender?: 'male' | 'female' | string;
  area?: 'northern' | 'central' | 'southern' | string;
  group?: string;
  emotion?: string;
};

function norm(s: string): string {
  return (s || '').normalize('NFC').toLowerCase();
}

/** Giới tính từ tên profile */
export function inferGenderFromName(name: string): 'male' | 'female' | 'unknown' {
  const n = norm(name);
  if (/nữ|nu tre|nu trung|nu gia|giả giọng nữ|female/.test(n)) return 'female';
  // "Nam" = male voice (not region): Nam Trẻ / Nam Già / Kenny - Nam / USER-... Nam
  if (
    /\bnam\b|nam trẻ|nam gia|nam trung|kenny - nam|lồng tiếng nam|user-lồng tiếng nam/.test(
      n,
    ) ||
    /tiếng anh - nam|tin tức - nam|thuyết pháp - nam|truyện ma - nam|văn chương - nam|điếu văn - nam|quảng cáo.*nam/.test(
      n,
    )
  ) {
    return 'male';
  }
  if (/đông phương bất bại/.test(n)) return 'female';
  if (/bảo - giả giọng nữ/.test(n)) return 'female';
  if (/giọng bảo|user-lồng/.test(n)) return 'male';
  return 'unknown';
}

/** Phong cách (group) từ tên */
export function inferGroupFromName(name: string): string[] {
  const n = norm(name);
  const tags: string[] = [];
  if (/lồng tiếng|thuyết minh|long_tieng|dub/.test(n)) tags.push('dubbing');
  if (/tin tức|thời sự|đọc tin/.test(n)) tags.push('news');
  if (/quảng cáo|quang cao|ads|game|sp -/.test(n)) tags.push('ads');
  if (/kể chuyện|truyện ma|văn chương|điếu văn|audiobook|sách/.test(n)) {
    tags.push('story');
    tags.push('audiobook');
  }
  if (/review|giao tiếp|tự nhiên/.test(n)) tags.push('review');
  if (/thuyết pháp|kiến thức|khoa học/.test(n)) {
    tags.push('story');
    tags.push('news');
  }
  if (/cảm xúc|sắc thái|giọng /.test(n) && tags.length === 0) tags.push('story');
  if (tags.length === 0) tags.push('story', 'dubbing'); // generic film/narration
  return tags;
}

/** Cảm xúc từ tên (rỗng = neutral/generic) */
export function inferEmotionsFromName(name: string): string[] {
  const n = norm(name);
  const tags: string[] = [];
  if (/vui vẻ|hào hứng|hùng hồn|truyền cảm|sôi động|quyến rũ/.test(n)) tags.push('happy');
  if (/buồn|tuyệt vọng|điếu văn|chậm rãi|trầm ấm/.test(n)) tags.push('sad');
  if (/giận|quát|lạnh lùng|đe dọa|kiêu ngạo/.test(n)) tags.push('angry');
  if (/sợ hãi|hoảng|bí ẩn|kinh dị|truyện ma/.test(n)) tags.push('fear');
  if (/dịu dàng|an ủi|ê thẹn|ngại|ngây thơ/.test(n)) tags.push('gentle');
  if (/mệt mỏi|chán|say xỉn|già - lão/.test(n)) tags.push('tired');
  if (/ngạc nhiên|sốc|mỉa mai/.test(n)) tags.push('happy', 'angry');
  if (tags.length === 0) tags.push('neutral');
  return tags;
}

/**
 * Vùng miền: hầu hết profile Vina không gắn Bắc/Trung/Nam.
 * Soft: chỉ lọc khi tên có từ khóa; không có → coi như match mọi area.
 */
export function matchesArea(name: string, area?: string): boolean {
  if (!area) return true;
  const n = norm(name);
  const hasNorth = /bắc|northern|hà nội|hn_/.test(n);
  const hasCentral = /miền trung|huế|đà nẵng|central/.test(n) && !/trung niên/.test(n);
  const hasSouth = /miền nam|sài gòn|southern|nam bộ/.test(n);
  const hasAnyRegion = hasNorth || hasCentral || hasSouth;
  if (!hasAnyRegion) return true; // không ghi vùng → giữ lại
  if (area === 'northern') return hasNorth;
  if (area === 'central') return hasCentral;
  if (area === 'southern') return hasSouth;
  return true;
}

export function filterCloneProfilesByFields<T extends { name: string; isUser?: boolean; source?: string }>(
  profiles: T[],
  filters: CloneFilterInput,
): T[] {
  const gender = filters.gender || 'male';
  const group = filters.group || 'story';
  const emotion = filters.emotion || 'neutral';
  const area = filters.area;

  const isUserProfile = (p: { name: string; isUser?: boolean; source?: string }) =>
    !!(
      p.isUser ||
      p.source === 'user_upload' ||
      p.source === 'user_scan' ||
      /^USER/i.test(p.name)
    );

  // USER clone luôn giữ (mẫu user upload) — không bị lọc tên catalog
  let list = profiles.filter((p) => {
    if (isUserProfile(p)) return true;
    const g = inferGenderFromName(p.name);
    if (g !== 'unknown' && g !== gender) return false;
    if (!matchesArea(p.name, area)) return false;
    return true;
  });

  // Phong cách
  const byGroup = list.filter((p) => inferGroupFromName(p.name).includes(group));
  if (byGroup.length > 0) list = byGroup;

  // Cảm xúc
  if (emotion && emotion !== 'neutral') {
    const byEmo = list.filter((p) => inferEmotionsFromName(p.name).includes(emotion));
    if (byEmo.length > 0) list = byEmo;
  } else {
    // neutral: ưu tiên profile generic (có neutral), vẫn giữ list nếu rỗng
    const generic = list.filter((p) => inferEmotionsFromName(p.name).includes('neutral'));
    if (generic.length > 0) list = generic;
  }

  // Fallback: nếu lọc quá chặt → nới chỉ còn gender
  if (list.length === 0) {
    list = profiles.filter((p) => {
      const g = inferGenderFromName(p.name);
      return g === 'unknown' || g === gender;
    });
  }
  if (list.length === 0) return profiles;

  return list;
}
