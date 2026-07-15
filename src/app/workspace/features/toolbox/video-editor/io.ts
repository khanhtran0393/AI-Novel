import { API } from '@/contracts';
import { toast } from '@/lib/toastBus';
import type { LocalFileKind } from './types';

export async function readStreamingText(res: Response, onChunk: (chunk: string) => void) {
  if (!res.body) throw new Error('Stream API khong hoat dong');
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let fullText = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    const chunk = decoder.decode(value, { stream: true });
    fullText += chunk;
    onChunk(chunk);
  }
  return fullText;
}

export async function selectLocalFiles(kind: LocalFileKind, title: string, multi = false) {
  try {
    const res = await fetch(API.capassistant.selectFile, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, title, multi }),
    });
    const data = await res.json();
    if (data?.paths?.length) return data.paths as string[];
    return [];
  } catch {
    const p = prompt(`${title} - nhap duong dan file:`, '');
    return p ? [p] : [];
  }
}

export async function readTextFile(filePath: string) {
  const res = await fetch(API.capassistant.fileText, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'read', path: filePath }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || 'Khong doc duoc file.');
  return String(data.content || '');
}

export async function writeTextFile(filePath: string, content: string) {
  const res = await fetch(API.capassistant.fileText, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'write', path: filePath, content }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || 'Khong ghi duoc file.');
}

export async function openLocalPath(
  targetPath: string,
  appendPanelLog?: (message: string) => void,
) {
  if (!targetPath) {
    toast.info('Notice', 'Chua co file de mo.');
    return;
  }
  const res = await fetch(API.capassistant.openPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: targetPath }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    toast.info('Notice', `Khong mo duoc file: ${data.error || 'unknown error'}`);
    return;
  }
  appendPanelLog?.(`[OPEN] ${data.opened}`);
}
