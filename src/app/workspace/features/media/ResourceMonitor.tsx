'use client';
import React, { useEffect, useState } from 'react';

export function ResourceMonitor() {
  const [res, setRes] = useState<any>(null);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const r = await fetch('/api/flow/resources', { cache: 'no-store' });
        if (r.ok) {
          const data = await r.json();
          if (active && data.ok) {
            setRes((prev: any) => {
              if (
                prev &&
                prev.ram?.used === data.ram?.used &&
                prev.chrome?.pids === data.chrome?.pids &&
                prev.chrome?.ramBytes === data.chrome?.ramBytes &&
                prev.queue?.active === data.queue?.active &&
                prev.queue?.max === data.queue?.max
              ) {
                return prev;
              }
              return data;
            });
          }
        }
      } catch (e) {
        // ignore
      }
      if (active) setTimeout(poll, 3000);
    };
    poll();
    return () => { active = false; };
  }, []);

  if (!res) return null;

  const ramUsedGb = (res.ram.used / 1024 / 1024 / 1024).toFixed(1);
  const ramTotalGb = (res.ram.total / 1024 / 1024 / 1024).toFixed(1);
  const percent = Math.round((res.ram.used / res.ram.total) * 100);
  const chromeMb = Math.round(res.chrome.ramBytes / 1024 / 1024);

  return (
    <div className="shrink-0 flex items-center gap-2 text-[10px] font-medium opacity-80 border-l pl-2 ml-1">
      <div className="flex items-center gap-1" title="Sức khoẻ Tài nguyên (Chrome & RAM)">
        <span className="text-zinc-500">RAM:</span>
        <span className={percent > 90 ? 'text-red-500 font-bold' : ''}>
          {ramUsedGb}/{ramTotalGb}GB ({percent}%)
        </span>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-zinc-500">Chrome:</span>
        <span>{res.chrome.pids} PIDs ({chromeMb}MB)</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-zinc-500">Queue:</span>
        <span>{res.queue.active}/{res.queue.max}</span>
      </div>
    </div>
  );
}
