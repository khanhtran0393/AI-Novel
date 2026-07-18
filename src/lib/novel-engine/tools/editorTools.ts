/**
 * Editor / architect tools — arc summary, volume summary, foundation expand.
 */
import { type EngineProgress } from '../domain';
import { logEngine } from '../bus';
import {
  generateBaseUrl,
  loadProjectContext,
  resolveGenerateKeys,
  setupGenrePayload,
  type ProjectContext,
} from '../projectContext';
import { listChapters, saveProgress, writeJsonAtomicSafe } from '../store/diskStore';
import { recordCheckpoint } from '../engine';
import { buildNovelContext } from '../context/novelContext';
import { markArcSummaryDone, markVolumeSummaryDone } from '@/lib/pipeline';

async function postGenerate(
  requestType: string,
  payload: Record<string, unknown>,
  ctx: ProjectContext,
): Promise<Record<string, unknown>> {
  const { keysToUse, model } = resolveGenerateKeys(ctx);
  if (keysToUse.length === 0 && model !== 'aistudio') {
    throw new Error('Chưa có API Key.');
  }
  const res = await fetch(`${generateBaseUrl()}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestType, apiKeys: keysToUse, model, payload }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(data.error || `generate ${requestType} failed`));
  return data;
}

/** Tóm tắt cung — dựa trên các chương đã commit gần nhất */
export async function saveArcSummaryTool(progress: EngineProgress): Promise<EngineProgress> {
  const ctx = loadProjectContext();
  const chapters = listChapters().filter((c) => c.content.trim()).slice(-5);
  const body = chapters.map((c) => `### Ch${c.id} ${c.title}\n${c.content.slice(0, 1500)}`).join('\n\n');
  logEngine('📚 save_arc_summary…');

  const data = await postGenerate(
    'COMMIT_MEMORY',
    {
      ten_tac_pham: ctx.ten_tac_pham,
      chuong_hien_tai: {
        so_chuong: progress.currentChapter,
        tieu_de: `Arc summary @ ch${progress.currentChapter}`,
      },
      noi_dung_kich_ban: body || ctx.dan_y_tong_the,
      ...setupGenrePayload(ctx),
      tom_tat_cuon_chieu: ctx.tom_tat_cuon_chieu,
      tri_nho_ngan_han: ctx.tri_nho_ngan_han,
      lorebook: ctx.lorebook,
    },
    ctx,
  );
  const summary = String(data.tom_tat_cuon_chieu || data.summary || data.compressedMemory || '').trim();
  if (!summary) {
    throw new Error('COMMIT_MEMORY khong tra summary cho arc.');
  }

  writeJsonAtomicSafe('summaries/arc-latest.json', {
    atChapter: progress.currentChapter,
    summary,
    chapterIds: chapters.map((c) => c.id),
    updatedAt: new Date().toISOString(),
  });
  recordCheckpoint({
    step: 'arc_summary',
    scope: { kind: 'global' },
    payload: { summary },
    projectName: progress.projectName,
  });

  const updated = {
    ...progress,
    lastAction: 'Arc summary saved',
    updatedAt: new Date().toISOString(),
  };
  saveProgress(updated);
  // P2 — close arc-end window for Flow Router
  markArcSummaryDone(progress.currentChapter || progress.completedChapters.at(-1) || 0);
  logEngine('✅ Arc summary saved', 'success');
  return updated;
}

export async function saveVolumeSummaryTool(progress: EngineProgress): Promise<EngineProgress> {
  const ctx = loadProjectContext();
  const chapters = listChapters().filter((c) => c.content.trim());
  logEngine('📖 save_volume_summary…');
  const digest = chapters.map((c) => `Ch${c.id} (${c.wordCount} từ): ${c.title}`).join('\n');
  writeJsonAtomicSafe('summaries/volume-latest.json', {
    project: ctx.ten_tac_pham,
    totalChapters: chapters.length,
    digest,
    updatedAt: new Date().toISOString(),
  });
  recordCheckpoint({
    step: 'volume_summary',
    scope: { kind: 'global' },
    payload: { digest },
    projectName: progress.projectName,
  });
  const updated = {
    ...progress,
    lastAction: 'Volume summary saved',
    updatedAt: new Date().toISOString(),
  };
  saveProgress(updated);
  // P2
  markVolumeSummaryDone(progress.currentChapter || progress.completedChapters.at(-1) || 0);
  logEngine('✅ Volume summary saved', 'success');
  return updated;
}

/** Architect: expand next arc skeleton via GENERATE_CHAPTER_OUTLINE chain */
export async function expandArcTool(progress: EngineProgress): Promise<EngineProgress> {
  const ctx = loadProjectContext();
  const next = Math.min(progress.totalChapters, (progress.completedChapters.at(-1) || 0) + 1);
  logEngine(`🏗️ architect expand_arc → ch${next}`);
  const pack = buildNovelContext(next, ctx);
  const outline = await postGenerate(
    'GENERATE_CHAPTER_OUTLINE',
    {
      ten_tac_pham: ctx.ten_tac_pham,
      dan_y_tong_the: ctx.dan_y_tong_the,
      lorebook: ctx.lorebook,
      chuong_so: next,
      tom_tat_cuon_chieu: pack.scrollSummary,
      tri_nho_ngan_han: pack.shortTerm,
      ...setupGenrePayload(ctx),
    },
    ctx,
  );
  const danY = String(outline.dan_y || '').trim();
  if (!danY) {
    throw new Error(`GENERATE_CHAPTER_OUTLINE khong tra dan_y cho expand_arc ch${next}.`);
  }
  writeJsonAtomicSafe(`outline/expand-ch${String(next).padStart(2, '0')}.json`, {
    chapter: next,
    dan_y: danY,
    contextHint: pack.chapterPlan,
    updatedAt: new Date().toISOString(),
  });
  logEngine(`✅ expand_arc plan ch${next}`, 'success');
  const updated = {
    ...progress,
    lastAction: `Architect expanded outline ch${next}`,
    updatedAt: new Date().toISOString(),
  };
  saveProgress(updated);
  return updated;
}
