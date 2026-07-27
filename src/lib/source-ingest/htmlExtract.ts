/**
 * Lightweight HTML → article text (no jsdom / puppeteer).
 * Heuristics: og/meta → title; main/article body strip; fallback body text.
 */

import { MAX_SOURCE_TEXT_CHARS, MAX_WEB_DESC_CHARS } from './types';

export type HtmlExtractResult = {
  title: string;
  description: string;
  text: string;
  author: string;
  method: 'web_readability' | 'web_direct' | 'web_meta';
};

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function stripTags(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|h[1-6]|li|tr|br|section|article|blockquote|figcaption)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim(),
  );
}

function metaContent(html: string, names: string[]): string {
  for (const name of names) {
    const re = new RegExp(
      `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`,
      'i',
    );
    const re2 = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["']`,
      'i',
    );
    const m = html.match(re) || html.match(re2);
    if (m?.[1]) return decodeHtmlEntities(m[1].trim());
  }
  return '';
}

function titleFromHtml(html: string): string {
  const og = metaContent(html, ['og:title', 'twitter:title']);
  if (og) return og;
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (m?.[1]) return decodeHtmlEntities(stripTags(m[1])).slice(0, 300);
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1?.[1]) return decodeHtmlEntities(stripTags(h1[1])).slice(0, 300);
  return '';
}

function extractBlock(html: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = html.match(re);
  return m?.[1] ?? null;
}

function extractByRoleMain(html: string): string | null {
  const re = /<[^>]+role=["']main["'][^>]*>([\s\S]*?)<\/[a-z0-9]+>/i;
  const m = html.match(re);
  return m?.[1] ?? null;
}

function scoreTextBlock(text: string): number {
  const t = text.trim();
  if (t.length < 80) return 0;
  const sentences = (t.match(/[.!?。！？]\s/g) || []).length;
  const paras = (t.match(/\n\n/g) || []).length;
  return t.length + sentences * 40 + paras * 80;
}

/**
 * Pick best main content region from HTML.
 */
export function extractArticleFromHtml(
  html: string,
  opts?: { siteHost?: string; maxTextChars?: number },
): HtmlExtractResult {
  const maxChars = opts?.maxTextChars ?? MAX_SOURCE_TEXT_CHARS;
  const title = titleFromHtml(html).normalize('NFC');
  const description = metaContent(html, [
    'description',
    'og:description',
    'twitter:description',
  ])
    .slice(0, MAX_WEB_DESC_CHARS)
    .normalize('NFC');
  const author =
    metaContent(html, ['author', 'article:author', 'og:site_name']) ||
    (opts?.siteHost || '').replace(/^www\./, '');

  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '');

  const candidates: string[] = [];
  for (const tag of ['article', 'main']) {
    const block = extractBlock(cleaned, tag);
    if (block) candidates.push(block);
  }
  const roleMain = extractByRoleMain(cleaned);
  if (roleMain) candidates.push(roleMain);

  // Wikipedia / wiki / custom content container check
  const wikiContent = cleaned.match(/<div[^>]+id=["'](?:bodyContent|content|mw-content-text|article-body|main-content)["'][^>]*>([\s\S]*?)<\/div>/i);
  if (wikiContent?.[1]) candidates.push(wikiContent[1]);

  // Multiple articles: score each
  const articleGlobal = cleaned.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi);
  for (const m of articleGlobal) {
    if (m[1]) candidates.push(m[1]);
  }

  let bestText = '';
  let bestScore = 0;
  for (const c of candidates) {
    const text = stripTags(c);
    const sc = scoreTextBlock(text);
    if (sc > bestScore) {
      bestScore = sc;
      bestText = text;
    }
  }

  let method: HtmlExtractResult['method'] = 'web_readability';
  if (bestScore < 200) {
    // Fallback: whole body
    const body = extractBlock(cleaned, 'body') || cleaned;
    bestText = stripTags(body);
    method = 'web_direct';
  }

  // Drop ultra-noisy short leftovers
  bestText = bestText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => {
      if (!l) return false;
      if (/^(cookie|subscribe|sign in|đăng nhập|menu|home|search)$/i.test(l)) return false;
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .normalize('NFC');

  if (bestText.length > maxChars) {
    bestText = `${bestText.slice(0, maxChars - 1).trimEnd()}…`;
  }

  // Meta-only if body still too thin
  if (bestText.length < 80 && (title || description)) {
    method = 'web_meta';
    bestText = '';
  }

  return {
    title,
    description,
    text: bestText,
    author: author.normalize('NFC'),
    method,
  };
}

export function truncateSourceText(s: string, max = MAX_SOURCE_TEXT_CHARS): string {
  const t = (s || '').trim().normalize('NFC');
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

export function wordCountOf(s: string): number {
  return (s || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}
