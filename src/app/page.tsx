'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    // Chuyển hướng sang trang workspace
    router.replace('/workspace');
  }, [router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-black font-sans text-amber-500" suppressHydrationWarning>
      <div className="relative flex flex-col items-center gap-6" suppressHydrationWarning>
        {/* Vòng quay Sci-Fi Amber */}
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
        </div>
      </div>
    </div>
  );
}
