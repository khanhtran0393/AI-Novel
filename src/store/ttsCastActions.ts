import { sceneAssetKey } from '@/contracts';
import {
  emptyNhanVatProfile,
  normalizeNhanVatProfile,
} from '@/lib/characterProfile';
import {
  characterRoleId,
  findRoleByCharacter,
  maxVinaRoleIndex,
  normalizeVoiceCast,
  type VoiceRole,
  NARRATOR_ROLE_ID,
} from '@/lib/voiceCast';
import {
  ensureSeededCast,
  migrateRolesForPlatform,
} from '@/lib/castSeed';
import { suggestProsodyFromProfile } from '@/lib/characterVoice';
import { patchChannelTtsDna } from '@/lib/channelModel';
import { ttsDnaPatchFromConfig } from './channelStoreHelpers';
import { flushDurableNow } from './persistStorage';
import type { NovelActions } from './novelTypes';
import type { StoreGet, StoreSet } from './storeSet';

type TtsCastActions = Pick<
  NovelActions,
  | 'updateTTSConfig' | 'setVoiceCast' | 'updateVoiceCast' | 'upsertVoiceRole'
  | 'removeVoiceRole' | 'setSegmentOverride' | 'clearSegmentOverridesForScene'
  | 'ensureVoiceCastSeeded' | 'setCharacterVoice' | 'assignCloneProfile'
  | 'migrateCastVoicesForPlatform'
>;

export function createTtsCastActions(
  set: StoreSet,
  get: StoreGet,
): TtsCastActions {
  return {
      updateTTSConfig: (config, opts) => {
        const mirrorChannel = opts?.mirrorChannel !== false;
        set((state) => {
          const next = { ...state.ttsConfig, ...config };
          const platformChanged =
            typeof config.platform === 'string' &&
            config.platform !== state.ttsConfig.platform;

          let channels = state.channels;
          const chId = state.activeChannelId;
          const ch = channels?.[chId];
          if (mirrorChannel && ch) {
            const dnaPatch = ttsDnaPatchFromConfig(config);
            if (Object.keys(dnaPatch).length > 0) {
              channels = {
                ...channels,
                [chId]: patchChannelTtsDna(ch, dnaPatch),
              };
            }
          }

          if (!platformChanged) {
            return { ttsConfig: next, channels };
          }

          const language = next.language || state.ttsConfig.language || 'vi';
          const cast = normalizeVoiceCast(state.voiceCast);
          if (!cast.roles.length) return { ttsConfig: next, channels };

          const roles = migrateRolesForPlatform(
            cast.roles,
            config.platform!,
            language,
            state.nhan_vat_prompts || {},
            next.voice || '',
            {
              baseSpeed: next.speed ?? state.ttsConfig.speed,
              basePitch: next.pitch ?? state.ttsConfig.pitch,
            },
          );
          const prompts = { ...(state.nhan_vat_prompts || {}) };
          for (const r of roles) {
            if (r.kind === 'character' && r.characterName) {
              const prev = normalizeNhanVatProfile(prompts[r.characterName]);
              prompts[r.characterName] = normalizeNhanVatProfile({
                ...prev,
                tts_voice: r.voiceId,
              });
            }
          }
          return {
            ttsConfig: next,
            voiceCast: normalizeVoiceCast({ ...cast, roles }),
            nhan_vat_prompts: prompts,
            channels,
          };
        });
        queueMicrotask(() => flushDurableNow());
      },

      setVoiceCast: (cast) => set({ voiceCast: normalizeVoiceCast(cast) }),

      updateVoiceCast: (partial) =>
        set((state) => ({
          voiceCast: normalizeVoiceCast({
            ...normalizeVoiceCast(state.voiceCast),
            ...partial,
          }),
        })),

      upsertVoiceRole: (role) =>
        set((state) => {
          const cast = normalizeVoiceCast(state.voiceCast);
          const idx = cast.roles.findIndex((r) => r.id === role.id);
          const roles = [...cast.roles];
          if (idx >= 0) roles[idx] = { ...roles[idx], ...role, id: role.id };
          else roles.push(role);
          return { voiceCast: normalizeVoiceCast({ ...cast, roles, enabled: cast.enabled || roles.length > 0 }) };
        }),

      removeVoiceRole: (roleId) =>
        set((state) => {
          if (roleId === NARRATOR_ROLE_ID) return state;
          const cast = normalizeVoiceCast(state.voiceCast);
          const roles = cast.roles.filter((r) => r.id !== roleId);
          // sticky holes — do not renumber vinaRoleIndex
          const overrides = { ...cast.segmentOverrides };
          for (const [sid, ov] of Object.entries(overrides)) {
            if (ov.speakerRoleId === roleId) {
              overrides[sid] = { ...ov, speakerRoleId: NARRATOR_ROLE_ID };
            }
          }
          return {
            voiceCast: normalizeVoiceCast({
              ...cast,
              roles,
              segmentOverrides: overrides,
              enabled: cast.enabled && roles.length > 0,
            }),
          };
        }),

      setSegmentOverride: (segmentId, override) =>
        set((state) => {
          const cast = normalizeVoiceCast(state.voiceCast);
          const segmentOverrides = { ...cast.segmentOverrides };
          if (override == null) delete segmentOverrides[segmentId];
          else {
            segmentOverrides[segmentId] = {
              ...(segmentOverrides[segmentId] || {}),
              ...override,
            };
          }
          return { voiceCast: normalizeVoiceCast({ ...cast, segmentOverrides }) };
        }),

      clearSegmentOverridesForScene: (chapter, sceneIndex) =>
        set((state) => {
          const cast = normalizeVoiceCast(state.voiceCast);
          // Segment ids embed chapter|scene in hash input but not as prefix;
          // prune by matching overrides that reference scene via sceneTextHashes key only
          // MVP: clear all unlocked overrides when user requests scene clear
          const segmentOverrides = { ...cast.segmentOverrides };
          for (const [id, ov] of Object.entries(segmentOverrides)) {
            if (!ov.locked) delete segmentOverrides[id];
          }
          const sceneTextHashes = { ...(cast.sceneTextHashes || {}) };
          delete sceneTextHashes[sceneAssetKey(chapter, sceneIndex)];
          return {
            voiceCast: normalizeVoiceCast({
              ...cast,
              segmentOverrides,
              sceneTextHashes,
            }),
          };
        }),

      ensureVoiceCastSeeded: () =>
        set((state) => {
          const next = ensureSeededCast({
            nhan_vat: state.nhan_vat || [],
            nhan_vat_prompts: state.nhan_vat_prompts || {},
            ttsConfig: state.ttsConfig,
            voiceCast: state.voiceCast,
          });
          return { voiceCast: next };
        }),

      setCharacterVoice: (characterName, voiceId) =>
        set((state) => {
          const name = (characterName || '').trim().normalize('NFC');
          if (!name) return state;
          const platform = state.ttsConfig.platform || '';
          const prompts = { ...(state.nhan_vat_prompts || {}) };
          const prev = normalizeNhanVatProfile(prompts[name]);
          prompts[name] = normalizeNhanVatProfile({
            ...prev,
            tts_voice: voiceId,
          });

          const cast = normalizeVoiceCast(state.voiceCast);
          let roles = [...cast.roles];
          const existing = findRoleByCharacter(roles, name);
          if (existing) {
            roles = roles.map((r) =>
              r.id === existing.id
                ? {
                    ...r,
                    voiceId,
                    voicesByPlatform: {
                      ...(r.voicesByPlatform || {}),
                      [platform]: voiceId,
                    },
                  }
                : r,
            );
          } else if (roles.length > 0) {
            // seeded cast: upsert character role
            const nextIdx = maxVinaRoleIndex(roles) + 1;
            roles.push({
              id: characterRoleId(name),
              label: name,
              kind: 'character',
              characterName: name,
              voiceId,
              voicesByPlatform: { [platform]: voiceId },
              vinaRoleIndex: nextIdx,
            });
          }

          return {
            nhan_vat_prompts: prompts,
            voiceCast: roles.length
              ? normalizeVoiceCast({ ...cast, roles })
              : cast,
          };
        }),

      assignCloneProfile: (params) =>
        set((state) => {
          const profileName = (params.profileName || '').trim();
          if (!profileName) return state;
          const target = (params.target || 'global').trim().normalize('NFC');
          const platform = 'vina_voice' as const;
          const ttsConfig = {
            ...state.ttsConfig,
            platform,
            vinaUseClone: true as const,
            voice: profileName,
            ...(params.refPath
              ? { vinaReferenceAudio: params.refPath }
              : {}),
            ...(params.refText != null
              ? { vinaReferenceText: params.refText }
              : {}),
            ...(typeof params.speed === 'number' ? { speed: params.speed } : {}),
            ...(typeof params.pitch === 'number' ? { pitch: params.pitch } : {}),
          };

          // Seed cast nếu chưa có roles
          let cast = ensureSeededCast({
            nhan_vat: state.nhan_vat || [],
            nhan_vat_prompts: state.nhan_vat_prompts || {},
            ttsConfig,
            voiceCast: state.voiceCast,
          });
          cast = { ...cast, enabled: true };
          let roles = [...cast.roles];
          const prompts = { ...(state.nhan_vat_prompts || {}) };

          const patchRole = (
            role: VoiceRole,
            extra?: { speed?: number; pitch?: number; emotion?: string },
          ): VoiceRole => ({
            ...role,
            voiceId: profileName,
            voicesByPlatform: {
              ...(role.voicesByPlatform || {}),
              [platform]: profileName,
            },
            speed:
              typeof extra?.speed === 'number'
                ? extra.speed
                : typeof params.speed === 'number'
                  ? params.speed
                  : role.speed,
            pitch:
              typeof extra?.pitch === 'number'
                ? extra.pitch
                : typeof params.pitch === 'number'
                  ? params.pitch
                  : role.pitch,
            emotion: extra?.emotion ?? params.emotion ?? role.emotion,
          });

          if (target === 'global' || target === 'narrator' || target === '') {
            roles = roles.map((r) =>
              r.id === NARRATOR_ROLE_ID || r.kind === 'narrator'
                ? patchRole(r)
                : r,
            );
            // global: narrator + default tts voice
            return {
              ttsConfig,
              voiceCast: normalizeVoiceCast({ ...cast, roles, enabled: true }),
            };
          }

          // Character target
          const name = target;
          const prev = normalizeNhanVatProfile(prompts[name]);
          prompts[name] = normalizeNhanVatProfile({
            ...prev,
            tts_voice: profileName,
          });

          // Prosody from quirk hồ sơ nếu chưa truyền
          let speed = params.speed;
          let pitch = params.pitch;
          let emotion = params.emotion;
          const pr = suggestProsodyFromProfile(prompts[name], {
            baseSpeed: ttsConfig.speed,
            basePitch: ttsConfig.pitch,
          });
          if (speed == null) speed = pr.speed;
          if (pitch == null) pitch = pr.pitch;
          if (!emotion) emotion = pr.emotion;

          const existing = findRoleByCharacter(roles, name);
          if (existing) {
            roles = roles.map((r) =>
              r.id === existing.id
                ? patchRole(r, { speed, pitch, emotion })
                : r,
            );
          } else {
            const nextIdx = maxVinaRoleIndex(roles) + 1;
            roles.push(
              patchRole(
                {
                  id: characterRoleId(name),
                  label: name,
                  kind: 'character',
                  characterName: name,
                  voiceId: profileName,
                  voicesByPlatform: { [platform]: profileName },
                  vinaRoleIndex: nextIdx,
                },
                { speed, pitch, emotion },
              ),
            );
          }

          return {
            ttsConfig,
            nhan_vat_prompts: prompts,
            voiceCast: normalizeVoiceCast({ ...cast, roles, enabled: true }),
          };
        }),

      migrateCastVoicesForPlatform: (newPlatform, language) =>
        set((state) => {
          const cast = normalizeVoiceCast(state.voiceCast);
          if (!cast.roles.length) return state;
          const lang = language || state.ttsConfig.language || 'vi';
          const roles = migrateRolesForPlatform(
            cast.roles,
            newPlatform,
            lang,
            state.nhan_vat_prompts || {},
            state.ttsConfig.voice || '',
            {
              baseSpeed: state.ttsConfig.speed,
              basePitch: state.ttsConfig.pitch,
            },
          );
          return { voiceCast: normalizeVoiceCast({ ...cast, roles }) };
        }),
  };
}
