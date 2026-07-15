'use client';

import React, { useEffect, useState } from 'react';
import {
  listJobs,
  subscribeJobQueue,
  pauseJob,
  resumeJob,
  cancelJob,
  clearFinishedJobs,
  jobProgress,
  retryFailedJob,
  hasJobRunner,
  buildJobErrorReport,
  type BatchJob,
} from '@/lib/jobQueue';
import { Pause, Play, X, Trash2, ListTodo, RotateCcw, Copy } from 'lucide-react';
import { toast } from '@/lib/toastBus';
import { maskSecretsInText } from '@/lib/secrets';

export default function JobQueuePanel() {
  const [jobs, setJobs] = useState<BatchJob[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const sync = () => setJobs(listJobs());
    sync();
    return subscribeJobQueue(sync);
  }, []);

  const active = jobs.filter(
    (j) => j.status === 'running' || j.status === 'paused' || j.status === 'queued',
  );
  const badge = active.length;

  if (!jobs.length) return null;

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-300 hover:bg-zinc-800 cursor-pointer"
        title="Hàng đợi job (ảnh / TTS batch)"
      >
        <ListTodo className="h-3.5 w-3.5 text-amber-400" />
        Jobs
        {badge > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-black">
            {badge}
          </span>
        ) : null}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-[70] mt-2 w-[min(340px,92vw)] rounded-xl border border-zinc-800 bg-zinc-950/95 p-3 shadow-2xl backdrop-blur-md">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              Hàng đợi · cid
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  const report = maskSecretsInText(buildJobErrorReport());
                  try {
                    await navigator.clipboard.writeText(report);
                    toast.success(
                      'Đã copy report lỗi',
                      'Gồm correlationId — dán vào chat/support',
                    );
                  } catch {
                    toast.warn('Copy thất bại', 'Xem console — report đã log');
                    console.log(report);
                  }
                }}
                className="flex items-center gap-1 text-[9px] font-bold uppercase text-zinc-500 hover:text-amber-300 cursor-pointer"
                title="Copy error report (correlationId + mask secret)"
              >
                <Copy className="h-3 w-3" />
                Report
              </button>
              <button
                type="button"
                onClick={() => clearFinishedJobs()}
                className="flex items-center gap-1 text-[9px] font-bold uppercase text-zinc-500 hover:text-white cursor-pointer"
              >
                <Trash2 className="h-3 w-3" />
                Dọn xong
              </button>
            </div>
          </div>
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {jobs.map((j) => {
              const p = jobProgress(j);
              return (
                <div
                  key={j.id}
                  className="rounded-lg border border-zinc-800/80 bg-black/40 p-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[11px] font-bold text-zinc-200">
                        {j.title}
                      </div>
                      <div className="text-[9px] text-zinc-500">
                        {j.status} · {p.done}/{p.total} · {p.failed} lỗi · {p.pct}%
                      </div>
                      {j.correlationId ? (
                        <div
                          className="truncate font-mono text-[8px] text-zinc-600"
                          title={j.correlationId}
                        >
                          {j.correlationId}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {j.status === 'running' && (
                        <button
                          type="button"
                          onClick={() => pauseJob(j.id)}
                          className="rounded border border-zinc-700 p-1 text-zinc-400 hover:text-amber-400 cursor-pointer"
                          title="Tạm dừng"
                        >
                          <Pause className="h-3 w-3" />
                        </button>
                      )}
                      {j.status === 'paused' && (
                        <button
                          type="button"
                          onClick={() => resumeJob(j.id)}
                          className="rounded border border-zinc-700 p-1 text-zinc-400 hover:text-emerald-400 cursor-pointer"
                          title="Tiếp tục"
                        >
                          <Play className="h-3 w-3" />
                        </button>
                      )}
                      {p.failed > 0 &&
                        hasJobRunner(j.id) &&
                        (j.status === 'failed' || j.status === 'done' || j.status === 'paused') && (
                          <button
                            type="button"
                            onClick={() => {
                              void retryFailedJob(j.id).then((job) => {
                                if (!job) {
                                  toast.warn('Retry', 'Không còn runner cho job này.');
                                  return;
                                }
                                toast.info('Retry failed', job.title);
                              });
                            }}
                            className="rounded border border-amber-800/50 p-1 text-amber-400 hover:bg-amber-500/10 cursor-pointer"
                            title="Chạy lại các item lỗi"
                          >
                            <RotateCcw className="h-3 w-3" />
                          </button>
                        )}
                      {(j.status === 'running' || j.status === 'paused' || j.status === 'queued') && (
                        <button
                          type="button"
                          onClick={() => cancelJob(j.id)}
                          className="rounded border border-zinc-700 p-1 text-zinc-400 hover:text-red-400 cursor-pointer"
                          title="Hủy"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-900">
                    <div
                      className={`h-full rounded-full transition-all ${
                        p.failed ? 'bg-amber-500' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${Math.max(2, p.pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
