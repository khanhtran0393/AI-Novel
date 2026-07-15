'use client';

import React from 'react';

export default function SectionPanel({ title, index, children }: { title: string; index: number | string; children: React.ReactNode }) { return (
  <div className="bg-[#0f172a] border border-[#334155] rounded-lg mt-3 relative pb-2 shadow-md">
    <div className="absolute -top-2.5 left-3 bg-[#1e293b] border border-[#475569] text-white text-[11px] font-bold px-2 py-0.5 rounded shadow-sm z-10">
      {index}. {title}
    </div>
    <div className="px-3 pt-4 pb-1 flex flex-col gap-2">
      {children}
    </div>
  </div>
); }
