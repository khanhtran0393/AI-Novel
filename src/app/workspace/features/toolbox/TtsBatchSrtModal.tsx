'use client';

/**
 * Tool Dịch SRT — UI giống CapAssist tab "📝 Tool Dịch SRT":
 *   Chọn SRT → bảng cue (ID / time / text) → Dịch (Google Studio) →
 *   xem gốc/đã dịch → sửa tay → Lưu file.
 * TTS / CapCut draft giữ ở panel phụ (tùy chọn).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  FileText,
  Loader2,
  Save,
  Languages,
  FolderOpen,
  Mic2,
} from 'lucide-react';
import { useNovelStore } from '@/store/useNovelStore';
import { toast } from '@/lib/toastBus';
import { API } from '@/contracts';
import {
  buildClientApiHeaders,
  resolveMasterModelKeys,
} from '../../modules/apiClient';
import {
  SOURCE_LANG_OPTIONS,
  TARGET_LANG_OPTIONS,
  type BatchLangCode,
} from '@/lib/ttsBatchSrt/languages';
import {
  parseSrt,
  formatSrtTimestamp,
  cuesToSrt,
  normalizeSubtitleInput,
  srtSummary,
} from '@/lib/ttsBatchSrt/parseSrt';
import type { SrtCue } from '@/lib/ttsBatchSrt/types';
import {
  TRANSLATE_RULE_PUBLIC_OPTIONS as TRANSLATE_RULE_OPTIONS,
  DEFAULT_TRANSLATE_CHUNK,
  MIN_TRANSLATE_CHUNK,
  MAX_TRANSLATE_CHUNK,
  clampTranslateChunk,
} from '@/lib/ttsBatchSrt/publicTranslateCatalog';

export interface TtsBatchSrtModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Hiển thị key/cookie lấy từ store Cài đặt (không gửi cookie vào REST dịch). */
function AuthFromSettingsHint() {
  const apiKey = useNovelStore((s) => s.apiKey);
  const apiKeys = useNovelStore((s) => s.apiKeys);
  const cookie = useNovelStore((s) => s.googleStudioCookie);
  const cookies = useNovelStore((s) => s.googleStudioCookies);
  const isHydrated = useNovelStore((s) => s.isHydrated);

  const keyCount = useMemo(() => {
    const list =
      apiKeys?.length > 0 ? apiKeys : apiKey ? [apiKey] : [];
    return list.filter(Boolean).length;
  }, [apiKey, apiKeys]);

  const cookieCount = useMemo(() => {
    const list = [
      ...(Array.isArray(cookies) ? cookies : []),
      cookie || '',
    ].filter((c) => String(c).trim());
    return new Set(list).size;
  }, [cookie, cookies]);

  if (!isHydrated) {
    return (
      <p className="text-[10px] text-zinc-600">Đang nạp Cài đặt…</p>
    );
  }

  return (
    <p className="text-[10px] text-zinc-500">
      Cài đặt:{' '}
      <span className={keyCount ? 'text-emerald-400/90' : 'text-amber-400'}>
        {keyCount} API key Gemini
      </span>
      {' · '}
      <span className={cookieCount ? 'text-zinc-400' : 'text-zinc-600'}>
        {cookieCount} cookie Studio
      </span>
      <span className="text-zinc-600">
        {' '}
        (dịch REST chỉ dùng API key; cookie không thay key)
      </span>
    </p>
  );
}

type ViewMode = 'origin' | 'translated';

type CueRow = SrtCue & {
  /** Text before translate (always kept) */
  originText: string;
  /** Text after translate (editable) */
  translatedText: string;
};

function rowsFromSrt(srt: string, fileName?: string): CueRow[] {
  const norm = normalizeSubtitleInput(srt, fileName);
  const cues = parseSrt(norm.srtText);
  return cues.map((c) => ({
    ...c,
    originText: c.text,
    translatedText: c.text,
  }));
}

function rowsToSrt(rows: CueRow[], mode: ViewMode): string {
  const cues: SrtCue[] = rows.map((r, i) => ({
    index: i + 1,
    startMs: r.startMs,
    endMs: r.endMs,
    text: mode === 'translated' ? r.translatedText : r.originText,
    speaker: r.speaker,
  }));
  return cuesToSrt(cues);
}

export default function TtsBatchSrtModal({ isOpen, onClose }: TtsBatchSrtModalProps) {
  const store = useNovelStore();
  const isHydrated = store.isHydrated;
  const logRef = useRef<HTMLPreElement | null>(null);

  const [filePath, setFilePath] = useState('');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<CueRow[]>([]);
  const [sourceLang, setSourceLang] = useState<BatchLangCode>('zh');
  const [targetLang, setTargetLang] = useState<BatchLangCode>('vi');
  const [ruleId, setRuleId] = useState('modern');
  /** CapAssist "chia" — tự điền 50 dòng/lô */
  const [chunkSize, setChunkSize] = useState(50);
  const [busy, setBusy] = useState(false);
  const [translatedOnce, setTranslatedOnce] = useState(false);
  const [log, setLog] = useState(
    '> Tool Dịch SRT · Chọn file .srt → Dịch (Google Studio) → sửa → Lưu\n',
  );
  /** Optional advanced: TTS after translate */
  const [showTtsPanel, setShowTtsPanel] = useState(false);

  // Mỗi lần mở modal: reset Chia = 50 (Cap default)
  useEffect(() => {
    if (isOpen) {
      setChunkSize(DEFAULT_TRANSLATE_CHUNK); // 50
    }
  }, [isOpen]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const appendLog = useCallback((msg: string) => {
    setLog((prev) => {
      const next = prev + (msg.endsWith('\n') ? msg : `${msg}\n`);
      const lines = next.split('\n');
      return lines.length > 400 ? lines.slice(-400).join('\n') : next;
    });
  }, []);

  const summary = useMemo(() => srtSummary(rows), [rows]);

  const pickSrt = async () => {
    try {
      const res = await fetch(API.capassistant.selectFile, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'subtitle',
          title: 'Chọn file SRT / TXT',
          readContent: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.cancelled || !data.path) {
        appendLog('> Hủy chọn file');
        return;
      }
      const content = String(data.content ?? '');
      if (!content.trim()) {
        toast.error('File trống', 'Không đọc được nội dung UTF-8');
        return;
      }
      const name = String(data.path).split(/[/\\]/).pop() || 'file.srt';
      const next = rowsFromSrt(content, name);
      setFilePath(String(data.path));
      setFileName(name);
      setRows(next);
      setTranslatedOnce(false);
      const sm = srtSummary(next);
      appendLog(
        `> Đã nạp: ${data.path} · ${sm.count} cue · ~${sm.durationSec}s` +
          (sm.speakers.length ? ` · speakers: ${sm.speakers.join(', ')}` : ''),
      );
      toast.success('Nạp SRT', `${sm.count} cue`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error('Chọn file lỗi', msg);
      appendLog(`! ${msg}`);
    }
  };

  const runTranslate = async () => {
    if (!rows.length) {
      toast.error('Chưa có SRT', 'Bấm Chọn SRT trước');
      return;
    }
    if (!isHydrated) {
      toast.error('Đang nạp store', 'Chờ hydrate xong');
      return;
    }

    const st = useNovelStore.getState();
    // API keys từ Cài đặt (cùng nguồn write/gen): apiKeys / apiKey master Gemini
    const fromMaster = resolveMasterModelKeys().keysToUse;
    const fromStore =
      st.apiKeys?.length > 0
        ? st.apiKeys
        : st.apiKey
          ? [st.apiKey]
          : [];
    const apiKeys = [...new Set([...(fromMaster || []), ...(fromStore || [])].filter(Boolean))];
    const studioCookies = [
      ...(Array.isArray(st.googleStudioCookies) ? st.googleStudioCookies : []),
      st.googleStudioCookie || '',
    ].filter((c) => String(c).trim().length > 0);

    if (!apiKeys.length) {
      const cookieHint = studioCookies.length
        ? ` Có ${studioCookies.length} cookie Google Studio trong Cài đặt — cookie dùng Flow/TTS khác, không thay API key cho dịch REST.`
        : ' Cookie Google Studio cũng chưa có trong Cài đặt.';
      toast.error(
        'Thiếu API key Gemini',
        `Tool Dịch SRT gọi Google AI Studio bằng API key (Cài đặt / header).${cookieHint}`,
      );
      appendLog(
        `! Thiếu apiKeys. Cookie Studio: ${studioCookies.length ? 'có' : 'không'} (không dùng cho translateOnly REST)`,
      );
      return;
    }
    appendLog(
      `> Auth: ${apiKeys.length} API key Gemini · Cookie Studio: ${studioCookies.length || 0} (chỉ hiển thị, REST dùng key)`,
    );

    // Translate from origin column (never from already-translated twice silently)
    const originSrt = rowsToSrt(rows, 'origin');
    setBusy(true);
    const chunk = clampTranslateChunk(chunkSize);
    appendLog(
      `> Dịch Google Studio · ${sourceLang} → ${targetLang} · rule=${ruleId} · chia ${chunk} dòng · ${rows.length} cue…`,
    );

    try {
      const res = await fetch(API.ttsBatchSrt, {
        method: 'POST',
        headers: buildClientApiHeaders(),
        body: JSON.stringify({
          action: 'translateOnly',
          srtText: originSrt,
          targetLang,
          ruleId,
          chunkSize: chunk,
          apiKeys,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      const translatedSrt = String(data.srt || '');
      if (!translatedSrt.includes('-->')) {
        throw new Error('Kết quả dịch không phải SRT hợp lệ');
      }
      const outCues = parseSrt(translatedSrt);
      if (outCues.length !== rows.length) {
        appendLog(
          `! Cảnh báo: số cue in=${rows.length} out=${outCues.length} — map theo index tối đa`,
        );
      }

      setRows((prev) =>
        prev.map((r, i) => {
          const t = outCues[i];
          return {
            ...r,
            translatedText: t?.text?.trim() || r.translatedText,
          };
        }),
      );
      setTranslatedOnce(true);
      appendLog(
        `> Dịch xong · ${outCues.length} cue · chia ${chunk} · Google Studio`,
      );
      toast.success('Dịch xong', `${outCues.length} cue`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      appendLog(`! Dịch lỗi: ${msg}`);
      toast.error('Dịch thất bại', msg);
    } finally {
      setBusy(false);
    }
  };

  const saveSrt = async () => {
    if (!rows.length) {
      toast.error('Trống', 'Chưa có phụ đề để lưu');
      return;
    }
    // Luôn lưu cột "Nội dung đã dịch" (sau dịch / sau sửa tay)
    const srt = rowsToSrt(rows, 'translated');
    const base =
      fileName.replace(/\.[^.]+$/, '') || 'subtitle';
    const defaultName = `${base}_vi.srt`;

    setBusy(true);
    try {
      const res = await fetch(API.capassistant.saveFile, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: srt,
          title: 'Lưu file SRT',
          defaultName,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.cancelled) {
        appendLog('> Hủy lưu file');
        return;
      }
      if (!res.ok || data.error) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      appendLog(`> Đã lưu: ${data.path}`);
      toast.success('Đã lưu SRT', String(data.path).split(/[/\\]/).pop() || '');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      appendLog(`! Lưu lỗi: ${msg}`);
      toast.error('Lưu thất bại', msg);
    } finally {
      setBusy(false);
    }
  };

  const updateOriginText = (idx: number, text: string) => {
    setRows((prev) =>
      prev.map((r, i) =>
        i === idx ? { ...r, originText: text, text } : r,
      ),
    );
  };

  const updateTranslatedText = (idx: number, text: string) => {
    setRows((prev) =>
      prev.map((r, i) =>
        i === idx ? { ...r, translatedText: text, text } : r,
      ),
    );
  };

  const resetWorkspace = () => {
    setFilePath('');
    setFileName('');
    setRows([]);
    setTranslatedOnce(false);
    appendLog('> Đã xóa workspace (RAM)');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-5xl max-h-[92vh] overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl flex flex-col">
        {/* Header — CapAssist Tool Dịch SRT */}
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="h-5 w-5 text-violet-400 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-white truncate">
                Dịch SRT
              </h2>
              <p className="text-[10px] text-zinc-500 truncate">
                Thử thách tốc độ Dịch thuật cực hạn
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Toolbar row */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void pickSrt()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-violet-500 hover:bg-violet-400 text-black px-3 py-2 text-[11px] font-bold cursor-pointer disabled:opacity-50"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              Chọn SRT
            </button>
            <button
              type="button"
              onClick={() => void runTranslate()}
              disabled={busy || !rows.length}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black px-3 py-2 text-[11px] font-bold cursor-pointer disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Languages className="h-3.5 w-3.5" />
              )}
              Dịch
            </button>
            <button
              type="button"
              onClick={() => void saveSrt()}
              disabled={busy || !rows.length}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-600 px-3 py-2 text-[11px] font-bold text-zinc-200 hover:bg-zinc-800 cursor-pointer disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              Lưu file
            </button>
            <button
              type="button"
              onClick={resetWorkspace}
              disabled={busy || !rows.length}
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 px-2 py-2 text-[10px] font-bold text-zinc-500 hover:text-zinc-300 cursor-pointer disabled:opacity-50"
            >
              Xóa bảng
            </button>
            {filePath ? (
              <span className="text-[10px] font-mono text-zinc-500 truncate max-w-[240px]" title={filePath}>
                {fileName}
              </span>
            ) : null}
            {rows.length > 0 ? (
              <span className="text-[10px] text-zinc-500 ml-auto">
                {summary.count} cue · ~{summary.durationSec}s
              </span>
            ) : null}
          </div>

          {/* Lang + 14 style + chia dòng */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <label className="block space-y-1">
              <span className="text-[10px] font-bold uppercase text-zinc-500">
                Ngôn ngữ gốc
              </span>
              <select
                value={sourceLang}
                onChange={(e) => setSourceLang(e.target.value as BatchLangCode)}
                disabled={busy}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-2 text-xs text-zinc-200"
              >
                {SOURCE_LANG_OPTIONS.filter((l) => l.code !== 'auto').map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] font-bold uppercase text-zinc-500">
                Ngôn ngữ đích
              </span>
              <select
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value as BatchLangCode)}
                disabled={busy}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-2 text-xs text-zinc-200"
              >
                {TARGET_LANG_OPTIONS.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 sm:col-span-1 lg:col-span-1">
              <span className="text-[10px] font-bold uppercase text-zinc-500">
                Phong cách dịch (14 chế độ)
              </span>
              <select
                value={ruleId}
                onChange={(e) => setRuleId(e.target.value)}
                disabled={busy}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-2 text-xs text-zinc-200"
              >
                {TRANSLATE_RULE_OPTIONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] font-bold uppercase text-zinc-500">
                Chia (dòng / batch)
              </span>
              <input
                type="number"
                min={MIN_TRANSLATE_CHUNK}
                max={MAX_TRANSLATE_CHUNK}
                value={chunkSize}
                disabled={busy}
                onChange={(e) =>
                  setChunkSize(
                    clampTranslateChunk(
                      e.target.value === '' ? 50 : Number(e.target.value),
                    ),
                  )
                }
                placeholder="50"
                title={`Số câu mỗi lô dịch. Tự điền 50. ${MIN_TRANSLATE_CHUNK}–${MAX_TRANSLATE_CHUNK}.`}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-2 text-xs font-mono text-zinc-200"
              />
              <span className="text-[9px] text-zinc-600">
                Tự điền 50 dòng/lô · neo ||
              </span>
            </label>
          </div>

          {/* Auth status from Cài đặt */}
          <AuthFromSettingsHint />

          {/* Cue table — chia đôi: gốc | đã dịch (giống CapAssist) */}
          <div className="rounded-xl border border-zinc-800 overflow-hidden">
            <div className="max-h-[48vh] overflow-auto">
              <table className="w-full text-left text-[11px] border-collapse table-fixed">
                <thead className="sticky top-0 z-10 bg-zinc-900 border-b border-zinc-800">
                  <tr className="text-[10px] uppercase tracking-wide text-zinc-500">
                    <th className="px-2 py-2 w-10 font-bold">#</th>
                    <th className="px-2 py-2 w-[7.5rem] font-bold">Thời gian</th>
                    <th className="px-2 py-2 w-[calc(50%-5.25rem)] font-bold border-l border-zinc-800">
                      Nội dung gốc
                    </th>
                    <th className="px-2 py-2 w-[calc(50%-5.25rem)] font-bold border-l border-emerald-500/20 text-emerald-500/80">
                      Nội dung đã dịch
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-3 py-10 text-center text-zinc-600 text-xs"
                      >
                        Chưa có phụ đề — bấm{' '}
                        <strong className="text-zinc-400">Chọn SRT</strong>
                      </td>
                    </tr>
                  ) : (
                    rows.map((r, i) => (
                      <tr
                        key={`${r.index}-${i}`}
                        className="border-t border-zinc-800/80 hover:bg-zinc-900/40"
                      >
                        <td className="px-2 py-1.5 font-mono text-zinc-500 align-top">
                          {i + 1}
                        </td>
                        <td className="px-2 py-1.5 font-mono text-[10px] text-zinc-500 align-top whitespace-nowrap">
                          {formatSrtTimestamp(r.startMs)}
                          <br />
                          <span className="text-zinc-600">→</span>{' '}
                          {formatSrtTimestamp(r.endMs)}
                        </td>
                        <td className="px-1.5 py-1 align-top border-l border-zinc-800/80 w-1/2">
                          <textarea
                            value={r.originText}
                            onChange={(e) =>
                              updateOriginText(i, e.target.value)
                            }
                            disabled={busy}
                            rows={2}
                            className="w-full resize-y min-h-[2.5rem] rounded-md border border-zinc-800 bg-black/40 px-2 py-1 text-[11px] text-zinc-300 focus:border-zinc-600 focus:outline-none"
                          />
                        </td>
                        <td className="px-1.5 py-1 align-top border-l border-emerald-500/15 w-1/2">
                          <textarea
                            value={r.translatedText}
                            onChange={(e) =>
                              updateTranslatedText(i, e.target.value)
                            }
                            disabled={busy}
                            rows={2}
                            placeholder={
                              translatedOnce ? '' : 'Bấm Dịch để điền…'
                            }
                            className="w-full resize-y min-h-[2.5rem] rounded-md border border-emerald-500/20 bg-emerald-500/5 px-2 py-1 text-[11px] text-emerald-100/90 placeholder:text-zinc-600 focus:border-emerald-500/40 focus:outline-none"
                          />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Optional TTS note — secondary, not main UI */}
          <button
            type="button"
            onClick={() => setShowTtsPanel((v) => !v)}
            className="w-full text-left text-[10px] text-zinc-500 hover:text-zinc-400 cursor-pointer flex items-center gap-1"
          >
            <Mic2 className="h-3 w-3" />
            {showTtsPanel ? 'Ẩn' : 'Hiện'} gợi ý TTS / CapCut (tuỳ chọn sau khi dịch)
          </button>
          {showTtsPanel ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-[10px] text-zinc-500 space-y-1">
              <p>
                Sau khi dịch xong, lưu SRT đã dịch. Lồng tiếng / CapCut draft: cấu hình{' '}
                <code className="text-zinc-400">gemini_tts</code> hoặc{' '}
                <code className="text-zinc-400">google</code> ở TTS Config, rồi dùng pipe
                video full (API batch) nếu cần — tool này tập trung <strong>dịch SRT</strong>.
              </p>
            </div>
          ) : null}

          <pre
            ref={logRef}
            className="h-24 overflow-y-auto rounded-xl border border-zinc-800 bg-black/50 px-3 py-2 text-[10px] font-mono text-zinc-500 whitespace-pre-wrap"
          >
            {log}
          </pre>
        </div>
      </div>
    </div>
  );
}
