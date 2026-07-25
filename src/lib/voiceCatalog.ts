/**
 * Catalog giọng TTS dùng chung toàn app (TTSConfigModal, Sidebar NV, multi-voice, AutoRender…).
 * Nguồn tĩnh — runtime merge động (Piper/OmniVoice/Vina) qua voiceCatalogPrep + /api/tts/voices.
 */
import { buildCapCutVoiceCatalog } from './capcutVoices';

export type VoiceGender = 'male' | 'female' | 'neutral';

export type VoiceOption = {
  id: string;
  name: string;
  previewUrl?: string;
  gender?: VoiceGender;
  /** Locale hint, e.g. vi-VN, en-US */
  locale?: string;
};

/** platform → language code → voices */
export type VoiceCatalog = Record<string, Record<string, VoiceOption[]>>;

export type VoicePlatformId =
  | 'edge_tts'
  | 'openai_tts'
  | 'gemini_tts'
  | 'tiktok_tts'
  | 'capcut_tts'
  | 'hotai_tts'
  | 'piper'
  | 'vieneu_tts'
  | 'omnivoice_local'
  | 'vina_voice'
  | 'la_studio'
  | 'vbee'
  | 'google'
  | 'elevenlabs';

export const TTS_LANGUAGES = [
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'en', label: 'Tiếng Anh (English)' },
  { code: 'fr', label: 'Tiếng Pháp (French)' },
  { code: 'de', label: 'Tiếng Đức (German)' },
  { code: 'es', label: 'Tiếng Tây Ban Nha (Spanish)' },
  { code: 'pt', label: 'Tiếng Bồ Đào Nha (Portuguese)' },
  { code: 'id', label: 'Tiếng Indonesia (Indonesian)' },
  { code: 'ja', label: 'Tiếng Nhật (Japanese)' },
  { code: 'zh', label: 'Tiếng Trung (Chinese)' },
  { code: 'ko', label: 'Tiếng Hàn (Korean)' },
  { code: 'th', label: 'Tiếng Thái (Thai)' },
  { code: 'ru', label: 'Tiếng Nga (Russian)' },
  { code: 'it', label: 'Tiếng Ý (Italian)' },
  { code: 'ar', label: 'Tiếng Ả Rập (Arabic)' },
  { code: 'hi', label: 'Tiếng Hindi' },
] as const;

const v = (
  id: string,
  name: string,
  gender?: VoiceGender,
  locale?: string,
): VoiceOption => ({ id, name, gender, locale });

// ─── OpenAI ───────────────────────────────────────────────
export const OPENAI_VOICE_OPTIONS: VoiceOption[] = [
  v('alloy', 'Alloy (trung tính)', 'neutral'),
  v('ash', 'Ash (nam rõ)', 'male'),
  v('ballad', 'Ballad (kể chuyện)', 'neutral'),
  v('coral', 'Coral (nữ ấm)', 'female'),
  v('echo', 'Echo (nam)', 'male'),
  v('fable', 'Fable (kể chuyện)', 'neutral'),
  v('nova', 'Nova (nữ sáng)', 'female'),
  v('onyx', 'Onyx (nam trầm)', 'male'),
  v('sage', 'Sage (trung tính êm)', 'neutral'),
  v('shimmer', 'Shimmer (nữ mềm)', 'female'),
  v('verse', 'Verse (biểu cảm)', 'neutral'),
  v('marin', 'Marin', 'female'),
  v('cedar', 'Cedar', 'male'),
];

// ─── Gemini prebuilt (full set) ───────────────────────────
export const GEMINI_VOICE_OPTIONS: VoiceOption[] = [
  v('Zephyr', 'Zephyr (Bright)', 'female'),
  v('Puck', 'Puck (Upbeat)', 'male'),
  v('Charon', 'Charon (Informative)', 'male'),
  v('Kore', 'Kore (Firm)', 'female'),
  v('Fenrir', 'Fenrir (Excitable)', 'male'),
  v('Leda', 'Leda (Youthful)', 'female'),
  v('Orus', 'Orus (Firm)', 'male'),
  v('Aoede', 'Aoede (Breezy)', 'female'),
  v('Callirrhoe', 'Callirrhoe (Easy-going)', 'female'),
  v('Autonoe', 'Autonoe (Bright)', 'female'),
  v('Enceladus', 'Enceladus (Breathy)', 'male'),
  v('Iapetus', 'Iapetus (Clear)', 'male'),
  v('Umbriel', 'Umbriel (Easy-going)', 'male'),
  v('Algieba', 'Algieba (Smooth)', 'male'),
  v('Despina', 'Despina (Smooth)', 'female'),
  v('Erinome', 'Erinome (Clear)', 'female'),
  v('Algenib', 'Algenib (Gravelly)', 'male'),
  v('Rasalgethi', 'Rasalgethi (Informative)', 'male'),
  v('Laomedeia', 'Laomedeia (Upbeat)', 'female'),
  v('Achernar', 'Achernar (Soft)', 'female'),
  v('Alnilam', 'Alnilam (Firm)', 'male'),
  v('Schedar', 'Schedar (Even)', 'male'),
  v('Gacrux', 'Gacrux (Mature)', 'female'),
  v('Pulcherrima', 'Pulcherrima (Forward)', 'female'),
  v('Achird', 'Achird (Friendly)', 'male'),
  v('Zubenelgenubi', 'Zubenelgenubi (Casual)', 'male'),
  v('Vindemiatrix', 'Vindemiatrix (Gentle)', 'female'),
  v('Sadachbia', 'Sadachbia (Lively)', 'male'),
  v('Sadaltager', 'Sadaltager (Knowledgeable)', 'male'),
  v('Sulafat', 'Sulafat (Warm)', 'female'),
];

// ─── TikTok / CapCut shared VN + multi ────────────────────
const TIKTOK_VI: VoiceOption[] = [
  v('BV074_streaming', 'Cô Gái Hoạt Ngôn', 'female'),
  v('BV075_streaming', 'Thanh Niên Tự Tin', 'male'),
  v('BV421_vivn_streaming', 'Nhỏ Ngọt Ngào', 'female'),
  v('vi_female_huong', 'Giọng Phổ Thông', 'female'),
  v('BV074_streaming_dsp', 'Giọng Bé', 'female'),
  v('BV075_streaming_vibrato_dsp', 'Việt Mèo', 'male'),
  v('BV562_streaming', 'Mai', 'female'),
];

const TIKTOK_EN: VoiceOption[] = [
  v('en_us_001', 'Nữ 1 (US)', 'female'),
  v('en_us_002', 'Nữ 2 (US)', 'female'),
  v('en_us_006', 'Nam 1 (US)', 'male'),
  v('en_us_007', 'Nam 2 (US)', 'male'),
  v('en_us_009', 'Nam 3 (US)', 'male'),
  v('en_us_010', 'Nam 4 (US)', 'male'),
  v('en_uk_001', 'Nam 1 (UK)', 'male'),
  v('en_uk_003', 'Nam 2 (UK)', 'male'),
  v('en_au_001', 'Nữ 1 (AU)', 'female'),
  v('en_au_002', 'Nam 1 (AU)', 'male'),
  v('en_us_ghostface', '👻 Ghostface (Scream)', 'male'),
  v('en_us_chewbacca', '🦁 Chewbacca', 'male'),
  v('en_us_c3po', '🤖 C-3PO', 'male'),
  v('en_us_stitch', '👽 Stitch', 'male'),
  v('en_us_stormtrooper', '🔫 Stormtrooper', 'male'),
  v('en_us_rocket', '🦝 Rocket', 'male'),
];

const TIKTOK_OTHER: Record<string, VoiceOption[]> = {
  fr: [v('fr_001', 'Nam 1 (Pháp)', 'male'), v('fr_002', 'Nam 2 (Pháp)', 'male')],
  de: [v('de_001', 'Nữ (Đức)', 'female'), v('de_002', 'Nam (Đức)', 'male')],
  es: [v('es_002', 'Nam (TBN)', 'male'), v('es_mx_002', 'Nam (Mexico)', 'male')],
  pt: [
    v('br_001', 'Nữ 1 (BR)', 'female'),
    v('br_003', 'Nữ 2 (BR)', 'female'),
    v('br_004', 'Nữ 3 (BR)', 'female'),
    v('br_005', 'Nam (BR)', 'male'),
  ],
  id: [v('id_001', 'Nữ (Indonesia)', 'female')],
  ja: [
    v('jp_001', 'Nữ 1 (Nhật)', 'female'),
    v('jp_003', 'Nữ 2 (Nhật)', 'female'),
    v('jp_005', 'Nữ 3 (Nhật)', 'female'),
    v('jp_006', 'Nam (Nhật)', 'male'),
  ],
  ko: [
    v('kr_002', 'Nam 1 (Hàn)', 'male'),
    v('kr_003', 'Nữ (Hàn)', 'female'),
    v('kr_004', 'Nam 2 (Hàn)', 'male'),
  ],
};

// ─── Edge TTS (Neural — multilingual, production-known set) ─
const EDGE_VI: VoiceOption[] = [
  v('vi-VN-HoaiMyNeural', 'Hoài My (Nữ)', 'female', 'vi-VN'),
  v('vi-VN-NamMinhNeural', 'Nam Minh (Nam)', 'male', 'vi-VN'),
];

const EDGE_EN: VoiceOption[] = [
  // US
  v('en-US-AriaNeural', 'Aria (Nữ US)', 'female', 'en-US'),
  v('en-US-JennyNeural', 'Jenny (Nữ US)', 'female', 'en-US'),
  // JennyMultilingualNeural — Edge thường fail "unknown"; dùng JennyNeural thay
  v('en-US-MichelleNeural', 'Michelle (Nữ US)', 'female', 'en-US'),
  v('en-US-AnaNeural', 'Ana (Nữ trẻ US)', 'female', 'en-US'),
  v('en-US-EmmaNeural', 'Emma (Nữ US)', 'female', 'en-US'),
  v('en-US-EmmaMultilingualNeural', 'Emma Multilingual (Nữ)', 'female', 'en-US'),
  v('en-US-AvaNeural', 'Ava (Nữ US)', 'female', 'en-US'),
  v('en-US-AvaMultilingualNeural', 'Ava Multilingual (Nữ)', 'female', 'en-US'),
  v('en-US-GuyNeural', 'Guy (Nam US)', 'male', 'en-US'),
  v('en-US-BrianNeural', 'Brian (Nam US)', 'male', 'en-US'),
  v('en-US-BrianMultilingualNeural', 'Brian Multilingual (Nam)', 'male', 'en-US'),
  v('en-US-AndrewNeural', 'Andrew (Nam US)', 'male', 'en-US'),
  v('en-US-AndrewMultilingualNeural', 'Andrew Multilingual (Nam)', 'male', 'en-US'),
  v('en-US-ChristopherNeural', 'Christopher (Nam US)', 'male', 'en-US'),
  v('en-US-EricNeural', 'Eric (Nam US)', 'male', 'en-US'),
  v('en-US-RogerNeural', 'Roger (Nam US)', 'male', 'en-US'),
  v('en-US-SteffanNeural', 'Steffan (Nam US)', 'male', 'en-US'),
  // AIGenerate* often returns Edge "unknown" — removed from catalog
  // UK
  v('en-GB-SoniaNeural', 'Sonia (Nữ UK)', 'female', 'en-GB'),
  v('en-GB-LibbyNeural', 'Libby (Nữ UK)', 'female', 'en-GB'),
  v('en-GB-MaisieNeural', 'Maisie (Nữ UK)', 'female', 'en-GB'),
  v('en-GB-RyanNeural', 'Ryan (Nam UK)', 'male', 'en-GB'),
  v('en-GB-ThomasNeural', 'Thomas (Nam UK)', 'male', 'en-GB'),
  // AU / CA / IE / NZ / IN / SG / PH / ZA / HK
  v('en-AU-NatashaNeural', 'Natasha (Nữ AU)', 'female', 'en-AU'),
  v('en-CA-ClaraNeural', 'Clara (Nữ CA)', 'female', 'en-CA'),
  v('en-CA-LiamNeural', 'Liam (Nam CA)', 'male', 'en-CA'),
  v('en-IE-ConnorNeural', 'Connor (Nam IE)', 'male', 'en-IE'),
  v('en-IE-EmilyNeural', 'Emily (Nữ IE)', 'female', 'en-IE'),
  v('en-NZ-MitchellNeural', 'Mitchell (Nam NZ)', 'male', 'en-NZ'),
  v('en-NZ-MollyNeural', 'Molly (Nữ NZ)', 'female', 'en-NZ'),
  v('en-IN-NeerjaNeural', 'Neerja (Nữ IN)', 'female', 'en-IN'),
  v('en-IN-NeerjaExpressiveNeural', 'Neerja Expressive (Nữ IN)', 'female', 'en-IN'),
  v('en-IN-PrabhatNeural', 'Prabhat (Nam IN)', 'male', 'en-IN'),
  v('en-SG-LunaNeural', 'Luna (Nữ SG)', 'female', 'en-SG'),
  v('en-SG-WayneNeural', 'Wayne (Nam SG)', 'male', 'en-SG'),
  v('en-PH-RosaNeural', 'Rosa (Nữ PH)', 'female', 'en-PH'),
  v('en-PH-JamesNeural', 'James (Nam PH)', 'male', 'en-PH'),
  v('en-ZA-LeahNeural', 'Leah (Nữ ZA)', 'female', 'en-ZA'),
  v('en-ZA-LukeNeural', 'Luke (Nam ZA)', 'male', 'en-ZA'),
  v('en-HK-YanNeural', 'Yan (Nữ HK)', 'female', 'en-HK'),
  v('en-HK-SamNeural', 'Sam (Nam HK)', 'male', 'en-HK')
];

const EDGE_ZH: VoiceOption[] = [
  v('zh-CN-XiaoxiaoNeural', 'Xiaoxiao (Nữ CN)', 'female', 'zh-CN'),
  v('zh-CN-XiaoyiNeural', 'Xiaoyi (Nữ CN)', 'female', 'zh-CN'),
  v('zh-CN-YunxiNeural', 'Yunxi (Nam CN)', 'male', 'zh-CN'),
  v('zh-CN-YunjianNeural', 'Yunjian (Nam CN)', 'male', 'zh-CN'),
  v('zh-CN-YunyangNeural', 'Yunyang (Nam tin tức)', 'male', 'zh-CN'),
  v('zh-CN-YunxiaNeural', 'Yunxia (Nam trẻ CN)', 'male', 'zh-CN'),
  v('zh-CN-liaoning-XiaobeiNeural', 'Xiaobei (Nữ Liêu Ninh)', 'female', 'zh-CN'),
  v('zh-CN-shaanxi-XiaoniNeural', 'Xiaoni (Nữ Thiểm Tây)', 'female', 'zh-CN'),
  v('zh-TW-HsiaoChenNeural', 'HsiaoChen (Nữ TW)', 'female', 'zh-TW'),
  v('zh-TW-HsiaoYuNeural', 'HsiaoYu (Nữ TW)', 'female', 'zh-TW'),
  v('zh-TW-YunJheNeural', 'YunJhe (Nam TW)', 'male', 'zh-TW'),
  v('zh-HK-HiuMaanNeural', 'HiuMaan (Nữ HK)', 'female', 'zh-HK'),
  v('zh-HK-HiuGaaiNeural', 'HiuGaai (Nữ HK)', 'female', 'zh-HK'),
  v('zh-HK-WanLungNeural', 'WanLung (Nam HK)', 'male', 'zh-HK')
];

const EDGE_JA: VoiceOption[] = [
  v('ja-JP-NanamiNeural', 'Nanami (Nữ)', 'female', 'ja-JP'),
  v('ja-JP-KeitaNeural', 'Keita (Nam)', 'male', 'ja-JP')
];

const EDGE_KO: VoiceOption[] = [
  v('ko-KR-SunHiNeural', 'SunHi (Nữ)', 'female', 'ko-KR'),
  v('ko-KR-InJoonNeural', 'InJoon (Nam)', 'male', 'ko-KR')
];

const EDGE_FR: VoiceOption[] = [
  v('fr-FR-DeniseNeural', 'Denise (Nữ FR)', 'female', 'fr-FR'),
  v('fr-FR-EloiseNeural', 'Eloise (Nữ FR)', 'female', 'fr-FR'),
  v('fr-FR-HenriNeural', 'Henri (Nam FR)', 'male', 'fr-FR'),
  v('fr-FR-RemyMultilingualNeural', 'Remy Multilingual (Nam)', 'male', 'fr-FR'),
  v('fr-FR-VivienneMultilingualNeural', 'Vivienne Multilingual (Nữ)', 'female', 'fr-FR'),
  v('fr-CA-SylvieNeural', 'Sylvie (Nữ CA)', 'female', 'fr-CA'),
  v('fr-CA-JeanNeural', 'Jean (Nam CA)', 'male', 'fr-CA'),
  v('fr-CA-AntoineNeural', 'Antoine (Nam CA)', 'male', 'fr-CA'),
  v('fr-CA-ThierryNeural', 'Thierry (Nam CA)', 'male', 'fr-CA'),
  v('fr-BE-CharlineNeural', 'Charline (Nữ BE)', 'female', 'fr-BE'),
  v('fr-BE-GerardNeural', 'Gerard (Nam BE)', 'male', 'fr-BE'),
  v('fr-CH-ArianeNeural', 'Ariane (Nữ CH)', 'female', 'fr-CH'),
  v('fr-CH-FabriceNeural', 'Fabrice (Nam CH)', 'male', 'fr-CH')
];

const EDGE_DE: VoiceOption[] = [
  v('de-DE-KatjaNeural', 'Katja (Nữ DE)', 'female', 'de-DE'),
  v('de-DE-ConradNeural', 'Conrad (Nam DE)', 'male', 'de-DE'),
  v('de-DE-AmalaNeural', 'Amala (Nữ DE)', 'female', 'de-DE'),
  v('de-DE-KillianNeural', 'Killian (Nam DE)', 'male', 'de-DE'),
  v('de-DE-SeraphinaMultilingualNeural', 'Seraphina Multilingual (Nữ)', 'female', 'de-DE'),
  v('de-DE-FlorianMultilingualNeural', 'Florian Multilingual (Nam)', 'male', 'de-DE'),
  v('de-AT-IngridNeural', 'Ingrid (Nữ AT)', 'female', 'de-AT'),
  v('de-AT-JonasNeural', 'Jonas (Nam AT)', 'male', 'de-AT'),
  v('de-CH-JanNeural', 'Jan (Nam CH)', 'male', 'de-CH'),
  v('de-CH-LeniNeural', 'Leni (Nữ CH)', 'female', 'de-CH')
];

const EDGE_ES: VoiceOption[] = [
  v('es-ES-ElviraNeural', 'Elvira (Nữ ES)', 'female', 'es-ES'),
  v('es-ES-AlvaroNeural', 'Alvaro (Nam ES)', 'male', 'es-ES'),
  v('es-ES-XimenaNeural', 'Ximena (Nữ ES)', 'female', 'es-ES'),
  v('es-MX-DaliaNeural', 'Dalia (Nữ MX)', 'female', 'es-MX'),
  v('es-MX-JorgeNeural', 'Jorge (Nam MX)', 'male', 'es-MX'),
  v('es-AR-ElenaNeural', 'Elena (Nữ AR)', 'female', 'es-AR'),
  v('es-AR-TomasNeural', 'Tomas (Nam AR)', 'male', 'es-AR'),
  v('es-CO-SalomeNeural', 'Salome (Nữ CO)', 'female', 'es-CO'),
  v('es-CO-GonzaloNeural', 'Gonzalo (Nam CO)', 'male', 'es-CO'),
  v('es-US-PalomaNeural', 'Paloma (Nữ US-ES)', 'female', 'es-US'),
  v('es-US-AlonsoNeural', 'Alonso (Nam US-ES)', 'male', 'es-US')
];

const EDGE_PT: VoiceOption[] = [
  v('pt-BR-FranciscaNeural', 'Francisca (Nữ BR)', 'female', 'pt-BR'),
  v('pt-BR-AntonioNeural', 'Antonio (Nam BR)', 'male', 'pt-BR'),
  v('pt-PT-RaquelNeural', 'Raquel (Nữ PT)', 'female', 'pt-PT'),
  v('pt-PT-DuarteNeural', 'Duarte (Nam PT)', 'male', 'pt-PT')
];

const EDGE_ID: VoiceOption[] = [
  v('id-ID-GadisNeural', 'Gadis (Nữ)', 'female', 'id-ID'),
  v('id-ID-ArdiNeural', 'Ardi (Nam)', 'male', 'id-ID')
];

const EDGE_TH: VoiceOption[] = [
  v('th-TH-PremwadeeNeural', 'Premwadee (Nữ)', 'female', 'th-TH'),
  v('th-TH-NiwatNeural', 'Niwat (Nam)', 'male', 'th-TH')
];

const EDGE_RU: VoiceOption[] = [
  v('ru-RU-SvetlanaNeural', 'Svetlana (Nữ)', 'female', 'ru-RU'),
  // Dmitry: MS list still has it but Edge WS often timeout in this region — removed after live probe fail
];

const EDGE_IT: VoiceOption[] = [
  v('it-IT-ElsaNeural', 'Elsa (Nữ)', 'female', 'it-IT'),
  v('it-IT-IsabellaNeural', 'Isabella (Nữ)', 'female', 'it-IT'),
  v('it-IT-DiegoNeural', 'Diego (Nam)', 'male', 'it-IT'),
  v('it-IT-GiuseppeMultilingualNeural', 'Giuseppe Multilingual (Nam)', 'male', 'it-IT')
];

const EDGE_AR: VoiceOption[] = [
  v('ar-SA-ZariyahNeural', 'Zariyah (Nữ SA)', 'female', 'ar-SA'),
  v('ar-SA-HamedNeural', 'Hamed (Nam SA)', 'male', 'ar-SA'),
  v('ar-EG-SalmaNeural', 'Salma (Nữ EG)', 'female', 'ar-EG'),
  v('ar-EG-ShakirNeural', 'Shakir (Nam EG)', 'male', 'ar-EG'),
  v('ar-AE-FatimaNeural', 'Fatima (Nữ AE)', 'female', 'ar-AE'),
  v('ar-AE-HamdanNeural', 'Hamdan (Nam AE)', 'male', 'ar-AE')
];

const EDGE_HI: VoiceOption[] = [
  v('hi-IN-SwaraNeural', 'Swara (Nữ)', 'female', 'hi-IN'),
  v('hi-IN-MadhurNeural', 'Madhur (Nam)', 'male', 'hi-IN')
];

// ─── HotAI / VieNeu / Piper / Vbee / Google / Eleven ──────
const HOTAI_VI: VoiceOption[] = [
  v('chau_tinh_tri', 'Châu Tinh Trì', 'male'),
  v('nguyen_ngoc_ngan', 'Nguyễn Ngọc Ngạn', 'male'),
  v('tao_thao', 'Tào Tháo', 'male'),
  v('nui_yen_tu', 'Núi Yên Tử', 'male'),
  v('doraemon', 'Doraemon', 'male'),
  v('tvb', 'TVB Lồng Tiếng', 'male'),
];

/**
 * VieNeu route local → Piper ONNX trong bin/piper_vn.
 * Chỉ liệt kê model có file thật (probe disk lúc runtime merge thêm).
 * Alias cũ (Adam 1…) được map trong generate-tts → manhdung/ngochuyen.
 */
const VIENEU_VI: VoiceOption[] = [
  v('manhdung.onnx', 'Mạnh Dũng (Nam — Piper local)', 'male'),
  v('ngochuyen.onnx', 'Ngọc Huyền (Nữ — Piper local)', 'female'),
  // Friendly aliases (resolve to onnx at generate time)
  v('Mạnh Dũng', 'Mạnh Dũng', 'male'),
  v('Ngọc Huyền', 'Ngọc Huyền (Truyện Audio)', 'female'),
];

/**
 * Piper list is disk-only at runtime (`/api/tts/voices` → listPiperVoiceOptions).
 * Empty static = cấm hiện giọng ảo khi gói thiếu model (preview fail «(trống)»).
 * Disk may include: manhdung, ngochuyen, rhasspy vi_VN (25h/vais/vivos multi).
 */
const PIPER_VI_STATIC: VoiceOption[] = [];

/** VBee list — legacy catalog only (platform hard-fail; IRON B10) */
const VBEE_VI: VoiceOption[] = [
  v('hn_ngo_ngochuyen_24g_v2', '👑 Ngọc Huyền (legacy)', 'female'),
  v('hn_male_manhdung_news_48k-v2', '👑 Mạnh Dũng (legacy)', 'male'),
  v('VBEE_MaiPhuong', '👑 Mai Phương (legacy)', 'female'),
  v('VBEE_ThaoTrinh', '👑 Thảo Trinh (legacy)', 'female'),
  v('VBEE_MinhHoang', '👑 Minh Hoàng (legacy)', 'male'),
];

/** Google Cloud voice IDs — bắt buộc API key (IRON B10) */
const GOOGLE_VI: VoiceOption[] = [
  v('vi-VN-Standard-A', 'Google Nữ Chuẩn (A)', 'female'),
  v('vi-VN-Standard-B', 'Google Nam Chuẩn (B)', 'male'),
  v('vi-VN-Standard-C', 'Google Nữ Chuẩn (C)', 'female'),
  v('vi-VN-Standard-D', 'Google Nam Chuẩn (D)', 'male'),
  v('vi-VN-Neural2-A', 'Google Nữ Neural2 (A)', 'female'),
  v('vi-VN-Neural2-D', 'Google Nam Neural2 (D)', 'male'),
  v('vi-VN-Wavenet-A', 'Google Nữ Wavenet (A)', 'female'),
  v('vi-VN-Wavenet-B', 'Google Nam Wavenet (B)', 'male'),
  v('vi-VN-Wavenet-C', 'Google Nữ Wavenet (C)', 'female'),
  v('vi-VN-Wavenet-D', 'Google Nam Wavenet (D)', 'male'),
];

const ELEVEN_EN: VoiceOption[] = [
  v('EXAVITQu4vr4xnSDxMaL', '👑 Bella', 'female'),
  v('ErXwobaYiN019PkySvjV', '👑 Antoni', 'male'),
  v('21m00Tcm4TlvDq8ikWAM', '👑 Rachel', 'female'),
  v('AZnzlk1XvdvUeBnXmlld', '👑 Domi', 'female'),
  v('VR6AewLTigWG4xSOukaG', '👑 Arnold', 'male'),
  v('pNInz6obpgDQGcFmaJgB', '👑 Adam', 'male'),
  v('yoZ06aMxZJJ28mfd3POQ', '👑 Sam', 'male'),
  v('jBpfuIE2acCO8z3wKNLl', '👑 Gigi', 'female'),
  v('jsCqWAovK2LkecY7zXl4', '👑 Freya', 'female'),
  v('oWAxZDx7w5VEj9dCyTzz', '👑 Grace', 'female'),
];

function cloneForLangs(voices: VoiceOption[], langs: string[]): Record<string, VoiceOption[]> {
  const out: Record<string, VoiceOption[]> = {};
  for (const lang of langs) out[lang] = voices;
  return out;
}

const ALL_UI_LANGS = ['vi', 'en', 'fr', 'de', 'es', 'pt', 'id', 'ja', 'zh', 'ko', 'th', 'ru', 'it', 'ar', 'hi'];

/** Catalog tĩnh đầy đủ — merge runtime qua prepareVoiceCatalog */
export const STATIC_VOICE_CATALOG: VoiceCatalog = {
  edge_tts: {
    vi: EDGE_VI,
    en: EDGE_EN,
    zh: EDGE_ZH,
    ja: EDGE_JA,
    ko: EDGE_KO,
    fr: EDGE_FR,
    de: EDGE_DE,
    es: EDGE_ES,
    pt: EDGE_PT,
    id: EDGE_ID,
    th: EDGE_TH,
    ru: EDGE_RU,
    it: EDGE_IT,
    ar: EDGE_AR,
    hi: EDGE_HI,
  },
  openai_tts: cloneForLangs(OPENAI_VOICE_OPTIONS, ALL_UI_LANGS),
  gemini_tts: cloneForLangs(GEMINI_VOICE_OPTIONS, ALL_UI_LANGS),
  tiktok_tts: {
    vi: TIKTOK_VI,
    en: TIKTOK_EN,
    ...TIKTOK_OTHER,
  },
  // Full CapCut matrix (127) + resource_id map — see capcutVoices.ts / data/capcut_voices.json
  capcut_tts: buildCapCutVoiceCatalog(),
  hotai_tts: {
    vi: HOTAI_VI,
  },
  piper: {
    vi: PIPER_VI_STATIC,
  },
  vieneu_tts: {
    vi: VIENEU_VI,
    en: [v('Bình An', 'Bình An (Bilingual)', 'male')],
  },
  vina_voice: {
    vi: [],
    en: [],
  },
  /** LA Studio — default + runtime merge Kokoro/custom from /api/tts/voices */
  la_studio: {
    vi: [
      // Real Kokoro ids only — CLI gen works offline without GUI model load
      v('diem_trinh', 'Diễm Trinh (mặc định Kokoro-VI)', 'female'),
      v('mai_linh', 'Mai Linh (Kokoro-VI)', 'female'),
      v('mai_loan', 'Mai Loan (Kokoro-VI)', 'female'),
      v('my_yen', 'Mỹ Yến (Kokoro-VI)', 'female'),
      v('ngoc_huyen', 'Ngọc Huyền (Kokoro-VI)', 'female'),
      v('thuc_trinh', 'Thục Trinh (Kokoro-VI)', 'female'),
      v('hung_thinh', 'Hưng Thịnh (Kokoro-VI)', 'male'),
      v('manh_dung', 'Mạnh Dũng (Kokoro-VI)', 'male'),
      v('phat_tai', 'Phát Tài (Kokoro-VI)', 'male'),
      v('thanh_dat', 'Thành Đạt (Kokoro-VI)', 'male'),
      v('tuan_ngoc', 'Tuấn Ngọc (Kokoro-VI)', 'male'),
      v('duc_an', 'Đức An (Kokoro-VI)', 'male'),
      v('duc_duy', 'Đức Duy (Kokoro-VI)', 'male'),
      v('storyvert', 'storyvert (Kokoro-VI)', 'neutral'),
    ],
    en: [v('diem_trinh', 'Diem Trinh (Kokoro-VI default)', 'female')],
  },
  // Design presets (Omni native) + clone library merge runtime qua /api/tts/voices
  omnivoice_local: {
    vi: [
      v('alloy', 'Alloy (Omni design)', 'neutral'),
      v('echo', 'Echo (Omni design)', 'male'),
      v('nova', 'Nova (Omni design)', 'female'),
      v('onyx', 'Onyx (Omni design)', 'male'),
      v('shimmer', 'Shimmer (Omni design)', 'female'),
      v('fable', 'Fable (Omni design)', 'neutral'),
      v('coral', 'Coral (Omni design)', 'female'),
      v('ash', 'Ash (Omni design)', 'male'),
    ],
    en: [
      v('alloy', 'Alloy (Omni design)', 'neutral'),
      v('echo', 'Echo (Omni design)', 'male'),
      v('nova', 'Nova (Omni design)', 'female'),
      v('onyx', 'Onyx (Omni design)', 'male'),
      v('shimmer', 'Shimmer (Omni design)', 'female'),
      v('fable', 'Fable (Omni design)', 'neutral'),
    ],
    ja: [
      v('alloy', 'Alloy (Omni design)', 'neutral'),
      v('nova', 'Nova (Omni design)', 'female'),
    ],
    ko: [v('alloy', 'Alloy (Omni design)', 'neutral')],
    th: [v('alloy', 'Alloy (Omni design)', 'neutral')],
    zh: [v('alloy', 'Alloy (Omni design)', 'neutral')],
    fr: [v('alloy', 'Alloy (Omni design)', 'neutral')],
    de: [v('alloy', 'Alloy (Omni design)', 'neutral')],
    es: [v('alloy', 'Alloy (Omni design)', 'neutral')],
    pt: [v('alloy', 'Alloy (Omni design)', 'neutral')],
    id: [v('alloy', 'Alloy (Omni design)', 'neutral')],
  },
  vbee: {
    vi: VBEE_VI,
    en: [v('en_female_1', '👑 English Female 1', 'female')],
  },
  google: {
    vi: GOOGLE_VI,
    en: [
      v('en-US-Journey-F', 'Journey Nữ (US)', 'female'),
      v('en-US-Journey-D', 'Journey Nam (US)', 'male'),
      v('en-US-Neural2-A', 'Neural2 A (Nữ)', 'female'),
      v('en-US-Neural2-C', 'Neural2 C (Nữ)', 'female'),
      v('en-US-Neural2-D', 'Neural2 D (Nam)', 'male'),
      v('en-US-Neural2-F', 'Neural2 F (Nữ)', 'female'),
      v('en-US-Neural2-I', 'Neural2 I (Nam)', 'male'),
      v('en-US-Neural2-J', 'Neural2 J (Nam)', 'male'),
    ],
    fr: [v('fr-FR-Translate', 'Google Translate French', 'neutral')],
    de: [v('de-DE-Translate', 'Google Translate German', 'neutral')],
    es: [v('es-ES-Translate', 'Google Translate Spanish', 'neutral')],
    pt: [v('pt-BR-Translate', 'Google Translate Portuguese', 'neutral')],
    id: [v('id-ID-Translate', 'Google Translate Indonesian', 'neutral')],
    ja: [v('ja-JP-Translate', 'Google Translate Japanese', 'neutral')],
    zh: [v('zh-CN-Translate', 'Google Translate Chinese', 'neutral')],
    ko: [v('ko-KR-Translate', 'Google Translate Korean', 'neutral')],
  },
  elevenlabs: {
    vi: ELEVEN_EN,
    en: ELEVEN_EN,
  },
};

/** Deep clone catalog (tránh mutate static) */
export function cloneVoiceCatalog(catalog: VoiceCatalog = STATIC_VOICE_CATALOG): VoiceCatalog {
  const out: VoiceCatalog = {};
  for (const [platform, langs] of Object.entries(catalog)) {
    out[platform] = {};
    for (const [lang, list] of Object.entries(langs || {})) {
      out[platform][lang] = list.map((x) => ({ ...x }));
    }
  }
  return out;
}

function dedupeVoicesById(list: VoiceOption[]): VoiceOption[] {
  const map = new Map<string, VoiceOption>();
  for (const voice of list || []) {
    if (!voice?.id) continue;
    const prev = map.get(voice.id);
    if (!prev || (voice.name || '').length >= (prev.name || '').length) {
      map.set(voice.id, voice);
    }
  }
  return Array.from(map.values());
}

export function getVoiceList(
  catalog: VoiceCatalog,
  platform: string,
  language: string,
): VoiceOption[] {
  const byLang = catalog[platform]?.[language];
  if (byLang?.length) return dedupeVoicesById(byLang);
  // Prep chưa xong / catalog rỗng → fallback static (tránh dropdown "Không có giọng")
  if (catalog !== STATIC_VOICE_CATALOG) {
    const staticList = STATIC_VOICE_CATALOG[platform]?.[language];
    if (staticList?.length) return dedupeVoicesById(staticList);
  }
  return [];
}

/** Tất cả giọng của 1 platform (mọi language), dedupe theo id */
export function getAllVoicesForPlatform(
  catalog: VoiceCatalog,
  platform: string,
): VoiceOption[] {
  const plat = catalog[platform] || {};
  const map = new Map<string, VoiceOption>();
  for (const list of Object.values(plat)) {
    for (const voice of list || []) {
      if (voice?.id && !map.has(voice.id)) map.set(voice.id, voice);
    }
  }
  return [...map.values()];
}

/**
 * Giọng cho gán NV / multi-voice.
 * - preferLanguage: ưu tiên language hiện tại
 * - includeAllLanguages: true → gộp mọi locale (Edge đầy đủ đa ngôn ngữ trong 1 dropdown)
 */
export function getCharacterVoiceOptions(
  platform: string,
  language = 'vi',
  options?: { includeAllLanguages?: boolean; catalog?: VoiceCatalog },
): VoiceOption[] {
  const catalog = options?.catalog || STATIC_VOICE_CATALOG;
  if (options?.includeAllLanguages) {
    const all = getAllVoicesForPlatform(catalog, platform);
    if (all.length) return all;
  }
  const list = getVoiceList(catalog, platform, language);
  if (list.length) return list;
  return [];
}

export function getDefaultVoiceConfig(
  catalog: VoiceCatalog,
  platform: string,
  preferredLanguage: string,
): { language: string; voice: string } {
  const tryList = (cat: VoiceCatalog, lang: string) =>
    cat[platform]?.[lang] || [];

  let language = preferredLanguage || 'vi';
  let voices = tryList(catalog, language);
  if (!voices.length) voices = tryList(STATIC_VOICE_CATALOG, language);
  if (!voices.length && language !== 'vi') {
    language = 'vi';
    voices = tryList(catalog, 'vi');
    if (!voices.length) voices = tryList(STATIC_VOICE_CATALOG, 'vi');
  }
  // Last resort: first language that has any voice on this platform
  if (!voices.length) {
    const merged = { ...STATIC_VOICE_CATALOG[platform], ...catalog[platform] };
    for (const [lang, list] of Object.entries(merged || {})) {
      if (list?.length) {
        language = lang;
        voices = list;
        break;
      }
    }
  }

  let voice = voices[0]?.id || '';
  // Hard defaults when catalog empty (dev race / prep fail)
  if (!voice) {
    if (platform === 'edge_tts') voice = 'vi-VN-NamMinhNeural';
    else if (platform === 'piper' || platform === 'vieneu_tts') voice = 'manhdung.onnx';
    else if (platform === 'omnivoice_local') voice = 'alloy';
    else if (platform === 'la_studio') voice = 'default';
    else if (platform === 'gemini_tts') voice = 'Kore';
    else if (platform === 'openai_tts') voice = 'alloy';
  }

  return {
    language,
    voice,
  };
}

const OMNI_PRESET_RE =
  /^(alloy|ash|ballad|cedar|coral|echo|fable|marin|nova|onyx|sage|shimmer|verse|auto)$/i;

/**
 * Khi đổi nền tảng: luôn chọn language + voice hợp lệ cho platform mới.
 * - keepPreferred=false (mặc định khi đổi platform): lấy default, bỏ voice cũ (tránh Edge id → Vina fail).
 * - keepPreferred=true: giữ voice nếu còn trong catalog platform.
 */
export function resolveVoiceForPlatform(
  catalog: VoiceCatalog,
  platform: string,
  preferredLanguage: string,
  preferredVoice?: string,
  opts?: { keepPreferred?: boolean },
): { language: string; voice: string } {
  const def = getDefaultVoiceConfig(catalog, platform, preferredLanguage);
  const list = getVoiceList(catalog, platform, def.language);
  const pref = (preferredVoice || '').trim();
  const keep = opts?.keepPreferred !== false;

  if (keep && pref) {
    if (list.some((v) => v.id === pref || v.name === pref)) {
      return { language: def.language, voice: pref };
    }
    if (platform === 'omnivoice_local' && (OMNI_PRESET_RE.test(pref) || pref.startsWith('omnivoice_'))) {
      return { language: def.language, voice: pref };
    }
  }

  return {
    language: def.language,
    voice: def.voice || pref || '',
  };
}

/** Voice có thuộc catalog platform không (kèm preset Omni). */
export function isVoiceValidForPlatform(
  catalog: VoiceCatalog,
  platform: string,
  language: string,
  voiceId: string,
): boolean {
  const v = (voiceId || '').trim();
  if (!v) return false;
  const list = getVoiceList(catalog, platform, language || 'vi');
  if (list.some((x) => x.id === v || x.name === v)) return true;
  if (platform === 'omnivoice_local' && (OMNI_PRESET_RE.test(v) || v.startsWith('omnivoice_'))) {
    return true;
  }
  return false;
}

export function countCatalogVoices(catalog: VoiceCatalog): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const platform of Object.keys(catalog)) {
    counts[platform] = getAllVoicesForPlatform(catalog, platform).length;
  }
  return counts;
}

export function findVoiceMeta(
  catalog: VoiceCatalog,
  platform: string,
  voiceId: string,
): VoiceOption | undefined {
  return getAllVoicesForPlatform(catalog, platform).find((x) => x.id === voiceId);
}

/** Preset map cho CapAssistant / AutoRender (name → edge id) */
export function getEdgePresetList(catalog: VoiceCatalog = STATIC_VOICE_CATALOG): {
  name: string;
  edge: string;
  tiktok?: string;
  gender?: VoiceGender;
}[] {
  const vi = getVoiceList(catalog, 'edge_tts', 'vi');
  const en = getVoiceList(catalog, 'edge_tts', 'en').slice(0, 12);
  const tt = getVoiceList(catalog, 'tiktok_tts', 'vi');
  const presets = [
    ...vi.map((x, i) => ({
      name: x.name,
      edge: x.id,
      tiktok: tt[i % Math.max(tt.length, 1)]?.id,
      gender: x.gender,
    })),
    ...en.map((x) => ({
      name: x.name,
      edge: x.id,
      tiktok: undefined as string | undefined,
      gender: x.gender,
    })),
  ];
  return presets;
}

export function mergePlatformLangVoices(
  catalog: VoiceCatalog,
  platform: string,
  language: string,
  voices: VoiceOption[],
): VoiceCatalog {
  const next = cloneVoiceCatalog(catalog);
  if (!next[platform]) next[platform] = {};
  // merge by id (dynamic wins on name/preview)
  const map = new Map<string, VoiceOption>();
  for (const x of next[platform][language] || []) map.set(x.id, x);
  for (const x of voices) map.set(x.id, { ...map.get(x.id), ...x });
  next[platform][language] = [...map.values()];
  return next;
}
