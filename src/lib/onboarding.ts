/**
 * First-run / core-loop onboarding flags (localStorage).
 */

export const ONBOARDING_STORAGE_KEY = 'ainovel.onboarding.v1';

export type OnboardingState = {
  dismissed: boolean;
  completedSteps: string[];
  demoLoaded?: boolean;
};

export const CORE_LOOP_STEPS = [
  { id: 'setup', label: 'Thiết lập chủ đề & số chương', hint: 'Tab Setup / giai đoạn 1' },
  { id: 'outline', label: 'Sinh dàn ý', hint: 'Nút tạo outline' },
  { id: 'write', label: 'Viết chương 1', hint: 'Editor → Viết chương' },
  { id: 'tts', label: 'TTS 1 scene (Edge)', hint: 'Cài TTS platform = edge_tts' },
  { id: 'image', label: 'Prompt ảnh + gen 1 ảnh', hint: 'Scene card → Gen ảnh' },
  { id: 'export', label: 'Export / Ship pack', hint: 'CapCut hoặc Ship pack' },
] as const;

export function loadOnboarding(): OnboardingState {
  if (typeof window === 'undefined') {
    return { dismissed: true, completedSteps: [] };
  }
  try {
    const raw = window.localStorage.getItem(ONBOARDING_STORAGE_KEY);
    if (!raw) return { dismissed: false, completedSteps: [] };
    const p = JSON.parse(raw) as OnboardingState;
    return {
      dismissed: !!p.dismissed,
      completedSteps: Array.isArray(p.completedSteps) ? p.completedSteps : [],
      demoLoaded: !!p.demoLoaded,
    };
  } catch {
    return { dismissed: false, completedSteps: [] };
  }
}

export function saveOnboarding(state: OnboardingState) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(state));
}

export function markOnboardingStep(stepId: string) {
  const cur = loadOnboarding();
  if (!cur.completedSteps.includes(stepId)) {
    cur.completedSteps = [...cur.completedSteps, stepId];
    saveOnboarding(cur);
  }
  return cur;
}

export function dismissOnboarding() {
  const cur = loadOnboarding();
  cur.dismissed = true;
  saveOnboarding(cur);
  return cur;
}

/** Minimal demo project patch for first-run (no secrets). */
export function buildDemoProjectPatch(): Record<string, unknown> {
  return {
    ten_tac_pham: 'Demo Core Loop',
    giai_doan: 2,
    setup: {
      chu_de: 'Sinh Tồn',
      so_chuong: 3,
      phong_cach: 'Điện ảnh chậm',
      doi_tuong: 'YouTube narrated',
    },
    dan_y_tong_the:
      'Nhân vật chính thức tỉnh trong thành phố đổ nát sau đại dịch. Chương 1: tìm nước và đồng đội.',
    danh_sach_chuong: [
      {
        so_chuong: 1,
        tieu_de: 'Bình minh trên bê tông',
        dan_y: 'Thức dậy, khát nước, tiếng bước chân lạ.',
        noi_dung:
          'Ánh sáng xám len qua khe tường nứt. Hắn há miệng, lưỡi đắng kim loại. Phía hành lang, một tiếng bước chân dừng lại — rồi tiếp tục, chậm hơn.',
        trang_thai: 'ready',
      },
    ],
    chuong_dang_chon: 1,
    nhan_vat: ['Hàn Dực'],
    nhan_vat_prompts: {
      'Hàn Dực': {
        gioi_tinh: 'Nam',
        ngoai_hinh: 'Sẹo mày trái, áo khoác rách, mắt sâu',
        trang_phuc: 'Áo khoác quân sự cũ, bốt bùn',
        thoi_quen: 'Cắn môi khi căng thẳng',
      },
    },
    ttsConfig: {
      platform: 'edge_tts',
      voice: 'vi-VN-HoaiMyNeural',
      speed: 1,
      pitch: 0,
    },
    imageProvider: 'gemini',
    pipeline_step: 'write',
  };
}
