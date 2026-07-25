/**
 * Lightweight global toast bus — no React dependency in producers.
 * ToastHost subscribes via subscribeToasts().
 * Messages are secret-masked before display.
 */

import { maskSecretsInText } from '@/lib/secrets';

export type ToastKind = 'info' | 'success' | 'warn' | 'error';

export type AppToast = {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string;
  /**
   * Optional long body (e.g. Quality Gate findings).
   * ToastHost: click toast → expand/collapse detail.
   */
  detail?: string;
  durationMs?: number;
  createdAt: number;
};

type Listener = (toast: AppToast) => void;

const listeners = new Set<Listener>();

export function subscribeToasts(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export type PushToastOptions = {
  durationMs?: number;
  detail?: string;
};

export function pushToast(
  kind: ToastKind,
  title: string,
  message?: string,
  durationMsOrOpts: number | PushToastOptions = 4500,
): string {
  const opts: PushToastOptions =
    typeof durationMsOrOpts === 'number'
      ? { durationMs: durationMsOrOpts }
      : durationMsOrOpts || {};
  const toast: AppToast = {
    id: `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    kind,
    title: maskSecretsInText(title),
    message: message != null ? maskSecretsInText(message) : undefined,
    detail: opts.detail != null ? maskSecretsInText(opts.detail) : undefined,
    durationMs: opts.durationMs ?? 4500,
    createdAt: Date.now(),
  };
  for (const fn of listeners) {
    try {
      fn(toast);
    } catch {
      /* ignore */
    }
  }
  return toast.id;
}

export const toast = {
  info: (title: string, message?: string, opts?: PushToastOptions) =>
    pushToast('info', title, message, opts ?? 4500),
  success: (title: string, message?: string, opts?: PushToastOptions) =>
    pushToast('success', title, message, opts ?? 4500),
  warn: (title: string, message?: string, opts?: PushToastOptions) =>
    pushToast('warn', title, message, opts ?? 4500),
  error: (title: string, message?: string, opts?: PushToastOptions) =>
    pushToast('error', title, message, {
      durationMs: 7000,
      ...opts,
    }),
};
