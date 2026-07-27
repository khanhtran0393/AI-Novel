import { API, chapterAssetPrefix } from '@/contracts';
/**
 * Silent production runtime — no UI entry points.
 * Seedance / FableCut / MiroFish run as side-effects of existing app actions.
 */
import { useNovelStore } from '@/store/useNovelStore';
import { parseScenes } from '../utils/stringUtils';

export type SilentTimelineResult = {
  ok: boolean;
  imagesResolved?: number;
  projectPath?: string;
  clipCount?: number;
  reservationPath?: string;
  reservationSlots?: number;
  reservationFilled?: number;
  error?: string;
};

function characterNamesFromStore(store: ReturnType<typeof useNovelStore.getState>): string[] {
  const names = new Set<string>();
  for (const n of store.nhan_vat || []) if (n) names.add(n);
  for (const k of Object.keys(store.nhan_vat_prompts || {})) if (k) names.add(k);
  return Array.from(names);
}

function sceneTextsForChapter(
  store: ReturnType<typeof useNovelStore.getState>,
  chapterNum: number,
): string[] {
  const ch = store.danh_sach_chuong.find((c) => c.so_chuong === chapterNum);
  if (!ch?.noi_dung) return [];
  const scenes = parseScenes(ch.noi_dung);
  if (scenes.length) return scenes.map((s) => s.content || s.title).filter(Boolean);
  return [ch.noi_dung.slice(0, 2000)];
}

/** Debounced per-chapter timeline rebuild (FableCut project on disk). Never opens UI. */
const timelineTimers = new Map<number, ReturnType<typeof setTimeout>>();
const timelineInFlightChapters = new Set<number>();
const timelineDirtyChapters = new Set<number>();

export function scheduleSilentChapterTimeline(opts?: {
  chapterNum?: number;
  delayMs?: number;
}): void {
  const delay = opts?.delayMs ?? 1200;
  const chapterNum =
    opts?.chapterNum ?? useNovelStore.getState().chuong_dang_chon;
  const pending = timelineTimers.get(chapterNum);
  if (pending) clearTimeout(pending);
  const timer = setTimeout(() => {
    timelineTimers.delete(chapterNum);
    void runSilentChapterTimeline({ chapterNum }).catch((err) => {
      console.warn('[IntegrationsRuntime] timeline:', err);
    });
  }, delay);
  timelineTimers.set(chapterNum, timer);
}

export async function runSilentChapterTimeline(opts?: {
  chapterNum?: number;
}): Promise<SilentTimelineResult> {
  const store = useNovelStore.getState();
  const chapterNum = opts?.chapterNum ?? store.chuong_dang_chon;
  if (timelineInFlightChapters.has(chapterNum)) {
    timelineDirtyChapters.add(chapterNum);
    return { ok: false, error: 'busy' };
  }
  timelineInFlightChapters.add(chapterNum);
  try {
    const ch = store.danh_sach_chuong.find((c) => c.so_chuong === chapterNum);
    const title = (ch?.tieu_de || '').trim();
    if (!title) {
      throw new Error(`Chuong ${chapterNum} thieu tieu_de.`);
    }
    const styleHint = (store.visualDnaPrompt || store.mediaStylePreset || '').trim();
    if (!styleHint) {
      throw new Error('Chua cau hinh Visual DNA / Media Style.');
    }
    const aspect = (store.videoAspectRatio || '').trim();
    if (!aspect) {
      throw new Error('Chua chon videoAspectRatio.');
    }

    const generatedPrompts: Record<string, unknown[]> = {};
    const chPrefix = chapterAssetPrefix(chapterNum);
    for (const [k, v] of Object.entries(store.generatedPrompts || {})) {
      if (k.startsWith(chPrefix)) generatedPrompts[k] = v;
    }

    // Prefer real TTS durations for FableCut still length (sum of chapter scene audio)
    let secondsPerImage = Number(store.secondsPerBeat) > 0 ? Number(store.secondsPerBeat) : 0;
    try {
      const audioEntries = Object.entries(store.generatedAudioPaths || {}).filter(([k]) =>
        k.startsWith(chPrefix),
      );
      const totalAudio = audioEntries.reduce(
        (s, [, v]) => s + (Number(v?.duration) > 0 ? Number(v.duration) : 0),
        0,
      );
      const stillCount = Object.keys(store.generatedImages || {}).filter((k) =>
        k.startsWith(chPrefix),
      ).length;
      if (totalAudio > 0 && stillCount > 0) {
        secondsPerImage = Math.max(1.5, totalAudio / stillCount);
      }
    } catch {
      /* optional */
    }

    const res = await fetch(API.integrations.chapter, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'pipeline',
        chapterNum,
        title,
        ten_tac_pham: store.ten_tac_pham,
        sceneTexts: sceneTextsForChapter(store, chapterNum),
        characterNames: characterNamesFromStore(store),
        styleHint,
        generatedImages: store.generatedImages,
        generatedAudioPaths: store.generatedAudioPaths,
        generatedVideos: store.generatedVideos,
        generatedPrompts,
        // Seedance already applied at API generate time — skip recompile noise unless no prompts
        runSeedance: Object.keys(generatedPrompts).length === 0,
        runFableCut: true,
        liveEditor: true,
        autoStartFableCut: false,
        aspect,
        secondsPerImage: secondsPerImage > 0 ? secondsPerImage : undefined,
      }),
    });
    const data = await res.json();
    const reservationPath = String(data.timelineReservationPath || '').trim();
    const reservationSlots = Number(data.timelineReservation?.slots?.length) || 0;
    const reservationFilled = Number(data.timelineReservation?.filledSlots) || 0;
    if (data.fablecut?.success) {
      console.info(
        `[IntegrationsRuntime] FableCut ch${chapterNum} clips=${data.fablecut.clipCount} → ${data.fablecut.projectPath}`,
      );
      try {
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem(
            'ainovel_last_timeline',
            JSON.stringify({
              ok: true,
              chapterNum,
              clipCount: data.fablecut.clipCount,
              projectPath: data.fablecut.projectPath,
              reservationPath,
              reservationSlots,
              reservationFilled,
              at: Date.now(),
            }),
          );
        }
      } catch {
        /* ignore */
      }
      return {
        ok: true,
        imagesResolved: data.imagesResolved,
        projectPath: data.fablecut.projectPath,
        clipCount: data.fablecut.clipCount,
        reservationPath: reservationPath || undefined,
        reservationSlots,
        reservationFilled,
      };
    }
    if (reservationPath && reservationSlots > 0) {
      console.info(
        `[IntegrationsRuntime] CapCut reservation ch${chapterNum} slots=${reservationSlots} filled=${reservationFilled} → ${reservationPath}`,
      );
      try {
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem(
            'ainovel_last_timeline',
            JSON.stringify({
              ok: true,
              chapterNum,
              reservationPath,
              reservationSlots,
              reservationFilled,
              at: Date.now(),
            }),
          );
        }
      } catch {
        /* ignore */
      }
      return {
        ok: true,
        imagesResolved: data.imagesResolved,
        reservationPath,
        reservationSlots,
        reservationFilled,
      };
    }
    const err = data.fablecut?.error || data.error || 'no timeline';
    console.info(`[IntegrationsRuntime] timeline skip ch${chapterNum}: ${err}`);
    try {
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(
          'ainovel_last_timeline',
          JSON.stringify({ ok: false, chapterNum, error: err, at: Date.now() }),
        );
      }
    } catch {
      /* ignore */
    }
    return { ok: false, imagesResolved: data.imagesResolved, error: err };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    timelineInFlightChapters.delete(chapterNum);
    if (timelineDirtyChapters.delete(chapterNum)) {
      scheduleSilentChapterTimeline({ chapterNum, delayMs: 150 });
    }
  }
}

/**
 * After planning a new arc — enrich lorebook with swarm plot hooks (MiroFish-style).
 * Silent; failures never block planArc.
 */
export async function silentEnrichArcHooks(opts: {
  hypothesis?: string;
  /** outline | plan_arc | lore — MiroFish API scope gate */
  context?: 'outline' | 'plan_arc' | 'lore' | 'lorebook' | 'arc';
}): Promise<string[]> {
  try {
    const store = useNovelStore.getState();
    const ch = store.danh_sach_chuong.find((c) => c.so_chuong === store.chuong_dang_chon);
    const hypothesis =
      opts.hypothesis ||
      `Dự đoán arc tiếp theo của "${store.ten_tac_pham || 'truyện'}" sau chương ${store.chuong_dang_chon}`;

    const res = await fetch(API.integrations.mirofish, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: opts.context || 'plan_arc',
        scope: 'lorebook',
        title: store.ten_tac_pham,
        lorebook: store.lorebook,
        chapterSummary: ch
          ? `Chương ${ch.so_chuong}: ${ch.tieu_de}\n${(ch.dan_y || ch.noi_dung || '').slice(0, 1500)}`
          : '',
        characters: characterNamesFromStore(store).map((name) => ({ name })),
        hypothesis,
        rounds: 3,
        apiKey: store.apiKey,
        apiKeys: store.apiKeys,
      }),
    });
    const data = await res.json();
    if (!data.success || !Array.isArray(data.plotHooks) || data.plotHooks.length === 0) {
      return [];
    }
    const hooks = data.plotHooks.map(String).filter(Boolean);
    // Merge into lorebook as structured note (app memory), not a modal
    const block = [
      '',
      '## Swarm plot hooks (auto)',
      ...hooks.map((h: string, i: number) => `${i + 1}. ${h}`),
      '',
    ].join('\n');
    const nextLore = `${store.lorebook || ''}${block}`.slice(0, 12000);
    if (typeof store.updateLorebook === 'function') {
      store.updateLorebook(nextLore);
    }
    console.info(`[IntegrationsRuntime] MiroFish hooks +${hooks.length} → lorebook`);
    return hooks;
  } catch (e) {
    console.warn('[IntegrationsRuntime] arc enrich skipped:', e);
    return [];
  }
}
