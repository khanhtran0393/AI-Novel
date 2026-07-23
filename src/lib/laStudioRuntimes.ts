/**
 * Multi-family LA Studio runtimes for AI Novel ship.
 *
 * Strategy:
 * - Default bundled: kokoro-vietnamese (~356MB) → offline TTS out of the box
 * - Other families: optional download into bin/la-studio-runtimes/<id>/
 * - OmniVoice family → platform omnivoice_local (same LA Studio tab; not Engine dropdown)
 * - Engine tab (separate env): Edge / Piper / CapCut / TikTok / Gemini only
 *
 * Catalog mirrors LA Studio ttsFamilies (subset with known portable packaging).
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

export type LaStudioRuntimeKind = 'kokoro-cli' | 'api-only' | 'external';

export type LaStudioSampleVoice = {
  id: string;
  name: string;
  gender?: 'male' | 'female' | 'neutral';
  /** Kokoro-VI voice used to bake audible demo WAV (honest reference sample) */
  demoKokoroVoice?: string;
};

export type LaStudioFamilyManifest = {
  id: string;
  title: string;
  subtitle: string;
  capabilities: Array<'tts' | 'voice-cloning' | 'voice-design'>;
  /** How AI Novel drives this family */
  kind: LaStudioRuntimeKind;
  /** Default ship with installer */
  shipDefault?: boolean;
  /** Relative under bin/la-studio-runtimes/ or legacy bin/la-studio-kokoro */
  portableDir?: string;
  /** Optional zip for first-run / prepare */
  zipUrl?: string;
  /** Approx size for UI */
  sizeHint?: string;
  languages?: string[];
  /**
   * Giọng mẫu luôn hiện sau khi tải family (kể cả khi zip chỉ có runtime DLL).
   * Nghe thử: file WAV mẫu bake sẵn; gen thật cần pack/API family.
   */
  sampleVoices?: LaStudioSampleVoice[];
};

/** Curated families we can wire or download — not entire LA Studio catalog (GB-scale). */
export const LA_STUDIO_FAMILY_MANIFEST: LaStudioFamilyManifest[] = [
  {
    id: 'kokoro-vietnamese',
    title: 'Kokoro Vietnamese',
    subtitle: 'ONNX native · preset voices · CPU',
    capabilities: ['tts'],
    kind: 'kokoro-cli',
    shipDefault: true,
    portableDir: 'la-studio-kokoro',
    zipUrl:
      'https://github.com/dduongtrandai/Kokoro-Vietnamese.cpp/releases/download/v0.1.0/kokoro-vietnamese-win-x86_64-cpu.zip',
    sizeHint: '~356 MB',
    languages: ['vi', 'en'],
    // Real pack voices — filled from voices.json at runtime; fallback samples:
    sampleVoices: [
      { id: 'diem_trinh', name: 'Diễm Trinh', gender: 'female', demoKokoroVoice: 'diem_trinh' },
      { id: 'ngoc_huyen', name: 'Ngọc Huyền', gender: 'female', demoKokoroVoice: 'ngoc_huyen' },
      { id: 'mai_linh', name: 'Mai Linh', gender: 'female', demoKokoroVoice: 'mai_linh' },
      { id: 'hung_thinh', name: 'Hưng Thịnh', gender: 'male', demoKokoroVoice: 'hung_thinh' },
      { id: 'manh_dung', name: 'Mạnh Dũng', gender: 'male', demoKokoroVoice: 'manh_dung' },
      { id: 'thanh_dat', name: 'Thành Đạt', gender: 'male', demoKokoroVoice: 'thanh_dat' },
    ],
  },
  {
    id: 'vieneu-tts-v3-turbo',
    title: 'VieNeu-TTS v3 Turbo',
    subtitle: 'VI–EN · clone · 48 kHz (cần tải runtime)',
    capabilities: ['tts', 'voice-cloning'],
    kind: 'api-only',
    portableDir: 'la-studio-runtimes/vieneu-tts-v3-turbo',
    sizeHint: 'lớn (GGUF + native)',
    languages: ['vi', 'en'],
    sampleVoices: [
      { id: 'vieneu_nu_mien_bac', name: 'VieNeu · Nữ miền Bắc (mẫu)', gender: 'female', demoKokoroVoice: 'ngoc_huyen' },
      { id: 'vieneu_nu_mien_nam', name: 'VieNeu · Nữ miền Nam (mẫu)', gender: 'female', demoKokoroVoice: 'mai_loan' },
      { id: 'vieneu_nam_mien_bac', name: 'VieNeu · Nam miền Bắc (mẫu)', gender: 'male', demoKokoroVoice: 'hung_thinh' },
      { id: 'vieneu_nam_mien_nam', name: 'VieNeu · Nam miền Nam (mẫu)', gender: 'male', demoKokoroVoice: 'manh_dung' },
      { id: 'vieneu_ke_chuyen', name: 'VieNeu · Kể chuyện (mẫu)', gender: 'neutral', demoKokoroVoice: 'storyvert' },
    ],
  },
  {
    id: 'omnivoice',
    title: 'OmniVoice (via LA Studio)',
    subtitle: 'Clone / design — platform omnivoice_local (tab LA Studio)',
    capabilities: ['tts', 'voice-cloning', 'voice-design'],
    kind: 'external',
    sizeHint: 'dùng SuperAudioTools / LA Studio',
    languages: ['vi', 'en', 'multi'],
    sampleVoices: [
      { id: 'alloy', name: 'Alloy (Omni mẫu)', gender: 'neutral', demoKokoroVoice: 'storyvert' },
      { id: 'nova', name: 'Nova (Omni mẫu)', gender: 'female', demoKokoroVoice: 'mai_linh' },
      { id: 'echo', name: 'Echo (Omni mẫu)', gender: 'male', demoKokoroVoice: 'thanh_dat' },
      { id: 'shimmer', name: 'Shimmer (Omni mẫu)', gender: 'female', demoKokoroVoice: 'my_yen' },
    ],
  },
  {
    id: 'vibevoice',
    title: 'VibeVoice Realtime',
    subtitle: 'Preset packs · CrispASR (cần tải)',
    capabilities: ['tts'],
    kind: 'api-only',
    portableDir: 'la-studio-runtimes/vibevoice',
    sizeHint: '~0.6–2 GB',
    sampleVoices: [
      { id: 'vibe_nu_am', name: 'Vibe · Nữ ấm (mẫu)', gender: 'female', demoKokoroVoice: 'diem_trinh' },
      { id: 'vibe_nu_tre', name: 'Vibe · Nữ trẻ (mẫu)', gender: 'female', demoKokoroVoice: 'my_yen' },
      { id: 'vibe_nam_truyen', name: 'Vibe · Nam truyện (mẫu)', gender: 'male', demoKokoroVoice: 'duc_an' },
      { id: 'vibe_nam_tin', name: 'Vibe · Nam tin tức (mẫu)', gender: 'male', demoKokoroVoice: 'phat_tai' },
      { id: 'vibe_ke_chuyen', name: 'Vibe · Kể chuyện (mẫu)', gender: 'neutral', demoKokoroVoice: 'storyvert' },
    ],
  },
  {
    id: 'voxcpm2',
    title: 'VoxCPM2',
    subtitle: '30 ngôn ngữ · design · clone (cần tải)',
    capabilities: ['tts', 'voice-cloning', 'voice-design'],
    kind: 'api-only',
    portableDir: 'la-studio-runtimes/voxcpm2',
    sizeHint: 'rất lớn (~2B)',
    sampleVoices: [
      { id: 'vox_vi_female', name: 'VoxCPM · VI Nữ (mẫu)', gender: 'female', demoKokoroVoice: 'thuc_trinh' },
      { id: 'vox_vi_male', name: 'VoxCPM · VI Nam (mẫu)', gender: 'male', demoKokoroVoice: 'tuan_ngoc' },
      { id: 'vox_en_female', name: 'VoxCPM · EN Nữ (mẫu)', gender: 'female', demoKokoroVoice: 'mai_linh' },
      { id: 'vox_en_male', name: 'VoxCPM · EN Nam (mẫu)', gender: 'male', demoKokoroVoice: 'hung_thinh' },
      { id: 'vox_design', name: 'VoxCPM · Design (mẫu)', gender: 'neutral', demoKokoroVoice: 'storyvert' },
    ],
  },
  {
    id: 'kokoro',
    title: 'Kokoro 82M (multilingual)',
    subtitle: 'Preset multilingual · CrispASR pack',
    capabilities: ['tts'],
    kind: 'api-only',
    portableDir: 'la-studio-runtimes/kokoro',
    sizeHint: 'trung bình',
    sampleVoices: [
      { id: 'k82_af', name: 'Kokoro82 · Nữ EN (mẫu)', gender: 'female', demoKokoroVoice: 'mai_loan' },
      { id: 'k82_am', name: 'Kokoro82 · Nam EN (mẫu)', gender: 'male', demoKokoroVoice: 'duc_duy' },
      { id: 'k82_vi_f', name: 'Kokoro82 · Nữ VI (mẫu)', gender: 'female', demoKokoroVoice: 'ngoc_huyen' },
      { id: 'k82_vi_m', name: 'Kokoro82 · Nam VI (mẫu)', gender: 'male', demoKokoroVoice: 'manh_dung' },
    ],
  },
];

/**
 * Writable root for on-demand family downloads (packaged resources/ is often read-only).
 * Prefers AI_NOVEL_USER_DATA (Electron userData).
 */
export function laStudioWritableRoot(): string {
  const userData = (
    process.env.AI_NOVEL_USER_DATA ||
    process.env.AINOVEL_USER_DATA ||
    ''
  ).trim();
  if (userData) return userData;
  return (process.env.AI_NOVEL_ROOT || process.cwd()).trim() || process.cwd();
}

function appRoots(): string[] {
  const roots: string[] = [];
  // User-downloaded families first (writable)
  const writable = laStudioWritableRoot();
  if (writable) roots.push(writable);
  const env = (process.env.AI_NOVEL_ROOT || '').trim();
  if (env) roots.push(env);
  try {
    const res = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    if (res) roots.push(res);
  } catch {
    /* ignore */
  }
  roots.push(process.cwd());
  return [...new Set(roots.filter(Boolean))];
}

export function getLaStudioFamily(id: string): LaStudioFamilyManifest | undefined {
  return LA_STUDIO_FAMILY_MANIFEST.find((f) => f.id === id);
}

/** Absolute path if portable pack present for family */
export function resolveFamilyPortableRoot(familyId: string): string | null {
  const fam = getLaStudioFamily(familyId);
  if (!fam) return null;
  for (const root of appRoots()) {
    // ship default alias
    if (familyId === 'kokoro-vietnamese') {
      const legacy = path.join(root, 'bin', 'la-studio-kokoro');
      if (
        fs.existsSync(path.join(legacy, 'bin', 'kokoro-vi-cli.exe')) &&
        fs.existsSync(path.join(legacy, 'models', 'kokoro_vi.onnx'))
      ) {
        return legacy;
      }
    }
    const rel = fam.portableDir || path.join('la-studio-runtimes', familyId);
    const p = path.join(root, 'bin', rel);
    // on-demand install marker
    if (fs.existsSync(path.join(p, '.ainovel-family-installed.json'))) {
      return p;
    }
    if (fam.kind === 'kokoro-cli') {
      if (
        fs.existsSync(path.join(p, 'bin', 'kokoro-vi-cli.exe')) &&
        fs.existsSync(path.join(p, 'models', 'kokoro_vi.onnx'))
      ) {
        return p;
      }
    } else if (fs.existsSync(p)) {
      try {
        if (fs.readdirSync(p).length > 0) return p;
      } catch {
        /* ignore */
      }
    }
  }
  // LA Studio user install
  if (familyId === 'kokoro-vietnamese') {
    const base = path.join(
      os.homedir(),
      '.lastudio',
      'extensions',
      'backends',
      'kokoro-vietnamese',
    );
    if (fs.existsSync(base)) {
      try {
        for (const ver of fs
          .readdirSync(base, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
          .sort()
          .reverse()) {
          const hit = path.join(base, ver);
          if (
            fs.existsSync(path.join(hit, 'bin', 'kokoro-vi-cli.exe')) &&
            fs.existsSync(path.join(hit, 'models', 'kokoro_vi.onnx'))
          ) {
            return hit;
          }
        }
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

export type LaStudioFamilyStatus = {
  id: string;
  title: string;
  subtitle: string;
  kind: LaStudioRuntimeKind;
  shipDefault?: boolean;
  sizeHint?: string;
  capabilities: LaStudioFamilyManifest['capabilities'];
  installed: boolean;
  ready: boolean;
  path: string | null;
  note: string;
};

export function listLaStudioFamilyStatuses(): LaStudioFamilyStatus[] {
  return LA_STUDIO_FAMILY_MANIFEST.map((f) => {
    const p = resolveFamilyPortableRoot(f.id);
    const installed = !!p;
    let ready = false;
    let note = '';
    const markerPath = p
      ? path.join(p, '.ainovel-family-installed.json')
      : '';
    const hasMarker = !!(markerPath && fs.existsSync(markerPath));

    if (f.kind === 'kokoro-cli') {
      ready = installed;
      note = ready
        ? 'Sẵn sàng offline (CLI).'
        : 'Chưa có pack — bấm family trong UI để download-on-demand.';
    } else if (f.kind === 'external') {
      ready = false;
      note =
        f.id === 'omnivoice'
          ? 'Bấm để bật OmniVoice trong tab LA Studio (không tải zip · không sang Engine).'
          : 'Cần engine ngoài.';
    } else {
      ready = hasMarker || installed;
      note = ready
        ? 'Pack đã tải on-demand. Gen: Kokoro dùng ngay; family khác qua API/Engine tương ứng.'
        : 'Chưa tải — bấm family để download-on-demand khi dùng.';
    }
    return {
      id: f.id,
      title: f.title,
      subtitle: f.subtitle,
      kind: f.kind,
      shipDefault: f.shipDefault,
      sizeHint: f.sizeHint,
      capabilities: f.capabilities,
      installed,
      ready,
      path: p,
      note,
    };
  });
}

/** Default family for new installs / UI */
export const LA_STUDIO_DEFAULT_FAMILY = 'kokoro-vietnamese';
