/**
 * First-run / core-loop onboarding flags (localStorage).
 * Commercial: checklist only — no demo genre seed content.
 */

export const ONBOARDING_STORAGE_KEY = 'ainovel.onboarding.v1';
/** Banner listens — markOnboardingStep dispatches after save */
export const ONBOARDING_CHANGE_EVENT = 'ainovel:onboarding-change';

export type OnboardingState = {
  dismissed: boolean;
  completedSteps: string[];
};

export const CORE_LOOP_STEPS = [
  {
    id: 'setup',
    label: 'Thiết lập chủ đề & số chương',
    hint: 'Nút Setup (sidebar) · chọn Chủ đề + Phong cách',
  },
  { id: 'outline', label: 'Sinh dàn ý', hint: 'Setup hoặc Viết tiếp → Sinh dàn ý' },
  { id: 'write', label: 'Viết chương 1', hint: 'Editor → Sinh chi tiết chương' },
  {
    id: 'tts',
    label: 'TTS 1 scene',
    hint: 'Free: Engine → Edge/Piper · Trial/Pro: LA Studio',
  },
  { id: 'image', label: 'Prompt ảnh + gen 1 ảnh', hint: 'Scene card → Gen Prompt → Gen ảnh' },
  {
    id: 'export',
    label: 'Export / Ship pack',
    hint: 'CapCut hoặc Ship pack (Trial/Pro)',
  },
] as const;

export type OnboardingStepId = (typeof CORE_LOOP_STEPS)[number]['id'];

function notifyOnboardingChange(state: OnboardingState) {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(
      new CustomEvent(ONBOARDING_CHANGE_EVENT, { detail: state }),
    );
  } catch {
    /* ignore */
  }
}

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
  notifyOnboardingChange(state);
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
