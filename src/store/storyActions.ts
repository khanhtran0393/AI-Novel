import { characterImageKey } from '@/contracts';
import {
  emptyNhanVatProfile,
  normalizeNhanVatProfile,
} from '@/lib/characterProfile';
import {
  characterRoleId,
  normalizeVoiceCast,
} from '@/lib/voiceCast';
import { pushChannelMemory } from '@/lib/channelModel';
import { mergeYoutubeSafe as mergeYoutubeSafeConfig } from '@/lib/youtubeSafe';
import {
  emptySceneLocation,
  normalizeSceneLocationAssets,
  type SceneLocationAsset,
} from '@/lib/sceneLocationLibrary';
import {
  normalizeScriptMode,
  scriptModeMediaSoftPatch,
} from '@/lib/scriptMode';
import {
  resolveStyleEngineProfile,
  styleEngineMediaSoftPatch,
} from '@/lib/styleEngineProfiles';
import type { NovelActions } from './novelTypes';
import type { StoreGet, StoreSet } from './storeSet';

type StoryActions = Pick<
  NovelActions,
  | 'setSetup' | 'setGiaiDoan' | 'updateTenTacPham' | 'updateDanYTongThe' | 'updateNhanVat'
  | 'renameNhanVat' | 'setDanhSachChuong' | 'updateChuong' | 'selectChuong'
  | 'setTabHienTai' | 'setWorkspaceTab' | 'setDangTai'
  | 'setPipelineStep' | 'updateLorebook' | 'updateTomTatCuonChieu' | 'updateTriNhoNganHan'
  | 'updateNhanVatPrompt'
  | 'setSceneLocationAssets' | 'upsertSceneLocationAsset' | 'removeSceneLocationAsset'
  | 'updateYoutubeSafe' | 'setHumanEditFlag' | 'setChapterHook'
  | 'setSetupKind' | 'setYoutubeRewrite' | 'setScriptMode'
  | 'updateUserRules' | 'updateEditorReview' | 'dismissEditorReview' | 'clearEditorReview' | 'setCungHienTai' | 'addChuongMoi'
  | 'updateWorldState' | 'updateSpentEntities' | 'setNextBeatType' | 'setMemoryPipelineStatus'
>;

export function createStoryActions(
  set: StoreSet,
  get: StoreGet,
): StoryActions {
  return {
      setSetup: (data) =>
        set((state) => {
          const newSetup = { ...state.setup, ...data };
          const generatedName = `${newSetup.chu_de} - ${newSetup.phong_cach}`;
          const genreTouched =
            data.chu_de !== undefined || data.phong_cach !== undefined;
          const base = {
            setup: newSetup,
            ten_tac_pham:
              state.giai_doan === 1 ? generatedName : state.ten_tac_pham,
          };
          if (!genreTouched) return base;

          const profile = resolveStyleEngineProfile(
            newSetup.chu_de,
            newSetup.phong_cach,
          );
          const soft = styleEngineMediaSoftPatch(profile, {
            wpm: state.wpm,
            secondsPerBeat: state.secondsPerBeat,
            visualDnaPrompt: state.visualDnaPrompt,
            mediaStylePreset: state.mediaStylePreset,
            activeStyleEngineId: state.activeStyleEngineId,
            scriptMode: state.scriptMode,
          });
          return {
            ...base,
            activeStyleEngineId:
              soft.activeStyleEngineId !== undefined
                ? soft.activeStyleEngineId
                : profile?.id ?? null,
            ...(soft.wpm != null ? { wpm: soft.wpm } : {}),
            ...(soft.secondsPerBeat != null
              ? { secondsPerBeat: soft.secondsPerBeat }
              : {}),
            ...(soft.visualDnaPrompt != null
              ? { visualDnaPrompt: soft.visualDnaPrompt }
              : {}),
            ...(soft.mediaStylePreset != null
              ? { mediaStylePreset: soft.mediaStylePreset }
              : {}),
          };
        }),

      setGiaiDoan: (giai_doan) => set({ giai_doan }),

      updateTenTacPham: (ten_tac_pham) => set({ ten_tac_pham }),

      updateDanYTongThe: (dan_y_tong_the) => set({ dan_y_tong_the }),

      updateNhanVat: (nhan_vat) => set({ nhan_vat }),

      renameNhanVat: (oldName, newName, options) => {
        const from = (oldName || '').trim();
        const to = (newName || '').trim().normalize('NFC');
        if (!from) return { ok: false as const, error: 'Tên cũ không hợp lệ.' };
        if (!to) return { ok: false as const, error: 'Tên mới không được để trống.' };
        if (from === to) return { ok: false as const, error: 'Tên mới trùng tên hiện tại.' };

        const state = get();
        if (!state.nhan_vat.includes(from)) {
          return { ok: false as const, error: `Không tìm thấy nhân vật "${from}".` };
        }
        if (state.nhan_vat.some((c) => c !== from && c === to)) {
          return { ok: false as const, error: `Tên "${to}" đã tồn tại trong hồ sơ.` };
        }

        const replaceInText = options?.replaceInText !== false;
        const swapText = (text: string | undefined | null) => {
          if (!text || !replaceInText) return text || '';
          return text.split(from).join(to);
        };

        const remapAssetKeys = <T,>(record: Record<string, T> | undefined): Record<string, T> => {
          const src = record || {};
          const out: Record<string, T> = {};
          const oldPrefix = characterImageKey(from);
          const newPrefix = characterImageKey(to);
          for (const [key, value] of Object.entries(src)) {
            if (key === oldPrefix || key.startsWith(`${oldPrefix}_`)) {
              out[`${newPrefix}${key.slice(oldPrefix.length)}`] = value;
            } else {
              out[key] = value;
            }
          }
          return out;
        };

        const prompts = { ...(state.nhan_vat_prompts || {}) };
        if (prompts[from] !== undefined) {
          prompts[to] = prompts[from];
          delete prompts[from];
        }

        const cast = normalizeVoiceCast(state.voiceCast);
        const oldRoleId = characterRoleId(from);
        const newRoleId = characterRoleId(to);
        const roles = cast.roles.map((r) => {
          if (r.kind === 'character' && (r.characterName === from || r.id === oldRoleId)) {
            return {
              ...r,
              id: newRoleId,
              characterName: to,
              label: r.label === from ? to : r.label,
              // sticky vinaRoleIndex kept
            };
          }
          return r;
        });
        const segmentOverrides = { ...cast.segmentOverrides };
        for (const [sid, ov] of Object.entries(segmentOverrides)) {
          if (ov.speakerRoleId === oldRoleId) {
            segmentOverrides[sid] = { ...ov, speakerRoleId: newRoleId };
          }
        }

        set({
          nhan_vat: state.nhan_vat.map((c) => (c === from ? to : c)),
          nhan_vat_prompts: prompts,
          voiceCast: normalizeVoiceCast({ ...cast, roles, segmentOverrides }),
          generatedImages: remapAssetKeys(state.generatedImages),
          generatedImageVariants: remapAssetKeys(state.generatedImageVariants),
          projectUrls: remapAssetKeys(state.projectUrls),
          dan_y_tong_the: swapText(state.dan_y_tong_the),
          lorebook: swapText(state.lorebook),
          tom_tat_cuon_chieu: swapText(state.tom_tat_cuon_chieu),
          tri_nho_ngan_han: (state.tri_nho_ngan_han || []).map((s) => swapText(s)),
          danh_sach_chuong: state.danh_sach_chuong.map((c) => ({
            ...c,
            tieu_de: swapText(c.tieu_de),
            dan_y: swapText(c.dan_y),
            noi_dung: swapText(c.noi_dung),
          })),
        });

        return { ok: true as const, newName: to };
      },

      setDanhSachChuong: (danh_sach_chuong) => set({ danh_sach_chuong }),

      updateChuong: (so_chuong, update) =>
        set((state) => ({
          danh_sach_chuong: state.danh_sach_chuong.map((c) =>
            Number(c.so_chuong) === Number(so_chuong) ? { ...c, ...update } : c,
          ),
        })),

      selectChuong: (raw) => {
        const n = typeof raw === 'number' ? raw : Number(raw);
        const chuong_dang_chon = Number.isFinite(n) && n > 0 ? Math.trunc(n) : 1;
        set({ chuong_dang_chon, workspaceTab: 'script' });
      },

      setTabHienTai: (tab_hien_tai) => set({ tab_hien_tai }),

      setWorkspaceTab: (workspaceTab) => set({ workspaceTab }),

      setDangTai: (dang_tai) => set({ dang_tai }),

      setPipelineStep: (pipeline_step) => set({ pipeline_step }),

      updateLorebook: (lorebook) => set({ lorebook }),

      updateTomTatCuonChieu: (tom_tat_cuon_chieu) => set({ tom_tat_cuon_chieu }),

      updateTriNhoNganHan: (tri_nho_ngan_han) => set({ tri_nho_ngan_han }),

      updateNhanVatPrompt: (charName, data) => set((state) => {
        const current = state.nhan_vat_prompts || {};
        const oldVal = normalizeNhanVatProfile(current[charName] || emptyNhanVatProfile());
        const merged = normalizeNhanVatProfile({
          ...oldVal,
          ...data,
          angle_prompts: {
            ...(oldVal.angle_prompts || {}),
            ...(data.angle_prompts || {}),
          },
          expression_prompts: {
            ...(oldVal.expression_prompts || {}),
            ...(data.expression_prompts || {}),
          },
          pose_prompts: {
            ...(oldVal.pose_prompts || {}),
            ...(data.pose_prompts || {}),
          },
          wardrobe_variants:
            data.wardrobe_variants !== undefined
              ? data.wardrobe_variants
              : oldVal.wardrobe_variants,
        });
        return {
          nhan_vat_prompts: {
            ...current,
            [charName]: merged,
          },
        };
      }),

      setSceneLocationAssets: (items) =>
        set({
          scene_location_assets: normalizeSceneLocationAssets(items),
        }),

      upsertSceneLocationAsset: (item: SceneLocationAsset) =>
        set((state) => {
          const next = emptySceneLocation(item);
          const list = normalizeSceneLocationAssets(state.scene_location_assets);
          const idx = list.findIndex((x) => x.id === next.id);
          if (idx >= 0) list[idx] = { ...list[idx], ...next, updatedAt: Date.now() };
          else list.push({ ...next, updatedAt: Date.now() });
          return { scene_location_assets: list };
        }),

      removeSceneLocationAsset: (id) =>
        set((state) => ({
          scene_location_assets: normalizeSceneLocationAssets(
            state.scene_location_assets,
          ).filter((x) => x.id !== id),
        })),

      updateYoutubeSafe: (config) =>
        set((state) => ({
          youtubeSafe: mergeYoutubeSafeConfig({ ...(state.youtubeSafe || {}), ...config }),
        })),

      setHumanEditFlag: (chapter, flag) =>
        set((state) => {
          const prev = state.humanEditFlags?.[chapter] || { edited: false };
          return {
            humanEditFlags: {
              ...state.humanEditFlags,
              [chapter]: {
                ...prev,
                ...flag,
                at: flag.edited ? new Date().toISOString() : prev.at,
              },
            },
          };
        }),

      setChapterHook: (chapter, hook) =>
        set((state) => {
          const prev = state.chapterHooks?.[chapter] || {
            hook: '',
            thumbnailLine: '',
          };
          return {
            chapterHooks: {
              ...(state.chapterHooks || {}),
              [chapter]: { ...prev, ...hook },
            },
          };
        }),

      setSetupKind: (kind) => set({ setupKind: kind }),

      setYoutubeRewrite: (data) =>
        set((state) => {
          let target = state.youtubeSimilarityTarget ?? 80;
          if (data.similarityTarget !== undefined) {
            const n = Number(data.similarityTarget);
            target = Number.isFinite(n)
              ? Math.max(10, Math.min(100, Math.round(n)))
              : 80;
          }
          return {
            youtubeRewriteUrl:
              data.url !== undefined ? data.url : state.youtubeRewriteUrl,
            youtubeSourceTitle:
              data.sourceTitle !== undefined
                ? data.sourceTitle
                : state.youtubeSourceTitle,
            youtubeSourceText:
              data.sourceText !== undefined
                ? data.sourceText
                : state.youtubeSourceText,
            youtubeSimilarityTarget: target,
          };
        }),

      setScriptMode: (mode) => {
        const m = normalizeScriptMode(mode);
        // Soft pacing per Phong Cách Kịch Bản (WPM / beat / video / word goal)
        const state = get();
        const soft = scriptModeMediaSoftPatch(m, {
          so_tu_chuong: state.setup?.so_tu_chuong,
          secondsPerBeat: state.secondsPerBeat,
          videoDuration: state.videoDuration,
          wpm: state.wpm,
        });
        set({
          scriptMode: m,
          setup: {
            ...state.setup,
            ...(soft.so_tu_chuong != null
              ? { so_tu_chuong: soft.so_tu_chuong }
              : {}),
          },
          ...(soft.secondsPerBeat != null
            ? { secondsPerBeat: soft.secondsPerBeat }
            : {}),
          ...(soft.videoDuration != null
            ? { videoDuration: soft.videoDuration }
            : {}),
          ...(soft.wpm != null ? { wpm: soft.wpm } : {}),
        });
      },

      updateUserRules: (rules) => set((state) => ({ userRules: { ...state.userRules, ...rules } })),

      updateEditorReview: (chapterIndex, review) => set((state) => ({
        editorReviews: { ...state.editorReviews, [chapterIndex]: review }
      })),

      dismissEditorReview: (chapterIndex) =>
        set((state) => {
          const prev = state.editorReviews[chapterIndex];
          if (!prev) return state;
          if (prev.verdict === 'accept') return state;
          const note = 'User bỏ qua yêu cầu sửa / giữ bản hiện tại.';
          const summary = (prev.summary || '').trim();
          return {
            editorReviews: {
              ...state.editorReviews,
              [chapterIndex]: {
                ...prev,
                verdict: 'accept' as const,
                summary: summary
                  ? summary.includes(note)
                    ? summary
                    : `${summary} · ${note}`
                  : note,
              },
            },
          };
        }),

      clearEditorReview: (chapterIndex) =>
        set((state) => {
          if (!(chapterIndex in state.editorReviews)) return state;
          const next = { ...state.editorReviews };
          delete next[chapterIndex];
          return { editorReviews: next };
        }),

      setCungHienTai: (arc) => set({ cung_hien_tai: arc }),

      addChuongMoi: (chuongList) => set((state) => ({ danh_sach_chuong: [...state.danh_sach_chuong, ...chuongList] })),

      updateWorldState: (data) => set((state) => ({ world_state: { ...state.world_state, ...data } })),

      updateSpentEntities: (data) => set((state) => ({
        da_dien_ra_entities: {
          dia_diem: Array.from(new Set([...state.da_dien_ra_entities.dia_diem, ...(data.dia_diem || [])])),
          vat_pham: Array.from(new Set([...state.da_dien_ra_entities.vat_pham, ...(data.vat_pham || [])])),
          motifs: Array.from(new Set([...state.da_dien_ra_entities.motifs, ...(data.motifs || [])]))
        }
      })),

      setNextBeatType: (current_beat_type) => set({ current_beat_type }),

      setMemoryPipelineStatus: (memoryPipelineStatus) => set({ memoryPipelineStatus }),
  };
}
