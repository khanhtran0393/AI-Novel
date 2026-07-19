/**
 * Next.js server boot — start Telegram long-poll when bot configured
 * (desktop: webhook empty → getUpdates handles Cấp Key / Từ chối).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'edge') return;
  try {
    const { telegramConfigured } = await import('@/lib/commercial/telegramNotify');
    if (!telegramConfigured()) return;
    const { ensureTelegramPoller } = await import('@/lib/commercial/telegramPoller');
    ensureTelegramPoller();
    console.log('[instrumentation] Telegram poller ensure()');
  } catch (e) {
    console.warn(
      '[instrumentation] Telegram poller skip:',
      e instanceof Error ? e.message : e,
    );
  }
}
