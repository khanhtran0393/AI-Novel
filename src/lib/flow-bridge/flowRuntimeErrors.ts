/**
 * Google Flow / Labs error taxonomy (standard).
 * Maps HTTP + aisandbox body reasons → RetryCategory + VN action message.
 * B10: never auto-swap model/provider — only suggest user actions.
 */
import type { RetryCategory } from './types';

export type FlowErrorDetail = {
  category: RetryCategory;
  /** Short technical message (logs / task.error) */
  technical: string;
  /** User-facing Vietnamese, actionable */
  userMessage: string;
  /** Optional next steps (UI can show as tips) */
  suggestions: string[];
  permanent: boolean;
};

const GOOGLE_REASON_HINTS: Array<{
  re: RegExp;
  category: RetryCategory;
  userMessage: string;
  suggestions: string[];
  permanent?: boolean;
}> = [
  {
    // Explicit Google quota reasons only — avoid bare resource_exhausted (often soft overload)
    re: /public_error_user_quota_reached|per_model_daily_quota|public_error_per_model_daily_quota|\bquotas?\b|\bcredits?\b|\bpaygate\b/i,
    category: 'quota',
    userMessage:
      'Google Flow hết quota / credits cho model hiện tại trên tài khoản này.',
    suggestions: [
      'Đổi sang tài khoản Google Labs khác (Media Config).',
      'Đổi model (ví dụ Nano Banana 2 ↔ Pro, hoặc Veo Fast) — do bạn chọn, app không tự đổi.',
      'Chờ reset quota ngày của Google rồi thử lại.',
    ],
    permanent: true,
  },
  {
    // Soft capacity / overload — retryable, not permanent quota.
    // Do NOT bare-match "500" (false positive inside "180000ms").
    re: /resource_exhausted|high.?traffic|try.?again.?later|\bunavailable\b|\bHTTP\s*50[023]\b|\bstatus[=:\s]*50[023]\b/i,
    category: 'rate_429',
    userMessage: 'Google Labs đang quá tải hoặc tạm không phản hồi. Sẽ thử lại.',
    suggestions: [
      'Chờ 15–60s; queue sẽ retry tự động.',
      'Giảm parallel / tăng delay giữa shot.',
    ],
  },
  {
    re: /google_challenge_timeout|google_challenge_required|google\.com\/sorry|sorry\/index/i,
    category: 'forbidden_403',
    userMessage:
      'Google chặn bot (trang /sorry/ — tick “Tôi không phải là người máy”). App đã đưa cửa sổ Chromium ra màn hình; nếu còn captcha ảnh hãy tick tay rồi gen lại.',
    suggestions: [
      'Nhìn cửa sổ Chromium/Flow: tick checkbox reCAPTCHA (và captcha ảnh nếu có).',
      'Không minimize cửa sổ khi đang gen — app cần tab Flow sạch sau /sorry/.',
      'Giảm parallel / gắn proxy riêng account nếu hay dính /sorry/.',
    ],
  },
  {
    re: /public_error_unusual_activity|unusual.?activity|\brecaptcha\b|\bcaptcha\b|verification.?required/i,
    category: 'forbidden_403',
    userMessage:
      'Google Labs yêu cầu xác minh (reCAPTCHA / unusual activity). Phiên trình duyệt cần làm mới.',
    suggestions: [
      'Mở lại tab Flow / đăng nhập lại profile bị dính.',
      'Nếu thấy trang google.com/sorry: tick captcha trên cửa sổ Chromium (app tự đưa cửa sổ ra).',
      'Giảm tốc độ gen; bật delay queue (đã có jitter chuẩn).',
      'Nếu farm nhiều: gắn proxy riêng cho account (Media Config) — không tự đổi engine.',
    ],
  },
  {
    re: /public_error_sexual|public_error_unsafe|unsafe.?generation|\bsafety\b|content.?policy|blocked.?by.?policy/i,
    category: 'content',
    userMessage:
      'Prompt bị Google Labs từ chối (nội dung không an toàn / policy).',
    suggestions: [
      'Viết lại prompt rõ ràng hơn, tránh nội dung nhạy cảm.',
      'Tách shot / bỏ chi tiết gây chặn policy.',
    ],
    permanent: true,
  },
  {
    re: /unauthor|unauthent|invalid.?token|access.?token|login.?required|\b401\b|session.?expired|no_flow_key|flow.?key/i,
    category: 'token_401',
    userMessage: 'Token Google Flow hết hạn hoặc profile chưa có Bearer hợp lệ.',
    suggestions: [
      'Media Config → profile → Đăng nhập Google / Refresh tab Flow.',
      'Đợi extension bắt lại token (đèn Token xanh) rồi gen lại.',
    ],
  },
  {
    re: /rate.?limit|too many requests|\b429\b|throttl/i,
    category: 'rate_429',
    userMessage: 'Google đang giới hạn tần suất (rate limit).',
    suggestions: [
      'Chờ 15–60s rồi gen tiếp (queue đã có delay + retry).',
      'Giảm parallel; ưu tiên 1 task / account.',
    ],
  },
  {
    re: /\beconn|\betimedout|\bnetwork\b|\btimeout\b|\bsocket\b|fetch failed|\baborted\b|\boffline\b|extension.*offline|socket offline/i,
    category: 'network',
    userMessage: 'Mất kết nối tới Google Labs / bridge / extension.',
    suggestions: [
      'Kiểm tra mạng và trạng thái Bridge + Extension (Media Config).',
      'Thử Refresh tab Flow hoặc mở lại Chrome profile.',
    ],
  },
  {
    re: /invalid.?argument|invalid.?model|videomodelkey|model.?key|mismatched|bad request|\b422\b|\b404\b/i,
    category: 'content',
    userMessage: 'Payload / model không hợp lệ với endpoint Google Flow.',
    suggestions: [
      'Chọn đúng model cho T2V / I2V / Ingredients / Extend trong UI.',
      'Không dùng key model của family khác (B10: app không auto-swap).',
    ],
    permanent: true,
  },
  {
    re: /unknown name|invalid json payload|cannot find field|end_image|start_image|reference_images/i,
    category: 'content',
    userMessage:
      'Schema ảnh start/end/ref gửi Google Flow sai field (payload bị từ chối).',
    suggestions: [
      'Cập nhật app / restart server để nạp payload I2V mediaId mới.',
      'I2V: 1 ảnh start + model I2V; First+Last cần ảnh end khác start.',
      'R2V/Ingredients: model nhánh reference (r2v), không nhét I2V key.',
    ],
    permanent: true,
  },
];

function extractHttpCode(status?: number, message?: string): number | undefined {
  if (status && status >= 100) return status;
  const raw = message || '';
  const m =
    raw.match(/\bHTTP\s*(\d{3})\b/i) ||
    raw.match(/\bstatus[=:\s]+(\d{3})\b/i);
  return m ? Number(m[1]) : undefined;
}

/**
 * Classify Google Flow / Labs errors for retry policy.
 * Prefer Google PUBLIC_ERROR_* / body text over bare HTTP when present.
 */
export function classifyFlowError(
  status?: number,
  message?: string,
): RetryCategory {
  return describeFlowError(status, message).category;
}

export function describeFlowError(
  status?: number,
  message?: string,
): FlowErrorDetail {
  const technical = String(message || '').trim() || `HTTP ${status || '?'}`;
  const code = extractHttpCode(status, technical);
  const blob = `${code || ''} ${technical}`;

  for (const hint of GOOGLE_REASON_HINTS) {
    if (hint.re.test(blob)) {
      const permanent =
        hint.permanent === true ||
        hint.category === 'content' ||
        hint.category === 'quota';
      return {
        category: hint.category,
        technical,
        userMessage: hint.userMessage,
        suggestions: hint.suggestions,
        permanent,
      };
    }
  }

  if (code === 401) {
    return {
      category: 'token_401',
      technical,
      userMessage: 'Phiên Google Flow chưa xác thực (401).',
      suggestions: ['Đăng nhập lại profile và chờ token Bearer.'],
      permanent: false,
    };
  }
  if (code === 429) {
    return {
      category: 'rate_429',
      technical,
      userMessage: 'Google rate limit (429).',
      suggestions: ['Chờ rồi thử lại; giảm song song.'],
      permanent: false,
    };
  }
  if (code === 403) {
    return {
      category: 'forbidden_403',
      technical,
      userMessage: 'Google từ chối yêu cầu (403) — captcha / quyền / policy.',
      suggestions: [
        'Refresh tab Flow, xác minh captcha nếu có.',
        'Đổi account nếu profile bị cooldown.',
      ],
      permanent: false,
    };
  }
  if (code === 400 || code === 404 || code === 422) {
    return {
      category: 'content',
      technical,
      userMessage: 'Yêu cầu gen không hợp lệ với Google Flow.',
      suggestions: ['Kiểm tra model, projectId, prompt và ảnh start/ref.'],
      permanent: true,
    };
  }

  return {
    category: 'other',
    technical,
    userMessage: technical.slice(0, 280) || 'Lỗi Google Flow không xác định.',
    suggestions: ['Xem log FlowQueue; thử lại hoặc đổi account.'],
    permanent: false,
  };
}

export function isPermanentFlowFailure(
  category: RetryCategory,
  message?: string,
): boolean {
  if (category === 'content' || category === 'quota') return true;
  const d = describeFlowError(undefined, message);
  return d.permanent;
}

/** Format for task.error + toast (technical kept, user message first). */
export function formatFlowTaskError(detail: FlowErrorDetail): string {
  const tips =
    detail.suggestions.length > 0
      ? `\n→ ${detail.suggestions[0]}`
      : '';
  if (detail.userMessage === detail.technical) {
    return `${detail.userMessage}${tips}`;
  }
  return `${detail.userMessage}${tips}\n(${detail.technical.slice(0, 180)})`;
}
