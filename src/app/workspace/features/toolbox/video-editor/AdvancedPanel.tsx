'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import React from 'react';
import SectionPanel from './SectionPanel';
import { CustomCheckbox } from './VideoEditorControls';

export default function AdvancedPanel(p: any) {
  const {
    enableFrame,
    setEnableFrame,
    handleSelectFrame,
    bypassFx,
    setBypassFx,
    rotate,
    setRotate,
    bright,
    setBright,
    contrast,
    setContrast,
    sat,
    setSat,
  } = p;

  return (
    <SectionPanel index={7} title="Bypass & Xử lý Nâng Cao">
      <div className="flex items-center gap-2 mb-2">
        <CustomCheckbox checked={enableFrame} onChange={setEnableFrame} label="Bật Khung Overlay (Frame)" />
        <button className="bg-slate-800 border border-slate-700 py-1 px-2 rounded text-[10px] text-slate-200" onClick={handleSelectFrame}>
          🖼️ Duyệt Frame PNG
        </button>
      </div>

      <div className="flex items-center justify-between text-[11px] mb-2">
        <span className="text-slate-300">Hiệu ứng lách (Bypass FX):</span>
        <select value={bypassFx} onChange={(event) => setBypassFx(event.target.value)} className="bg-slate-950 border border-slate-700 rounded px-1 w-[180px]">
          <option>Không (None)</option>
          <option>TEST 2: Đảo màu (Negative)</option>
          <option>Nhiễu hạt (Fine Noise)</option>
          <option>Viền mờ (Soft Vignette)</option>
          <option>Tăng sắc nét (Sharpen)</option>
          <option>Màu phim (Cinematic Tint)</option>
          <option>Lớp phủ gương (Glass Edge)</option>
          <option>Lách AI 1 (Motion Blur)</option>
          <option>Lách AI 2 (Gamma Shift)</option>
          <option>Lách AI 3 (Dynamic Hue)</option>
          <option>Lách AI 4 (Ghost Pattern)</option>
          <option>Lách AI 5 (Macroblock Noise)</option>
        </select>
      </div>

      <div className="flex items-center justify-between mt-1 text-[11px]">
        <span className="text-slate-300">Góc Xoay (Chống quét):</span>
        <div className="flex gap-1 items-center">
          <input type="number" value={rotate} onChange={(event) => setRotate(event.target.value)} className="bg-slate-950 border border-slate-700 rounded px-1 w-[60px] text-center" />
          <span className="text-slate-400">độ</span>
        </div>
      </div>

      <div className="flex items-center justify-between mt-1 text-[11px]">
        <span className="text-slate-300 w-[140px]">Độ Sáng (Color EQ):</span>
        <input type="range" min="-50" max="50" value={bright} onChange={(event) => setBright(event.target.value)} className="flex-1 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-orange-500" />
      </div>
      <div className="flex items-center justify-between mt-1 text-[11px]">
        <span className="text-slate-300 w-[140px]">Tương Phản (Color EQ):</span>
        <input type="range" min="50" max="150" value={contrast} onChange={(event) => setContrast(event.target.value)} className="flex-1 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-orange-500" />
      </div>
      <div className="flex items-center justify-between mt-1 text-[11px]">
        <span className="text-slate-300 w-[140px]">Rực Màu (Color EQ):</span>
        <input type="range" min="50" max="150" value={sat} onChange={(event) => setSat(event.target.value)} className="flex-1 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-orange-500" />
      </div>
    </SectionPanel>
  );
}
