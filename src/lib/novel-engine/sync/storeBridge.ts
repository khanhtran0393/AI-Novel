/**
 * Bridge: .ainovel-app chapters ↔ durable Zustand store backup (2 chiều).
 */
import { readStoreBackup, writeStoreBackup } from '@/lib/persistStore';
import { listChapters, loadChapter, saveChapter } from '../store/diskStore';
import { wordCount, type EngineChapter } from '../domain';
import { logEngine } from '../bus';

/** Đẩy chapter engine → store backup (Zustand durable). */
export function pushChapterToStoreBackup(chapter: EngineChapter): boolean {
  const raw = readStoreBackup();
  if (!raw) {
    logEngine('storeBridge: chưa có store backup — bỏ qua sync Zustand', 'info');
    return false;
  }
  try {
    const parsed = JSON.parse(raw);
    const hasWrapper = parsed && typeof parsed === 'object' && parsed.state;
    const state = hasWrapper ? { ...parsed.state } : { ...parsed };
    const list = Array.isArray(state.danh_sach_chuong) ? [...state.danh_sach_chuong] : [];
    const idx = list.findIndex((c: { so_chuong?: number }) => c.so_chuong === chapter.id);
    const row = {
      so_chuong: chapter.id,
      tieu_de: chapter.title,
      dan_y: chapter.dan_y,
      noi_dung: chapter.content,
      trang_thai: chapter.status === 'committed' ? 'ready' : list[idx]?.trang_thai || 'empty',
    };
    if (idx >= 0) list[idx] = { ...list[idx], ...row };
    else list.push(row);
    list.sort((a: { so_chuong: number }, b: { so_chuong: number }) => a.so_chuong - b.so_chuong);
    state.danh_sach_chuong = list;
    if (chapter.status === 'committed') {
      state.chuong_dang_chon = chapter.id;
    }
    const out = hasWrapper ? { ...parsed, state } : state;
    writeStoreBackup(JSON.stringify(out));
    logEngine(`🔄 Sync ch${chapter.id} → Zustand backup`, 'success');
    return true;
  } catch (err) {
    logEngine(
      `storeBridge push fail: ${err instanceof Error ? err.message : String(err)}`,
      'error',
    );
    return false;
  }
}

/** Kéo chương từ store backup → disk engine (khi Start). */
export function pullChaptersFromStoreBackup(): number {
  const raw = readStoreBackup();
  if (!raw) return 0;
  let n = 0;
  try {
    const parsed = JSON.parse(raw);
    const state = parsed?.state || parsed;
    const list = Array.isArray(state?.danh_sach_chuong) ? state.danh_sach_chuong : [];
    for (const c of list) {
      const id = Number(c.so_chuong);
      const content = String(c.noi_dung || '').trim();
      if (!id || !content) continue;
      const existing = loadChapter(id);
      // Không ghi đè bản engine dài hơn
      if (existing && wordCount(existing.content) >= wordCount(content)) continue;
      saveChapter({
        id,
        title: String(c.tieu_de || `Chương ${id}`),
        dan_y: String(c.dan_y || ''),
        content,
        wordCount: wordCount(content),
        status: c.trang_thai === 'ready' ? 'committed' : 'draft',
        updatedAt: new Date().toISOString(),
      });
      n += 1;
    }
    if (n > 0) logEngine(`📥 Pull ${n} chương từ store → engine disk`, 'success');
  } catch (err) {
    logEngine(
      `storeBridge pull fail: ${err instanceof Error ? err.message : String(err)}`,
      'error',
    );
  }
  return n;
}

export function exportEngineChapterIndex(): Array<{
  id: number;
  title: string;
  status: string;
  wordCount: number;
}> {
  return listChapters().map((c) => ({
    id: c.id,
    title: c.title,
    status: c.status,
    wordCount: c.wordCount,
  }));
}
