'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Root `/` — hard-redirect to workspace.
 * Electron loads /workspace directly; this page is fallback for browser.
 * Prefer location.replace over router.replace (more reliable in Electron shell).
 */
export default function Home() {
  const router = useRouter();

  useEffect(() => {
    try {
      // Full navigation — avoids stuck client transition on Electron
      window.location.replace('/workspace');
    } catch {
      router.replace('/workspace');
    }
  }, [router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-black font-sans text-amber-500" suppressHydrationWarning>
      <div className="relative flex flex-col items-center gap-6" suppressHydrationWarning>
        <div className="relative h-20 w-20" suppressHydrationWarning>
          <div className="absolute inset-0 rounded-full border-4 border-amber-950/30" suppressHydrationWarning></div>
          <div className="absolute inset-0 animate-spin rounded-full border-4 border-amber-500 border-t-transparent" suppressHydrationWarning></div>
          <div className="absolute inset-0 animate-pulse rounded-full border border-amber-400/20" suppressHydrationWarning></div>
        </div>

        <div className="flex flex-col items-center gap-2" suppressHydrationWarning>
          <h2 className="text-xl font-medium tracking-[0.2em] uppercase text-zinc-100 animate-pulse" suppressHydrationWarning>
            AI Novel Generator
          </h2>
          <p className="text-xs tracking-wider text-amber-500/60 uppercase" suppressHydrationWarning>
            Đang tải không gian làm việc...
          </p>
          <a
            href="/workspace"
            className="mt-4 text-xs text-cyan-400 underline underline-offset-4 hover:text-cyan-300"
          >
            Bấm vào đây nếu chờ quá lâu → Workspace
          </a>
        </div>
      </div>
    </div>
  );
}
