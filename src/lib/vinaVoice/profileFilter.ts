/**
 * Lọc catalog Clone Voice theo giới tính / phong cách / cảm xúc
 * (suy ra từ tên profile Vina — không có metadata riêng).
 * Vùng miền: không lọc (bỏ filter area) — hiển thị full catalog theo giới/style/emotion.
 */

export type CloneFilterInput = {
  gender?: 'male' | 'female' | string;
  /** @deprecated Không còn lọc theo vùng miền — giữ field để tương thích API cũ. */
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
 * Vùng miền: đã bỏ lọc — luôn match (giữ export để không vỡ import cũ).
 */
export function matchesArea(_name: string, _area?: string): boolean {
  return true;
}

export function filterCloneProfilesByFields<T extends { name: string; isUser?: boolean; source?: string }>(
  profiles: T[],
  filters: CloneFilterInput,
): T[] {
  const gender = filters.gender || 'male';
  const group = filters.group || 'story';
  const emotion = filters.emotion || 'neutral';

  const isUserProfile = (p: { name: string; isUser?: boolean; source?: string }) =>
    !!(
      p.isUser ||
      p.source === 'user_upload' ||
      p.source === 'user_scan' ||
      /^USER/i.test(p.name)
    );

  // USER clone luôn giữ (mẫu user upload) — không bị lọc tên catalog
  // Không lọc vùng miền (Bắc/Trung/Nam).
  let list = profiles.filter((p) => {
    if (isUserProfile(p)) return true;
    const g = inferGenderFromName(p.name);
    if (g !== 'unknown' && g !== gender) return false;
    return true;
  });

  // Phong cách — hard filter (không giữ list cũ khi 0 khớp)
  list = list.filter((p) => inferGroupFromName(p.name).includes(group));

  // Cảm xúc — lọc đúng filter, không nới dần che “không khớp”
  if (emotion && emotion !== 'neutral') {
    list = list.filter((p) => inferEmotionsFromName(p.name).includes(emotion));
  } else {
    const generic = list.filter((p) => inferEmotionsFromName(p.name).includes('neutral'));
    if (generic.length > 0) list = generic;
  }

  // IRON B10: không trả full profiles khi filter rỗng
  return list;
}

/** Nhãn UI cố định — chỉ render option khi catalog còn ≥1 giọng. */
export const CLONE_GENDER_OPTIONS = [
  { value: 'male', label: 'Nam' },
  { value: 'female', label: 'Nữ' },
] as const;

export const CLONE_GROUP_OPTIONS = [
  { value: 'story', label: 'Kể chuyện' },
  { value: 'news', label: 'Tin tức' },
  { value: 'audiobook', label: 'Sách nói' },
  { value: 'ads', label: 'Quảng cáo' },
  { value: 'dubbing', label: 'Lồng tiếng' },
  { value: 'review', label: 'Review' },
] as const;

export const CLONE_EMOTION_OPTIONS = [
  { value: 'neutral', label: 'Trung tính' },
  { value: 'happy', label: 'Vui' },
  { value: 'sad', label: 'Buồn' },
  { value: 'angry', label: 'Giận' },
  { value: 'fear', label: 'Sợ' },
  { value: 'gentle', label: 'Dịu dàng' },
  { value: 'tired', label: 'Mệt' },
] as const;

export type CloneFilterAvailability = {
  genders: Array<(typeof CLONE_GENDER_OPTIONS)[number]>;
  groups: Array<(typeof CLONE_GROUP_OPTIONS)[number]>;
  emotions: Array<(typeof CLONE_EMOTION_OPTIONS)[number]>;
  /** Gợi ý sửa khi tổ hợp hiện tại = 0 */
  suggested?: CloneFilterInput;
};

/**
 * Tùy chọn dropdown còn ít nhất 1 giọng (cascade: gender → group → emotion).
 * Ẩn option rỗng để user không chọn «Tin tức + Vui» = 0.
 */
export function listAvailableCloneFilterOptions<
  T extends { name: string; isUser?: boolean; source?: string },
>(
  profiles: T[],
  current: CloneFilterInput = {},
): CloneFilterAvailability {
  const gender = current.gender || 'male';
  const group = current.group || 'story';
  const emotion = current.emotion || 'neutral';

  const genders = CLONE_GENDER_OPTIONS.filter(
    (o) =>
      filterCloneProfilesByFields(profiles, {
        gender: o.value,
        group: 'story',
        emotion: 'neutral',
      }).length > 0 ||
      // gender may only match under other groups
      CLONE_GROUP_OPTIONS.some(
        (g) =>
          filterCloneProfilesByFields(profiles, {
            gender: o.value,
            group: g.value,
            emotion: 'neutral',
          }).length > 0,
      ),
  );

  const groups = CLONE_GROUP_OPTIONS.filter(
    (o) =>
      filterCloneProfilesByFields(profiles, {
        gender,
        group: o.value,
        emotion: 'neutral',
      }).length > 0 ||
      CLONE_EMOTION_OPTIONS.some(
        (e) =>
          filterCloneProfilesByFields(profiles, {
            gender,
            group: o.value,
            emotion: e.value,
          }).length > 0,
      ),
  );

  const emotions = CLONE_EMOTION_OPTIONS.filter(
    (o) =>
      filterCloneProfilesByFields(profiles, {
        gender,
        group,
        emotion: o.value,
      }).length > 0,
  );

  let suggested: CloneFilterInput | undefined;
  const currentHits = filterCloneProfilesByFields(profiles, {
    gender,
    group,
    emotion,
  });
  if (currentHits.length === 0 && profiles.length > 0) {
    // Prefer keep gender+group, reset emotion; then keep gender; then first non-empty combo
    const tryEmotion =
      emotions[0]?.value ||
      (filterCloneProfilesByFields(profiles, {
        gender,
        group,
        emotion: 'neutral',
      }).length > 0
        ? 'neutral'
        : undefined);
    if (
      tryEmotion &&
      filterCloneProfilesByFields(profiles, {
        gender,
        group,
        emotion: tryEmotion,
      }).length > 0
    ) {
      suggested = { gender, group, emotion: tryEmotion };
    } else {
      const g2 = groups[0]?.value || 'story';
      const e2 =
        CLONE_EMOTION_OPTIONS.find(
          (e) =>
            filterCloneProfilesByFields(profiles, {
              gender,
              group: g2,
              emotion: e.value,
            }).length > 0,
        )?.value || 'neutral';
      if (
        filterCloneProfilesByFields(profiles, {
          gender,
          group: g2,
          emotion: e2,
        }).length > 0
      ) {
        suggested = { gender, group: g2, emotion: e2 };
      } else {
        const gen = genders[0]?.value || 'male';
        const gr =
          CLONE_GROUP_OPTIONS.find(
            (g) =>
              filterCloneProfilesByFields(profiles, {
                gender: gen,
                group: g.value,
                emotion: 'neutral',
              }).length > 0,
          )?.value || 'story';
        suggested = { gender: gen, group: gr, emotion: 'neutral' };
      }
    }
  }

  return { genders, groups, emotions, suggested };
}

/**
 * Chuẩn hóa filter về tổ hợp còn giọng (khi option bị ẩn / catalog đổi).
 */
export function coerceCloneFilterToAvailable<
  T extends { name: string; isUser?: boolean; source?: string },
>(profiles: T[], current: CloneFilterInput): CloneFilterInput {
  const gender = current.gender || 'male';
  const group = current.group || 'story';
  const emotion = current.emotion || 'neutral';
  if (
    filterCloneProfilesByFields(profiles, { gender, group, emotion }).length > 0
  ) {
    return { gender, group, emotion };
  }
  const avail = listAvailableCloneFilterOptions(profiles, {
    gender,
    group,
    emotion,
  });
  return {
    gender: avail.suggested?.gender || gender,
    group: avail.suggested?.group || group,
    emotion: avail.suggested?.emotion || 'neutral',
  };
}
