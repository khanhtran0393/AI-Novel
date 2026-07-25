/**
 * Standard progress steps for Google Flow gen tasks (UI + logs).
 */
import type { FlowTask, FlowTaskStep } from './types';

const STEP_PROGRESS: Record<FlowTaskStep, number> = {
  queued: 0,
  account: 8,
  captcha: 18,
  submit: 35,
  poll: 55,
  download: 78,
  saving: 90,
  done: 100,
  error: 0,
};

const STEP_LABEL_VI: Record<FlowTaskStep, string> = {
  queued: 'Đang chờ trong hàng đợi Google Flow…',
  account: 'Chọn / gắn profile Google Labs…',
  captcha: 'Xác minh reCAPTCHA / chặn bot Google…',
  submit: 'Gửi yêu cầu gen tới Google Flow…',
  poll: 'Đang chờ Google render…',
  download: 'Tải media từ Google…',
  saving: 'Lưu file cục bộ…',
  done: 'Hoàn tất',
  error: 'Lỗi',
};

export function flowStepLabel(step: FlowTaskStep): string {
  return STEP_LABEL_VI[step] || step;
}

export function applyFlowTaskStep(
  task: FlowTask,
  step: FlowTaskStep,
  opts?: { progress?: number; message?: string },
): void {
  task.step = step;
  task.progress =
    opts?.progress != null ? opts.progress : STEP_PROGRESS[step] ?? task.progress;
  task.progressMessage = opts?.message || STEP_LABEL_VI[step];
  task.updatedAt = Date.now();
}
