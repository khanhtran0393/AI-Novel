/**
 * CapCut TTS voice matrix — captured CapCut editor list (resource_id + voice_type).
 * Safe for client + server (static JSON import, no fs).
 */
import type { VoiceOption } from './voiceCatalog';
import capcutVoicesJson from './data/capcut_voices.json';

export type CapCutVoiceRow = {
  id: string;
  name: string;
  resource_id: string;
  lan: string;
  lang: string;
};

const ROWS: CapCutVoiceRow[] = Array.isArray(capcutVoicesJson)
  ? (capcutVoicesJson as CapCutVoiceRow[])
  : [];

export function loadCapCutVoices(): CapCutVoiceRow[] {
  return ROWS;
}

export function resolveCapCutVoice(voiceId: string): {
  voiceName: string;
  resourceId: string;
  platform: string;
  displayName: string;
} {
  const id = String(voiceId || '').trim();
  const hit = ROWS.find((r) => r.id === id);
  if (hit) {
    return {
      voiceName: hit.id,
      resourceId: hit.resource_id || hit.id,
      platform: 'sami',
      displayName: hit.name || hit.id,
    };
  }
  if (/^\d{10,}$/.test(id)) {
    return {
      voiceName: 'CapCut',
      resourceId: id,
      platform: 'sami',
      displayName: id,
    };
  }
  return {
    voiceName: id || 'BV074_streaming',
    resourceId: id || 'BV074_streaming',
    platform: 'sami',
    displayName: id || 'BV074_streaming',
  };
}

function guessGender(name: string, id: string): 'male' | 'female' | 'neutral' {
  const s = `${name} ${id}`.toLowerCase();
  if (
    /nam |male|boy|man|kenny|alex|felipe|robot|c3po|storm|rocket|chew|ghost|namminh|thanh niên|nam 1|nam 2|nam 3|nam 4|nam \(/i.test(
      s,
    )
  ) {
    return 'male';
  }
  if (
    /nữ|nu |female|girl|woman|gái|mai |sisi|kiwi|huong|hoai|jenny|aria|cô gái|nhỏ ngọt|giọng bé|phổ thông/i.test(
      s,
    )
  ) {
    return 'female';
  }
  if (/multi_male|en_us_00[6-9]|en_us_010|en_uk|en_au_002|bv075|bv560/.test(s)) {
    return 'male';
  }
  if (/multi_female|en_us_00[12]|en_au_001|bv074|bv421|bv562/.test(s)) {
    return 'female';
  }
  return 'neutral';
}

function lanToUi(lan: string): string {
  const l = (lan || 'en').toLowerCase();
  if (l === 'vi' || l.startsWith('vi')) return 'vi';
  if (l === 'jp' || l === 'ja') return 'ja';
  if (l === 'zh' || l.startsWith('zh')) return 'zh';
  if (l === 'br' || l === 'pt') return 'pt';
  if (['th', 'id', 'ko', 'fr', 'de', 'es', 'en'].includes(l)) return l;
  if (l.startsWith('en')) return 'en';
  return l.slice(0, 2) || 'en';
}

/** Full platform map for voiceCatalog.capcut_tts */
export function buildCapCutVoiceCatalog(): Record<string, VoiceOption[]> {
  const byLang: Record<string, VoiceOption[]> = {};
  const push = (lang: string, opt: VoiceOption) => {
    if (!byLang[lang]) byLang[lang] = [];
    if (byLang[lang].some((x) => x.id === opt.id)) return;
    byLang[lang].push(opt);
  };

  for (const r of ROWS) {
    push(lanToUi(r.lan), {
      id: r.id,
      name: r.name || r.id,
      gender: guessGender(r.name, r.id),
      locale: r.lang || undefined,
    });
  }

  // Merge jp → ja
  if (byLang.jp?.length) {
    for (const v of byLang.jp) push('ja', v);
    delete byLang.jp;
  }
  if (byLang.br?.length) {
    for (const v of byLang.br) push('pt', v);
    delete byLang.br;
  }

  if (!byLang.vi?.length) {
    byLang.vi = [
      { id: 'BV074_streaming', name: 'Cô Gái Hoạt Ngôn', gender: 'female' },
      { id: 'BV075_streaming', name: 'Thanh Niên Tự Tin', gender: 'male' },
      { id: 'BV421_vivn_streaming', name: 'Nhỏ Ngọt Ngào', gender: 'female' },
      { id: 'vi_female_huong', name: 'Giọng Phổ Thông', gender: 'female' },
      { id: 'BV562_streaming', name: 'Mai', gender: 'female' },
      { id: 'BV560_streaming', name: 'Alex Đại Đế', gender: 'male' },
    ];
  }

  return byLang;
}

export function listCapCutVoicesSummary(): {
  total: number;
  byLan: Record<string, number>;
  vi: Array<{ id: string; name: string; resource_id: string }>;
} {
  const byLan: Record<string, number> = {};
  for (const r of ROWS) {
    const k = lanToUi(r.lan);
    byLan[k] = (byLan[k] || 0) + 1;
  }
  return {
    total: ROWS.length,
    byLan,
    vi: ROWS.filter((r) => lanToUi(r.lan) === 'vi').map((r) => ({
      id: r.id,
      name: r.name,
      resource_id: r.resource_id,
    })),
  };
}
