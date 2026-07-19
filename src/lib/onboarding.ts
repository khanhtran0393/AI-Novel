/**
 * First-run / core-loop onboarding flags (localStorage).
 * Commercial: checklist only — no demo/mạt-thế seed content.
 */

export const ONBOARDING_STORAGE_KEY = 'ainovel.onboarding.v1';

export type OnboardingState = {
  dismissed: boolean;
  completedSteps: string[];
};

export const CORE_LOOP_STEPS = [
  { id: 'setup', label: 'Thiết lập chủ đề & số chương', hint: 'Tab Setup / giai đoạn 1' },
  { id: 'outline', label: 'Sinh dàn ý', hint: 'Nút tạo outline' },
  { id: 'write', label: 'Viết chương 1', hint: 'Editor → Viết chương' },
  { id: 'tts', label: 'TTS 1 scene', hint: 'Cài TTS → gen audio scene' },
  { id: 'image', label: 'Prompt ảnh + gen 1 ảnh', hint: 'Scene card → Gen ảnh' },
  { id: 'export', label: 'Export / Ship pack', hint: 'CapCut hoặc Ship pack (Pro)' },
] as const;

export function loadOnboarding(): OnboardingState {
  if (typeof window === 'undefined') {
    return { dismissed: true, completedSteps: [] };
  }
  try {
    const raw = window.localStorage.getItem(ONBOARDING_STORAGE_KEY);
    if (!raw) return { dismissed: false, completedSteps: [] };
    const p = JSON.parse(raw) as OnboardingState & { demoLoaded?: boolean };
    return {
      dismissed: !!p.dismissed,
      completedSteps: Array.from(
        new Set(Array.isArray(p.completedSteps) ? p.completedSteps : []),
      ),
    };
  } catch {
    return { dismissed: false, completedSteps: [] };
  }
}

export function saveOnboarding(state: OnboardingState) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    ONBOARDING_STORAGE_KEY,
    JSON.stringify({
      dismissed: !!state.dismissed,
      completedSteps: Array.isArray(state.completedSteps)
        ? state.completedSteps
        : [],
    }),
  );
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
