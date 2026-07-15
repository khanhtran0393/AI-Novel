'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import React from 'react';
import SectionPanel from './SectionPanel';
import { CustomCheckbox } from './VideoEditorControls';

export default function TrimPanel(p: any) {
  const { enableTrim, setEnableTrim, trims, setTrims } = p;

  return (
    <SectionPanel index={6} title="Loại bỏ đoạn thừa (Remove Segments)">
      <CustomCheckbox checked={enableTrim} onChange={setEnableTrim} label="Bật tính năng xóa" />
      <div className="flex gap-2 mt-1">
        <button
          className="bg-slate-800 border border-slate-700 py-1 px-2 rounded text-[10px] text-slate-200"
          onClick={() => {
            setTrims([...trims, { start: '00:00:00', end: '00:00:05' }]);
          }}
        >
          [+] Thêm đoạn xóa
        </button>
        <button className="bg-red-900/50 hover:bg-red-800 border border-red-900 py-1 px-2 rounded text-[10px] text-red-200" onClick={() => setTrims([])}>
          [-] Xóa chọn
        </button>
      </div>
      <div className="bg-[#020617] border border-slate-700 h-[50px] rounded mt-1 overflow-y-auto">
        {trims.map((trim: any, index: number) => (
          <div key={`${trim.start}-${trim.end}-${index}`} className="text-[10px] p-1 border-b border-slate-800 text-slate-300">
            Start: {trim.start} - End: {trim.end}
          </div>
        ))}
      </div>
    </SectionPanel>
  );
}
