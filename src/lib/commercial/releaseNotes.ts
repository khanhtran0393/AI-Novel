/**
 * Versioned release notes for "đã cập nhật so với bản cũ".
 * Source of truth for ship: resources/commercial/release-notes.json
 * (also mirrored here for web/dev when file missing).
 */

export type ReleaseNotesVersion = {
  date?: string;
  title?: string;
  items: string[];
};

export type ReleaseNotesDoc = {
  schema?: string;
  product?: string;
  versions: Record<string, ReleaseNotesVersion>;
};

/** Fallback when packaged JSON not loaded (dev / tests). Keep in sync with resources/commercial/release-notes.json */
export const BUNDLED_RELEASE_NOTES: ReleaseNotesDoc = {
  schema: 'ainovel.release-notes.v1',
  product: 'AI Novel',
  versions: {
    '1.0.4': {
      date: '2026-07-22',
      title: 'Update changelog + pack ship',
      items: [
        'Thông báo «Cập nhật thành công»: liệt kê mục đã đổi so với bản cũ (X → Y)',
        'Ghi chú phiên bản nhúng khi pack (resources/commercial/release-notes.json + stamp packedAt)',
        'LA Studio multi-family TTS chỉ Trial/Pro; Free = Edge TTS / Piper',
        'Nghe thử ▶ family tải on-demand: bake sample WAV trên máy user (userData)',
        'Tải family ghi userData (an toàn trên cài Program Files)',
        'Gate API /api/la-studio/* + generate-tts la_studio qua tts_premium',
      ],
    },
    '1.0.3': {
      date: '2026-07-22',
      title: 'LA Studio + TTS commercial',
      items: [
        'LA Studio multi-family TTS: Kokoro-VI ship + tải family on-demand (VieNeu, Vibe…)',
        'Nghe thử ▶ family mới: bake sample WAV trên máy user (userData) — list có là nghe được',
        'LA Studio chỉ gói Trial/Pro; Free dùng Edge TTS / Piper',
        'Tải family ghi vào userData (an toàn trên máy cài Program Files)',
        'Bootstrap engine LA Studio ẩn chỉ khi Trial/Pro',
      ],
    },
    '1.0.2': {
      date: '2026-06-01',
      title: 'Desktop update & commercial',
      items: [
        'Kênh cập nhật desktop (electron-updater + feed HTTPS)',
        'Free / Trial / Pro entitlement + license one-path',
        'Cải thiện TTS Edge/Piper và quota Free',
      ],
    },
    '1.0.1': {
      date: '2026-05-01',
      title: 'Ổn định workspace',
      items: [
        'Hydration store không kẹt màn nạp',
        'Setup genre bắt buộc cho write/gen prompt',
        'Ship pack / CapCut export ổn định hơn',
      ],
    },
    '1.0.0': {
      date: '2026-04-01',
      title: 'Bản phát hành đầu',
      items: [
        'Workspace viết truyện + Gen Prompt + Ảnh/Video/TTS',
        'Engine AI Novel native TypeScript',
        'Gói Free / Trial / Pro',
      ],
    },
  },
};

export type ChangelogBlock = {
  version: string;
  date?: string;
  title?: string;
  items: string[];
};

export type JustUpdatedPayload = {
  fromVersion: string;
  toVersion: string;
  blocks: ChangelogBlock[];
  /** Flat list for dialogs / toasts */
  items: string[];
  /** Optional raw notes from update feed */
  releaseNotes?: string | null;
};

/** Parse "1.0.3" → [1,0,3] */
export function parseSemverParts(v: string): number[] {
  const core = String(v || '')
    .trim()
    .replace(/^v/i, '')
    .split(/[-+]/)[0];
  return core
    .split('.')
    .map((p) => {
      const n = parseInt(p.replace(/\D/g, ''), 10);
      return Number.isFinite(n) ? n : 0;
    });
}

/** -1 if a<b, 0 equal, 1 if a>b */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemverParts(a);
  const pb = parseSemverParts(b);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/**
 * Collect changelog blocks for versions (from, to] — exclusive of from, inclusive of to.
 * Sorted oldest → newest for reading order.
 */
export function collectChangelogBetween(
  fromVersion: string,
  toVersion: string,
  doc: ReleaseNotesDoc = BUNDLED_RELEASE_NOTES,
): JustUpdatedPayload {
  const from = String(fromVersion || '').trim() || '0.0.0';
  const to = String(toVersion || '').trim();
  const versions = doc?.versions || {};
  const keys = Object.keys(versions).sort(compareSemver);
  const blocks: ChangelogBlock[] = [];
  for (const ver of keys) {
    // strictly after `from` and <= `to`
    if (compareSemver(ver, from) <= 0) continue;
    if (to && compareSemver(ver, to) > 0) continue;
    const row = versions[ver];
    const items = Array.isArray(row?.items)
      ? row.items.map((s) => String(s || '').trim()).filter(Boolean)
      : [];
    if (!items.length) continue;
    blocks.push({
      version: ver,
      date: row.date,
      title: row.title,
      items,
    });
  }
  const items = blocks.flatMap((b) =>
    b.items.map((line) => `[${b.version}] ${line}`),
  );
  return {
    fromVersion: from,
    toVersion: to || from,
    blocks,
    items,
  };
}

/** Normalize electron-updater releaseNotes (string | array) → bullet lines */
export function normalizeFeedReleaseNotes(
  notes: unknown,
): string[] {
  if (!notes) return [];
  if (typeof notes === 'string') {
    return notes
      .split(/\r?\n/)
      .map((l) => l.replace(/^[-*•]\s*/, '').trim())
      .filter((l) => l.length > 2);
  }
  if (Array.isArray(notes)) {
    const out: string[] = [];
    for (const n of notes) {
      if (typeof n === 'string') {
        out.push(...normalizeFeedReleaseNotes(n));
      } else if (n && typeof n === 'object' && 'note' in n) {
        out.push(...normalizeFeedReleaseNotes((n as { note?: string }).note));
      }
    }
    return out;
  }
  return [];
}
