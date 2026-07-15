/**
 * Genre packs — rules + visual DNA + default TTS DNA per niche.
 */

import type { ChannelOutputDna, ChannelTtsDna } from './channelModel';
import { defaultOutputDna, defaultTtsDna } from './channelModel';

export type GenrePackId =
  | 'mat_the'
  | 'trinh_tham'
  | 'horror_audio'
  | 'romance_dark'
  | 'xuyen_khong'
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
    id: 'mat_the',
    label: 'Mạt thế / Sinh tồn',
    description: 'Hoang phế, khuyết tật, pacing chậm đa giác quan.',
    niche: 'Mạt thế',
    forbidden_words:
      'đáng chú ý là, nhìn chung, có thể nói rằng, không thể phủ nhận, trong bối cảnh hiện nay, nói một cách dễ hiểu, tóm lại là, nói tóm lại',
    fatigue_words:
      'không khỏi, dường như, bất chợt, bỗng nhiên, ánh mắt sâu thẳm, trái tim thắt lại, không khí như đông đặc, trong tích tắc, lướt qua tâm trí, một cảm giác khó tả, ánh lên quyết tâm, nuốt nước bọt, siết chặt nắm đấm',
    visualDna:
      'post-apocalyptic survival, dusty ruined streets, tactile grit, overcast cold light, grounded realism, scars and hardship readable at medium shot',
    mediaStylePreset:
      'cinematic natural realism, grounded production design, expressive practical lighting, tactile materials, restrained color grade',
    outputDna: { imageAspectRatio: '16:9', videoAspectRatio: '16:9' },
    ttsDna: {
      platform: 'vina_voice',
      language: 'vi',
      speed: 0.97,
      pitch: 0,
      syncMode: 'pro',
    },
    defaultShipMode: 'longform',
  },
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
      platform: 'vina_voice',
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
      platform: 'vina_voice',
      language: 'vi',
      speed: 1,
      pitch: 0,
    },
    defaultShipMode: 'longform',
  },
];

export function getGenrePack(id: string | undefined | null): GenrePack | null {
  if (!id) return null;
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
