// @ts-nocheck — context bag props from RoleCastStudioModal shell
'use client';

import React from 'react';
import {
  Loader2,
  Sparkles,
  Download,
  RefreshCw,
  Volume2,
  Wand2,
} from 'lucide-react';

/** Tab Vai giọng — inject context bag from RoleCastStudioModal */
/* eslint-disable @typescript-eslint/no-explicit-any */
export default function RoleCastRolesPanel(p: Record<string, any>) {
  const {
    generatingAllCharPrompts,
    genAllProgress,
    genPromptAndCastAll,
    exportVinaRolesJson,
    downloadJson,
    exportVinaRoleProfile,
    showToast,
    cast,
    store,
    reseed,
    roles,
    updateRole,
    voiceOptions,
    previewingId,
    previewRole,
    suggestRole,
  } = p;

  return (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-zinc-500">
                  Người kể + từng NV · giọng theo giới tính/tính cách/quirk · dual-write{' '}
                  <code className="text-zinc-400">tts_voice</code>
                </p>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    disabled={generatingAllCharPrompts}
                    onClick={() => void genPromptAndCastAll()}
                    className="flex items-center gap-1 rounded border border-amber-900/50 bg-amber-500/10 px-2 py-1 text-[10px] font-semibold text-amber-400 hover:border-amber-600 hover:bg-amber-500/20 disabled:opacity-50 disabled:cursor-wait"
                    title="Gen Prompt AI mọi NV + gán chất giọng theo giới tính, tính cách, quirk, động cơ"
                  >
                    {generatingAllCharPrompts ? (
                      <>
                        <Loader2 size={12} className="animate-spin" />
                        {genAllProgress
                          ? `${genAllProgress.current}/${genAllProgress.total} ${genAllProgress.name}`
                          : 'Đang gen…'}
                      </>
                    ) : (
                      <>
                        <Sparkles size={12} /> Gen Prompt + giọng tất cả
                      </>
                    )}
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
                          {voiceOptions.map((v, i) => (
                            <option key={`${v.id}__${i}`} value={v.id}>
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
  );
}
