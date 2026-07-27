/**
 * Media-reference URL helpers shared by the browser client and server routes.
 *
 * `/api/serve-image?file=...` and `?path=...` are references, not plain paths.
 * Removing everything after the first `?` destroys the identity source.
 */

function asLocalUrl(raw: string): URL | null {
  try {
    return new URL(raw, 'http://ainovel.local');
  } catch {
    return null;
  }
}

export function stripImageCacheBust(raw?: string): string {
  const value = String(raw || '').trim();
  if (!value) return '';

  // Windows/local filesystem paths may contain a cache suffix but are not URLs.
  if (/^[A-Za-z]:[\\/]/u.test(value) || value.startsWith('file:')) {
    return value.replace(/([?&])t=\d+(?=(&|$))/u, '$1')
      .replace(/[?&]$/u, '');
  }

  const url = asLocalUrl(value);
  if (!url) {
    return value.replace(/([?&])t=\d+(?=(&|$))/u, '$1')
      .replace(/[?&]$/u, '');
  }

  url.searchParams.delete('t');
  const query = url.searchParams.toString();
  if (url.origin === 'http://ainovel.local') {
    return `${url.pathname}${query ? `?${query}` : ''}${url.hash}`;
  }
  return `${url.origin}${url.pathname}${query ? `?${query}` : ''}${url.hash}`;
}

export function appendImageCacheBust(
  raw: string,
  timestamp = Date.now(),
): string {
  const value = stripImageCacheBust(raw);
  if (!value) return '';
  return `${value}${value.includes('?') ? '&' : '?'}t=${timestamp}`;
}

/**
 * Convert a serve-image URL into a transport path that API routes can resolve.
 * `file=` stays project-relative; `path=` becomes its decoded absolute path.
 */
export function resolveImageReferenceTransportPath(raw?: string): string {
  let value = stripImageCacheBust(raw);
  if (!value) return '';

  try {
    const url = asLocalUrl(value);
    if (url && url.pathname.endsWith('/api/serve-image')) {
      const absolutePath = url.searchParams.get('path');
      if (absolutePath) return decodeURIComponent(absolutePath);
      const filename = url.searchParams.get('file');
      if (filename) {
        return `public/images/${decodeURIComponent(filename)
          .replace(/\\/gu, '/')
          .split('/')
          .pop()}`;
      }
    }
  } catch {
    // Keep the original reference so the server can return an actionable error.
  }

  if (value.startsWith('/images/')) {
    value = `public${value}`;
  } else if (value.startsWith('images/')) {
    value = `public/${value}`;
  }

  try {
    if (value.startsWith('file:')) {
      return decodeURIComponent(
        value.replace(/^file:\/\//u, '').replace(/^\/([A-Za-z]:)/u, '$1'),
      );
    }
  } catch {
    // Keep value below.
  }
  return value;
}
