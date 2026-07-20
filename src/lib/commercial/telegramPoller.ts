/**
 * Desktop fallback when Telegram webhook URL is empty.
 * Long-polls getUpdates so ✅ Cấp Key / ❌ Từ chối work without Vercel.
 *
 * If webhook is set (Vercel), this poller stays idle (getUpdates conflicts).
 */
import {
  processTelegramUpdate,
  type TgUpdate,
} from '@/lib/commercial/telegramWebhookHandler';
import {
  telegramBotToken,
  telegramConfigured,
  telegramAdminChatId,
} from '@/lib/commercial/telegramNotify';

type PollerState = {
  running: boolean;
  offset: number;
  lastError?: string;
  lastOkAt?: number;
  mode: 'idle' | 'polling' | 'webhook-present' | 'error';
  startedAt?: number;
  processed: number;
};

const g = globalThis as unknown as {
  __ainovelTgPoller?: PollerState;
  __ainovelTgPollerTimer?: ReturnType<typeof setTimeout> | null;
  __ainovelTgPollerPromise?: Promise<void> | null;
};

function state(): PollerState {
  if (!g.__ainovelTgPoller) {
    g.__ainovelTgPoller = {
      running: false,
      offset: 0,
      mode: 'idle',
      processed: 0,
    };
  }
  return g.__ainovelTgPoller;
}

export function getTelegramPollerStatus(): PollerState & {
  configured: boolean;
  chatIdPresent: boolean;
} {
  const s = state();
  return {
    ...s,
    configured: telegramConfigured(),
    chatIdPresent: Boolean(telegramAdminChatId()),
  };
}

async function getWebhookUrl(token: string): Promise<string> {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/getWebhookInfo`,
      { signal: AbortSignal.timeout(10_000) },
    );
    const data = (await res.json()) as {
      ok?: boolean;
      result?: { url?: string };
    };
    return (data.result?.url || '').trim();
  } catch {
    return '';
  }
}

async function getUpdates(
  token: string,
  offset: number,
): Promise<{ updates: TgUpdate[]; error?: string }> {
  try {
    const url = new URL(`https://api.telegram.org/bot${token}/getUpdates`);
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('timeout', '25');
    url.searchParams.set('allowed_updates', JSON.stringify(['callback_query', 'message']));
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(35_000),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      description?: string;
      result?: TgUpdate[];
    };
    if (!data.ok) {
      return {
        updates: [],
        error: data.description || `getUpdates HTTP ${res.status}`,
      };
    }
    return { updates: Array.isArray(data.result) ? data.result : [] };
  } catch (e) {
    return {
      updates: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function pollLoop(): Promise<void> {
  const s = state();
  const token = telegramBotToken();
  if (!token || !telegramConfigured()) {
    s.mode = 'idle';
    s.running = false;
    return;
  }

  // If public webhook is set (Vercel), do not long-poll
  const hook = await getWebhookUrl(token);
  if (hook) {
    s.mode = 'webhook-present';
    s.running = false;
    s.lastError = undefined;
    console.log(
      `[TelegramPoller] Webhook đang gắn: ${hook} — bỏ long-poll (Vercel xử lý).`,
    );
    return;
  }

  s.mode = 'polling';
  s.running = true;
  s.startedAt = s.startedAt || Date.now();
  console.log(
    '[TelegramPoller] Webhook trống — long-poll getUpdates (nút Cấp Key / Từ chối trên desktop).',
  );

  while (s.running) {
    // Re-check webhook every ~cycle in case seller set it mid-run
    const hookNow = await getWebhookUrl(token);
    if (hookNow) {
      s.mode = 'webhook-present';
      s.running = false;
      console.log(`[TelegramPoller] Webhook mới: ${hookNow} — dừng poll.`);
      break;
    }

    const { updates, error } = await getUpdates(token, s.offset);
    if (error) {
      s.lastError = error;
      s.mode = 'error';
      // Conflict: webhook was set elsewhere
      if (/conflict|webhook/i.test(error)) {
        s.mode = 'webhook-present';
        s.running = false;
        console.warn('[TelegramPoller]', error);
        break;
      }
      console.warn('[TelegramPoller] getUpdates:', error);
      await new Promise((r) => setTimeout(r, 3000));
      s.mode = 'polling';
      continue;
    }

    s.lastError = undefined;
    s.lastOkAt = Date.now();
    s.mode = 'polling';

    for (const u of updates) {
      if (typeof u.update_id === 'number') {
        s.offset = u.update_id + 1;
      }
      try {
        await processTelegramUpdate(u);
        s.processed += 1;
      } catch (e) {
        console.error(
          '[TelegramPoller] process update failed',
          e instanceof Error ? e.message : e,
        );
      }
    }
  }
}

/**
 * Start long-poll if not already running. Safe to call often (idempotent).
 */
export function ensureTelegramPoller(): PollerState {
  const s = state();
  if (!telegramConfigured()) {
    s.mode = 'idle';
    return s;
  }
  if (s.running || g.__ainovelTgPollerPromise) {
    return s;
  }
  g.__ainovelTgPollerPromise = pollLoop()
    .catch((e) => {
      s.lastError = e instanceof Error ? e.message : String(e);
      s.mode = 'error';
      s.running = false;
    })
    .finally(() => {
      g.__ainovelTgPollerPromise = null;
      s.running = false;
      // Auto-restart after short delay if still no webhook
      if (s.mode !== 'webhook-present' && telegramConfigured()) {
        g.__ainovelTgPollerTimer = setTimeout(() => {
          g.__ainovelTgPollerTimer = null;
          ensureTelegramPoller();
        }, 5000);
      }
    });
  return s;
}

export function stopTelegramPoller(): void {
  const s = state();
  s.running = false;
  if (g.__ainovelTgPollerTimer) {
    clearTimeout(g.__ainovelTgPollerTimer);
    g.__ainovelTgPollerTimer = null;
  }
}
