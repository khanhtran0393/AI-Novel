import {
  createChannelProfile,
  getActiveChannel as resolveActiveChannel,
  normalizeChannelProfile,
  pushChannelMemory,
  resolveChannelOutputDna,
  resolveChannelTtsDna,
} from '@/lib/channelModel';
import {
  captureOutputDnaFromState,
  captureProjectSnapshot,
  captureTtsDnaFromConfig,
  snapshotToWorkspacePatch,
} from '@/lib/channelBridge';
import { NARRATOR_ROLE_ID, normalizeVoiceCast } from '@/lib/voiceCast';
import {
  bindableFromState,
  mediaFieldsFromPatch,
  mergeTtsFromChannelPatch,
} from './channelStoreHelpers';
import type { NovelActions, NovelState } from './novelTypes';

import type { StoreGet, StoreSet } from './storeSet';

type ChannelActions = Pick<
  NovelActions,
  | 'saveActiveChannelSnapshot'
  | 'createChannel'
  | 'switchChannel'
  | 'updateChannel'
  | 'deleteChannel'
  | 'setDefaultShipMode'
  | 'rememberChannelMotif'
  | 'applyActiveChannelDna'
  | 'getActiveChannel'
>;

export function createChannelActions(
  set: StoreSet,
  get: StoreGet,
): ChannelActions {
  return {
    saveActiveChannelSnapshot: () =>
      set((state) => {
        const id = state.activeChannelId;
        const ch = state.channels[id];
        if (!ch) return state;
        const bindable = bindableFromState(state);
        const snap = captureProjectSnapshot(bindable);
        const outputDna = captureOutputDnaFromState(bindable);
        const ttsDna = captureTtsDnaFromConfig(bindable.ttsConfig);
        return {
          channels: {
            ...state.channels,
            [id]: {
              ...ch,
              projectSnapshot: snap,
              outputDna,
              ttsDna,
              visualDna: state.visualDnaPrompt || ch.visualDna,
              narratorVoiceId: ttsDna.voice || ch.narratorVoiceId,
              ttsPlatform: ttsDna.platform || ch.ttsPlatform,
              updatedAt: new Date().toISOString(),
            },
          },
        };
      }),

    createChannel: (name, opts) => {
      const state = get();
      const activeId = state.activeChannelId;
      const active = state.channels[activeId];
      let channels = { ...state.channels };
      if (active) {
        const bindable = bindableFromState(state);
        const snap = captureProjectSnapshot(bindable);
        channels[activeId] = {
          ...active,
          projectSnapshot: snap,
          outputDna: captureOutputDnaFromState(bindable),
          ttsDna: captureTtsDnaFromConfig(bindable.ttsConfig),
          visualDna: state.visualDnaPrompt || active.visualDna,
          narratorVoiceId: state.ttsConfig?.voice || active.narratorVoiceId,
          ttsPlatform: state.ttsConfig?.platform || active.ttsPlatform,
          updatedAt: new Date().toISOString(),
        };
      }
      const cloneSnap = opts?.cloneFromActive
        ? captureProjectSnapshot(bindableFromState(state))
        : undefined;
      const ch = createChannelProfile(name || 'Kênh mới', {
        ...opts?.partial,
        projectSnapshot: cloneSnap
          ? {
              ...cloneSnap,
              ten_tac_pham: name || cloneSnap.ten_tac_pham,
            }
          : opts?.partial?.projectSnapshot,
        ...(opts?.cloneFromActive
          ? {
              outputDna: captureOutputDnaFromState(bindableFromState(state)),
              ttsDna: captureTtsDnaFromConfig(state.ttsConfig),
              visualDna: state.visualDnaPrompt || '',
            }
          : {}),
      });
      channels = { ...channels, [ch.id]: ch };
      const patch = snapshotToWorkspacePatch(ch, ch.projectSnapshot);
      const { ttsConfigPatch, mediaPatch, ...workspace } = patch;
      set({
        channels,
        activeChannelId: ch.id,
        ...(workspace as Partial<NovelState>),
        ...mediaFieldsFromPatch(mediaPatch),
        ttsConfig: mergeTtsFromChannelPatch(state.ttsConfig, ttsConfigPatch),
      });
      return ch.id;
    },

    switchChannel: (channelId) => {
      const state = get();
      if (!channelId || !state.channels[channelId]) {
        return { ok: false as const, error: 'Không tìm thấy kênh.' };
      }
      if (channelId === state.activeChannelId) {
        return { ok: true as const };
      }
      const activeId = state.activeChannelId;
      const active = state.channels[activeId];
      const channels = { ...state.channels };
      if (active) {
        const bindable = bindableFromState(state);
        const snap = captureProjectSnapshot(bindable);
        channels[activeId] = {
          ...active,
          projectSnapshot: snap,
          outputDna: captureOutputDnaFromState(bindable),
          ttsDna: captureTtsDnaFromConfig(bindable.ttsConfig),
          visualDna: state.visualDnaPrompt || active.visualDna,
          narratorVoiceId: state.ttsConfig?.voice || active.narratorVoiceId,
          ttsPlatform: state.ttsConfig?.platform || active.ttsPlatform,
          updatedAt: new Date().toISOString(),
        };
      }
      const target = channels[channelId];
      const patch = snapshotToWorkspacePatch(target, target.projectSnapshot);
      const { ttsConfigPatch, mediaPatch, ...workspace } = patch;
      set({
        channels,
        activeChannelId: channelId,
        ...(workspace as Partial<NovelState>),
        ...mediaFieldsFromPatch(mediaPatch),
        ttsConfig: mergeTtsFromChannelPatch(state.ttsConfig, ttsConfigPatch),
      });
      return { ok: true as const };
    },

    updateChannel: (channelId, partial) =>
      set((state) => {
        const ch = state.channels[channelId];
        if (!ch) return state;
        const next = normalizeChannelProfile({
          ...ch,
          ...partial,
          id: ch.id,
          updatedAt: new Date().toISOString(),
        });
        if (!next) return state;
        return {
          channels: { ...state.channels, [channelId]: next },
        };
      }),

    deleteChannel: (channelId) => {
      const state = get();
      const ids = Object.keys(state.channels);
      if (ids.length <= 1) {
        return { ok: false as const, error: 'Không thể xóa kênh duy nhất.' };
      }
      if (!state.channels[channelId]) {
        return { ok: false as const, error: 'Không tìm thấy kênh.' };
      }
      const channels = { ...state.channels };
      delete channels[channelId];
      if (state.activeChannelId === channelId) {
        const nextId = Object.keys(channels)[0];
        const target = channels[nextId];
        const patch = snapshotToWorkspacePatch(target, target.projectSnapshot);
        const { ttsConfigPatch, mediaPatch, ...workspace } = patch;
        set({
          channels,
          activeChannelId: nextId,
          ...(workspace as Partial<NovelState>),
          ...mediaFieldsFromPatch(mediaPatch),
          ttsConfig: mergeTtsFromChannelPatch(state.ttsConfig, ttsConfigPatch),
        });
      } else {
        set({ channels });
      }
      return { ok: true as const };
    },

    setDefaultShipMode: (mode) =>
      set((state) => {
        const id = state.activeChannelId;
        const ch = state.channels[id];
        if (!ch) return state;
        return {
          channels: {
            ...state.channels,
            [id]: {
              ...ch,
              defaultShipMode: mode,
              updatedAt: new Date().toISOString(),
            },
          },
        };
      }),

    rememberChannelMotif: (kind, value) =>
      set((state) => {
        const id = state.activeChannelId;
        const ch = state.channels[id];
        if (!ch) return state;
        return {
          channels: {
            ...state.channels,
            [id]: pushChannelMemory(ch, kind, value),
          },
        };
      }),

    applyActiveChannelDna: () =>
      set((state) => {
        const ch = state.channels[state.activeChannelId];
        if (!ch) return state;
        const out = resolveChannelOutputDna(ch, ch.projectSnapshot);
        const tts = resolveChannelTtsDna(ch, ch.projectSnapshot);
        let voiceCast = normalizeVoiceCast(state.voiceCast);
        if (voiceCast.roles.length && tts.voice) {
          voiceCast = normalizeVoiceCast({
            ...voiceCast,
            roles: voiceCast.roles.map((r) =>
              r.kind === 'narrator' || r.id === NARRATOR_ROLE_ID
                ? {
                    ...r,
                    voiceId: tts.voice,
                    voicesByPlatform: {
                      ...(r.voicesByPlatform || {}),
                      [tts.platform || state.ttsConfig.platform]: tts.voice,
                    },
                  }
                : r,
            ),
          });
        }
        return {
          visualDnaPrompt: ch.visualDna || state.visualDnaPrompt,
          mediaStylePreset: out.mediaStylePreset || state.mediaStylePreset,
          imageAspectRatio: out.imageAspectRatio || state.imageAspectRatio,
          videoAspectRatio: out.videoAspectRatio || state.videoAspectRatio,
          imageProvider: out.imageProvider || state.imageProvider,
          imageModel: out.imageModel || state.imageModel,
          imageCount: out.imageCount ?? state.imageCount,
          videoProvider: out.videoProvider || state.videoProvider,
          videoModel: out.videoModel || state.videoModel,
          videoDuration: out.videoDuration ?? state.videoDuration,
          ttsConfig: mergeTtsFromChannelPatch(state.ttsConfig, tts),
          voiceCast,
        };
      }),

    getActiveChannel: () => {
      const state = get();
      return resolveActiveChannel(state.channels, state.activeChannelId);
    },
  };
}
