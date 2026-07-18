'use client';

import React, { useState } from 'react';
import type { TTSConfig } from '@/store/useNovelStore';
import { Volume2, Loader2, Play, X, Trash2 } from 'lucide-react';
import { SELECT_DARK_SM, OPTION_DARK } from '../ttsSelectStyles';
import { appConfirm } from '@/lib/confirmDialog';

export type CloneVoiceTabProps = {
  config: TTSConfig;
  updateTTSConfig: (p: Partial<TTSConfig>) => void;
  filteredCloneProfiles: Array<{
    name: string;
    hasSample?: boolean;
    filename?: string;
    isUser?: boolean;
    source?: string;
  }>;
  cloneProfiles: Array<{ name: string; isUser?: boolean }>;
  onCloneFilterChange: (partial: Partial<TTSConfig>) => void;
  applyCloneProfile: (name: string) => void;
  isPreviewing: boolean;
  handlePreviewVoice: () => void | Promise<void>;
  /** Xóa 1 USER clone khỏi UI + disk */
  onDeleteCloneProfile?: (name: string) => void | Promise<void>;
  /** Xóa tất cả USER clone */
  onDeleteAllUserClones?: () => void | Promise<void>;
  deletingCloneName?: string | null;
};

function isDeletableClone(p: {
  name: string;
  isUser?: boolean;
  source?: string;
}): boolean {
  return !!(
    p.isUser ||
    p.source === 'user_upload' ||
    p.source === 'user_scan' ||
    /^USER/i.test(p.name)
  );
}

export default function CloneVoiceTab(props: CloneVoiceTabProps) {
  const {
    config,
    updateTTSConfig,
    filteredCloneProfiles,
    cloneProfiles,
    onCloneFilterChange,
    applyCloneProfile,
    isPreviewing,
    handlePreviewVoice,
    onDeleteCloneProfile,
    onDeleteAllUserClones,
    deletingCloneName,
  } = props;
  const store = { updateTTSConfig };
  const [confirmAll, setConfirmAll] = useState(false);

  const userCount = cloneProfiles.filter((p) => isDeletableClone(p)).length;
  const selectedName =
    filteredCloneProfiles.some((p) => p.name === (config.voice || ''))
      ? config.voice
      : filteredCloneProfiles.find((p) => p.hasSample !== false)?.name || '';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="space-y-1">
          <label className="text-[9px] font-bold uppercase text-zinc-500">Giới tính</label>
          <select
            value={config.vinaGender || 'male'}
            onChange={(e) =>
              onCloneFilterChange({
                vinaGender: e.target.value as 'male' | 'female',
              })
            }
            className={SELECT_DARK_SM}
          >
            <option className={OPTION_DARK} value="male">
              Nam
            </option>
            <option className={OPTION_DARK} value="female">
              Nữ
            </option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[9px] font-bold uppercase text-zinc-500">Phong cách</label>
          <select
            value={config.vinaGroup || 'story'}
            onChange={(e) => onCloneFilterChange({ vinaGroup: e.target.value })}
            className={SELECT_DARK_SM}
          >
            <option className={OPTION_DARK} value="story">
              Kể chuyện
            </option>
            <option className={OPTION_DARK} value="news">
              Tin tức
            </option>
            <option className={OPTION_DARK} value="audiobook">
              Sách nói
            </option>
            <option className={OPTION_DARK} value="ads">
              Quảng cáo
            </option>
            <option className={OPTION_DARK} value="dubbing">
              Lồng tiếng
            </option>
            <option className={OPTION_DARK} value="review">
              Review
            </option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[9px] font-bold uppercase text-zinc-500">Cảm xúc</label>
          <select
            value={config.vinaEmotion || 'neutral'}
            onChange={(e) => onCloneFilterChange({ vinaEmotion: e.target.value })}
            className={SELECT_DARK_SM}
          >
            <option className={OPTION_DARK} value="neutral">
              Trung tính
            </option>
            <option className={OPTION_DARK} value="happy">
              Vui
            </option>
            <option className={OPTION_DARK} value="sad">
              Buồn
            </option>
            <option className={OPTION_DARK} value="angry">
              Giận
            </option>
            <option className={OPTION_DARK} value="fear">
              Sợ
            </option>
            <option className={OPTION_DARK} value="gentle">
              Dịu dàng
            </option>
            <option className={OPTION_DARK} value="tired">
              Mệt
            </option>
          </select>
        </div>
      </div>
      <p className="text-[9px] text-zinc-600 -mt-2">
        List giọng bên dưới đã lọc theo 4 trường trên
        {cloneProfiles.length
          ? ` (${filteredCloneProfiles.length}/${cloneProfiles.length})`
          : ''}
        . 🎤 = có file mẫu · ⚠ = thiếu WAV · nút <strong className="text-zinc-400">✕</strong> =
        xóa USER clone khỏi app. Lần đầu nghe thử sinh + lưu cache
        (data/tts-preview-cache); lần sau cùng giọng/câu phát ngay.
      </p>

      <div className="space-y-2">
        <label className="flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-widest text-zinc-400">
          <span className="flex items-center gap-1.5">
            <Volume2 className="h-3.5 w-3.5 text-amber-400" />
            Chọn giọng
            <span className="normal-case font-medium text-zinc-600 tracking-normal">
              ({filteredCloneProfiles.length || 0}
              {userCount ? ` · ${userCount} USER` : ''})
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            {userCount > 0 && onDeleteAllUserClones && (
              <button
                type="button"
                disabled={!!deletingCloneName}
                onClick={() => {
                  if (!confirmAll) {
                    setConfirmAll(true);
                    return;
                  }
                  setConfirmAll(false);
                  void onDeleteAllUserClones();
                }}
                title="Xóa toàn bộ giọng USER clone"
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold normal-case tracking-normal text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-900/40 disabled:opacity-50"
              >
                <Trash2 className="h-3 w-3" />
                {confirmAll ? `Xác nhận xóa ${userCount}?` : 'Xóa hết USER'}
              </button>
            )}
            {config.voice && (
              <button
                type="button"
                onClick={() => void handlePreviewVoice()}
                title={
                  isPreviewing
                    ? 'Bấm để hủy nghe thử'
                    : 'Sinh Zero-Shot từ file mẫu của đúng profile đang chọn'
                }
                className={`flex items-center gap-1.5 px-3 py-1 rounded transition-colors normal-case tracking-normal font-semibold text-[11px] ${
                  isPreviewing
                    ? 'bg-rose-500/15 text-rose-400 hover:bg-rose-500/25'
                    : 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
                }`}
              >
                {isPreviewing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                {isPreviewing ? 'Hủy' : 'Nghe thử'}
              </button>
            )}
          </span>
        </label>

        <div className="max-h-56 overflow-y-auto rounded-lg border border-zinc-800 bg-black/40 divide-y divide-zinc-800/80">
          {filteredCloneProfiles.length === 0 && (
            <p className="px-3 py-4 text-[11px] text-zinc-500 text-center">
              Không có giọng khớp bộ lọc
            </p>
          )}
          {filteredCloneProfiles.map((p) => {
            const selected = p.name === selectedName;
            const canDelete = isDeletableClone(p) && !!onDeleteCloneProfile;
            const busy = deletingCloneName === p.name;
            return (
              <div
                key={p.name}
                className={`flex items-center gap-1 group ${
                  selected
                    ? 'bg-amber-500/10 border-l-2 border-l-amber-400'
                    : 'hover:bg-zinc-900/80 border-l-2 border-l-transparent'
                } ${p.hasSample === false ? 'opacity-70' : ''}`}
              >
                <button
                  type="button"
                  disabled={p.hasSample === false}
                  onClick={() => applyCloneProfile(p.name)}
                  className="flex-1 min-w-0 text-left px-2.5 py-2 text-[12px] text-zinc-200 disabled:cursor-not-allowed"
                  title={
                    p.hasSample === false
                      ? `Thiếu mẫu: ${p.filename || p.name}`
                      : p.name
                  }
                >
                  <span className="mr-1.5">
                    {p.hasSample === false ? '⚠' : '🎤'}
                  </span>
                  <span className="truncate inline-block max-w-[calc(100%-1.5rem)] align-middle">
                    {p.name}
                  </span>
                  {isDeletableClone(p) && (
                    <span className="ml-1.5 text-[9px] font-bold uppercase text-sky-500/80">
                      USER
                    </span>
                  )}
                </button>
                {canDelete && (
                  <button
                    type="button"
                    disabled={!!deletingCloneName}
                    onClick={(e) => {
                      e.stopPropagation();
                      void (async () => {
                        const ok = await appConfirm({
                          title: 'Xóa giọng clone',
                          message: `Xóa giọng clone «${p.name}» khỏi app?`,
                          details: [
                            'File mẫu + profile sẽ bị xóa vĩnh viễn',
                          ],
                          confirmLabel: 'Xóa vĩnh viễn',
                          cancelLabel: 'Giữ lại',
                          tone: 'danger',
                        });
                        if (!ok) return;
                        void onDeleteCloneProfile?.(p.name);
                      })();
                    }}
                    title={`Xóa «${p.name}»`}
                    className="shrink-0 m-1 p-1.5 rounded-md text-zinc-500 hover:text-rose-400 hover:bg-rose-500/15 disabled:opacity-40 transition-colors"
                    aria-label={`Xóa ${p.name}`}
                  >
                    {busy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-rose-400" />
                    ) : (
                      <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {(() => {
          const cur = filteredCloneProfiles.find((p) => p.name === config.voice);
          if (cur && cur.hasSample === false) {
            return (
              <p className="text-[10px] text-rose-400/90 leading-snug rounded border border-rose-900/40 bg-rose-950/20 px-2 py-1.5">
                Giọng «{cur.name}» thiếu file mẫu
                {cur.filename ? ` (${cur.filename})` : ''} trong{' '}
                <code className="text-rose-300">data/vina-voices/samples</code> — thêm WAV,
                chọn giọng 🎤 khác, hoặc bấm ✕ nếu là USER clone.
              </p>
            );
          }
          return null;
        })()}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label
            className="text-[9px] font-bold uppercase text-zinc-500"
            title="Mã số định danh “người nói”. Đổi số = cùng style nhưng tembre/biến thể giọng khác (như chọn ID nhân vật)."
          >
            Speaker seed
          </label>
          <input
            type="number"
            value={config.vinaSpeakerSeed ?? 2336}
            onChange={(e) =>
              store.updateTTSConfig({
                vinaSpeakerSeed: parseInt(e.target.value, 10) || 0,
              })
            }
            className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-100"
          />
          <p className="text-[8px] text-zinc-600 leading-snug">
            ID giọng / tembre. Đổi số → biến thể người nói khác (cùng profile).
          </p>
        </div>
        <div className="space-y-1">
          <label
            className="text-[9px] font-bold uppercase text-zinc-500"
            title="Mã số điệu bộ: ngắt nghỉ, nhấn nhá, ngữ điệu câu. Đổi số = cùng tembre nhưng cách đọc khác."
          >
            Style seed
          </label>
          <input
            type="number"
            value={config.vinaStyleSeed ?? 4125}
            onChange={(e) =>
              store.updateTTSConfig({
                vinaStyleSeed: parseInt(e.target.value, 10) || 0,
              })
            }
            className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-100"
          />
          <p className="text-[8px] text-zinc-600 leading-snug">
            Điệu bộ / ngắt nghỉ / nhấn nhá. Đổi số → cách đọc khác, tembre giữ.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">
            Tốc độ
          </label>
          <div className="flex items-center gap-3 bg-black/60 border border-zinc-800 rounded-lg p-2">
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.1"
              value={config.speed}
              onChange={(e) =>
                store.updateTTSConfig({ speed: parseFloat(e.target.value) })
              }
              className="w-full accent-amber-500 h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
            />
            <span className="text-sm font-bold text-zinc-300 w-10 text-right">
              {Number(config.speed || 1).toFixed(1)}x
            </span>
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">
            Pitch
          </label>
          <div className="flex items-center gap-3 bg-black/60 border border-zinc-800 rounded-lg p-2">
            <input
              type="range"
              min="-12"
              max="12"
              step="1"
              value={config.pitch || 0}
              onChange={(e) =>
                store.updateTTSConfig({ pitch: parseInt(e.target.value, 10) })
              }
              className="w-full accent-indigo-500 h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
            />
            <span className="text-sm font-bold text-zinc-300 w-12 text-right">
              {(config.pitch || 0) > 0 ? `+${config.pitch}` : config.pitch || 0}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
