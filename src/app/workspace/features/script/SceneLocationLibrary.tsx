'use client';

/**
 * Scene / location concept library (Printfilm P1) — soft panel under roster.
 */
import React, { useState } from 'react';
import { MapPin, Plus, Trash2, Sparkles } from 'lucide-react';
import { useNovelStore } from '@/store/useNovelStore';
import {
  composeSceneLocationPrompt,
  emptySceneLocation,
  type SceneLocationAsset,
} from '@/lib/sceneLocationLibrary';
import { sceneLocationImageKey } from '@/contracts';
import { generateCharImageAction } from '../../modules/characterModule';
import { toast } from '@/lib/toastBus';

type Props = { onImageZoom: (url: string) => void };

export default function SceneLocationLibrary({ onImageZoom }: Props) {
  const items = useNovelStore((s) => s.scene_location_assets || []);
  const upsert = useNovelStore((s) => s.upsertSceneLocationAsset);
  const remove = useNovelStore((s) => s.removeSceneLocationAsset);
  const generatedImages = useNovelStore((s) => s.generatedImages);
  const visualDna = useNovelStore((s) => s.visualDnaPrompt);
  const mediaStyle = useNovelStore((s) => s.mediaStylePreset);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const addEmpty = () => {
    const loc = emptySceneLocation({
      name: `Địa điểm ${items.length + 1}`,
      atmosphere: '',
    });
    upsert(loc);
    setOpen(true);
  };

  const patchItem = (id: string, patch: Partial<SceneLocationAsset>) => {
    const cur = items.find((x) => x.id === id);
    if (!cur) return;
    const name = patch.name !== undefined ? patch.name : cur.name;
    const next = emptySceneLocation({
      ...cur,
      ...patch,
      name,
      image_key: sceneLocationImageKey(name),
    });
    // keep same id
    next.id = cur.id;
    upsert(next);
  };

  const genStill = async (loc: SceneLocationAsset) => {
    const style = String(visualDna || mediaStyle || '').trim();
    const setup = useNovelStore.getState().setup;
    const genre = [setup?.chu_de, setup?.phong_cach]
      .map((s) => String(s || '').trim())
      .filter(Boolean)
      .join(' / ');
    if (!style && !genre) {
      toast.error(
        'Location',
        'Thiếu Visual DNA / Setup (chủ đề + phong cách). App không tự gán.',
      );
      return;
    }
    setBusyId(loc.id);
    const key = loc.image_key || sceneLocationImageKey(loc.name);
    useNovelStore.getState().addGeneratedImage(key, '');
    try {
      const st = useNovelStore.getState();
      const prompt = composeSceneLocationPrompt(loc, style || genre);
      const data = await generateCharImageAction({
        char: loc.name,
        charPrompt: prompt,
        savePathCharacter: st.savePathCharacter || '',
        googleDrivePath: st.googleDrivePath || '',
        ten_tac_pham: st.ten_tac_pham || '',
        googleStudioCookies: st.googleStudioCookies || [],
        googleStudioCookie: st.googleStudioCookie || '',
      });
      const imagePath =
        data.imagePath +
        (data.imagePath.includes('?') ? '&' : '?') +
        't=' +
        Date.now();
      st.addGeneratedImage(key, imagePath);
      if (data.projectUrl) st.addProjectUrl(key, data.projectUrl);
      upsert({
        ...loc,
        image_key: key,
        referencePath: String(data.imagePath || '').split('?')[0],
        updatedAt: Date.now(),
      });
      toast.success('Location', `Đã gen still: ${loc.name}`);
    } catch (e: unknown) {
      toast.error(
        'Location',
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mb-4 border-t border-zinc-900 pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-500 hover:text-zinc-300 cursor-pointer"
        >
          <MapPin className="h-3 w-3 text-teal-500" />
          Thư viện địa điểm
          <span className="font-normal normal-case tracking-normal text-zinc-600">
            ({items.length})
          </span>
        </button>
        <button
          type="button"
          onClick={addEmpty}
          className="inline-flex items-center gap-0.5 rounded border border-teal-900/50 bg-teal-500/10 px-1.5 py-0.5 text-[8px] font-bold uppercase text-teal-400 hover:bg-teal-500/20 cursor-pointer"
        >
          <Plus className="h-3 w-3" />
          Thêm
        </button>
      </div>
      {open || items.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {items.length === 0 ? (
            <p className="text-[9px] text-zinc-600">
              Chưa có địa điểm — thêm concept môi trường tái dùng (không nhân vật).
            </p>
          ) : null}
          {items.map((loc) => {
            const key = loc.image_key || sceneLocationImageKey(loc.name);
            const img = generatedImages?.[key];
            return (
              <div
                key={loc.id}
                className="rounded border border-zinc-800 bg-black/40 p-1.5"
              >
                <div className="mb-1 flex gap-1">
                  <input
                    type="text"
                    value={loc.name}
                    onChange={(e) =>
                      patchItem(loc.id, { name: e.target.value })
                    }
                    className="h-6 min-w-0 flex-1 rounded border border-zinc-800 bg-black/60 px-1.5 text-[10px] text-zinc-300 outline-none focus:border-teal-500"
                    placeholder="Tên địa điểm"
                  />
                  <button
                    type="button"
                    onClick={() => remove(loc.id)}
                    className="rounded border border-rose-900/40 px-1 text-rose-500/80 hover:text-rose-400 cursor-pointer"
                    title="Xóa"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                <input
                  type="text"
                  value={loc.atmosphere || ''}
                  onChange={(e) =>
                    patchItem(loc.id, { atmosphere: e.target.value })
                  }
                  className="mb-1 h-6 w-full rounded border border-zinc-800 bg-black/60 px-1.5 text-[10px] text-zinc-400 outline-none focus:border-teal-500"
                  placeholder="Không khí / thời gian (đêm mưa, hoàng hôn…)"
                />
                <input
                  type="text"
                  value={loc.visualPrompt || ''}
                  onChange={(e) =>
                    patchItem(loc.id, { visualPrompt: e.target.value })
                  }
                  className="mb-1 h-6 w-full rounded border border-zinc-800 bg-black/60 px-1.5 text-[10px] text-zinc-400 outline-none focus:border-teal-500"
                  placeholder="EN visual prompt (optional)"
                />
                <div className="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    disabled={busyId === loc.id}
                    onClick={() => void genStill(loc)}
                    className="inline-flex items-center gap-0.5 rounded border border-emerald-800/50 bg-emerald-500/15 px-1.5 py-0.5 text-[8px] font-bold uppercase text-emerald-400 hover:bg-emerald-500/25 disabled:opacity-40 cursor-pointer"
                  >
                    <Sparkles className="h-2.5 w-2.5" />
                    {busyId === loc.id ? 'Đang gen…' : 'Gen still'}
                  </button>
                  {img ? (
                    <button
                      type="button"
                      onClick={() => onImageZoom(img)}
                      className="text-[8px] font-bold uppercase text-sky-400 hover:text-sky-300 cursor-pointer"
                    >
                      Xem ảnh
                    </button>
                  ) : (
                    <span className="text-[8px] text-zinc-600">Chưa có still</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
