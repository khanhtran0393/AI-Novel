import { useNovelStore, type Chuong } from '@/store/useNovelStore';
import {
  evaluateChapterAction,
  commitMemoryAction,
} from '../modules/writeModule';
import { recordEngineCheckpoint, recordEngineSnapshot } from '../modules/engineModule';
import { resolveMasterModelKeys } from '../modules/apiClient';
import {
  enrichMemoryAfterCommit,
  evaluateChapterQuality,
  setChapterQuality,
} from '@/lib/pipeline';

/** Normalize language label; repair legacy mojibake from older builds. */
export function resolveNgonNgu(raw?: string): string {
  const n = (raw || '').trim();
  if (!n || /Ti\?ng Vi\?t/i.test(n) || n.includes('\uFFFD')) return 'Tiếng Việt';
  return n;
}

export async function evaluateChapter(
  noi_dung_kich_ban: string,
  chapterNumber: number,
  signal?: AbortSignal,
) {
  try {
    const state = useNovelStore.getState();
    const currentChapter = state.danh_sach_chuong.find((c) => c.so_chuong === chapterNumber);
    if (!currentChapter) return undefined;

    const review = await evaluateChapterAction({
      apiKey: state.apiKey,
      apiKeys: state.apiKeys || [],
      chuong_hien_tai: currentChapter,
      noi_dung_kich_ban,
      userRules: state.userRules,
      signal,
    });

    state.updateEditorReview(chapterNumber, review);
    await recordEngineCheckpoint({
      step: 'chapter_review',
      scope: { kind: 'chapter', chapter: chapterNumber },
      projectName: state.ten_tac_pham,
      payload: {
        chapter: chapterNumber,
        review,
      },
    });

    const afterReviewState = useNovelStore.getState();
    await recordEngineSnapshot({
      ten_tac_pham: afterReviewState.ten_tac_pham,
      chuong_dang_chon: afterReviewState.chuong_dang_chon,
      setup: afterReviewState.setup,
      danh_sach_chuong: afterReviewState.danh_sach_chuong,
      editorReviews: afterReviewState.editorReviews,
      generatedAudioPaths: afterReviewState.generatedAudioPaths,
      generatedImages: afterReviewState.generatedImages,
      generatedVideos: afterReviewState.generatedVideos,
    });
    return review;
  } catch (err: unknown) {
    console.error('Lỗi khi chấm điểm:', err);
    return undefined;
  }
}

/**
 * LLM often returns lorebook/tom_tat as object/array instead of string.
 * Coerce safely — never call .trim() on non-string (toast: lorebook_cap_nhat.trim is not a function).
 */
export function coerceMemoryText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => coerceMemoryText(item))
      .filter(Boolean)
      .join('\n');
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    for (const key of ['text', 'content', 'lorebook', 'value', 'body'] as const) {
      if (typeof o[key] === 'string') return o[key] as string;
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return '';
    }
  }
  return String(value);
}

function applyMemoryResult(
  state: ReturnType<typeof useNovelStore.getState>,
  memory: {
    tom_tat_cuon_chieu?: unknown;
    tri_nho_ngan_han_moi?: unknown;
    lorebook_cap_nhat?: unknown;
    world_state_cap_nhat?: {
      inventory: string[];
      discovered_clues: string[];
      current_location: string;
    };
    spent_entities_cap_nhat?: {
      dia_diem: string[];
      vat_pham: string[];
      motifs: string[];
    };
  },
  chapterNum: number,
  chapterCount: number,
  okMessage: string,
): void {
  const tomTat = coerceMemoryText(memory.tom_tat_cuon_chieu).trim();
  const triNho = coerceMemoryText(memory.tri_nho_ngan_han_moi).trim();
  const lorebook = coerceMemoryText(memory.lorebook_cap_nhat).trim();

  if (tomTat) {
    state.updateTomTatCuonChieu(tomTat.normalize('NFC'));
  }
  if (triNho) {
    state.updateTriNhoNganHan(
      [...state.tri_nho_ngan_han, triNho.normalize('NFC')].slice(-3),
    );
  }
  if (lorebook) {
    state.updateLorebook(lorebook.normalize('NFC'));
  }
  if (memory.world_state_cap_nhat) {
    state.updateWorldState(memory.world_state_cap_nhat);
  }
  if (memory.spent_entities_cap_nhat) {
    state.updateSpentEntities(memory.spent_entities_cap_nhat);
  }

  const beats = [
    'Beat A (Discovery)',
    'Beat B (Confrontation)',
    'Beat C (Survival Crisis)',
    'Beat D (Insight)',
  ];
  const currentBeatIdx = beats.indexOf(state.current_beat_type);
  const nextBeat = beats[currentBeatIdx === -1 ? 0 : (currentBeatIdx + 1) % beats.length];
  state.setNextBeatType(nextBeat);
  // Advance stepper away from misleading "outline" after real memory work
  state.setPipelineStep('commit');

  state.setMemoryPipelineStatus({
    status: 'ok',
    chapter: chapterNum,
    message: okMessage,
  });

  void recordEngineCheckpoint({
    step: 'memory_commit',
    scope: { kind: 'chapter', chapter: chapterNum },
    projectName: state.ten_tac_pham,
    payload: {
      chapter: chapterNum,
      tom_tat_cuon_chieu: tomTat || undefined,
      tri_nho_ngan_han_moi: triNho || undefined,
      hasLorebookUpdate: Boolean(lorebook && lorebook !== state.lorebook),
      chapterCount,
      nextBeat,
    },
  });
}

/**
 * Commit macro memory after a chapter is written.
 * Never use write-abort signal — content is already saved; memory must still try.
 * On AI failure: status=failed only (no local heuristic). Key rotation stays in /api/generate.
 */
export async function commitChapterMemory(
  updatedChapter: Chuong,
  noi_dung_kich_ban: string,
  updatedChapters: Chuong[],
  _signal?: AbortSignal,
): Promise<{ ok: boolean; local?: boolean; error?: string }> {
  const state = useNovelStore.getState();
  const chapterNum = updatedChapter.so_chuong;
  const body = (noi_dung_kich_ban || updatedChapter.noi_dung || '').trim();

  if (!body) {
    const msg = 'Không có nội dung chương để commit memory.';
    state.setMemoryPipelineStatus({
      status: 'failed',
      chapter: chapterNum,
      message: msg,
    });
    return { ok: false, error: msg };
  }

  state.setMemoryPipelineStatus({
    status: 'pending',
    chapter: chapterNum,
    message: 'Đang commit bộ nhớ vĩ mô…',
  });

  // Resolve keys from master model (Gemini / OpenAI / Grok), not only store.apiKey
  let apiKeys: string[] = state.apiKeys || [];
  let apiKey = state.apiKey || '';
  try {
    const resolved = resolveMasterModelKeys();
    if (resolved.keysToUse.length > 0) {
      apiKeys = resolved.keysToUse;
      apiKey = resolved.keysToUse[0] || apiKey;
    }
  } catch {
    /* fall through — commitMemoryAction will error if keys missing */
  }

  try {
    const memory = await commitMemoryAction({
      apiKey,
      apiKeys,
      ten_tac_pham: state.ten_tac_pham,
      chuong_hien_tai: updatedChapter,
      noi_dung_kich_ban: body,
      tom_tat_cuon_chieu: state.tom_tat_cuon_chieu,
      tri_nho_ngan_han: state.tri_nho_ngan_han,
      lorebook: state.lorebook,
      world_state: state.world_state,
      da_dien_ra_entities: state.da_dien_ra_entities,
      // Do NOT forward write abort signal — memory is post-save and must complete
    });

    applyMemoryResult(
      useNovelStore.getState(),
      memory,
      chapterNum,
      updatedChapters.length,
      'Commit memory xong (AI).',
    );

    // P0 — Memory pack + foreshadow ledger (local extract, no fake AI)
    const after = useNovelStore.getState();
    enrichMemoryAfterCommit({
      chapter: chapterNum,
      content: body,
      scrollSummary:
        after.tom_tat_cuon_chieu ||
        coerceMemoryText(memory.tom_tat_cuon_chieu) ||
        '',
      shortTerm: after.tri_nho_ngan_han || [],
      characterNames: after.nhan_vat || [],
    });

    // P0 — Quality Gate snapshot (editor verdict may still be pending)
    const { effectiveSetupWordGoal } = await import(
      '@/lib/commercial/freeLimitsPolicy'
    );
    const wordGoalQg = effectiveSetupWordGoal(after.setup?.so_tu_chuong, {
      is_pro: after.is_pro,
      is_trial: after.is_trial,
      is_vip: after.is_vip,
    });
    const q = evaluateChapterQuality({
      chapter: chapterNum,
      content: body,
      characterNames: after.nhan_vat || [],
      wordGoal: wordGoalQg,
      userRules: after.userRules,
      editorVerdict: after.editorReviews?.[chapterNum]?.verdict,
      scriptMode: after.scriptMode,
    });
    setChapterQuality(q);

    return { ok: true };
  } catch (error) {
    // No local/heuristic replacement — fail hard (API key rotation stays inside generate).
    const errMsg =
      error instanceof Error
        ? error.message
        : 'Commit bộ nhớ thất bại — chương sau có thể mất mạch.';
    console.warn('[Engine] memory commit failed:', error);
    useNovelStore.getState().setMemoryPipelineStatus({
      status: 'failed',
      chapter: chapterNum,
      message: errMsg.slice(0, 200),
    });
    return { ok: false, error: errMsg };
  }
}
