'use client';
import { API } from '@/contracts';

/**
 * Role Casting Studio — Voice roles + Script casting board (Vina-inspired).
 * Cyberpunk glass aesthetic; hydration-safe.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import RoleCastRolesPanel from './rolecast/RoleCastRolesPanel';
import RoleCastBoardPanel from './rolecast/RoleCastBoardPanel';
import { useNovelStore } from '@/store/useNovelStore';
import {
  getCharacterVoiceOptions,
  suggestProsodyFromProfile,
  suggestVoiceFromProfile,
} from '@/lib/characterVoice';
import {
  NARRATOR_ROLE_ID,
  characterRoleId,
  isCastActive,
  normalizeVoiceCast,
  sceneKey,
  type VoiceRole,
} from '@/lib/voiceCast';
import { buildSceneCastSegments } from '@/lib/castDialogue';
import { suggestAllRolesFromProfiles } from '@/lib/castSeed';
import { applyBulkRoleRule } from '../../modules/castModule';
import { playTTSAction } from '../../modules/ttsModule';
import { getTTSCredentialsForConfig } from '../../modules/tts/credentials';
import { getTTSApiCredentials } from '../../hooks/ttsActionHelpers';
import { useCharacterActions } from '../../hooks/useCharacterActions';
import {
  downloadJson,
  exportVinaRoleProfile,
  exportVinaRolesJson,
} from '@/lib/castExport';
import {
  autoTagCacheKey,
  getAutoTagCache,
  setAutoTagCache,
} from '@/lib/castAutoTagCache';
import {
  clearAllMultiPartials,
  clearMultiPartial,
  listAllMultiPartials,
} from '@/lib/multiTtsPartialCache';
import { runCastPreflight } from '../../modules/castPreflight';
import {
  X,
  Volume2,
  Loader2,
  Users,
  ListOrdered,
  Sparkles,
  RefreshCw,
  Download,
  Wand2,
} from 'lucide-react';

interface RoleCastStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Optional scene text for board tab */
  sceneText?: string;
  chapter?: number;
  sceneIndex?: number;
  initialTab?: 'roles' | 'board';
}

export default function RoleCastStudioModal({
  isOpen,
  onClose,
  sceneText = '',
  chapter = 1,
  sceneIndex = 0,
  initialTab = 'roles',
}: RoleCastStudioModalProps) {
  const store = useNovelStore();
  const {
    generatingAllCharPrompts,
    genAllProgress,
    handleGenerateAllCharPrompts,
  } = useCharacterActions();
  const [tab, setTab] = useState<'roles' | 'board'>(initialTab);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [bulkRule, setBulkRule] = useState('#1-#2-#1');
  const [selectedOrders, setSelectedOrders] = useState<number[]>([]);
  const [toast, setToast] = useState('');
  const [autoTagging, setAutoTagging] = useState(false);
  const [previewingSegId, setPreviewingSegId] = useState<string | null>(null);

  const hydrated = store.isHydrated;
  const cast = normalizeVoiceCast(store.voiceCast);
  const platform = (store.ttsConfig?.platform || '').trim();
  const language = (store.ttsConfig?.language || '').trim();
  const voiceOptions = useMemo(
    () => (platform && language ? getCharacterVoiceOptions(platform, language) : []),
    [platform, language],
  );

  useEffect(() => {
    if (!isOpen || !hydrated) return;
    store.ensureVoiceCastSeeded();
    setTab(initialTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, hydrated, initialTab]);

  const roles = cast.roles;
  const castOn = isCastActive(cast);
  const [cacheTick, setCacheTick] = useState(0);

  const partialList = useMemo(() => {
    void cacheTick;
    return listAllMultiPartials();
  }, [cacheTick, isOpen]);

  const sceneHealth = useMemo(() => {
    if (!sceneText?.trim()) return null;
    return runCastPreflight({
      sceneText,
      chapter,
      sceneIndex,
      cast,
      characterNames: store.nhan_vat || [],
      nhanVatPrompts: store.nhan_vat_prompts || {},
      defaultVoice: store.ttsConfig.voice || '',
      platform: platform,
      language,
      globalSpeed: store.ttsConfig.speed,
      globalPitch: store.ttsConfig.pitch,
    });
  }, [
    sceneText,
    chapter,
    sceneIndex,
    cast,
    store.nhan_vat,
    store.nhan_vat_prompts,
    store.ttsConfig.voice,
    store.ttsConfig.speed,
    store.ttsConfig.pitch,
    platform,
    language,
  ]);

  const board = useMemo(() => {
    if (!sceneText?.trim()) {
      return {
        segments: [] as ReturnType<typeof buildSceneCastSegments>['segments'],
        textHash: '',
        prunedOverrideIds: [] as string[],
      };
    }
    return buildSceneCastSegments({
      sceneText,
      chapter,
      sceneIndex,
      characterNames: store.nhan_vat || [],
      cast,
    });
  }, [sceneText, chapter, sceneIndex, store.nhan_vat, cast]);

  // Persist scene text hash + prune unlocked overrides when scene changes
  useEffect(() => {
    if (!isOpen || !sceneText?.trim() || !board.textHash) return;
    const sk = sceneKey(chapter, sceneIndex);
    const prev = cast.sceneTextHashes?.[sk];
    if (prev === board.textHash && !board.prunedOverrideIds.length) return;
    const segmentOverrides = { ...cast.segmentOverrides };
    for (const id of board.prunedOverrideIds) {
      delete segmentOverrides[id];
    }
    store.updateVoiceCast({
      sceneTextHashes: { ...(cast.sceneTextHashes || {}), [sk]: board.textHash },
      segmentOverrides,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, board.textHash, chapter, sceneIndex, sceneText]);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 3200);
  };

  const updateRole = (roleId: string, patch: Partial<VoiceRole>) => {
    const role = roles.find((r) => r.id === roleId);
    if (!role) return;
    const next = { ...role, ...patch };
    if (patch.voiceId != null) {
      next.voicesByPlatform = {
        ...(role.voicesByPlatform || {}),
        [platform]: patch.voiceId,
      };
      if (role.kind === 'character' && role.characterName) {
        store.setCharacterVoice(role.characterName, patch.voiceId);
        store.upsertVoiceRole(next);
        return;
      }
      if (role.kind === 'narrator') {
        store.updateTTSConfig({ voice: patch.voiceId });
      }
    }
    store.upsertVoiceRole(next);
  };

  const previewRole = async (role: VoiceRole) => {
    try {
      setPreviewingId(role.id);
      const live = useNovelStore.getState();
      const voice = (role.voiceId || '').trim();
      if (!voice) {
        throw new Error('Chưa chọn giọng cho role — gán voice trước khi nghe thử.');
      }
      const ttsConfig = {
        ...live.ttsConfig,
        voice,
        speed: role.speed ?? live.ttsConfig.speed,
        pitch: role.pitch ?? live.ttsConfig.pitch,
      };
      const creds = getTTSCredentialsForConfig(
        ttsConfig,
        getTTSApiCredentials(live).apiKey,
        getTTSApiCredentials(live).apiKeys,
      );
      const sample = `Xin chào, tôi là ${role.label}. Đây là giọng đọc thử.`;
      await playTTSAction({
        text: sample,
        voice,
        ttsConfig,
        apiKeys: creds.apiKeys,
        apiKey: creds.apiKey,
        ten_tac_pham: live.ten_tac_pham || 'AI Novel',
        onStart: () => {},
        onSuccess: () => {},
        onEnded: () => setPreviewingId(null),
        onError: (msg) => {
          setPreviewingId(null);
          showToast(msg);
        },
      });
    } catch (e) {
      setPreviewingId(null);
      showToast(e instanceof Error ? e.message : String(e));
    }
  };

  const suggestRole = (role: VoiceRole) => {
    if (role.kind === 'narrator') return;
    if (role.locked) {
      showToast('Role đang khóa — mở khóa trước khi gợi ý');
      return;
    }
    const profile = role.characterName
      ? store.nhan_vat_prompts?.[role.characterName]
      : undefined;
    const v = suggestVoiceFromProfile(profile, platform, language);
    const prosody = suggestProsodyFromProfile(profile, {
      baseSpeed: store.ttsConfig.speed,
      basePitch: store.ttsConfig.pitch,
    });
    updateRole(role.id, {
      voiceId: v || role.voiceId,
      speed: prosody.speed,
      pitch: prosody.pitch,
      emotion: prosody.emotion,
    });
    const giong = (profile?.giong_thoai || '').trim();
    showToast(
      giong
        ? `Quirk: “${giong.slice(0, 40)}${giong.length > 40 ? '…' : ''}” → ${prosody.note} · spd ${prosody.speed} · pitch ${prosody.pitch}`
        : `Gợi ý hồ sơ → ${prosody.note} · spd ${prosody.speed} · pitch ${prosody.pitch}`,
    );
  };

  /**
   * Ghi đè "Gợi ý tất cả": Gen Prompt AI toàn bộ NV + gán chất giọng
   * theo giới tính, tính cách, quirk, động cơ, dáng…
   */
  const genPromptAndCastAll = async () => {
    const chars = store.nhan_vat || [];
    if (!chars.length) {
      showToast('Chưa có nhân vật — thêm NV ở Sidebar trước');
      return;
    }
    showToast(`Đang Gen Prompt + giọng cho ${chars.length} NV…`);
    const result = await handleGenerateAllCharPrompts({
      applyCastVoices: true,
      silent: true,
    });
    if (!result) return;
    if (result.ok === 0 && result.fail === 0) {
      showToast('Đã hủy');
      return;
    }
    // Refresh cast from latest store after gen
    const snap = useNovelStore.getState();
    const freshCast = normalizeVoiceCast(snap.voiceCast);
    const { roles: nextRoles, updated } = suggestAllRolesFromProfiles(
      freshCast.roles.length ? freshCast.roles : roles,
      snap.nhan_vat_prompts || {},
      platform,
      language,
      snap.ttsConfig.speed,
      snap.ttsConfig.pitch,
      { preferFreshSuggest: true, respectExplicitTtsVoice: false },
    );
    store.setVoiceCast({
      ...freshCast,
      enabled: true,
      roles: nextRoles,
    });
    for (const r of nextRoles) {
      if (r.kind === 'character' && r.characterName && r.voiceId && !r.locked) {
        store.updateNhanVatPrompt(r.characterName, { tts_voice: r.voiceId });
      }
    }
    showToast(
      `✅ Prompt ${result.ok}/${chars.length}` +
        (result.fail ? ` · lỗi ${result.fail}` : '') +
        ` · giọng hồ sơ ${updated} role (giới tính · tính cách · quirk)`,
    );
  };

  const toggleEnabled = () => {
    if (!cast.enabled) {
      store.ensureVoiceCastSeeded();
      store.updateVoiceCast({ enabled: true });
      showToast('Đã bật Role Casting Studio');
    } else {
      store.updateVoiceCast({ enabled: false });
      showToast('Đã tắt cast — gen TTS dùng legacy');
    }
  };

  const applyBulk = () => {
    const { updates, errors } = applyBulkRoleRule({
      segments: board.segments.map((s) => ({ id: s.id, order: s.order })),
      selectedOrders: selectedOrders.length
        ? selectedOrders
        : board.segments.map((s) => s.order),
      rule: bulkRule,
      roles,
    });
    for (const u of updates) {
      store.setSegmentOverride(u.segmentId, {
        speakerRoleId: u.speakerRoleId,
        source: 'manual',
        locked: true,
      });
    }
    if (errors.length) showToast(errors[0]);
    else showToast(`Đã gán ${updates.length} dòng`);
  };

  const previewSegment = async (segId: string, text: string, roleId: string) => {
    const role = roles.find((r) => r.id === roleId);
    const live = useNovelStore.getState();
    const voice = (role?.voiceId || '').trim();
    if (!voice || !text.trim()) {
      showToast('Thiếu voice hoặc text để preview — gán giọng role / engine TTS trước.');
      return;
    }
    try {
      setPreviewingSegId(segId);
      const ttsConfig = {
        ...live.ttsConfig,
        voice,
        speed: role?.speed ?? live.ttsConfig.speed,
        pitch: role?.pitch ?? live.ttsConfig.pitch,
      };
      const baseCreds = getTTSApiCredentials(live);
      const creds = getTTSCredentialsForConfig(
        ttsConfig,
        baseCreds.apiKey,
        baseCreds.apiKeys,
      );
      await playTTSAction({
        text: text.slice(0, 300),
        voice,
        ttsConfig,
        apiKeys: creds.apiKeys,
        apiKey: creds.apiKey,
        ten_tac_pham: live.ten_tac_pham || 'AI Novel',
        onStart: () => {},
        onSuccess: () => {},
        onEnded: () => setPreviewingSegId(null),
        onError: (msg) => {
          setPreviewingSegId(null);
          showToast(msg);
        },
      });
    } catch (e) {
      setPreviewingSegId(null);
      showToast(e instanceof Error ? e.message : String(e));
    }
  };

  const runAutoTag = async () => {
    if (!sceneText?.trim()) {
      showToast('Không có kịch bản cảnh để auto-tag');
      return;
    }
    const ambiguous = board.segments.filter(
      (s) => s.source === 'ambiguous' || (s.source === 'narrator' && /["“«]/.test(s.text)),
    );
    if (!ambiguous.length) {
      showToast('Không còn dòng 🟡 mơ hồ');
      return;
    }
    setAutoTagging(true);
    try {
      const cacheKey = autoTagCacheKey(sceneText, store.nhan_vat || []);
      let assignments: Array<{
        id: string;
        speaker: string | null;
        confidence: number;
      }> = getAutoTagCache(cacheKey) || [];
      let fromCache = false;
      let latencyMs: number | string = '?';
      let provider = 'cache';
      let segCount = ambiguous.length;

      if (assignments.length) {
        fromCache = true;
        latencyMs = 0;
      } else {
        const res = await fetch(API.castAutoTag, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            characterNames: store.nhan_vat || [],
            sceneText,
            ambiguousOnly: true,
            segments: board.segments.map((s) => ({
              id: s.id,
              text: s.text,
              source: s.source,
              order: s.order,
            })),
            apiKeys: store.apiKeys,
            apiKey: store.apiKey,
            openaiApiKeys: store.openaiApiKeys,
            openaiApiKey: store.openaiApiKey,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || 'Auto-tag failed');
        }
        assignments = Array.isArray(data.assignments) ? data.assignments : [];
        latencyMs = data.latencyMs ?? '?';
        provider = data.provider || 'ai';
        segCount = data.segCount || ambiguous.length;
        if (assignments.length) {
          setAutoTagCache(cacheKey, assignments, provider);
        }
      }

      let applied = 0;
      for (const a of assignments) {
        if (!a?.id) continue;
        const speaker = a.speaker as string | null;
        const roleId = speaker ? characterRoleId(speaker) : NARRATOR_ROLE_ID;
        if (
          speaker &&
          !roles.some((r) => r.id === roleId || r.characterName === speaker)
        ) {
          continue;
        }
        const resolvedRoleId = speaker
          ? roles.find(
              (r) =>
                r.characterName?.normalize('NFC') === speaker.normalize('NFC') ||
                r.id === roleId,
            )?.id || roleId
          : NARRATOR_ROLE_ID;
        store.setSegmentOverride(a.id, {
          speakerRoleId: resolvedRoleId,
          source: 'ai_tag',
          confidence: a.confidence,
          locked: false,
        });
        applied += 1;
      }
      showToast(
        `${fromCache ? 'Cache' : 'AI'} gán ${applied}/${segCount} dòng · ${latencyMs}ms · ${provider}`,
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      setAutoTagging(false);
    }
  };

  const reseed = () => {
    if (!window.confirm('Reset cast theo danh sách nhân vật hiện tại? Overrides sẽ giữ nếu còn khớp.')) {
      return;
    }
    store.setVoiceCast({
      version: 1,
      enabled: true,
      roles: [],
      segmentOverrides: cast.segmentOverrides,
      boardScope: cast.boardScope,
      sceneTextHashes: cast.sceneTextHashes,
      allowTextOverride: cast.allowTextOverride,
    });
    store.ensureVoiceCastSeeded();
    showToast('Đã seed lại roles');
  };

  const roleLabel = useCallback(
    (roleId: string) => {
      const r = roles.find((x) => x.id === roleId);
      if (!r) return roleId;
      const tag =
        r.kind === 'narrator'
          ? '#0'
          : typeof r.vinaRoleIndex === 'number'
            ? `#${r.vinaRoleIndex}`
            : '';
      return `${tag} ${r.label}`.trim();
    },
    [roles],
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 backdrop-blur-md p-3">
      <div className="relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950/95 shadow-2xl shadow-emerald-950/30">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-900 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="text-lg">🎭</span>
            <div>
              <h2 className="text-sm font-bold tracking-wide text-zinc-100">
                Role Casting Studio
              </h2>
              <p className="text-[10px] text-zinc-500">
                Phân vai giọng đọc · platform{' '}
                <span className="text-emerald-400/90">{platform}</span>
                {castOn ? (
                  <span className="ml-2 text-emerald-500">● ACTIVE</span>
                ) : (
                  <span className="ml-2 text-zinc-600">○ OFF</span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleEnabled}
              className={`rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider ${
                castOn
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                  : 'bg-zinc-900 text-zinc-400 border border-zinc-800'
              }`}
            >
              {castOn ? 'Cast ON' : 'Cast OFF'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-zinc-900 px-4">
          <button
            type="button"
            onClick={() => setTab('roles')}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-[11px] font-bold uppercase tracking-wider ${
              tab === 'roles'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Users size={14} /> Vai giọng
          </button>
          <button
            type="button"
            onClick={() => setTab('board')}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-[11px] font-bold uppercase tracking-wider ${
              tab === 'board'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <ListOrdered size={14} /> Bảng thoại
          </button>
        </div>

        {toast && (
          <div className="mx-4 mt-2 rounded border border-amber-900/50 bg-amber-950/40 px-3 py-1.5 text-[11px] text-amber-200">
            {toast}
          </div>
        )}

        {/* Health + partial cache summary */}
        {(sceneHealth || partialList.length > 0) && (
          <div className="mx-4 mt-2 space-y-1.5 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
            {sceneHealth ? (
              <div className="text-[10px] text-zinc-400">
                <span className="font-bold text-emerald-400/90">
                  Cảnh {sceneIndex} · Ch.{chapter}
                </span>
                {': '}
                {sceneHealth.multi
                  ? `Multi ${sceneHealth.voiceCount} giọng · ${sceneHealth.segmentCount} đoạn`
                  : `Single · ${sceneHealth.segmentCount || 0} đoạn`}
                {sceneHealth.partialCached > 0
                  ? ` · resume ${sceneHealth.partialCached}/${sceneHealth.partialTotal}`
                  : ''}
                {sceneHealth.issues
                  .filter((i) => i.level === 'warn' || i.level === 'block')
                  .slice(0, 2)
                  .map((i) => (
                    <div
                      key={i.code}
                      className={
                        i.level === 'block' ? 'text-rose-400' : 'text-amber-400/90'
                      }
                    >
                      {i.level === 'block' ? '🚫' : '⚠️'} {i.message}
                    </div>
                  ))}
              </div>
            ) : null}
            {partialList.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 text-[9px] text-violet-300/90">
                <span className="font-bold uppercase">
                  Cache partial: {partialList.length} cảnh
                </span>
                <button
                  type="button"
                  onClick={() => {
                    clearMultiPartial(chapter, sceneIndex);
                    setCacheTick((t) => t + 1);
                    showToast('Đã xóa cache partial cảnh này');
                  }}
                  className="underline hover:text-violet-200"
                >
                  Xóa cảnh này
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const n = clearAllMultiPartials();
                    setCacheTick((t) => t + 1);
                    showToast(`Đã xóa ${n} cache partial`);
                  }}
                  className="underline hover:text-rose-300"
                >
                  Xóa tất cả
                </button>
              </div>
            ) : null}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!hydrated ? (
            <div className="flex items-center justify-center gap-2 py-16 text-zinc-500">
              <Loader2 className="animate-spin" size={18} /> Hydrating…
            </div>
          ) : tab === 'roles' ? (
            <RoleCastRolesPanel
              generatingAllCharPrompts={generatingAllCharPrompts}
              genAllProgress={genAllProgress}
              genPromptAndCastAll={genPromptAndCastAll}
              exportVinaRolesJson={exportVinaRolesJson}
              downloadJson={downloadJson}
              exportVinaRoleProfile={exportVinaRoleProfile}
              showToast={showToast}
              cast={cast}
              store={store}
              reseed={reseed}
              roles={roles}
              updateRole={updateRole}
              voiceOptions={voiceOptions}
              previewingId={previewingId}
              previewRole={previewRole}
              suggestRole={suggestRole}
            />
          ) : (
            <RoleCastBoardPanel
              sceneText={sceneText}
              sceneIndex={sceneIndex}
              chapter={chapter}
              board={board}
              bulkRule={bulkRule}
              setBulkRule={setBulkRule}
              selectedOrders={selectedOrders}
              setSelectedOrders={setSelectedOrders}
              autoTagging={autoTagging}
              runAutoTag={runAutoTag}
              applyBulk={applyBulk}
              previewingSegId={previewingSegId}
              previewSegment={previewSegment}
              cast={cast}
              store={store}
              roleLabel={roleLabel}
              roles={roles}
            />
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-900 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-800 px-4 py-2 text-[11px] font-bold uppercase text-zinc-400 hover:bg-zinc-900"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
