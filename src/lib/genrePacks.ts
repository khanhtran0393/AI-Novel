/**
 * Genre packs — rules + visual DNA + default TTS DNA per niche.
 */

import type { ChannelOutputDna, ChannelTtsDna } from './channelModel';
import { defaultOutputDna, defaultTtsDna } from './channelModel';

export type GenrePackId =
  | 'trinh_tham'
  | 'horror_audio'
  | 'romance_dark'
  | 'xuyen_khong'
  | 'vo_hiep'
  | 'co_trang'
  | 'hai_huoc'
  | 'kinh_di'
  | 'ke_chuyen'
  | 'custom';

export type GenrePack = {
  id: GenrePackId;
  label: string;
  description: string;
  niche: string;
  forbidden_words: string;
  fatigue_words: string;
  visualDna: string;
  mediaStylePreset: string;
  outputDna: Partial<ChannelOutputDna>;
  ttsDna: Partial<ChannelTtsDna>;
  defaultShipMode: 'radio' | 'short' | 'longform';
};

export const GENRE_PACKS: GenrePack[] = [
  {
    id: 'trinh_tham',
    label: 'Trinh thám / Tâm lý',
    description: 'Manh mối, nhịp căng, ánh sáng noir.',
    niche: 'Trinh thám',
    forbidden_words:
      'đáng chú ý là, nhìn chung, tóm lại là, nói tóm lại, có thể nói rằng',
    fatigue_words:
      'bỗng nhiên, bất chợt, lạnh sống lưng, tim đập thình thịch, mồ hôi lạnh',
    visualDna:
      'neo-noir detective atmosphere, practical neon and sodium vapor, rain-slick streets, shallow depth, tension in eyes and hands',
    mediaStylePreset:
      'cinematic noir realism, high contrast practical light, wet surfaces, restrained palette',
    outputDna: { imageAspectRatio: '16:9', videoAspectRatio: '16:9' },
    ttsDna: {
      platform: 'edge_tts',
      voice: 'vi-VN-NamMinhNeural',
      language: 'vi',
      speed: 0.95,
      pitch: -1,
    },
    defaultShipMode: 'longform',
  },
  {
    id: 'horror_audio',
    label: 'Horror Audio / Radio drama',
    description: 'Ưu tiên TTS đa vai, ít visual bắt buộc.',
    niche: 'Horror audio',
    forbidden_words: 'nhìn chung, tóm lại là, nói tóm lại',
    fatigue_words:
      'rùng mình, lạnh gáy, tim đập thình thịch, bóng tối bao trùm, tiếng thở dài',
    visualDna:
      'foggy alley, limited practical light, film grain, intimate horror framing, negative space for dread',
    mediaStylePreset:
      'moody cinematic horror, low-key lighting, desaturated teal-orange restraint',
    outputDna: { imageAspectRatio: '16:9', videoAspectRatio: '16:9' },
    ttsDna: {
      // vina_voice removed — free-safe Edge default (LA Studio = Trial/Pro manual)
      platform: 'edge_tts',
      voice: 'vi-VN-NamMinhNeural',
      language: 'vi',
      speed: 0.92,
      pitch: -2,
      syncMode: 'pro',
    },
    defaultShipMode: 'radio',
  },
  {
    id: 'romance_dark',
    label: 'Romance tối / Melodrama',
    description: 'Cảm xúc, close-up, giọng ấm.',
    niche: 'Romance dark',
    forbidden_words: 'nhìn chung, tóm lại là, không thể phủ nhận',
    fatigue_words:
      'tim thắt lại, ánh mắt sâu thẳm, môi run run, nghẹn ngào, không khỏi',
    visualDna:
      'intimate dramatic portrait lighting, soft bloom, emotional faces, warm-cool split gel, elegant wardrobe detail',
    mediaStylePreset:
      'glossy cinematic drama, soft key light, shallow DOF, premium color grade',
    outputDna: { imageAspectRatio: '9:16', videoAspectRatio: '9:16' },
    ttsDna: {
      platform: 'edge_tts',
      voice: 'vi-VN-HoaiMyNeural',
      language: 'vi',
      speed: 0.96,
      pitch: 1,
    },
    defaultShipMode: 'short',
  },
  {
    id: 'xuyen_khong',
    label: 'Xuyên không / Dị giới',
    description: 'Thế giới mới, lore dày, visual fantasy grounded.',
    niche: 'Xuyên không',
    forbidden_words: 'đáng chú ý là, nhìn chung, tóm lại là',
    fatigue_words:
      'bỗng nhiên, trong tích tắc, ánh mắt sâu thẳm, không khỏi, dường như',
    visualDna:
      'grounded fantasy isekai, lived-in costumes, practical torchlight, wide establishing then character detail, no plastic CGI look',
    mediaStylePreset:
      'cinematic fantasy realism, tactile fabrics, volumetric light, epic yet intimate',
    outputDna: { imageAspectRatio: '16:9', videoAspectRatio: '16:9' },
    ttsDna: {
      platform: 'edge_tts',
      voice: 'vi-VN-HoaiMyNeural',
      language: 'vi',
      speed: 1,
      pitch: 0,
    },
    defaultShipMode: 'longform',
  },
  {
    id: 'vo_hiep',
    label: 'Võ hiệp & Giới giang hồ',
    description: 'Văn phong Hán Việt sắc sảo, đao kiếm khí chất, thoại uy lực.',
    niche: 'Võ hiệp',
    forbidden_words: 'nhìn chung, tóm lại là, đáng chú ý',
    fatigue_words: 'trong chớp mắt, ánh mắt lạnh lùng, khí thế ngút trời',
    visualDna:
      'wuxia martial arts atmosphere, flowing robes, mist-shrouded bamboo forest, sword gleam, epic cinematic lighting',
    mediaStylePreset: 'epic wuxia cinematic, rich ink wash colors, high contrast',
    outputDna: { imageAspectRatio: '16:9', videoAspectRatio: '16:9' },
    ttsDna: {
      platform: 'edge_tts',
      voice: 'vi-VN-NamMinhNeural',
      language: 'vi',
      speed: 0.96,
      pitch: -1,
    },
    defaultShipMode: 'longform',
  },
  {
    id: 'co_trang',
    label: 'Phim Cổ trang / Cung đấu',
    description: 'Đại điện tráng lệ, ngôn từ trang trọng, mưu lược trầm lắng.',
    niche: 'Cổ trang',
    forbidden_words: 'nói chung, tóm lại, hiện đại',
    fatigue_words: 'tim thắt lại, ánh mắt thâm sâu, cười lạnh',
    visualDna:
      'ancient palace interior, ornate royal silk, warm candlelight, dramatic shadows, noble presence',
    mediaStylePreset: 'imperial cinematic drama, gold and crimson tones, soft ambient glow',
    outputDna: { imageAspectRatio: '16:9', videoAspectRatio: '16:9' },
    ttsDna: {
      platform: 'edge_tts',
      voice: 'vi-VN-HoaiMyNeural',
      language: 'vi',
      speed: 0.95,
      pitch: 0,
    },
    defaultShipMode: 'longform',
  },
  {
    id: 'hai_huoc',
    label: 'Hài hước / Giải trí',
    description: 'Nhịp nhanh, thoại hóm hỉnh, tình huống hài dí dỏm.',
    niche: 'Giải trí',
    forbidden_words: 'tóm lại, nghiêm túc mà nói',
    fatigue_words: 'bất ngờ thay, cười vỡ bụng',
    visualDna:
      'vibrant bright lighting, expressive character faces, dynamic upbeat angles, punchy color palette',
    mediaStylePreset: 'vibrant commercial comedy, bright saturated colors, crisp focus',
    outputDna: { imageAspectRatio: '9:16', videoAspectRatio: '9:16' },
    ttsDna: {
      platform: 'edge_tts',
      voice: 'vi-VN-HoaiMyNeural',
      language: 'vi',
      speed: 1.05,
      pitch: 1,
    },
    defaultShipMode: 'short',
  },
  {
    id: 'kinh_di',
    label: 'Kinh dị & Căng thẳng',
    description: 'Bầu không khí u uất, giật gân, nhịp thở dồn dập.',
    niche: 'Kinh dị',
    forbidden_words: 'nhìn chung, tóm lại',
    fatigue_words: 'lạnh gáy, hoảng sợ, bóng tối bao trùm',
    visualDna:
      'chilling horror setting, flickering shadows, eerie moonlight, cold blue tones, unsettling composition',
    mediaStylePreset: 'dark cinematic thriller, desaturated cool tones, intense shadow contrast',
    outputDna: { imageAspectRatio: '16:9', videoAspectRatio: '16:9' },
    ttsDna: {
      platform: 'edge_tts',
      voice: 'vi-VN-NamMinhNeural',
      language: 'vi',
      speed: 0.90,
      pitch: -2,
    },
    defaultShipMode: 'longform',
  },
  {
    id: 'ke_chuyen',
    label: 'Người kể chuyện tự nhiên',
    description: 'Truyền cảm, nhịp thong thả, lối dẫn dắt mượt mà.',
    niche: 'Kể chuyện',
    forbidden_words: 'nói chung là, tóm lại',
    fatigue_words: 'thế nhưng, bỗng nhiên',
    visualDna:
      'warm cozy storytelling mood, soft golden hour lighting, intimate perspective, cinematic depth of field',
    mediaStylePreset: 'warm organic narrative, soft natural light, balanced tones',
    outputDna: { imageAspectRatio: '16:9', videoAspectRatio: '16:9' },
    ttsDna: {
      platform: 'edge_tts',
      voice: 'vi-VN-HoaiMyNeural',
      language: 'vi',
      speed: 0.98,
      pitch: 0,
    },
    defaultShipMode: 'longform',
  },
];

export function getGenrePack(id: string | undefined | null): GenrePack | null {
  if (!id) return null;
  // Legacy id `mat_the` removed — treat as unknown (no silent pack apply)
  if (id === 'mat_the') return null;
  return GENRE_PACKS.find((p) => p.id === id) || null;
}

export function applyGenrePackDefaults(pack: GenrePack): {
  userRules: { forbidden_words: string; fatigue_words: string };
  visualDna: string;
  mediaStylePreset: string;
  outputDna: ChannelOutputDna;
  ttsDna: ChannelTtsDna;
  niche: string;
  defaultShipMode: GenrePack['defaultShipMode'];
} {
  return {
    userRules: {
      forbidden_words: pack.forbidden_words,
      fatigue_words: pack.fatigue_words,
    },
    visualDna: pack.visualDna,
    mediaStylePreset: pack.mediaStylePreset,
    outputDna: defaultOutputDna({
      ...pack.outputDna,
      mediaStylePreset: pack.mediaStylePreset,
    }),
    ttsDna: defaultTtsDna(pack.ttsDna),
    niche: pack.niche,
    defaultShipMode: pack.defaultShipMode,
  };
}
