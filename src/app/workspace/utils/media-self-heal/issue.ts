import type { MediaIssue } from './types';

export function firstKey(mainKey?: string, keys?: string[]) {
  return mainKey || (keys && keys.length > 0 ? keys[0] : '') || '';
}

export function classifyMediaError(error: unknown): MediaIssue {
  const message = error instanceof Error ? error.message : String(error || '');
  const normalized = message.toLowerCase();

  if (
    normalized.includes('incorrect api key') ||
    normalized.includes('invalid api key') ||
    normalized.includes('api key not valid') ||
    normalized.includes('unauthorized') ||
    normalized.includes('forbidden') ||
    normalized.includes('401') ||
    normalized.includes('403')
  ) {
    return { kind: 'invalid_key', message };
  }

  if (
    normalized.includes('vui long cau hinh') ||
    normalized.includes('vui lòng cấu hình') ||
    normalized.includes('missing api key') ||
    normalized.includes('khong co api key') ||
    normalized.includes('không có api key') ||
    normalized.includes('chua cau hinh')
  ) {
    return { kind: 'missing_key', message };
  }

  if (
    normalized.includes('quota') ||
    normalized.includes('rate limit') ||
    normalized.includes('too many requests') ||
    normalized.includes('429') ||
    normalized.includes('limit') ||
    normalized.includes('no credits') ||
    normalized.includes('credits or licenses') ||
    normalized.includes('licenses yet') ||
    normalized.includes('purchase those') ||
    normalized.includes('billing') ||
    normalized.includes('payment required') ||
    normalized.includes('insufficient balance')
  ) {
    return { kind: 'quota', message };
  }

  if (
    normalized.includes('module') ||
    normalized.includes('cannot find') ||
    normalized.includes('khong tim thay') ||
    normalized.includes('không tìm thấy') ||
    normalized.includes('sscronet') ||
    normalized.includes('capcut') ||
    normalized.includes('piper')
  ) {
    return { kind: 'missing_module', message };
  }

  if (
    normalized.includes('model') ||
    normalized.includes('not found') ||
    normalized.includes('unsupported') ||
    normalized.includes('404')
  ) {
    return { kind: 'model_mismatch', message };
  }

  if (
    normalized.includes('missing field') ||
    normalized.includes('invalid request') ||
    normalized.includes('bad request') ||
    normalized.includes('400')
  ) {
    return { kind: 'missing_field', message };
  }

  if (
    normalized.includes('cookie') ||
    normalized.includes('signin') ||
    normalized.includes('accounts.google.com') ||
    normalized.includes('whisk')
  ) {
    return { kind: 'cookie_auth', message };
  }

  if (
    normalized.includes('timeout') ||
    normalized.includes('network') ||
    normalized.includes('fetch failed') ||
    normalized.includes('econnreset')
  ) {
    return { kind: 'network', message };
  }

  return { kind: 'unknown', message };
}
