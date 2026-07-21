'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  Plus,
  Check,
  Trash2,
  Layers,
} from 'lucide-react';
import { useNovelStore } from '@/store/useNovelStore';
import {
  selectActiveChannelId,
  selectChannels,
  selectCreateChannel,
  selectDeleteChannel,
  selectIsHydrated,
  selectSwitchChannel,
  selectUpdateChannel,
} from '@/store/useNovelStoreSelectors';
import { toast } from '@/lib/toastBus';
import { appConfirm } from '@/lib/confirmDialog';
import FloatingMenu from '../../shared/FloatingMenu';
import { useProAccess } from '../../hooks/useProAccess';

/**
 * Multi-channel workspace picker — compact dropdown on the main header row.
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
        title={active.name}
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
