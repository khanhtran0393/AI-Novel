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
  durationMs?: number;
  createdAt: number;
};

type Listener = (toast: AppToast) => void;

const listeners = new Set<Listener>();

export function subscribeToasts(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function pushToast(
  kind: ToastKind,
  title: string,
  message?: string,
  durationMs = 4500,
): string {
  const toast: AppToast = {
    id: `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    kind,
    title: maskSecretsInText(title),
    message: message != null ? maskSecretsInText(message) : undefined,
    durationMs,
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
  info: (title: string, message?: string) => pushToast('info', title, message),
  success: (title: string, message?: string) => pushToast('success', title, message),
  warn: (title: string, message?: string) => pushToast('warn', title, message),
  error: (title: string, message?: string) => pushToast('error', title, message, 7000),
};
