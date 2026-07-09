'use client';

/**
 * Role Casting Studio — Voice roles + Script casting board (Vina-inspired).
 * Cyberpunk glass aesthetic; hydration-safe.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { applyBulkRoleRule } from '../modules/castModule';
import { playTTSAction } from '../modules/ttsModule';
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
import { runCastPreflight } from '../modules/castPreflight';
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
  const [tab, setTab] = useState<'roles' | 'board'>(initialTab);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [bulkRule, setBulkRule] = useState('#1-#2-#1');
  const [selectedOrders, setSelectedOrders] = useState<number[]>([]);
  const [toast, setToast] = useState('');
  const [autoTagging, setAutoTagging] = useState(false);
  const [previewingSegId, setPreviewingSegId] = useState<string | null>(null);

  const hydrated = store.isHydrated;
  const cast = normalizeVoiceCast(store.voiceCast);
  const platform = store.ttsConfig?.platform || 'edge_tts';
  const language = store.ttsConfig?.language || 'vi';
  const voiceOptions = useMemo(
    () => getCharacterVoiceOptions(platform, language),
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
      globalSpeed: store.ttsConfig.speed ?? 1,
      globalPitch: store.ttsConfig.pitch ?? 0,
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
      const sample = `Xin chào, tôi là ${role.label}. Đây là giọng đọc thử.`;
      await playTTSAction({
        text: sample,
        voice: role.voiceId || store.ttsConfig.voice,
        ttsConfig: {
          ...store.ttsConfig,
          voice: role.voiceId || store.ttsConfig.voice,
          speed: role.speed ?? store.ttsConfig.speed,
          pitch: role.pitch ?? store.ttsConfig.pitch,
        },
        apiKeys: store.apiKeys,
        apiKey: store.apiKey,
        ten_tac_pham: store.ten_tac_pham,
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

  const suggestAllRoles = () => {
    const { roles: nextRoles, updated } = suggestAllRolesFromProfiles(
      roles,
      store.nhan_vat_prompts || {},
      platform,
      language,
      store.ttsConfig.speed ?? 1,
      store.ttsConfig.pitch ?? 0,
    );
    if (!updated) {
      showToast('Không có role mới (đã khớp quirk hoặc đang khóa)');
      return;
    }
    store.setVoiceCast({
      ...cast,
      enabled: true,
      roles: nextRoles,
    });
    // Dual-write tts_voice (không qua setCharacterVoice để tránh race ghi đè cast)
    for (const r of nextRoles) {
      if (r.kind !== 'character' || !r.characterName || r.locked) continue;
      const prev = roles.find((x) => x.id === r.id);
      if (prev && r.voiceId && r.voiceId !== prev.voiceId) {
        store.updateNhanVatPrompt(r.characterName, { tts_voice: r.voiceId });
      }
    }
    showToast(
      `Đã gợi ý ${updated} NV từ Giọng thoại/quirk (speed · pitch · emotion)`,
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
    const voice = role?.voiceId || store.ttsConfig.voice;
    if (!voice || !text.trim()) {
      showToast('Thiếu voice hoặc text để preview');
      return;
    }
    try {
      setPreviewingSegId(segId);
      await playTTSAction({
        text: text.slice(0, 300),
        voice,
        ttsConfig: {
          ...store.ttsConfig,
          voice,
          speed: role?.speed ?? store.ttsConfig.speed,
          pitch: role?.pitch ?? store.ttsConfig.pitch,
        },
        apiKeys: store.apiKeys,
        apiKey: store.apiKey,
        ten_tac_pham: store.ten_tac_pham,
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
        const res = await fetch('/api/cast/auto-tag', {
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
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-zinc-500">
                  Người kể + từng NV · speed/pitch/emotion theo vai · dual-write{' '}
                  <code className="text-zinc-400">tts_voice</code>
                </p>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={suggestAllRoles}
                    className="flex items-center gap-1 rounded border border-amber-900/50 px-2 py-1 text-[10px] text-amber-400 hover:border-amber-600"
                  >
                    <Sparkles size={12} /> Gợi ý tất cả
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const rolesJson = exportVinaRolesJson(
                        cast,
                        {
                          speaker_seed: store.ttsConfig.vinaSpeakerSeed,
                          style_seed: store.ttsConfig.vinaStyleSeed,
                          gender: store.ttsConfig.vinaGender,
                          area: store.ttsConfig.vinaArea,
                          group: store.ttsConfig.vinaGroup,
                        },
                        store.nhan_vat_prompts,
                      );
                      downloadJson('roles.json', rolesJson);
                      const profile = exportVinaRoleProfile(
                        cast,
                        store.nhan_vat || [],
                      );
                      const safeTitle = (store.ten_tac_pham || 'cast')
                        .replace(/[^\w\u00C0-\u1EF9\- ]+/gi, '')
                        .trim()
                        .slice(0, 40) || 'cast';
                      downloadJson(`${safeTitle}.json`, profile);
                      showToast('Đã export roles.json + Role-Profile');
                    }}
                    className="flex items-center gap-1 rounded border border-sky-900/50 px-2 py-1 text-[10px] text-sky-400 hover:border-sky-600"
                  >
                    <Download size={12} /> Export Vina
                  </button>
                  <button
                    type="button"
                    onClick={reseed}
                    className="flex items-center gap-1 rounded border border-zinc-800 px-2 py-1 text-[10px] text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                  >
                    <RefreshCw size={12} /> Reset seed
                  </button>
                </div>
              </div>

              {roles.length === 0 ? (
                <p className="py-8 text-center text-sm text-zinc-600">
                  Chưa có role. Bấm Cast ON hoặc thêm nhân vật ở Sidebar.
                </p>
              ) : (
                roles.map((role) => (
                  <div
                    key={role.id}
                    className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3"
                  >
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-mono text-emerald-400">
                          {role.kind === 'narrator'
                            ? '#0'
                            : `#${role.vinaRoleIndex ?? '?'}`}
                        </span>
                        <span className="text-sm font-semibold text-zinc-100">
                          {role.label}
                        </span>
                        <span className="text-[9px] uppercase text-zinc-600">
                          {role.kind}
                        </span>
                      </div>
                      <div className="flex gap-1">
                        {role.kind === 'character' && (
                          <button
                            type="button"
                            onClick={() => suggestRole(role)}
                            className="flex items-center gap-1 rounded px-2 py-1 text-[9px] font-bold uppercase text-amber-500 hover:bg-amber-950/40"
                          >
                            <Sparkles size={12} /> Gợi ý
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={!role.voiceId || previewingId === role.id}
                          onClick={() => previewRole(role)}
                          className="flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-1 text-[9px] font-bold uppercase text-emerald-400 hover:bg-emerald-500/25 disabled:opacity-40"
                        >
                          {previewingId === role.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Volume2 size={12} />
                          )}
                          Preview
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      <label className="flex flex-col gap-0.5 sm:col-span-2">
                        <span className="text-[9px] font-bold uppercase text-zinc-500">
                          Voice
                        </span>
                        <select
                          value={role.voiceId || ''}
                          onChange={(e) =>
                            updateRole(role.id, { voiceId: e.target.value })
                          }
                          className="h-8 rounded border border-zinc-800 bg-black/50 px-2 text-[11px] text-zinc-200 outline-none focus:border-emerald-600"
                        >
                          <option value="">— chọn —</option>
                          {voiceOptions.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-0.5">
                        <span className="text-[9px] font-bold uppercase text-zinc-500">
                          Speed
                          {role.kind === 'character' &&
                            role.characterName &&
                            store.nhan_vat_prompts?.[role.characterName]
                              ?.giong_thoai && (
                              <span className="ml-1 normal-case font-normal text-zinc-600">
                                (từ quirk)
                              </span>
                            )}
                        </span>
                        <input
                          type="number"
                          step={0.05}
                          min={0.5}
                          max={2}
                          placeholder={String(store.ttsConfig.speed)}
                          value={role.speed ?? ''}
                          onChange={(e) =>
                            updateRole(role.id, {
                              speed: e.target.value === ''
                                ? undefined
                                : Number(e.target.value),
                            })
                          }
                          className="h-8 rounded border border-zinc-800 bg-black/50 px-2 text-[11px] text-zinc-200 outline-none focus:border-emerald-600"
                        />
                      </label>
                      <label className="flex flex-col gap-0.5">
                        <span className="text-[9px] font-bold uppercase text-zinc-500">
                          Pitch
                        </span>
                        <input
                          type="number"
                          step={1}
                          min={-12}
                          max={12}
                          placeholder={String(store.ttsConfig.pitch)}
                          value={role.pitch ?? ''}
                          onChange={(e) =>
                            updateRole(role.id, {
                              pitch: e.target.value === ''
                                ? undefined
                                : Number(e.target.value),
                            })
                          }
                          className="h-8 rounded border border-zinc-800 bg-black/50 px-2 text-[11px] text-zinc-200 outline-none focus:border-emerald-600"
                        />
                      </label>
                      {role.kind === 'character' &&
                        role.characterName &&
                        !!(
                          store.nhan_vat_prompts?.[role.characterName]?.giong_thoai ||
                          store.nhan_vat_prompts?.[role.characterName]?.thoi_quen
                        ) && (
                          <p className="sm:col-span-2 text-[9px] leading-snug text-zinc-600">
                            Quirk:{' '}
                            <span className="text-zinc-400">
                              {(
                                store.nhan_vat_prompts?.[role.characterName]
                                  ?.giong_thoai ||
                                store.nhan_vat_prompts?.[role.characterName]
                                  ?.thoi_quen ||
                                ''
                              ).slice(0, 80)}
                            </span>
                            {typeof role.speed === 'number' ||
                            typeof role.pitch === 'number' ? (
                              <span className="text-emerald-600/80">
                                {' '}
                                · spd {role.speed ?? '—'} · pitch {role.pitch ?? '—'}
                                {role.emotion ? ` · ${role.emotion}` : ''}
                              </span>
                            ) : (
                              <span className="text-amber-600/80">
                                {' '}
                                · bấm Gợi ý để tính speed/pitch
                              </span>
                            )}
                          </p>
                        )}
                      <label className="flex flex-col gap-0.5 sm:col-span-2">
                        <span className="text-[9px] font-bold uppercase text-zinc-500">
                          Emotion
                        </span>
                        <select
                          value={role.emotion || ''}
                          onChange={(e) =>
                            updateRole(role.id, {
                              emotion: e.target.value || undefined,
                            })
                          }
                          className="h-8 rounded border border-zinc-800 bg-black/50 px-2 text-[11px] text-zinc-200 outline-none focus:border-emerald-600"
                        >
                          <option value="">— inherit / neutral —</option>
                          {[
                            'neutral',
                            'happy',
                            'sad',
                            'angry',
                            'fear',
                            'surprised',
                            'determined',
                          ].map((e) => (
                            <option key={e} value={e}>
                              {e}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {!sceneText?.trim() ? (
                <p className="py-10 text-center text-sm text-zinc-600">
                  Mở Studio từ một phân cảnh để xem bảng thoại.
                  <br />
                  <span className="text-[11px] text-zinc-500">
                    (Hoặc paste kịch bản có dòng <code>Tên NV: thoại</code>)
                  </span>
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap items-end gap-2 rounded-lg border border-zinc-800 bg-zinc-900/30 p-2">
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[9px] font-bold uppercase text-zinc-500">
                        Bulk #n
                      </span>
                      <input
                        value={bulkRule}
                        onChange={(e) => setBulkRule(e.target.value)}
                        className="h-8 w-36 rounded border border-zinc-800 bg-black/50 px-2 text-[11px] text-zinc-200"
                        placeholder="#1-#2-#1"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={applyBulk}
                      className="h-8 rounded bg-emerald-500 px-3 text-[10px] font-bold uppercase text-black hover:bg-emerald-400"
                    >
                      Áp dụng
                    </button>
                    <button
                      type="button"
                      disabled={autoTagging}
                      onClick={() => void runAutoTag()}
                      className="h-8 flex items-center gap-1 rounded border border-violet-800/60 bg-violet-500/15 px-3 text-[10px] font-bold uppercase text-violet-300 hover:bg-violet-500/25 disabled:opacity-40"
                    >
                      {autoTagging ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Wand2 size={12} />
                      )}
                      AI Auto-tag
                    </button>
                    <p className="text-[10px] text-zinc-600">
                      Cảnh {sceneIndex} · Ch.{chapter} · {board.segments.length} dòng ·{' '}
                      {board.segments.filter((s) => s.source === 'ambiguous').length} 🟡
                    </p>
                  </div>

                  <div className="overflow-x-auto rounded-lg border border-zinc-800">
                    <table className="w-full min-w-[640px] text-left text-[11px]">
                      <thead className="bg-zinc-900/80 text-[9px] uppercase tracking-wider text-zinc-500">
                        <tr>
                          <th className="p-2 w-8"></th>
                          <th className="p-2 w-10">#</th>
                          <th className="p-2 w-16">ST</th>
                          <th className="p-2">Thoại</th>
                          <th className="p-2 w-44">Vai</th>
                          <th className="p-2 w-14">Lock</th>
                          <th className="p-2 w-16">Nghe</th>
                        </tr>
                      </thead>
                      <tbody>
                        {board.segments.map((seg) => {
                          const statusColor =
                            seg.source === 'ambiguous'
                              ? 'text-amber-400'
                              : seg.source === 'ai_tag'
                                ? 'text-violet-400'
                                : seg.source === 'manual' || seg.locked
                                  ? 'text-emerald-400'
                                  : 'text-zinc-400';
                          const statusIcon =
                            seg.source === 'ambiguous'
                              ? '🟡'
                              : seg.source === 'ai_tag'
                                ? '🟣'
                                : '🟢';
                          return (
                            <tr
                              key={seg.id}
                              className="border-t border-zinc-900/80 hover:bg-zinc-900/40"
                            >
                              <td className="p-2">
                                <input
                                  type="checkbox"
                                  checked={selectedOrders.includes(seg.order)}
                                  onChange={(e) => {
                                    setSelectedOrders((prev) =>
                                      e.target.checked
                                        ? [...prev, seg.order]
                                        : prev.filter((o) => o !== seg.order),
                                    );
                                  }}
                                />
                              </td>
                              <td className="p-2 font-mono text-zinc-600">
                                {seg.order + 1}
                              </td>
                              <td className={`p-2 font-bold ${statusColor}`} title={seg.source}>
                                {statusIcon}
                              </td>
                              <td className="p-2 text-zinc-300 max-w-xs truncate" title={seg.text}>
                                {seg.text}
                              </td>
                              <td className="p-2">
                                <select
                                  value={seg.speakerRoleId}
                                  onChange={(e) => {
                                    store.setSegmentOverride(seg.id, {
                                      speakerRoleId: e.target.value,
                                      source: 'manual',
                                      locked: true,
                                    });
                                  }}
                                  className="h-7 w-full rounded border border-zinc-800 bg-black/50 px-1 text-[10px] text-zinc-200"
                                >
                                  {roles.map((r) => (
                                    <option key={r.id} value={r.id}>
                                      {roleLabel(r.id)}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="p-2 text-center">
                                <input
                                  type="checkbox"
                                  checked={!!seg.locked}
                                  onChange={(e) => {
                                    store.setSegmentOverride(seg.id, {
                                      locked: e.target.checked,
                                      speakerRoleId: seg.speakerRoleId,
                                      source: seg.source,
                                    });
                                  }}
                                />
                              </td>
                              <td className="p-2 text-center">
                                <button
                                  type="button"
                                  disabled={previewingSegId === seg.id}
                                  onClick={() =>
                                    void previewSegment(seg.id, seg.text, seg.speakerRoleId)
                                  }
                                  className="text-emerald-500 hover:text-emerald-300 disabled:opacity-40"
                                  title="Preview dòng"
                                >
                                  {previewingSegId === seg.id ? (
                                    <Loader2 size={12} className="inline animate-spin" />
                                  ) : (
                                    <Volume2 size={12} className="inline" />
                                  )}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
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
