'use client';

/**
 * Core-loop onboarding — first visit guide + load demo project.
 */
import React, { useEffect, useState } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import {
  CORE_LOOP_STEPS,
  buildDemoProjectPatch,
  dismissOnboarding,
  loadOnboarding,
  saveOnboarding,
  type OnboardingState,
} from '@/lib/onboarding';
import { toast } from '@/lib/toastBus';
import { X, Sparkles, CheckCircle2 } from 'lucide-react';

export default function OnboardingBanner() {
  const store = useNovelStore();
  const [state, setState] = useState<OnboardingState | null>(null);

  useEffect(() => {
    setState(loadOnboarding());
  }, []);

  if (!state || state.dismissed || !store.isHydrated) return null;

  const done = new Set(state.completedSteps);

  const handleDismiss = () => {
    setState(dismissOnboarding());
  };

  const handleLoadDemo = () => {
    try {
      const patch = buildDemoProjectPatch();
      useNovelStore.setState(patch as Partial<typeof store>);
      const next = {
        ...loadOnboarding(),
        demoLoaded: true,
        completedSteps: Array.from(
          new Set([...loadOnboarding().completedSteps, 'setup', 'outline', 'write']),
        ),
      };
      saveOnboarding(next);
      setState(next);
      toast.success(
        'Đã nạp Demo Core Loop',
        'Chương 1 sẵn sàng — thử TTS Edge hoặc gen prompt ảnh.',
      );
    } catch (e) {
      toast.error(
        'Nạp demo thất bại',
        e instanceof Error ? e.message : String(e),
      );
    }
  };

  return (
    <div className="shrink-0 border-b border-amber-900/40 bg-gradient-to-r from-amber-950/80 via-zinc-950 to-zinc-950 px-3 py-2 sm:px-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-400">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-amber-400">
              Core loop · 5 phút
            </h3>
            <span className="text-[10px] text-zinc-500">
              Setup → Outline → Viết → TTS → Ảnh → Export
            </span>
          </div>
          <ol className="mt-1.5 flex flex-wrap gap-1.5">
            {CORE_LOOP_STEPS.map((s, i) => {
              const ok = done.has(s.id);
              return (
                <li
                  key={s.id}
                  title={s.hint}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${
                    ok
                      ? 'border-emerald-800/60 bg-emerald-950/40 text-emerald-400'
                      : 'border-zinc-800 bg-zinc-900/60 text-zinc-400'
                  }`}
                >
                  {ok ? (
                    <CheckCircle2 className="h-3 w-3" />
                  ) : (
                    <span className="font-mono text-zinc-600">{i + 1}</span>
                  )}
                  {s.label}
                </li>
              );
            })}
          </ol>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleLoadDemo}
              className="rounded-lg bg-emerald-500 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-black shadow-md shadow-emerald-500/20 hover:bg-emerald-400 cursor-pointer"
            >
              Nạp truyện demo 1 chương
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              className="rounded-lg border border-zinc-700 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400 hover:text-white cursor-pointer"
            >
              Đã hiểu, ẩn hướng dẫn
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="shrink-0 rounded p-1 text-zinc-500 hover:text-white cursor-pointer"
          aria-label="Đóng"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
