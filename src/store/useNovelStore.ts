import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Chuong {
  so_chuong: number;
  tieu_de: string;
  dan_y: string;
  noi_dung: string;
  trang_thai: 'empty' | 'writing' | 'ready';
}

export interface SetupData {
  chu_de: string;
  phong_cach: string;
  mo_ta: string;
  so_chuong: number;
  so_tu_chuong?: number; // Số lượng từ mục tiêu mỗi chương (mặc định 4250)
}

export interface TTSConfig {
  platform: 'tiktok_tts' | 'edge_tts' | 'vbee' | 'google' | 'elevenlabs' | 'capcut_tts' | 'vieneu_tts';
  language: string;
  voice: string;
  speed: number;
  pitch: number; // Pitch shift in semitones (-12 to 12)
  tiktokSessionId: string;
  api_url_vieneu: string; // Base URL for VieNeu-TTS API
}

export interface NovelState {
  giai_doan: 1 | 2; // 1: Setup, 2: Workspace
  setup: SetupData;
  ten_tac_pham: string;
  dan_y_tong_the: string;
  nhan_vat: string[]; // Hồ sơ nhân vật tĩnh
  danh_sach_chuong: Chuong[];
  chuong_dang_chon: number; // 1-indexed
  tab_hien_tai: 'dan_y' | 'noi_dung';
  dang_tai: boolean;
  useMock: boolean;
  apiKey: string;
  apiKeys: string[]; // Mảng chứa nhiều API Key để xoay vòng
  googleStudioCookie: string; // Cookie Google Studio cho các dòng flow và TTS tự động
  googleStudioCookies: string[]; // Mảng nhiều cookie cho đa luồng
  isHydrated: boolean;

  // --- HỆ THỐNG LƯU TRỮ GOOGLE DRIVE ---
  googleDrivePath: string; // Đường dẫn thư mục Google Drive Desktop cục bộ trên Windows
  googleDriveConnected: boolean; // Trạng thái kết nối Google Drive
  googleLoggedIn: boolean; // Trạng thái đăng nhập Google Drive Cloud
  googleUser: { name: string; email: string; avatar: string } | null; // Thông tin tài khoản người dùng Google
  generatedAudioPaths: Record<string, { path: string; duration: number }>; // Quản lý audio đã sinh: { chapter_scene: { path, duration } }
  generatedPrompts: Record<string, { timestamp: string; prompt: string; sentence?: string }[]>; // Quản lý prompts đã sinh theo thời lượng: { chapter_scene: [{ timestamp, prompt }] }
  generatedPromptsAnalysis: Record<string, string>; // Phân tích kịch bản hình ảnh: { chapter_scene: markdown_string }
  generatedImages: Record<string, string>; // Quản lý ảnh đã sinh: { chapter_scene_prompt: path }
  generatedVideos: Record<string, string>; // Quản lý video đã sinh: { chapter_scene_prompt_video: path }
  
  savePathTTS: string; // Thư mục lưu audio riêng biệt
  savePathImage: string; // Thư mục lưu ảnh riêng biệt
  savePathCharacter: string; // Thư mục lưu ảnh nhân vật riêng biệt
  savePathVideo: string; // Thư mục lưu video riêng biệt
  projectUrls: Record<string, string>; // Quản lý link dự án cho từng prompt: { chapter_scene_prompt: url }

  // --- HỆ THỐNG BỘ NHỚ 3 TẦNG & PIPELINE STEPPER ---
  lorebook: string; // Tầng 1: Lõi Bất Biến
  tom_tat_cuon_chieu: string; // Tầng 2: Nén dưới 500 từ
  tri_nho_ngan_han: string[]; // Tầng 3: Tóm tắt cực ngắn 3 chương gần nhất
  pipeline_step: 'outline' | 'script' | 'commit'; // Stepper điều hướng 3 bước
  nhan_vat_prompts: Record<string, { gioi_tinh: string; quan_ao: string; so_thich: string; thoi_quen: string; prompt: string }>;
  imageModel: string;
  videoModel: string;
  
  // --- HỆ THỐNG CẤU HÌNH ĐẦU RA MEDIA ---
  aiMasterModel: string;
  aiMasterApiKey: string;
  visualDnaPrompt: string;

  // --- HỆ THỐNG THƯƠNG MẠI HÓA (VIP/PRO) ---
  is_vip: boolean;
  is_pro: boolean;
  credits: number;
  
  // --- HỆ THỐNG CẤU HÌNH GIỌNG ĐỌC TOÀN CỤC ---
  ttsConfig: TTSConfig;
}

export interface NovelActions {
  setSetup: (data: Partial<SetupData>) => void;
  setGiaiDoan: (giai_doan: 1 | 2) => void;
  updateTenTacPham: (name: string) => void;
  updateDanYTongThe: (outline: string) => void;
  updateNhanVat: (chars: string[]) => void;
  updateSavePathTTS: (path: string) => void;
  updateSavePathImage: (path: string) => void;
  updateSavePathCharacter: (path: string) => void;
  updateSavePathVideo: (path: string) => void;
  addProjectUrl: (key: string, url: string) => void;
  setDanhSachChuong: (chapters: Chuong[]) => void;
  updateChuong: (so_chuong: number, update: Partial<Chuong>) => void;
  selectChuong: (so_chuong: number) => void;
  setTabHienTai: (tab: 'dan_y' | 'noi_dung') => void;
  setDangTai: (loading: boolean) => void;
  setUseMock: (mock: boolean) => void;
  setApiKey: (key: string) => void;
  setApiKeys: (keys: string[]) => void; // Action cập nhật danh sách nhiều khóa
  prioritizeApiKey: (key: string) => void;
  setGoogleStudioCookie: (cookie: string) => void; // Action cập nhật Cookie Google Studio
  addGoogleCookie: (cookie: string) => void; // Thêm 1 cookie mới vào mảng
  removeGoogleCookie: (index: number) => void; // Xóa cookie theo index
  setHydrated: (hydrated: boolean) => void;
  resetStore: () => void;

  // Actions cho lưu trữ Google Drive & Assets
  updateGoogleDrivePath: (path: string) => void;
  setGoogleDriveConnected: (connected: boolean) => void;
  setGoogleLoggedIn: (loggedIn: boolean) => void;
  setGoogleUser: (user: { name: string; email: string; avatar: string } | null) => void;
  addGeneratedAudio: (key: string, path: string, duration: number) => void;
  addGeneratedPrompts: (key: string, prompts: { timestamp: string; prompt: string; sentence?: string }[]) => void;
  addGeneratedPromptsAnalysis: (key: string, analysis: string) => void;
  addGeneratedImage: (key: string, path: string) => void;
  addGeneratedVideo: (key: string, path: string) => void;

  // Actions mới cho Stepper & Bộ nhớ 3 tầng
  setPipelineStep: (step: 'outline' | 'script' | 'commit') => void;
  updateLorebook: (lorebook: string) => void;
  updateTomTatCuonChieu: (summary: string) => void;
  updateTriNhoNganHan: (shortTerm: string[]) => void;
  updateNhanVatPrompt: (charName: string, data: Partial<{ gioi_tinh: string; quan_ao: string; so_thich: string; thoi_quen: string; prompt: string }>) => void;
  setImageModel: (model: string) => void;
  setVideoModel: (model: string) => void;

  setAiMasterModel: (model: string) => void;
  setAiMasterApiKey: (key: string) => void;
  setVisualDnaPrompt: (prompt: string) => void;

  // Actions cho Thương mại hóa (VIP/PRO)
  setVipStatus: (is_vip: boolean, is_pro: boolean) => void;
  setCredits: (credits: number) => void;
  deductCredits: (amount: number) => boolean;

  // Cấu hình TTS Toàn cục
  updateTTSConfig: (config: Partial<TTSConfig>) => void;
}

export type NovelStore = NovelState & NovelActions;

const INITIAL_SETUP: SetupData = {
  chu_de: 'Trinh Thám',
  phong_cach: 'Viễn Tưởng',
  mo_ta: `Trong một đô thị tương lai mang tên Neo-Veridia, nơi những tòa nhà chọc trời vươn tới mây và ánh đèn neon lấp lánh không ngừng, cuộc sống được định nghĩa bởi "Mạng Lưới Thấu Cảm" (Empathic Net). Đây không chỉ là một mạng internet, mà là một hệ thống thần kinh tập thể, nơi mọi ký ức, trải nghiệm, và cảm xúc cá nhân được số hóa, chia sẻ và hợp nhất thành một dòng chảy dữ liệu khổng lồ. Mục đích ban đầu là tạo ra một xã hội hòa bình, không xung đột nhờ sự đồng cảm tuyệt đối. Tuy nhiên, sự phụ thuộc hoàn toàn vào Mạng Lưới đã biến ký ức thành tài sản công, và sự riêng tư trở thành một khái niệm lỗi thời.

Khải Đăng là một "Thợ Săn Ký Ức" (Memory Hunter), một thám tử kiêm kỹ thuật viên được cấp phép để điều tra các vụ án "xóa bỏ hiện thực" - những sự kiện mà quá khứ của cả một khu phố, một tập thể, hoặc thậm chí chỉ một cá nhân bị bóp méo.`,
  so_chuong: 2,
  so_tu_chuong: 4250,
};

const INITIAL_LOREBOOK = `📖 LÕI BẤT BIẾN (LOREBOOK) - KÝ ỨC PHAI TÀN: MẠNG LƯỚI HƯ VÔ

1. THẾ GIỚI & CÔNG NGHỆ:
- Neo-Veridia: Đô thị tương lai ngợp trong ánh đèn neon rực rỡ và những tòa nhà chọc trời vươn tới mây. Một xã hội có vẻ ngoài hoàn hảo nhưng thực chất bị kiểm soát hoàn toàn bởi ký ức tập thể.
- Mạng Lưới Thấu Cảm (Empathic Net): Hệ thống thần kinh tập thể số hóa mọi ký ức, trải nghiệm, và cảm xúc cá nhân. Mọi người chia sẻ cảm xúc để thấu hiểu lẫn nhau tuyệt đối, triệt tiêu xung đột xã hội.
- Mặt trái: Sự phụ thuộc hoàn toàn vào Mạng Lưới biến ký ức thành tài sản công, xóa nhòa ranh giới cá nhân và triệt tiêu sự riêng tư. Ký ức có thể bị mua bán, sửa đổi hoặc xóa bỏ hoàn toàn.

2. CÁC KHÁI NIỆM QUAN TRỌNG:
- Vụ án "xóa bỏ hiện thực": Những hiện tượng kỳ lạ khi ký ức và lịch sử của một cá nhân, tập thể, hoặc thậm chí cả một khu phố bị bóp méo, chỉnh sửa hoặc biến mất không dấu vết khỏi Mạng Lưới.
- Thợ Săn Ký Ức (Memory Hunter): Những thám tử kiêm kỹ thuật viên được cấp phép, có khả năng xâm nhập sâu vào Mạng Lưới Thấu Cảm hoặc trực tiếp vào não bộ đối tượng để truy vết, phục hồi hoặc điều tra các ký ức bị đánh cắp/xóa bỏ.

3. NHÂN VẬT CHÍNH:
- Khải Đăng: Một Thợ Săn Ký Ức tài năng nhưng cô độc. Anh có quá khứ bí ẩn và luôn hoài nghi về sự hoàn hảo của Mạng Lưới Thấu Cảm. Khải Đăng sử dụng các thiết bị giải mã ký ức chuyên nghiệp để lật mở những mảng tối của Neo-Veridia.`;

const INITIAL_STATE: NovelState = {
  giai_doan: 1,
  setup: INITIAL_SETUP,
  ten_tac_pham: 'Ký Ức Phai Tàn: Mạng Lưới Hư Vô',
  dan_y_tong_the: `# DÀN Ý TỔNG QUAN TRUYỆN: KÝ ỨC PHAI TÀN: MẠNG LƯỚI HƯ VÔ

## I. DÀN Ý TỔNG THỂ

### 1. Bối cảnh thế giới: Thành phố "Quên" và Mạng Lưới Thấu Cảm
Trong một đô thị tương lai mang tên Neo-Veridia, nơi những tòa nhà chọc trời vươn tới mây và ánh đèn neon lấp lánh không ngừng, cuộc sống được định nghĩa bởi "Mạng Lưới Thấu Cảm" (Empathic Net). Đây không chỉ là một mạng internet, mà là một hệ thống thần kinh tập thể, nơi mọi ký ức, trải nghiệm, và cảm xúc cá nhân được số hóa, chia sẻ và hợp nhất thành một dòng chảy dữ liệu khổng lồ. Mục đích ban đầu là tạo ra một xã hội hòa bình, không xung đột nhờ sự đồng cảm tuyệt đối. Tuy nhiên, sự phụ thuộc hoàn toàn vào Mạng Lưới đã biến ký ức thành tài sản công, và sự riêng tư trở thành một khái niệm lỗi thời.

### 2. Nhân vật chính
Khải Đăng là một "Thợ Săn Ký Ức" (Memory Hunter), một thám tử kiêm kỹ thuật viên được cấp phép để điều tra các vụ án "xóa bỏ hiện thực" - những sự kiện mà quá khứ của cả một khu phố, một tập thể, hoặc thậm chí chỉ một cá nhân bị bóp méo.

### 3. Diễn biến 2 chương đầu mô phỏng:
- **Chương 1: Ký ức biến mất**: Khải Đăng nhận một vụ án kỳ lạ tại khu phố ổ chuột của Neo-Veridia, nơi toàn bộ cư dân quên mất sự tồn tại của một cô gái trẻ. Anh phải kết nối trực tiếp vào Mạng Lưới Thấu Cảm để tìm lại những mảnh vụn ký ức bị xóa bỏ.
- **Chương 2: Lần theo dấu vết**: Khải Đăng phát hiện ra một lỗ hổng bảo mật chết người trong Mạng Lưới Thấu Cảm, cho phép một thế lực ẩn danh xóa sạch sự tồn tại của bất kỳ ai. Anh bị truy đuổi bởi các thực thể bảo vệ hệ thống.`,
  nhan_vat: ['Khải Đăng'],
  danh_sach_chuong: [
    {
      so_chuong: 1,
      tieu_de: 'Chương 1: Ký ức biến mất',
      dan_y: 'Khải Đăng nhận một vụ án kỳ lạ tại khu phố ổ chuột của Neo-Veridia, nơi toàn bộ cư dân quên mất sự tồn tại của một cô gái trẻ. Anh phải kết nối trực tiếp vào Mạng Lưới Thấu Cảm để tìm lại những mảnh vụn ký ức bị xóa bỏ.',
      noi_dung: '',
      trang_thai: 'empty'
    },
    {
      so_chuong: 2,
      tieu_de: 'Chương 2: Lần theo dấu vết',
      dan_y: 'Khải Đăng phát hiện ra một lỗ hổng bảo mật chết người trong Mạng Lưới Thấu Cảm, cho phép một thế lực ẩn danh xóa sạch sự tồn tại của bất kỳ ai. Anh bị truy đuổi bởi các thực thể bảo vệ hệ thống.',
      noi_dung: '',
      trang_thai: 'empty'
    }
  ],
  chuong_dang_chon: 1,
  tab_hien_tai: 'dan_y',
  dang_tai: false,
  useMock: false,
  apiKey: '',
  apiKeys: [], // Mảng khóa trống mặc định
  googleStudioCookie: '', // Khởi tạo chuỗi cookie rỗng
  googleStudioCookies: [], // Mảng cookie rỗng mặc định
  isHydrated: false,

  // Mặc định lưu trữ Google Drive
  googleDrivePath: '',
  googleDriveConnected: false,
  googleLoggedIn: false,
  googleUser: null,
  generatedAudioPaths: {},
  generatedPrompts: {},
  generatedPromptsAnalysis: {},
  generatedImages: {},
  generatedVideos: {},
  
  savePathTTS: '',
  savePathImage: '',
  savePathCharacter: '',
  savePathVideo: '',
  projectUrls: {},

  // Bộ nhớ 3 tầng & Stepper
  lorebook: INITIAL_LOREBOOK,
  tom_tat_cuon_chieu: 'Chưa có tóm tắt cốt truyện. Hệ thống sẽ tự động nén sau khi hoàn thành Chương 1.',
  tri_nho_ngan_han: [],
  pipeline_step: 'outline',
  nhan_vat_prompts: {},
  imageModel: 'imagen3',
  videoModel: 'veo',
  
  aiMasterModel: 'aistudio',
  aiMasterApiKey: '',
  visualDnaPrompt: '',

  // Thương mại hóa
  is_vip: false,
  is_pro: false,
  credits: 50, // Mặc định cho người dùng mới 50 credits

  // Cấu hình TTS Toàn cục
  ttsConfig: {
    platform: 'tiktok_tts',
    language: 'vi',
    voice: 'vn_tiktok_female',
    speed: 1.0,
    pitch: 0,
    tiktokSessionId: '',
    api_url_vieneu: 'http://localhost:23333/v1'
  },
};

export const useNovelStore = create<NovelStore>()(
  persist(
    (set) => ({
      ...INITIAL_STATE,

      setSetup: (data) =>
        set((state) => {
          const newSetup = { ...state.setup, ...data };
          const generatedName = `${newSetup.chu_de} - ${newSetup.phong_cach}`;
          return {
            setup: newSetup,
            ten_tac_pham: state.giai_doan === 1 ? generatedName : state.ten_tac_pham,
          };
        }),

      setGiaiDoan: (giai_doan) => set({ giai_doan }),

      updateTenTacPham: (ten_tac_pham) => set({ ten_tac_pham }),

      updateDanYTongThe: (dan_y_tong_the) => set({ dan_y_tong_the }),

      updateNhanVat: (nhan_vat) => set({ nhan_vat }),

      setDanhSachChuong: (danh_sach_chuong) => set({ danh_sach_chuong }),

      updateChuong: (so_chuong, update) =>
        set((state) => ({
          danh_sach_chuong: state.danh_sach_chuong.map((c) =>
            c.so_chuong === so_chuong ? { ...c, ...update } : c
          ),
        })),

      selectChuong: (chuong_dang_chon) => set({ chuong_dang_chon }),

      setTabHienTai: (tab_hien_tai) => set({ tab_hien_tai }),

      setDangTai: (dang_tai) => set({ dang_tai }),

      setUseMock: (useMock) => set({ useMock }),

      setApiKey: (apiKey) => set({ apiKey }),

      setApiKeys: (apiKeys) => set({ apiKeys }),

      prioritizeApiKey: (apiKey: string) => set((state) => {
        if (!apiKey || !state.apiKeys.includes(apiKey)) return state;
        const keys = [apiKey, ...state.apiKeys.filter(k => k !== apiKey)];
        return { apiKeys: keys };
      }),

      setGoogleStudioCookie: (googleStudioCookie) => set({ googleStudioCookie }),

      addGoogleCookie: (cookie: string) => set((state) => ({
        googleStudioCookies: [...state.googleStudioCookies, cookie]
      })),

      removeGoogleCookie: (index: number) => set((state) => ({
        googleStudioCookies: state.googleStudioCookies.filter((_, i) => i !== index)
      })),

      setHydrated: (isHydrated) => set({ isHydrated }),

      resetStore: () => set((state) => ({
        ...INITIAL_STATE,
        isHydrated: true,
        apiKey: state.apiKey,
        apiKeys: state.apiKeys,
        googleStudioCookie: state.googleStudioCookie,
        googleStudioCookies: state.googleStudioCookies,
        useMock: state.useMock,
        googleDrivePath: state.googleDrivePath,
        googleDriveConnected: state.googleDriveConnected,
        googleLoggedIn: state.googleLoggedIn,
        googleUser: state.googleUser,
        generatedAudioPaths: state.generatedAudioPaths,
        generatedPrompts: state.generatedPrompts,
        generatedPromptsAnalysis: state.generatedPromptsAnalysis,
        nhan_vat_prompts: {}
      })),

      // Actions cho lưu trữ Google Drive & Assets
      updateGoogleDrivePath: (googleDrivePath) => set({ googleDrivePath }),
      setGoogleDriveConnected: (googleDriveConnected) => set({ googleDriveConnected }),
      setGoogleLoggedIn: (googleLoggedIn) => set({ googleLoggedIn }),
      setGoogleUser: (googleUser) => set({ googleUser }),
      addGeneratedAudio: (key, path, duration) => set((state) => ({
        generatedAudioPaths: { ...state.generatedAudioPaths, [key]: { path, duration } }
      })),
      addGeneratedPrompts: (key, prompts) => set((state) => ({
        generatedPrompts: { ...state.generatedPrompts, [key]: prompts }
      })),
      addGeneratedPromptsAnalysis: (key, analysis) => set((state) => ({
        generatedPromptsAnalysis: { ...state.generatedPromptsAnalysis, [key]: analysis }
      })),
      addGeneratedImage: (key, path) => set((state) => ({
        generatedImages: { ...(state.generatedImages || {}), [key]: path }
      })),
      addGeneratedVideo: (key, path) => set((state) => ({
        generatedVideos: { ...(state.generatedVideos || {}), [key]: path }
      })),

      // Actions cho lưu trữ riêng biệt của từng mô-đun
      updateSavePathTTS: (savePathTTS) => set({ savePathTTS }),
      updateSavePathImage: (savePathImage) => set({ savePathImage }),
      updateSavePathCharacter: (savePathCharacter) => set({ savePathCharacter }),
      updateSavePathVideo: (savePathVideo) => set({ savePathVideo }),
      addProjectUrl: (key, url) => set((state) => ({
        projectUrls: { ...(state.projectUrls || {}), [key]: url }
      })),

      // Actions cho Stepper & Bộ nhớ 3 tầng
      setPipelineStep: (pipeline_step) => set({ pipeline_step }),
      updateLorebook: (lorebook) => set({ lorebook }),
      updateTomTatCuonChieu: (tom_tat_cuon_chieu) => set({ tom_tat_cuon_chieu }),
      updateTriNhoNganHan: (tri_nho_ngan_han) => set({ tri_nho_ngan_han }),
      updateNhanVatPrompt: (charName, data) => set((state) => {
        const current = state.nhan_vat_prompts || {};
        const oldVal = current[charName] || { gioi_tinh: '', quan_ao: '', so_thich: '', thoi_quen: '', prompt: '' };
        return {
          nhan_vat_prompts: {
            ...current,
            [charName]: { ...oldVal, ...data }
          }
        };
      }),
      setImageModel: (model) => set({ imageModel: model }),
      setVideoModel: (model) => set({ videoModel: model }),

      setAiMasterModel: (model) => set({ aiMasterModel: model }),
      setAiMasterApiKey: (key) => set({ aiMasterApiKey: key }),
      setVisualDnaPrompt: (prompt) => set({ visualDnaPrompt: prompt }),

      // Actions cho Thương mại hóa (VIP/PRO)
      setVipStatus: (is_vip, is_pro) => set({ is_vip, is_pro }),
      setCredits: (credits) => set({ credits }),
      deductCredits: (amount) => {
        let success = false;
        set((state) => {
          if (state.is_vip || state.is_pro) {
            success = true; // VIP/Pro không bị giới hạn credit (hoặc có giới hạn riêng)
            return state;
          }
          if (state.credits >= amount) {
            success = true;
            return { credits: state.credits - amount };
          }
          return state;
        });
        return success;
      },
      updateTTSConfig: (config) => set((state) => ({
        ttsConfig: { ...state.ttsConfig, ...config }
      }))
    }),
    {
      name: 'novel_generator_v2_store',
      skipHydration: true,
      partialize: (state) => ({
        giai_doan: state.giai_doan,
        setup: state.setup,
        ten_tac_pham: state.ten_tac_pham,
        dan_y_tong_the: state.dan_y_tong_the,
        nhan_vat: state.nhan_vat,
        danh_sach_chuong: state.danh_sach_chuong,
        chuong_dang_chon: state.chuong_dang_chon,
        tab_hien_tai: state.tab_hien_tai,
        useMock: state.useMock,
        apiKey: state.apiKey,
        apiKeys: state.apiKeys, // Lưu trữ danh sách nhiều khóa API kiên trì
        googleStudioCookie: state.googleStudioCookie, // Lưu trữ kiên trì cookie Google Studio
        googleStudioCookies: state.googleStudioCookies, // Lưu trữ kiên trì mảng cookie đa luồng
        googleDrivePath: state.googleDrivePath,
        googleDriveConnected: state.googleDriveConnected,
        googleLoggedIn: state.googleLoggedIn,
        googleUser: state.googleUser,
        generatedAudioPaths: state.generatedAudioPaths,
        generatedPrompts: state.generatedPrompts,
        generatedPromptsAnalysis: state.generatedPromptsAnalysis,
        generatedImages: state.generatedImages,
        generatedVideos: state.generatedVideos,
        
        savePathTTS: state.savePathTTS,
        savePathImage: state.savePathImage,
        savePathCharacter: state.savePathCharacter,
        savePathVideo: state.savePathVideo,
        projectUrls: state.projectUrls,

        // Lưu giữ bộ nhớ vĩ mô
        lorebook: state.lorebook,
        tom_tat_cuon_chieu: state.tom_tat_cuon_chieu,
        tri_nho_ngan_han: state.tri_nho_ngan_han,
        pipeline_step: state.pipeline_step,
        nhan_vat_prompts: state.nhan_vat_prompts,
        imageModel: state.imageModel,
        videoModel: state.videoModel,

        is_vip: state.is_vip,
        is_pro: state.is_pro,
        credits: state.credits,
        ttsConfig: state.ttsConfig
      }),
    }
  )
);
