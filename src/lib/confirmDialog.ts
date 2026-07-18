/**
 * Promise-based confirm / alert bus — no React dependency in producers.
 * ConfirmHost subscribes and renders a cyberpunk glass modal.
 * Drop-in replacement for window.confirm / window.alert.
 */

export type ConfirmTone = 'danger' | 'warn' | 'info' | 'success';

export type ConfirmRequest = {
  id: string;
  title: string;
  message: string;
  /** Optional bullet / secondary lines under message */
  details?: string[];
  confirmLabel: string;
  cancelLabel: string;
  tone: ConfirmTone;
  /** alert mode: single OK button, always resolves true */
  mode: 'confirm' | 'alert';
  createdAt: number;
};

export type ConfirmOptions = {
  title?: string;
  message: string;
  details?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
};

type Pending = {
  req: ConfirmRequest;
  resolve: (ok: boolean) => void;
};

type Listener = (req: ConfirmRequest | null) => void;

const listeners = new Set<Listener>();
const queue: Pending[] = [];
let active: Pending | null = null;

function newId(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function publish(): void {
  const payload = active?.req ?? null;
  for (const fn of listeners) {
    try {
      fn(payload);
    } catch {
      /* ignore */
    }
  }
}

function dequeue(): void {
  active = queue.shift() || null;
  publish();
}

function enqueue(req: ConfirmRequest): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const item: Pending = { req, resolve };
    if (!active) {
      active = item;
      publish();
    } else {
      queue.push(item);
    }
  });
}

/** Subscribe to the active confirm request (or null when idle). */
export function subscribeConfirm(fn: Listener): () => void {
  listeners.add(fn);
  // Replay current
  try {
    fn(active?.req ?? null);
  } catch {
    /* ignore */
  }
  return () => listeners.delete(fn);
}

/** Resolve current dialog from ConfirmHost. */
export function resolveConfirm(id: string, ok: boolean): void {
  if (!active || active.req.id !== id) return;
  const { resolve } = active;
  active = null;
  publish();
  resolve(ok);
  // Next in queue
  if (queue.length) {
    // Defer so UI can unmount/remount cleanly
    queueMicrotask(() => dequeue());
  }
}

/**
 * App-styled confirm. Returns true if user confirms.
 * @example await appConfirm({ title: 'Xóa', message: '…', tone: 'danger' })
 */
export function appConfirm(
  messageOrOpts: string | ConfirmOptions,
): Promise<boolean> {
  const opts: ConfirmOptions =
    typeof messageOrOpts === 'string'
      ? { message: messageOrOpts }
      : messageOrOpts;

  const tone = opts.tone || 'warn';
  const req: ConfirmRequest = {
    id: newId(),
    title: opts.title || defaultTitle(tone),
    message: String(opts.message || '').trim() || 'Bạn có chắc không?',
    details: opts.details?.filter(Boolean),
    confirmLabel: opts.confirmLabel || defaultConfirmLabel(tone),
    cancelLabel: opts.cancelLabel || 'Hủy',
    tone,
    mode: 'confirm',
    createdAt: Date.now(),
  };
  return enqueue(req);
}

/** App-styled alert (single OK). Always resolves true. */
export function appAlert(
  messageOrOpts: string | Omit<ConfirmOptions, 'cancelLabel'>,
): Promise<boolean> {
  const opts =
    typeof messageOrOpts === 'string'
      ? { message: messageOrOpts }
      : messageOrOpts;
  const tone = opts.tone || 'info';
  const req: ConfirmRequest = {
    id: newId(),
    title: opts.title || 'Thông báo',
    message: String(opts.message || '').trim() || '',
    details: opts.details?.filter(Boolean),
    confirmLabel: opts.confirmLabel || 'Đã hiểu',
    cancelLabel: '',
    tone,
    mode: 'alert',
    createdAt: Date.now(),
  };
  return enqueue(req);
}

function defaultTitle(tone: ConfirmTone): string {
  if (tone === 'danger') return 'Xác nhận nguy hiểm';
  if (tone === 'warn') return 'Xác nhận';
  if (tone === 'success') return 'Tiếp tục?';
  return 'Xác nhận';
}

function defaultConfirmLabel(tone: ConfirmTone): string {
  if (tone === 'danger') return 'Xác nhận xóa';
  if (tone === 'warn') return 'Tiếp tục';
  if (tone === 'success') return 'Đồng ý';
  return 'OK';
}

/**
 * Parse a multi-line native-style confirm string into title + body + details.
 * Helps migrate long confirm("a\nb\nc") strings without rewriting copy.
 */
export function splitConfirmBody(raw: string): {
  message: string;
  details?: string[];
} {
  const lines = String(raw || '')
    .replace(/^[⚠️🚫✨🎉]+\s*/u, '')
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length <= 1) return { message: lines[0] || raw };
  // Bullet lines (• / - )
  const bullets = lines.filter((l) => /^[•\-*]/.test(l));
  if (bullets.length) {
    const head = lines.filter((l) => !/^[•\-*]/.test(l));
    return {
      message: head.join(' ') || lines[0],
      details: bullets.map((b) => b.replace(/^[•\-*]\s*/, '')),
    };
  }
  return {
    message: lines[0],
    details: lines.slice(1),
  };
}
