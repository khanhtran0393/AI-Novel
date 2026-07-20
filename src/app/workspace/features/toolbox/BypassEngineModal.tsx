'use client';

/**
 * Phantom-X Bypass — toolbox tool.
 * UI shows filter NAMES only; FFmpeg pipeline math stays on server (5-stage builder).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Shield,
  FolderOpen,
  Loader2,
  Play,
  CheckSquare,
  Square,
  FolderSearch,
  Sparkles,
} from 'lucide-react';
import { toast } from '@/lib/toastBus';
import { API } from '@/contracts';
import {
  BYPASS_FILTER_CATALOG,
  GRID_LAYOUT_OPTIONS,
  VARIANCE_RECOMMENDED,
  recommendPcForSelection,
  type BypassFilterId,
  type GridLayoutMode,
} from '@/lib/bypass-engine/publicCatalog';

export interface BypassEngineModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Client catalog: labels only (same ids as server). */
const FILTER_UI = BYPASS_FILTER_CATALOG.map(({ id, label, master }) => ({
  id,
  label,
  master: Boolean(master),
}));

/** Thư mục đầu ra (tương đối cwd) — nằm trong "Mở thư mục lưu" (public/). */
const BYPASS_OUTPUT_REL = 'public/phantom-x-bypass';

type NvencUiProbe = {
  ok: boolean;
  message: string;
  bf2Ok?: boolean;
  loading: boolean;
  gpuName?: string | null;
};

export default function BypassEngineModal({ isOpen, onClose }: BypassEngineModalProps) {
  /** Nhiều video — xử lý theo thứ tự danh sách */
  const [inputPaths, setInputPaths] = useState<string[]>([]);
  const [overlayPath, setOverlayPath] = useState('');
  const [preferGpu, setPreferGpu] = useState(false);
  /** Turbo: scale mid + encode nhanh — vẫn đủ Ultimate/Grid */
  const [turbo, setTurbo] = useState(false);
  const [gridLayout, setGridLayout] = useState<GridLayoutMode>('none');
  const [randomize, setRandomize] = useState(false);
  const [randomPercent, setRandomPercent] = useState<number>(
    VARIANCE_RECOMMENDED.defaultPercent,
  );
  const [selected, setSelected] = useState<Set<BypassFilterId>>(new Set());
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [batchIndex, setBatchIndex] = useState(0);
  const [batchTotal, setBatchTotal] = useState(0);
  const [log, setLog] = useState('> Phantom-X Bypass sẵn sàng.\n');
  const [lastOutput, setLastOutput] = useState('');
  const [lastOutputDir, setLastOutputDir] = useState('');
  /** Real NVENC probe — same source as Settings system-info */
  const [nvencUi, setNvencUi] = useState<NvencUiProbe>({
    ok: false,
    message: 'Chưa probe NVENC.',
    loading: false,
    gpuName: null,
  });
  const logRef = useRef<HTMLPreElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const probedOpenRef = useRef(false);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const appendLog = useCallback((msg: string) => {
    setLog((prev) => {
      const next = prev + (msg.endsWith('\n') ? msg : `${msg}\n`);
      const lines = next.split('\n');
      if (lines.length > 300) return lines.slice(-300).join('\n');
      return next;
    });
  }, []);

  const refreshNvencProbe = useCallback(
    async (force = false) => {
      setNvencUi((s) => ({ ...s, loading: true }));
      try {
        const url = force
          ? `${API.bypassEngine}?nvenc=1&force=1`
          : API.bypassEngineNvenc;
        const res = await fetch(url, { method: 'GET' });
        const data = await res.json();
        const p = data?.nvenc;
        if (!res.ok || !p) {
          throw new Error(data?.error || `HTTP ${res.status}`);
        }
        const ok = Boolean(p.ok);
        const gpuName = data?.gpuName ? String(data.gpuName) : null;
        setNvencUi({
          ok,
          message: String(p.message || (ok ? 'NVENC OK' : 'NVENC không khả dụng')),
          bf2Ok: Boolean(p.bf2Ok),
          loading: false,
          gpuName,
        });
        // Only auto-enable GPU when probe passes; never force-on when fail
        setPreferGpu(ok);
        appendLog(
          ok
            ? `[NVENC] ${p.message}${p.bf2Ok ? ' · bf2 OK' : ' · bf2 off'}`
            : `[NVENC] ${p.message}`,
        );
        if (gpuName) appendLog(`[GPU] ${gpuName}`);
        if (ok && p.ffmpegPath) {
          appendLog(`[NVENC] FFmpeg encode: ${p.ffmpegPath}${p.usedCompatFfmpeg ? ' (compat)' : ''}`);
        }
        if (!ok) {
          appendLog(
            '[NVENC] Tải driver / kiểm tra: Cài đặt → Tăng tốc phần cứng → Quét lại.',
          );
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setNvencUi({
          ok: false,
          message: `Probe NVENC lỗi: ${msg}`,
          loading: false,
          gpuName: null,
        });
        setPreferGpu(false);
        appendLog(`[NVENC] Probe thất bại: ${msg}`);
      }
    },
    [appendLog],
  );

  useEffect(() => {
    if (!isOpen) {
      abortRef.current?.abort();
      abortRef.current = null;
      setProcessing(false);
      probedOpenRef.current = false;
      return;
    }
    if (!probedOpenRef.current) {
      probedOpenRef.current = true;
      void refreshNvencProbe(false);
    }
  }, [isOpen, refreshNvencProbe]);

  const atomicIds = useMemo(
    () => FILTER_UI.filter((f) => !f.master).map((f) => f.id),
    [],
  );

  /** PC đề nghị theo bộ lọc + grid đang chọn */
  const pcRec = useMemo(
    () => recommendPcForSelection(selected, gridLayout),
    [selected, gridLayout],
  );

  /** Gợi ý Turbo khi Ultimate + Grid 2×2 hoặc tải cao */
  const suggestTurbo = useMemo(() => {
    const hasUlt =
      selected.has('ultimate') ||
      (selected.has('dynamic_zoom_pan') &&
        selected.has('phantom_subpixel') &&
        selected.has('dynamic_temporal_noise'));
    return (hasUlt && gridLayout === '2x2') || pcRec.loadScore >= 70;
  }, [selected, gridLayout, pcRec.loadScore]);

  const toggle = (id: BypassFilterId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (id === 'ultimate') {
        if (next.has('ultimate')) {
          next.clear();
        } else {
          next.clear();
          for (const a of atomicIds) next.add(a);
          next.add('ultimate');
        }
        return next;
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      // ultimate only if all atomics on
      const allOn = atomicIds.every((a) => next.has(a));
      if (allOn) next.add('ultimate');
      else next.delete('ultimate');
      return next;
    });
  };

  const selectFile = async (kind: 'video' | 'image' = 'video') => {
    try {
      const res = await fetch(API.capassistant.selectFile, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          multi: kind === 'video',
          title:
            kind === 'image'
              ? 'Duyệt Frame PNG'
              : 'Chọn video (nhiều file) — Phantom-X Bypass',
        }),
      });
      const data = await res.json();
      if (data.cancelled) return;
      if (kind === 'image') {
        if (!data.path) return;
        setOverlayPath(String(data.path));
        appendLog(`[OVERLAY] ${data.path}`);
        return;
      }
      const paths: string[] = Array.isArray(data.paths)
        ? data.paths.map((p: string) => String(p).trim()).filter(Boolean)
        : data.path
          ? [String(data.path)]
          : [];
      if (paths.length === 0) return;
      setInputPaths((prev) => {
        const next = [...prev];
        for (const p of paths) {
          if (!next.includes(p)) next.push(p);
        }
        return next;
      });
      appendLog(`[INPUT] +${paths.length} file (tổng sẽ xử lý theo thứ tự)`);
      paths.forEach((p, i) => appendLog(`  ${i + 1}. ${p}`));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error('Lỗi', `Không mở được hộp thoại chọn file: ${msg}`);
    }
  };

  const removeInputAt = (index: number) => {
    setInputPaths((prev) => prev.filter((_, i) => i !== index));
  };

  const moveInput = (index: number, dir: -1 | 1) => {
    setInputPaths((prev) => {
      const j = index + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  };

  const openOutputFolder = async () => {
    const folder =
      lastOutputDir ||
      (lastOutput ? lastOutput.replace(/[/\\][^/\\]+$/, '') : '') ||
      BYPASS_OUTPUT_REL;
    try {
      await fetch(API.openFolder, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: folder }),
      });
    } catch {
      // best-effort
    }
  };

  /** Encode một file — trả SUCCESS path hoặc throw */
  const encodeOne = async (
    inputPath: string,
    signal: AbortSignal,
    onFileProgress: (pct: number) => void,
  ): Promise<string> => {
    const res = await fetch(API.bypassEngine, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inputPath,
        overlayPath: overlayPath.trim() || undefined,
        filters: [...selected],
        preferGpu,
        gridLayout,
        turbo,
        variance: {
          enabled: randomize,
          percent: Math.min(100, Math.max(0, Number(randomPercent) || 0)),
        },
      }),
      signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    if (!res.body) throw new Error('Không nhận được stream phản hồi.');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      const progressMatches = [...chunk.matchAll(/PROGRESS:(\d+)/g)];
      if (progressMatches.length) {
        onFileProgress(Number(progressMatches[progressMatches.length - 1][1]));
      }

      const cleaned = chunk.replace(/\n?PROGRESS:\d+\n?/g, '');
      if (cleaned.trim()) appendLog(cleaned);
    }

    const successMatch = buffer.match(/\[SUCCESS\]\s*(.+)/);
    if (successMatch) return successMatch[1].trim();
    if (buffer.includes('[ERROR]')) {
      throw new Error('FFmpeg thất bại — xem log.');
    }
    throw new Error('Không có [SUCCESS] trong phản hồi.');
  };

  const runBypass = async () => {
    if (inputPaths.length === 0) {
      toast.info('Notice', 'Vui lòng chọn ít nhất một video.');
      return;
    }
    if (selected.size === 0) {
      toast.info('Notice', 'Chọn ít nhất một bộ lọc.');
      return;
    }

    setProcessing(true);
    setProgress(0);
    setLastOutput('');
    setLastOutputDir('');
    const total = inputPaths.length;
    setBatchTotal(total);
    setBatchIndex(0);

    appendLog('\n[START] Phantom-X batch — xử lý theo thứ tự…');
    appendLog(`[QUEUE] ${total} video → thư mục ${BYPASS_OUTPUT_REL} · tên bypass_<file>.mp4`);
    appendLog(`[ACTIVE] ${[...selected].map((id) => FILTER_UI.find((f) => f.id === id)?.label || id).join(' · ')}`);
    appendLog(`[GRID] ${GRID_LAYOUT_OPTIONS.find((g) => g.id === gridLayout)?.label || gridLayout}`);
    if (turbo) {
      appendLog('[TURBO] scale mid max 1280 → filter → scale back · ultrafast/NVENC p6');
    } else {
      appendLog('[QUALITY] full-res · HQ encode · filter_threads max (máy mạnh)');
    }
    if (randomize) {
      appendLog(`[VARIANCE] Ngẫu nhiên ±${randomPercent}%`);
    }

    const controller = new AbortController();
    abortRef.current = controller;

    let okCount = 0;
    let failCount = 0;
    let lastOut = '';

    try {
      for (let i = 0; i < total; i++) {
        if (controller.signal.aborted) break;
        const file = inputPaths[i];
        setBatchIndex(i + 1);
        appendLog(`\n—— [${i + 1}/${total}] ${file}`);
        try {
          const out = await encodeOne(file, controller.signal, (pct) => {
            // Tiến độ tổng = file đã xong + % file hiện tại
            const overall = Math.floor(((i + pct / 100) / total) * 100);
            setProgress(Math.min(99, Math.max(1, overall)));
          });
          lastOut = out;
          setLastOutput(out);
          const dir = out.replace(/[/\\][^/\\]+$/, '');
          setLastOutputDir(dir);
          okCount += 1;
          appendLog(`[OK] → ${out}`);
        } catch (e) {
          if ((e as Error)?.name === 'AbortError') throw e;
          failCount += 1;
          const msg = e instanceof Error ? e.message : String(e);
          appendLog(`[FAIL] ${msg}`);
        }
      }

      setProgress(100);
      if (failCount === 0 && okCount > 0) {
        toast.success('Phantom-X', `Hoàn tất ${okCount}/${total} video.`);
      } else if (okCount > 0) {
        toast.info('Phantom-X', `Xong ${okCount}/${total} · lỗi ${failCount}.`);
      } else {
        toast.error('Phantom-X', 'Tất cả file thất bại — xem log.');
      }
      if (lastOut) setLastOutput(lastOut);
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        appendLog('[CANCEL] Đã hủy batch.');
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        appendLog(`[ERROR] ${msg}`);
        toast.error('Phantom-X', msg);
      }
    } finally {
      setProcessing(false);
      abortRef.current = null;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-sans text-zinc-200">
      <div className="w-full max-w-2xl bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800 bg-zinc-900/50 shrink-0">
          <h2 className="flex min-w-0 flex-1 items-center gap-2 pr-2">
            <Shield size={18} className="shrink-0 text-violet-400" />
            <span className="min-w-0 flex flex-col gap-0.5">
              <span className="font-bold uppercase tracking-wide text-sm text-violet-400">
                Phantom-X Bypass
              </span>
              <span className="text-[10px] font-semibold normal-case tracking-normal text-zinc-400">
                Lách kiểm duyệt Đa hình Bất đối xứng
              </span>
            </span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 hover:bg-zinc-800 rounded text-zinc-400 cursor-pointer"
            aria-label="Đóng"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          {/* Input — multi video, thứ tự queue */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                Video đầu vào
              </label>
              <span className="text-[9px] font-mono text-zinc-600">
                {inputPaths.length} file · ra: bypass_&lt;tên&gt;.mp4
              </span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => selectFile('video')}
                disabled={processing}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 px-3 py-2 text-xs font-bold text-zinc-200 cursor-pointer disabled:opacity-50"
              >
                <FolderOpen size={14} /> Chọn nhiều video
              </button>
              {inputPaths.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setInputPaths([])}
                  disabled={processing}
                  className="shrink-0 rounded-lg border border-zinc-800 px-3 py-2 text-[10px] font-bold text-zinc-500 hover:text-zinc-200 cursor-pointer disabled:opacity-50"
                >
                  Xóa hết
                </button>
              ) : null}
            </div>
            {inputPaths.length > 0 ? (
              <ul className="max-h-32 overflow-y-auto rounded-lg border border-zinc-800 bg-black/40 divide-y divide-zinc-900">
                {inputPaths.map((p, i) => (
                  <li
                    key={`${p}-${i}`}
                    className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] font-mono text-zinc-400"
                  >
                    <span className="text-violet-400/80 shrink-0 w-5">{i + 1}.</span>
                    <span className="flex-1 truncate" title={p}>
                      {p.replace(/^.*[/\\]/, '')}
                    </span>
                    <button
                      type="button"
                      disabled={processing || i === 0}
                      onClick={() => moveInput(i, -1)}
                      className="px-1 text-zinc-600 hover:text-zinc-200 disabled:opacity-30 cursor-pointer"
                      title="Lên"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={processing || i === inputPaths.length - 1}
                      onClick={() => moveInput(i, 1)}
                      className="px-1 text-zinc-600 hover:text-zinc-200 disabled:opacity-30 cursor-pointer"
                      title="Xuống"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      disabled={processing}
                      onClick={() => removeInputAt(i)}
                      className="px-1 text-rose-500/70 hover:text-rose-400 cursor-pointer disabled:opacity-30"
                      title="Gỡ"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[10px] text-zinc-600">Chọn một hoặc nhiều video — convert theo thứ tự danh sách.</p>
            )}
            <p className="text-[9px] text-zinc-600">
              Thư mục ra: <span className="text-zinc-400 font-mono">{BYPASS_OUTPUT_REL}</span> (trong Mở thư mục
              lưu)
            </p>
          </div>

          {/* Frame PNG + GPU — no filter math on UI */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              Khung Overlay PNG
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={overlayPath}
                onChange={(e) => setOverlayPath(e.target.value)}
                placeholder="Bỏ trống nếu không dùng frame PNG"
                className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 font-mono"
              />
              <button
                type="button"
                onClick={() => selectFile('image')}
                disabled={processing}
                className="shrink-0 flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 px-3 py-2 text-xs font-bold text-zinc-200 cursor-pointer disabled:opacity-50"
              >
                <FolderOpen size={14} /> Duyệt Frame PNG
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <label
                className={`flex items-center gap-2 text-xs cursor-pointer select-none ${
                  nvencUi.ok ? 'text-zinc-400' : 'text-zinc-600'
                }`}
                title={nvencUi.message}
              >
                <input
                  type="checkbox"
                  checked={preferGpu && nvencUi.ok}
                  onChange={(e) => {
                    if (!nvencUi.ok) return;
                    setPreferGpu(e.target.checked);
                  }}
                  disabled={processing || nvencUi.loading || !nvencUi.ok}
                  className="accent-violet-500 disabled:opacity-40"
                />
                GPU (h264_nvenc)
              </label>
              <button
                type="button"
                onClick={() => void refreshNvencProbe(true)}
                disabled={processing || nvencUi.loading}
                className="text-[9px] font-bold text-sky-400/90 hover:text-sky-300 cursor-pointer disabled:opacity-40"
                title="Probe lại NVENC (cùng logic Cài đặt)"
              >
                {nvencUi.loading ? 'Đang probe…' : 'Probe GPU'}
              </button>
              <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={turbo}
                  onChange={(e) => setTurbo(e.target.checked)}
                  disabled={processing}
                  className="accent-amber-500"
                />
                <span className="font-bold text-amber-300/90">Turbo (máy yếu)</span>
              </label>
            </div>
            <p
              className={`text-[9px] leading-relaxed ${
                nvencUi.loading
                  ? 'text-zinc-500'
                  : nvencUi.ok
                    ? 'text-emerald-500/85'
                    : 'text-amber-500/90'
              }`}
            >
              {nvencUi.loading
                ? 'Đang probe NVENC…'
                : nvencUi.ok
                  ? `NVENC sẵn sàng${nvencUi.bf2Ok ? ' · B-frames OK' : ' · B-frames off'}.${
                      nvencUi.gpuName ? ` (${nvencUi.gpuName})` : ''
                    }`
                  : `${nvencUi.message} → libx264. Tải driver: Cài đặt → Tăng tốc phần cứng → Link driver đúng card (NVENC).`}
            </p>
            {!turbo ? (
              <p className="text-[9px] text-emerald-500/80">
                Quality (mặc định): full-res · {nvencUi.ok ? 'NVENC HQ' : 'libx264 medium'} ·
                vắt threads — tối ưu máy mạnh.
              </p>
            ) : null}
            {suggestTurbo && !turbo ? (
              <p className="text-[9px] text-amber-500/90">
                Ultimate / Grid 2×2 nặng — máy yếu nên bật{' '}
                <button
                  type="button"
                  className="font-bold underline cursor-pointer"
                  onClick={() => setTurbo(true)}
                >
                  Turbo
                </button>
                : scale mid + encode nhanh, vẫn đủ filter.
              </p>
            ) : turbo ? (
              <p className="text-[9px] text-zinc-500">
                Turbo: max 1280px mid → Ultimate/Grid → scale gốc · NVENC p6 / libx264 ultrafast
              </p>
            ) : null}
          </div>

          {/* Filters — names only */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              BỘ lọc chính
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {FILTER_UI.map((f) => {
                const on = selected.has(f.id);
                const isMaster = f.master;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => toggle(f.id)}
                    disabled={processing}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 ${
                      isMaster
                        ? on
                          ? 'border-violet-500/50 bg-violet-500/15 text-violet-300'
                          : 'border-violet-500/20 bg-violet-500/5 text-violet-400/80 hover:bg-violet-500/10'
                        : on
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                          : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                    }`}
                  >
                    {on ? (
                      <CheckSquare size={14} className="shrink-0" />
                    ) : (
                      <Square size={14} className="shrink-0 opacity-60" />
                    )}
                    {isMaster ? <Sparkles size={12} className="shrink-0 text-violet-400" /> : null}
                    <span>{f.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Ngẫu nhiên ±% — ô nhập default 3%, ghi chú max 5%, cảnh báo khi >5% */}
            <div className="mt-1 flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5">
              <label className="flex items-center gap-2 text-xs font-bold text-zinc-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={randomize}
                  onChange={(e) => setRandomize(e.target.checked)}
                  disabled={processing}
                  className="accent-amber-500"
                />
                Ngẫu nhiên
              </label>
              <label
                className={`flex items-center gap-1.5 text-[11px] ${randomize ? 'text-zinc-300' : 'text-zinc-600'}`}
              >
                <span className="whitespace-nowrap">Lệch tối đa</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={randomPercent}
                  disabled={processing || !randomize}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setRandomPercent(Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0);
                  }}
                  className="w-16 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-center text-xs font-mono text-zinc-200 disabled:opacity-40"
                />
                <span className="font-bold text-amber-400/90">%</span>
              </label>
              <span className="text-[9px] text-zinc-500">max {VARIANCE_RECOMMENDED.safeMaxPercent}%</span>
              {randomize && randomPercent > VARIANCE_RECOMMENDED.dangerAbovePercent ? (
                <span className="text-[9px] text-rose-400/90">
                  &gt;{VARIANCE_RECOMMENDED.dangerAbovePercent}%: rủi ro vỡ khung hình tổng thể
                </span>
              ) : null}
            </div>

            {/* PC đề nghị theo filter (catalog tĩnh — không quét máy) */}
            <div className="mt-1 space-y-1.5">
              {pcRec.active ? (
                <div className="rounded-lg border border-sky-500/25 bg-sky-500/5 px-3 py-2.5 space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-sky-400">
                      PC đề nghị (theo filter)
                    </span>
                    <span className="text-[9px] font-mono text-zinc-500">
                      Tải ~{pcRec.loadScore}% · {pcRec.tierLabel}
                    </span>
                  </div>
                  <div className="text-[11px] font-bold text-sky-200/90">{pcRec.speed}</div>
                  <div className="text-[11px] text-zinc-200">{pcRec.pcSpec}</div>
                  {pcRec.detail ? (
                    <div className="text-[10px] text-zinc-500 leading-relaxed">{pcRec.detail}</div>
                  ) : null}
                  <div className="h-1 rounded-full bg-zinc-800 overflow-hidden mt-1">
                    <div
                      className={`h-full transition-all duration-300 ${
                        pcRec.loadScore >= 70
                          ? 'bg-rose-500'
                          : pcRec.loadScore >= 40
                            ? 'bg-amber-500'
                            : 'bg-emerald-500'
                      }`}
                      style={{ width: `${pcRec.loadScore}%` }}
                    />
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 px-3 py-2 text-[10px] text-zinc-600">
                  Tích BỘ lọc chính để xem cấu hình PC đề nghị
                </div>
              )}
            </div>
          </div>

          {/* Grid khung hình chính */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              Khung hình chính
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {GRID_LAYOUT_OPTIONS.map((g) => {
                const on = gridLayout === g.id;
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setGridLayout(g.id)}
                    disabled={processing}
                    className={`rounded-lg border px-2 py-2.5 text-center text-[11px] font-bold transition-colors cursor-pointer disabled:opacity-50 ${
                      on
                        ? 'border-sky-500/50 bg-sky-500/15 text-sky-300'
                        : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                    }`}
                  >
                    {g.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Progress */}
          {processing || progress > 0 ? (
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-[10px] font-mono text-zinc-500">
                <span>
                  Tiến độ
                  {batchTotal > 0 ? ` · file ${batchIndex}/${batchTotal}` : ''}
                </span>
                <span>{progress}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className="h-full bg-violet-500 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          ) : null}

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={runBypass}
              disabled={processing || inputPaths.length === 0 || selected.size === 0}
              className="flex-1 min-w-[140px] bg-violet-500 hover:bg-violet-400 text-black font-bold py-2.5 rounded-lg flex items-center justify-center gap-2 shadow-lg shadow-violet-500/20 disabled:opacity-50 cursor-pointer text-xs uppercase tracking-wide"
            >
              {processing ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Play size={16} />
              )}
              {processing
                ? `Đang render ${batchIndex}/${batchTotal}…`
                : inputPaths.length > 1
                  ? `Chạy batch (${inputPaths.length})`
                  : 'Chạy Phantom-X'}
            </button>
            <button
              type="button"
              onClick={openOutputFolder}
              className="shrink-0 flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 px-3 py-2 text-xs font-bold text-zinc-200 cursor-pointer"
              title={BYPASS_OUTPUT_REL}
            >
              <FolderSearch size={14} /> Mở thư mục ra
            </button>
          </div>

          {/* Log — no filter math, only run status */}
          <pre
            ref={logRef}
            className="h-36 shrink-0 bg-black rounded-lg border border-zinc-800 p-3 font-mono text-[10px] text-zinc-500 overflow-y-auto whitespace-pre-wrap"
          >
            {log}
          </pre>
        </div>
      </div>
    </div>
  );
}
