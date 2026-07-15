// @ts-nocheck — context bag props from RoleCastStudioModal shell
'use client';

import React from 'react';
import { Loader2, Wand2, Volume2 } from 'lucide-react';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function RoleCastBoardPanel(p: Record<string, any>) {
  const {
    sceneText,
    sceneIndex,
    chapter,
    board,
    bulkRule,
    setBulkRule,
    selectedOrders,
    setSelectedOrders,
    autoTagging,
    runAutoTag,
    applyBulk,
    previewingSegId,
    previewSegment,
    cast,
    store,
    roleLabel,
    roles,
  } = p;

  return (
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
  );
}
