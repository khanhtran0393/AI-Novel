/**
 * Writer / editor tools — gọi /api/generate native (không qua Go CLI).
 */
import {
  type EngineChapter,
  type EngineProgress,
  nextChapter,
  wordCount,
} from '../domain';
import { logEngine } from '../bus';
import {
  generateBaseUrl,
  loadProjectContext,
  resolveGenerateKeys,
  setupGenrePayload,
  type ProjectContext,
} from '../projectContext';
import { loadChapter, saveChapter, saveProgress } from '../store/diskStore';
import { recordCheckpoint } from '../engine';
import { buildNovelContext } from '../context/novelContext';
import { checkChapterAgainstRules, resolveRulesForProject } from '../rules/checker';
import { pushChapterToStoreBackup } from '../sync/storeBridge';

async function postGenerate(
  requestType: string,
  payload: Record<string, unknown>,
  ctx: ProjectContext,
): Promise<Record<string, unknown>> {
  const { keysToUse, model } = resolveGenerateKeys(ctx);
  if (keysToUse.length === 0 && model !== 'aistudio') {
    throw new Error('Chưa có API Key trong store app. Cấu hình ở Header trước khi Start Engine.');
  }

  const res = await fetch(`${generateBaseUrl()}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestType,
      apiKeys: keysToUse,
      model,
      payload,
    }),
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(String(data.error || `generate ${requestType} failed (${res.status})`));
  }
  return data;
}

function chapterMeta(ctx: ProjectContext, chapterNum: number): {
  so_chuong: number;
  tieu_de: string;
  dan_y: string;
  noi_dung: string;
} {
  const found = ctx.danh_sach_chuong.find((c) => c.so_chuong === chapterNum);
  if (!found) {
    throw new Error(`Khong tim thay metadata chuong ${chapterNum}. App khong tu tao chapter thay the.`);
  }
  const title = String(found.tieu_de || '').trim();
  if (!title) {
    throw new Error(`Chuong ${chapterNum} thieu tieu_de. App khong tu tao tieu de thay the.`);
  }
  return {
    so_chuong: found.so_chuong,
    tieu_de: title,
    dan_y: found.dan_y || '',
    noi_dung: found.noi_dung || '',
  };
}

/** Plan (outline detail) — lightweight local if no GENERATE_CHAPTER_OUTLINE needed */
export async function planChapterTool(
  chapterNum: number,
  progress: EngineProgress,
): Promise<EngineChapter> {
  const ctx = loadProjectContext();
  const meta = chapterMeta(ctx, chapterNum);
  logEngine(`📋 plan_chapter: Chương ${chapterNum} — ${meta.tieu_de}`);

  let dan_y = meta.dan_y;
  if (!dan_y.trim() && ctx.dan_y_tong_the.trim()) {
    const data = await postGenerate(
      'GENERATE_CHAPTER_OUTLINE',
      {
        ten_tac_pham: ctx.ten_tac_pham,
        dan_y_tong_the: ctx.dan_y_tong_the,
        lorebook: ctx.lorebook,
        chuong_so: chapterNum,
        tom_tat_cuon_chieu: ctx.tom_tat_cuon_chieu,
        tri_nho_ngan_han: ctx.tri_nho_ngan_han,
        ...setupGenrePayload(ctx),
      },
      ctx,
    );
    dan_y = String(data.dan_y || data.outline || '').trim();
    if (!dan_y) {
      throw new Error(`GENERATE_CHAPTER_OUTLINE khong tra dan_y cho chuong ${chapterNum}.`);
    }
  }
  if (!dan_y.trim()) {
    throw new Error(`Chuong ${chapterNum} thieu dan_y. App khong tu tao dan_y thay the.`);
  }

  const chapter: EngineChapter = {
    id: chapterNum,
    title: meta.tieu_de,
    dan_y,
    content: loadChapter(chapterNum)?.content || '',
    wordCount: 0,
    status: 'planned',
    updatedAt: new Date().toISOString(),
  };
  chapter.wordCount = wordCount(chapter.content);
  saveChapter(chapter);
  recordCheckpoint({
    step: 'plan',
    scope: { kind: 'chapter', chapter: chapterNum },
    payload: { chapter },
    projectName: progress.projectName,
  });
  return chapter;
}

/** Draft chapter content via WRITE_CHAPTER */
export async function draftChapterTool(
  chapterNum: number,
  progress: EngineProgress,
  opts?: { overwrite?: boolean },
): Promise<EngineChapter> {
  const ctx = loadProjectContext();
  const existing = loadChapter(chapterNum);
  const meta = chapterMeta(ctx, chapterNum);
  const planned = existing || (await planChapterTool(chapterNum, progress));

  logEngine(`✍️ draft_chapter: Chương ${chapterNum} (${progress.projectName})`);

  const pack = buildNovelContext(chapterNum, ctx);
  const baseContent = opts?.overwrite ? '' : planned.content || meta.noi_dung || '';
  const data = await postGenerate(
    'WRITE_CHAPTER',
    {
      ten_tac_pham: ctx.ten_tac_pham,
      dan_y_tong_the: pack.outline || ctx.dan_y_tong_the,
      nhan_vat: ctx.nhan_vat,
      nhan_vat_prompts: ctx.nhan_vat_prompts,
      chuong_hien_tai: {
        so_chuong: chapterNum,
        tieu_de: planned.title || meta.tieu_de,
        dan_y: planned.dan_y || pack.chapterPlan || meta.dan_y,
        noi_dung: baseContent,
      },
      tom_tat_cuon_chieu: pack.scrollSummary || ctx.tom_tat_cuon_chieu,
      tri_nho_ngan_han: pack.shortTerm.length ? pack.shortTerm : ctx.tri_nho_ngan_han,
      lorebook: pack.lorebook || ctx.lorebook,
      so_tu_chuong: ctx.so_tu_chuong,
      ngon_ngu: ctx.ngon_ngu,
      noi_dung_hien_tai: baseContent,
      userRules: ctx.userRules,
      ...setupGenrePayload(ctx),
    },
    ctx,
  );

  // WRITE_CHAPTER may return stream-style or { noi_dung } / text
  let newPart = '';
  if (typeof data.noi_dung === 'string') newPart = data.noi_dung;
  else if (typeof data.content === 'string') newPart = data.content;
  else if (typeof data.text === 'string') newPart = data.text;
  else if (typeof data.result === 'string') newPart = data.result;

  if (!newPart.trim()) {
    throw new Error('WRITE_CHAPTER không trả nội dung.');
  }

  const full = baseContent
    ? `${baseContent.trim()}\n\n${newPart.trim()}`
    : newPart.trim();

  const chapter: EngineChapter = {
    id: chapterNum,
    title: planned.title || meta.tieu_de,
    dan_y: planned.dan_y || meta.dan_y,
    content: full.normalize('NFC'),
    wordCount: wordCount(full),
    status: 'draft',
    updatedAt: new Date().toISOString(),
  };
  saveChapter(chapter);
  recordCheckpoint({
    step: 'draft',
    scope: { kind: 'chapter', chapter: chapterNum },
    payload: {
      chapter: {
        so_chuong: chapter.id,
        tieu_de: chapter.title,
        dan_y: chapter.dan_y,
        noi_dung: chapter.content,
      },
    },
    projectName: progress.projectName,
  });
  logEngine(
    `✅ Draft ch${chapterNum}: ${chapter.wordCount} từ`,
    'success',
  );
  return chapter;
}

/** Commit chapter — mark complete, optional memory commit */
export async function commitChapterTool(
  chapterNum: number,
  progress: EngineProgress,
): Promise<EngineProgress> {
  const chapter = loadChapter(chapterNum);
  if (!chapter?.content?.trim()) {
    throw new Error(`Chương ${chapterNum} chưa có nội dung để commit.`);
  }

  // Rules gate (CLI checker parity)
  const ctxRules = loadProjectContext();
  const rules = resolveRulesForProject(ctxRules.userRules);
  const findings = checkChapterAgainstRules(chapter.content, rules);
  const hardErrors = findings.filter((f) => f.severity === 'error');
  for (const f of findings) {
    logEngine(`rules[${f.severity}] ${f.rule}: ${f.message}`, f.severity === 'error' ? 'error' : 'info');
  }
  if (hardErrors.length >= 3) {
    logEngine(`⛔ Rules hard-fail (${hardErrors.length} errors) — queue rewrite`, 'error');
    const updatedFail: EngineProgress = {
      ...progress,
      flow: 'rewriting',
      pendingRewrites: Array.from(new Set([chapterNum, ...progress.pendingRewrites])),
      lastAction: `Rules blocked commit ch${chapterNum}`,
      updatedAt: new Date().toISOString(),
    };
    saveProgress(updatedFail);
    chapter.status = 'draft';
    saveChapter(chapter);
    return updatedFail;
  }

  await postGenerate(
    'COMMIT_MEMORY',
    {
      ten_tac_pham: ctxRules.ten_tac_pham,
      chuong_hien_tai: {
        so_chuong: chapterNum,
        tieu_de: chapter.title,
        dan_y: chapter.dan_y,
      },
      noi_dung_kich_ban: chapter.content,
      tom_tat_cuon_chieu: ctxRules.tom_tat_cuon_chieu,
      tri_nho_ngan_han: ctxRules.tri_nho_ngan_han,
      lorebook: ctxRules.lorebook,
      ...setupGenrePayload(ctxRules),
    },
    ctxRules,
  );
  logEngine(`🧠 COMMIT_MEMORY ch${chapterNum} OK`, 'success');

  chapter.status = 'committed';
  saveChapter(chapter);
  pushChapterToStoreBackup(chapter);

  const completed = Array.from(new Set([...progress.completedChapters, chapterNum])).sort(
    (a, b) => a - b,
  );
  const pendingRewrites = progress.pendingRewrites.filter((c) => c !== chapterNum);
  const next = nextChapter({
    ...progress,
    completedChapters: completed,
  });

  const updated: EngineProgress = {
    ...progress,
    completedChapters: completed,
    pendingRewrites,
    currentChapter: next > 0 ? next : chapterNum,
    flow: 'writing',
    phase: next > 0 ? 'writing' : 'complete',
    lastAction: `Committed chapter ${chapterNum}`,
    updatedAt: new Date().toISOString(),
  };
  saveProgress(updated);

  recordCheckpoint({
    step: 'commit',
    scope: { kind: 'chapter', chapter: chapterNum },
    payload: { chapterNum, wordCount: chapter.wordCount },
    projectName: progress.projectName,
  });

  logEngine(`📌 commit_chapter ${chapterNum}`, 'success');
  return updated;
}

/** Light review — EVALUATE_CHAPTER if available, else accept */
export async function saveReviewTool(
  chapterNum: number,
  progress: EngineProgress,
): Promise<{ verdict: string; progress: EngineProgress }> {
  const chapter = loadChapter(chapterNum);
  if (!chapter?.content?.trim()) {
    throw new Error(`Chương ${chapterNum} trống — không review được.`);
  }

  const ctx = loadProjectContext();
  logEngine(`🔎 save_review: Chương ${chapterNum}`);

  const rules = resolveRulesForProject(ctx.userRules);
  const ruleFindings = checkChapterAgainstRules(chapter.content, rules);
  const ruleErrors = ruleFindings.filter((f) => f.severity === 'error');

  const data = await postGenerate(
    'EVALUATE_CHAPTER',
    {
      ten_tac_pham: ctx.ten_tac_pham,
      chuong_hien_tai: {
        so_chuong: chapterNum,
        tieu_de: chapter.title,
        dan_y: chapter.dan_y,
      },
      noi_dung: chapter.content,
      noi_dung_kich_ban: chapter.content,
      lorebook: ctx.lorebook,
      userRules: ctx.userRules,
      ...setupGenrePayload(ctx),
    },
    ctx,
  );
  let verdict = String(data.verdict || '').trim();
  let summary = String(data.summary || data.nhan_xet || '').trim();
  if (!verdict) {
    throw new Error(`EVALUATE_CHAPTER khong tra verdict cho chuong ${chapterNum}.`);
  }
  if (!summary) {
    throw new Error(`EVALUATE_CHAPTER khong tra summary cho chuong ${chapterNum}.`);
  }

  // Rules escalate rewrite
  if (ruleErrors.length >= 2 && verdict === 'accept') {
    verdict = 'rewrite';
    summary = `${summary}\n[rules] ${ruleErrors.map((e) => e.message).join('; ')}`;
  }

  chapter.status = 'review';
  saveChapter(chapter);

  let updated: EngineProgress = {
    ...progress,
    flow: 'writing',
    lastAction: `Review ${chapterNum}: ${verdict}`,
    updatedAt: new Date().toISOString(),
  };

  if (verdict === 'rewrite') {
    updated = {
      ...updated,
      flow: 'rewriting',
      pendingRewrites: Array.from(new Set([chapterNum, ...updated.pendingRewrites])),
    };
    logEngine(`⚠️ verdict=rewrite → queue ch${chapterNum}`, 'error');
  } else {
    updated = await commitChapterTool(chapterNum, updated);
  }

  saveProgress(updated);
  recordCheckpoint({
    step: 'review',
    scope: { kind: 'chapter', chapter: chapterNum },
    payload: { verdict, summary },
    projectName: progress.projectName,
  });

  return { verdict, progress: updated };
}
