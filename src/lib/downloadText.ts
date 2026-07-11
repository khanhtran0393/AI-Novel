/**
 * Download / persist plain-text reports (browser + Electron).
 */

export function downloadTextFile(filename: string, content: string): void {
  if (typeof window === 'undefined') return;
  const safe = (filename || 'report.txt').replace(/[<>:"/\\|?*]+/g, '_');
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safe;
  a.click();
  URL.revokeObjectURL(url);
}

export type WriteTextResult = {
  ok: boolean;
  path?: string;
  error?: string;
  via?: 'electron' | 'download';
};

/**
 * Prefer Electron userData/reports; fallback to browser download.
 */
export async function persistTextReport(
  filename: string,
  content: string,
): Promise<WriteTextResult> {
  const safe = (filename || 'report.txt').replace(/[<>:"/\\|?*]+/g, '_');
  const api = typeof window !== 'undefined' ? window.ainovelTools : undefined;
  if (api?.writeTextFile) {
    try {
      const res = await api.writeTextFile({
        relativePath: safe,
        content,
        subdir: 'reports',
      });
      if (res?.ok && res.path) {
        return { ok: true, path: res.path, via: 'electron' };
      }
    } catch (e) {
      console.warn('[persistTextReport] electron failed', e);
    }
  }
  downloadTextFile(safe, content);
  return { ok: true, via: 'download' };
}
