/**
 * Story chapter wire ↔ store adapters.
 * Store keeps Vietnamese snake fields for persistence compatibility.
 * Wire / modules / new APIs use English camelCase DTOs.
 */

export type StoreChapterStatus = 'empty' | 'writing' | 'ready';

/** Persist / Zustand shape */
export interface StoreChapter {
  so_chuong: number;
  tieu_de: string;
  dan_y: string;
  noi_dung: string;
  trang_thai: StoreChapterStatus;
}

/** Wire shape for modules / pure logic / new APIs */
export interface ChapterDTO {
  chapter: number;
  title: string;
  outline: string;
  content: string;
  status: StoreChapterStatus;
}

export interface ProjectTitleWire {
  /** Store: ten_tac_pham */
  projectTitle: string;
}

/** Store setup (VN snake nested) */
export interface StoreSetup {
  chu_de?: string;
  phong_cach?: string;
  mo_ta?: string;
  so_chuong?: number;
  so_tu_chuong?: number;
  ngon_ngu?: string;
  [key: string]: unknown;
}

export interface SetupDTO {
  theme: string;
  style: string;
  description: string;
  chapterCount: number;
  wordsPerChapter: number;
  language: string;
}

export interface CharacterDTO {
  name: string;
  gender?: string;
  appearance?: string;
  outfit?: string;
  habit?: string;
  raw?: Record<string, unknown>;
}

export function chapterToDto(c: StoreChapter): ChapterDTO {
  return {
    chapter: c.so_chuong,
    title: c.tieu_de || '',
    outline: c.dan_y || '',
    content: c.noi_dung || '',
    status: c.trang_thai,
  };
}

export function chapterFromDto(d: ChapterDTO): StoreChapter {
  return {
    so_chuong: d.chapter,
    tieu_de: d.title || '',
    dan_y: d.outline || '',
    noi_dung: d.content || '',
    trang_thai: d.status,
  };
}

export function chaptersToDto(list: StoreChapter[]): ChapterDTO[] {
  return (list || []).map(chapterToDto);
}

export function chaptersFromDto(list: ChapterDTO[]): StoreChapter[] {
  return (list || []).map(chapterFromDto);
}

export function projectTitleFromStore(ten_tac_pham: string): ProjectTitleWire {
  return { projectTitle: ten_tac_pham || '' };
}

export function projectTitleToStore(w: ProjectTitleWire): string {
  return w.projectTitle || '';
}

export function setupToDto(s: StoreSetup | null | undefined): SetupDTO {
  const x = s || {};
  return {
    theme: String(x.chu_de || ''),
    style: String(x.phong_cach || ''),
    description: String(x.mo_ta || ''),
    chapterCount: Number(x.so_chuong) || 0,
    wordsPerChapter: Number(x.so_tu_chuong) || 0,
    language: String(x.ngon_ngu || 'Tiếng Việt'),
  };
}

export function setupFromDto(d: SetupDTO): StoreSetup {
  return {
    chu_de: d.theme || '',
    phong_cach: d.style || '',
    mo_ta: d.description || '',
    so_chuong: d.chapterCount || 1,
    so_tu_chuong: d.wordsPerChapter || 4250,
    ngon_ngu: d.language || 'Tiếng Việt',
  };
}

/**
 * Store may keep characters as array or name→profile map.
 */
export function charactersToDto(nhan_vat: unknown): CharacterDTO[] {
  if (!nhan_vat) return [];
  if (Array.isArray(nhan_vat)) {
    return nhan_vat.map((c, i) => {
      if (typeof c === 'string') return { name: c };
      if (c && typeof c === 'object') {
        const o = c as Record<string, unknown>;
        return {
          name: String(o.ten || o.name || `char_${i}`),
          gender: o.gioi_tinh != null ? String(o.gioi_tinh) : undefined,
          appearance: o.ngoai_hinh != null ? String(o.ngoai_hinh) : undefined,
          outfit: o.trang_phuc != null ? String(o.trang_phuc) : undefined,
          habit: o.thoi_quen != null ? String(o.thoi_quen) : undefined,
          raw: o,
        };
      }
      return { name: `char_${i}` };
    });
  }
  if (typeof nhan_vat === 'object') {
    return Object.entries(nhan_vat as Record<string, unknown>).map(([name, prof]) => {
      const o = (prof && typeof prof === 'object' ? prof : {}) as Record<string, unknown>;
      return {
        name,
        gender: o.gioi_tinh != null ? String(o.gioi_tinh) : undefined,
        appearance: o.ngoai_hinh != null ? String(o.ngoai_hinh) : undefined,
        outfit: o.trang_phuc != null ? String(o.trang_phuc) : undefined,
        habit: o.thoi_quen != null ? String(o.thoi_quen) : undefined,
        raw: o,
      };
    });
  }
  return [];
}

/** Prefer map form for store compatibility with profile editors */
export function charactersFromDto(list: CharacterDTO[]): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const c of list || []) {
    const name = (c.name || '').trim();
    if (!name) continue;
    out[name] = {
      ...(c.raw || {}),
      gioi_tinh: c.gender ?? (c.raw as { gioi_tinh?: string })?.gioi_tinh,
      ngoai_hinh: c.appearance ?? (c.raw as { ngoai_hinh?: string })?.ngoai_hinh,
      trang_phuc: c.outfit ?? (c.raw as { trang_phuc?: string })?.trang_phuc,
      thoi_quen: c.habit ?? (c.raw as { thoi_quen?: string })?.thoi_quen,
    };
  }
  return out;
}
