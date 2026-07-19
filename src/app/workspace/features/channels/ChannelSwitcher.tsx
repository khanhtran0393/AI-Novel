'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  Plus,
  Check,
  Trash2,
  Layers,
  Save,
  Download,
} from 'lucide-react';
import { useNovelStore } from '@/store/useNovelStore';
import {
  resolveChannelOutputDna,
  resolveChannelTtsDna,
} from '@/lib/channelModel';
import {
  selectActiveChannelId,
  selectApplyActiveChannelDna,
  selectChannels,
  selectCreateChannel,
  selectDeleteChannel,
  selectImageAspectRatio,
  selectImageProvider,
  selectIsHydrated,
  selectSaveActiveChannelSnapshot,
  selectSwitchChannel,
  selectTtsConfig,
  selectUpdateChannel,
  selectVisualDnaPrompt,
} from '@/store/useNovelStoreSelectors';
import { GENRE_PACKS, applyGenrePackDefaults } from '@/lib/genrePacks';
import { toast } from '@/lib/toastBus';
import { appConfirm } from '@/lib/confirmDialog';
import FloatingMenu from '../../shared/FloatingMenu';
import { useProAccess } from '../../hooks/useProAccess';

/**
 * Multi-channel workspace picker — compact dropdown on the main header row.
 * Shows DNA chips (TTS + media) and genre pack apply.
 * Tạo kênh thứ 2+ cần Pro (matrix multi_channel).
 */
export default function ChannelSwitcher() {
  const { can, requirePro } = useProAccess();
  const multiOk = can('multi_channel');
  const isHydrated = useNovelStore(selectIsHydrated);
  const activeChannelId = useNovelStore(selectActiveChannelId);
  const channels = useNovelStore(selectChannels);
  const createChannel = useNovelStore(selectCreateChannel);
  const switchChannel = useNovelStore(selectSwitchChannel);
  const updateChannel = useNovelStore(selectUpdateChannel);
  const deleteChannel = useNovelStore(selectDeleteChannel);
  const applyActiveChannelDna = useNovelStore(selectApplyActiveChannelDna);
  const saveActiveChannelSnapshot = useNovelStore(selectSaveActiveChannelSnapshot);
  const ttsConfig = useNovelStore(selectTtsConfig);
  const imageProvider = useNovelStore(selectImageProvider);
  const imageAspectRatio = useNovelStore(selectImageAspectRatio);
  const visualDnaPrompt = useNovelStore(selectVisualDnaPrompt);

  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  const list = useMemo(() => {
    const arr = Object.values(channels || {});
    return arr.sort((a, b) => {
      const ta = a.createdAt || '';
      const tb = b.createdAt || '';
      if (ta && tb && ta !== tb) return ta.localeCompare(tb);
      return a.name.localeCompare(b.name, 'vi');
    });
  }, [channels]);

  const active = channels?.[activeChannelId] || list[0] || null;

  const dnaChips = useMemo(() => {
    if (!active) return { tts: '', media: '', dna: '' };
    const tts = resolveChannelTtsDna(active);
    const out = resolveChannelOutputDna(active);
    const liveVoice = ttsConfig?.voice || tts.voice;
    const livePlat = ttsConfig?.platform || tts.platform;
    const liveImg = imageProvider || out.imageProvider;
    const liveRatio = imageAspectRatio || out.imageAspectRatio;
    const dnaShort = (visualDnaPrompt || active.visualDna || '')
      .slice(0, 28)
      .trim();
    return {
      tts: `TTS: ${livePlat} · ${(liveVoice || '—').slice(0, 18)} · ${tts.speed ?? 1}x`,
      media: `Img: ${liveImg} · ${liveRatio}`,
      dna: dnaShort ? `DNA: ${dnaShort}…` : 'DNA: (trống)',
    };
  }, [active, ttsConfig, imageProvider, imageAspectRatio, visualDnaPrompt]);

  useEffect(() => {
    if (renamingId && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [renamingId]);

  if (!isHydrated || !active) {
    return (
      <div className="flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900/40 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        <Layers className="h-3 w-3" />
        Kênh…
      </div>
    );
  }

  const handleSwitch = (id: string) => {
    if (id === activeChannelId) {
      setOpen(false);
      return;
    }
    const res = switchChannel(id);
    if (!res.ok) toast.error('Đổi kênh', res.error);
    else {
      toast.success('Đã chuyển kênh', channels[id]?.name || id);
      setOpen(false);
    }
  };

  const handleCreate = () => {
    // Free/Trial: 1 kênh; Pro+: multi_channel
    if (list.length >= 1 && !multiOk) {
      const gate = requirePro('multi_channel');
      toast.info('Pro', gate.message || 'Multi-channel cần gói Pro trả phí.');
      return;
    }
    const name = (newName || `Kênh ${list.length + 1}`).trim();
    createChannel(name, { cloneFromActive: false });
    setNewName('');
    setOpen(false);
    toast.success('Đã tạo kênh', name);
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (list.length <= 1) return;
    const ch = channels[id];
    const ok = await appConfirm({
      title: 'Xóa kênh',
      message: `Xóa kênh «${ch?.name || id}» khỏi danh sách?`,
      details: ['Không thể hoàn tác từ UI'],
      confirmLabel: 'Xóa kênh',
      cancelLabel: 'Giữ lại',
      tone: 'danger',
    });
    if (!ok) return;
    const res = deleteChannel(id);
    if (!res.ok) toast.error('Xóa kênh', res.error);
    else toast.info('Đã xóa kênh', ch?.name);
  };

  const commitRename = () => {
    if (!renamingId) return;
    const name = renameValue.trim();
    if (name) updateChannel(renamingId, { name });
    setRenamingId(null);
    setRenameValue('');
  };

  const handleSaveDna = () => {
    saveActiveChannelSnapshot();
    // Also push live media/tts into channel DNA via existing setters mirror
    const st = useNovelStore.getState();
    st.updateTTSConfig({ ...st.ttsConfig });
    st.setImageProvider(st.imageProvider);
    st.setImageAspectRatio(st.imageAspectRatio);
    st.setMediaStylePreset(st.mediaStylePreset);
    st.setVisualDnaPrompt(st.visualDnaPrompt);
    toast.success('Đã lưu DNA kênh', active.name);
  };

  const handleApplyDna = () => {
    applyActiveChannelDna();
    toast.success('Đã áp DNA kênh → workspace', active.name);
  };

  const handleGenre = (packId: string) => {
    const pack = GENRE_PACKS.find((p) => p.id === packId);
    if (!pack) return;
    const d = applyGenrePackDefaults(pack);
    const st = useNovelStore.getState();
    st.updateUserRules(d.userRules);
    st.setVisualDnaPrompt(d.visualDna);
    st.setMediaStylePreset(d.mediaStylePreset);
    st.setImageAspectRatio(d.outputDna.imageAspectRatio);
    st.setVideoAspectRatio(d.outputDna.videoAspectRatio);
    st.updateTTSConfig({
      platform: d.ttsDna.platform as typeof st.ttsConfig.platform,
      voice: d.ttsDna.voice,
      language: d.ttsDna.language,
      speed: d.ttsDna.speed,
      pitch: d.ttsDna.pitch,
      syncMode: d.ttsDna.syncMode,
    });
    updateChannel(activeChannelId, {
      niche: d.niche,
      visualDna: d.visualDna,
      defaultShipMode: d.defaultShipMode,
      outputDna: d.outputDna,
      ttsDna: d.ttsDna,
      narratorVoiceId: d.ttsDna.voice,
      ttsPlatform: d.ttsDna.platform,
    });
    toast.success('Genre pack', pack.label);
  };

  return (
    <div ref={rootRef} className="relative shrink-0 overflow-visible">
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="flex max-w-[min(150px,22vw)] items-center gap-1.5 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1.5 text-[clamp(9px,1vw,11px)] font-bold uppercase tracking-wider text-emerald-300 transition-colors hover:bg-emerald-500/15 cursor-pointer"
        title={`${dnaChips.tts}\n${dnaChips.media}\n${dnaChips.dna}`}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Layers className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{active.name}</span>
        <ChevronDown
          className={`h-3 w-3 shrink-0 opacity-70 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <FloatingMenu
        open={open}
        anchorRef={triggerRef}
        onClose={() => {
          setOpen(false);
          setRenamingId(null);
        }}
        width="320px"
        className="rounded-2xl border border-zinc-800/90 bg-zinc-950/98 p-2.5 shadow-2xl backdrop-blur-md"
      >
          <div className="mb-1.5 flex items-center justify-between px-1">
            <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">
              Kênh làm việc
            </span>
            <span className="text-[9px] text-zinc-600">{list.length}</span>
          </div>

          {/* DNA chips */}
          <div className="mb-2 flex flex-col gap-1 rounded-lg border border-zinc-800/80 bg-black/30 p-2">
            <span className="text-[8px] font-bold uppercase tracking-wider text-zinc-600">
              DNA kênh đang active
            </span>
            <span className="truncate text-[9px] font-mono text-amber-400/90" title={dnaChips.tts}>
              {dnaChips.tts}
            </span>
            <span className="truncate text-[9px] font-mono text-cyan-400/90" title={dnaChips.media}>
              {dnaChips.media}
            </span>
            <span className="truncate text-[9px] font-mono text-zinc-500" title={dnaChips.dna}>
              {dnaChips.dna}
            </span>
            <div className="mt-1 flex gap-1">
              <button
                type="button"
                onClick={handleApplyDna}
                className="flex flex-1 items-center justify-center gap-1 rounded border border-emerald-800/40 bg-emerald-500/10 py-1 text-[9px] font-bold uppercase text-emerald-400 hover:bg-emerald-500/20 cursor-pointer"
                title="Nạp DNA kênh vào workspace"
              >
                <Download className="h-3 w-3" />
                Áp DNA
              </button>
              <button
                type="button"
                onClick={handleSaveDna}
                className="flex flex-1 items-center justify-center gap-1 rounded border border-sky-800/40 bg-sky-500/10 py-1 text-[9px] font-bold uppercase text-sky-400 hover:bg-sky-500/20 cursor-pointer"
                title="Lưu workspace hiện tại vào DNA kênh"
              >
                <Save className="h-3 w-3" />
                Lưu DNA
              </button>
            </div>
          </div>

          <div className="mb-2 max-h-[180px] space-y-0.5 overflow-y-auto">
            {list.map((ch) => {
              const isActive = ch.id === activeChannelId;
              const isRenaming = renamingId === ch.id;
              return (
                <div
                  key={ch.id}
                  className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 ${
                    isActive
                      ? 'bg-emerald-500/15 border border-emerald-500/30'
                      : 'border border-transparent hover:bg-zinc-900'
                  }`}
                >
                  {isRenaming ? (
                    <input
                      ref={renameRef}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={commitRename}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename();
                        if (e.key === 'Escape') {
                          setRenamingId(null);
                          setRenameValue('');
                        }
                      }}
                      className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-100 outline-none focus:border-emerald-500/50"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleSwitch(ch.id)}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setRenamingId(ch.id);
                        setRenameValue(ch.name);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left cursor-pointer"
                      title="Click chọn · double-click đổi tên"
                    >
                      {isActive ? (
                        <Check className="h-3 w-3 shrink-0 text-emerald-400" />
                      ) : (
                        <span className="w-3 shrink-0" />
                      )}
                      <span className="truncate text-[11px] font-semibold text-zinc-100">
                        {ch.name}
                      </span>
                    </button>
                  )}
                  {list.length > 1 && !isRenaming && (
                    <button
                      type="button"
                      onClick={(e) => handleDelete(e, ch.id)}
                      className="shrink-0 rounded p-1 text-zinc-600 opacity-0 group-hover:opacity-100 hover:bg-zinc-800 hover:text-red-400 cursor-pointer"
                      title="Xóa kênh"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mb-2 border-t border-zinc-800 pt-2">
            <span className="mb-1 block px-1 text-[8px] font-bold uppercase tracking-wider text-zinc-600">
              Genre pack
            </span>
            <div className="flex flex-wrap gap-1">
              {GENRE_PACKS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => handleGenre(g.id)}
                  title={g.description}
                  className="rounded border border-zinc-800 bg-zinc-900/60 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-zinc-400 hover:border-amber-800/50 hover:text-amber-300 cursor-pointer"
                >
                  {g.label.split('/')[0].trim()}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-zinc-800 pt-2 space-y-1.5">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
              }}
              placeholder="Tên kênh mới…"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-emerald-500/40"
            />
            <button
              type="button"
              onClick={handleCreate}
              className="flex w-full items-center justify-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 py-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300 hover:bg-emerald-500/20 cursor-pointer"
            >
              <Plus className="h-3 w-3" />
              Thêm kênh
            </button>
          </div>
      </FloatingMenu>
    </div>
  );
}
