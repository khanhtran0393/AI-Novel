import {
  HIGH_RISK_TTS_PLATFORMS,
  type EditorVerdict,
} from './config';

export interface TtsGateInput {
  enforceEditorGate: boolean;
  requireHumanEdit?: boolean;
  humanEdited?: boolean;
  chapterNumber: number;
  hasScript: boolean;
  editorReview?: { verdict?: EditorVerdict; summary?: string } | null;
  ttsPlatform?: string;
  ttsPitch?: number;
  ttsSpeed?: number;
  bypass?: boolean;
}

export interface TtsGateResult {
  ok: boolean;
  hardBlock: boolean;
  reasons: string[];
  warnings: string[];
}

export function evaluateYoutubeTtsGate(input: TtsGateInput): TtsGateResult {
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (input.bypass) {
    return { ok: true, hardBlock: false, reasons, warnings };
  }

  if (!input.hasScript) {
    reasons.push('Chưa có kịch bản để đọc TTS.');
  }

  if (input.enforceEditorGate) {
    if (!input.editorReview || !input.editorReview.verdict) {
      reasons.push(
        'Chưa có AI Editor Review. Hãy Sinh/Đánh giá chương trước khi TTS (YouTube-safe).',
      );
    } else if (input.editorReview.verdict === 'rewrite') {
      reasons.push(
        'Editor verdict = rewrite. Sửa theo nhận xét trước khi sinh giọng (tránh up raw AI).',
      );
    } else if (input.editorReview.verdict === 'polish') {
      warnings.push('Editor verdict = polish. Nên trau chuốt kịch bản trước TTS.');
    }
  }

  if (input.requireHumanEdit && !input.humanEdited) {
    reasons.push(
      'Chưa tick "Đã sửa tay / Human Pass". YouTube-safe yêu cầu biên tập viên xác nhận trước TTS.',
    );
  }

  const platform = (input.ttsPlatform || '').toLowerCase();
  if (HIGH_RISK_TTS_PLATFORMS.has(platform)) {
    warnings.push(
      `Giọng ${platform} dễ trùng pattern kênh AI mass. Ưu tiên Gemini/OpenAI/OmniVoice/CapCut + pitch/speed series.`,
    );
  }

  const pitch = Number(input.ttsPitch ?? 0);
  const speed = Number(input.ttsSpeed ?? 1);
  if (pitch === 0 && Math.abs(speed - 1) < 0.01 && HIGH_RISK_TTS_PLATFORMS.has(platform)) {
    warnings.push(
      'Pitch=0 và Speed=1 trên giọng free: rất dễ "giọng AI phẳng". Đặt pitch ±1–2, speed ~0.95–1.03.',
    );
  }

  return {
    ok: reasons.length === 0,
    hardBlock: reasons.length > 0,
    reasons,
    warnings,
  };
}
