/**
 * Generic web article channel — self-host first (direct fetch + HTML extract).
 * Optional Jina Reader only when AINOVEL_SOURCE_JINA=1.
 */

import { extractArticleFromHtml, truncateSourceText, wordCountOf } from '../htmlExtract';
import { assertSafePublicHttpUrl } from '../ssrf';
import {
  MAX_WEB_HTML_BYTES,
  type SourceChannel,
  type SourceFetchOpts,
  type SourceIngestResult,
} from '../types';

const DEFAULT_TIMEOUT_MS = 25_000;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function jinaEnabled(): boolean {
  const v = String(process.env.AINOVEL_SOURCE_JINA || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function buildUserError(code: string, detail: string): string {
  const fixes: Record<string, string[]> = {
    SSRF_BLOCKED: ['Chỉ dán link http/https công khai (không localhost / IP nội bộ).'],
    INVALID_URL: ['Kiểm tra lại URL (có https:// và hostname).'],
    TIMEOUT: ['Thử lại khi mạng ổn định.', 'Hoặc copy nội dung bài dán tay vào ô 3 Cốt truyện.'],
    NETWORK: ['Kiểm tra mạng / DNS.', 'Gõ tay cốt truyện ô 3 nếu site chặn bot.'],
    HTTP_ERROR: ['Site có thể chặn bot hoặc yêu cầu đăng nhập.', 'Copy text bài → dán ô 3.'],
    EMPTY_CONTENT: [
      'Trang không có bài viết đọc được (SPA / login wall).',
      'Copy nội dung chính → dán ô 3 Cốt truyện.',
    ],
    BODY_TOO_LARGE: ['Trang quá lớn — thử link bài viết cụ thể, không phải trang chủ.'],
    FETCH_FAILED: ['Fetch web thất bại.', 'Dán tay cốt truyện ô 3.'],
  };
  const tips = fixes[code] || ['Thử URL khác hoặc gõ tay ô 3.'];
  return [
    '❌ Không lấy được nội dung trang web.',
    '',
    `🔎 Vì sao: ${detail}`,
    '📍 Ở đâu: Bước «Phân tích» (kênh Web)',
    '✅ Cách khắc phục:',
    ...tips.map((t) => `• ${t}`),
  ].join('\n');
}

async function fetchHtml(
  url: string,
  timeoutMs: number,
): Promise<{ html: string; finalUrl: string; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'User-Agent': UA,
        'Accept-Language': 'vi,en;q=0.9',
      },
    });
    const finalUrl = res.url || url;
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_WEB_HTML_BYTES) {
      const tooBig = new Error('BODY_TOO_LARGE') as Error & { code?: string };
      tooBig.code = 'BODY_TOO_LARGE';
      throw tooBig;
    }
    // Prefer utf-8; latin1 fallback only if content-type says so (avoid BufferEncoding cast issues)
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const html =
      ct.includes('charset=iso-8859-1') || ct.includes('charset=latin1')
        ? buf.toString('latin1')
        : buf.toString('utf8');
    return { html, finalUrl, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchViaJina(url: string, timeoutMs: number): Promise<string> {
  const jinaUrl = `https://r.jina.ai/${url}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(jinaUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'text/plain',
        'User-Agent': UA,
      },
    });
    if (!res.ok) {
      throw new Error(`Jina HTTP ${res.status}`);
    }
    return (await res.text()).trim();
  } finally {
    clearTimeout(timer);
  }
}

export const webChannel: SourceChannel = {
  id: 'web',
  backends: ['direct_fetch+readability', 'jina_optional'],
  canHandle(url: string): boolean {
    const check = assertSafePublicHttpUrl(url);
    return check.ok;
  },
  async fetch(url: string, opts?: SourceFetchOpts): Promise<SourceIngestResult> {
    const chain: string[] = [];
    const safe = assertSafePublicHttpUrl(url);
    if (!safe.ok) {
      return {
        ok: false,
        platform: 'web',
        url: String(url || '').trim(),
        errorCode: 'SSRF_BLOCKED',
        error: buildUserError('SSRF_BLOCKED', safe.reason),
        chain: ['ssrf_blocked'],
      };
    }

    const target = safe.url.toString();
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const siteHost = safe.url.hostname;

    try {
      chain.push('direct_fetch');
      const { html, finalUrl } = await fetchHtml(target, timeoutMs);
      chain.push('html_extract');
      const extracted = extractArticleFromHtml(html, { siteHost });
      const text = truncateSourceText(extracted.text);
      const title = extracted.title;
      const description = extracted.description;
      const author = extracted.author || siteHost.replace(/^www\./, '');

      if (text.length >= 80) {
        chain.push(extracted.method);
        return {
          ok: true,
          platform: 'web',
          url: finalUrl,
          title,
          author,
          description,
          text,
          wordCount: wordCountOf(text),
          source: extracted.method,
          chain,
        };
      }

      // Thin body: try optional Jina before giving meta-only soft path
      if (jinaEnabled()) {
        chain.push('jina_reader');
        try {
          const jinaText = truncateSourceText(await fetchViaJina(finalUrl || target, timeoutMs));
          if (jinaText.length >= 80) {
            // Jina returns markdown-ish; first line often Title: …
            let jTitle = title;
            const titleLine = jinaText.match(/^Title:\s*(.+)$/im);
            if (titleLine?.[1]) jTitle = titleLine[1].trim();
            return {
              ok: true,
              platform: 'web',
              url: finalUrl,
              title: jTitle || title,
              author,
              description,
              text: jinaText,
              wordCount: wordCountOf(jinaText),
              source: 'web_jina',
              chain,
            };
          }
        } catch (jErr) {
          chain.push(
            `jina_fail:${jErr instanceof Error ? jErr.message.slice(0, 40) : 'err'}`,
          );
        }
      }

      // Soft path: metadata only (client may seed plot)
      if (title || description) {
        chain.push('web_meta');
        return {
          ok: false,
          platform: 'web',
          url: finalUrl,
          title,
          author,
          description,
          text: undefined,
          source: 'web_meta',
          chain,
          errorCode: 'EMPTY_CONTENT',
          error: buildUserError(
            'EMPTY_CONTENT',
            'HTML có tiêu đề/mô tả nhưng không trích được thân bài (SPA / paywall / anti-bot).',
          ),
        };
      }

      return {
        ok: false,
        platform: 'web',
        url: finalUrl,
        errorCode: 'EMPTY_CONTENT',
        error: buildUserError('EMPTY_CONTENT', 'Không trích được text từ trang.'),
        chain,
      };
    } catch (e) {
      const err = e as Error & { status?: number; code?: string; name?: string };
      if (err.code === 'BODY_TOO_LARGE' || err.message === 'BODY_TOO_LARGE') {
        return {
          ok: false,
          platform: 'web',
          url: target,
          errorCode: 'BODY_TOO_LARGE',
          error: buildUserError('BODY_TOO_LARGE', 'HTML vượt giới hạn 2MB.'),
          chain,
        };
      }
      if (err.name === 'AbortError') {
        return {
          ok: false,
          platform: 'web',
          url: target,
          errorCode: 'TIMEOUT',
          error: buildUserError('TIMEOUT', `Hết thời gian chờ (${timeoutMs}ms).`),
          chain: [...chain, 'timeout'],
        };
      }
      if (typeof err.status === 'number') {
        return {
          ok: false,
          platform: 'web',
          url: target,
          errorCode: 'HTTP_ERROR',
          error: buildUserError('HTTP_ERROR', `Máy chủ trả ${err.status}.`),
          chain: [...chain, `http_${err.status}`],
        };
      }
      return {
        ok: false,
        platform: 'web',
        url: target,
        errorCode: 'NETWORK',
        error: buildUserError(
          'NETWORK',
          err.message || 'Lỗi mạng khi fetch trang.',
        ),
        chain: [...chain, 'network_error'],
      };
    }
  },
};
