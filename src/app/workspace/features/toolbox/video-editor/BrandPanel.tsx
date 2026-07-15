'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import React from 'react';
import SectionPanel from './SectionPanel';
import { CustomCheckbox } from './VideoEditorControls';

export default function BrandPanel(p: any) {
  const {
    presetLogos,
    handleQuickLogo,
    useLogo,
    setUseLogo,
    handleSelectLogo,
    logoRescale,
    setLogoRescale,
    logoDelay,
    setLogoDelay,
    useStaticText,
    setUseStaticText,
    staticText,
    setStaticText,
    staticFont,
    setStaticFont,
    staticSize,
    setStaticSize,
    staticDelay,
    setStaticDelay,
    useWm,
    setUseWm,
    wmText,
    setWmText,
    wmDelay,
    setWmDelay,
  } = p;

  return (
    <SectionPanel index={5} title="Thương hiệu (Logo & Text & Watermark)">
      <div className="flex items-center gap-2 text-[11px]">
        <span className="text-slate-300">🌟 Chọn Logo nhanh:</span>
        <div className="flex gap-1 flex-1">
          {['1', '2', '3', '4'].map((item, index) => (
            <button
              key={item}
              onClick={() => handleQuickLogo(index)}
              title={presetLogos[index] || 'Chua gan file, bam de chon'}
              className="flex-1 bg-blue-900 hover:bg-blue-800 text-white font-bold py-0.5 rounded"
            >
              Logo {item}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-2">
        <CustomCheckbox checked={useLogo} onChange={setUseLogo} label="Hiện Logo" />
        <button className="bg-slate-800 border border-slate-700 py-1 px-3 rounded text-[11px] text-slate-200" onClick={handleSelectLogo}>
          🖼️ Duyệt File
        </button>
      </div>
      <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-300">
        <span>Kích thước:</span>
        <input
          type="range"
          min="5"
          max="50"
          value={logoRescale}
          onChange={(event) => setLogoRescale(event.target.value)}
          className="w-20 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-orange-500"
        />
        <span className="ml-2">Delay (s):</span>
        <input type="number" value={logoDelay} onChange={(event) => setLogoDelay(event.target.value)} className="w-12 bg-slate-950 border border-slate-700 rounded px-1 text-center" />
      </div>

      <div className="flex items-center gap-2 mt-3">
        <CustomCheckbox checked={useStaticText} onChange={setUseStaticText} label="Text Tĩnh:" />
        <input
          type="text"
          placeholder="Nhập nội dung text tĩnh..."
          value={staticText}
          onChange={(event) => setStaticText(event.target.value)}
          className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px]"
        />
      </div>
      <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-300">
        <span>Font:</span>
        <select value={staticFont} onChange={(event) => setStaticFont(event.target.value)} className="bg-slate-950 border border-slate-700 rounded px-1 w-[80px]">
          <option>UTM_Bebas</option>
        </select>
        <span className="ml-1">Size:</span>
        <input type="number" value={staticSize} onChange={(event) => setStaticSize(event.target.value)} className="w-12 bg-slate-950 border border-slate-700 rounded px-1 text-center" />
        <span className="ml-1">Delay:</span>
        <input type="number" value={staticDelay} onChange={(event) => setStaticDelay(event.target.value)} className="w-12 bg-slate-950 border border-slate-700 rounded px-1 text-center" />
      </div>

      <div className="flex items-center gap-2 mt-3">
        <CustomCheckbox checked={useWm} onChange={setUseWm} label="Watermark (Di chuyển):" />
        <input
          type="text"
          placeholder="CapAssistant"
          value={wmText}
          onChange={(event) => setWmText(event.target.value)}
          className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px]"
        />
        <span className="text-[11px] text-slate-300">Delay:</span>
        <input type="number" value={wmDelay} onChange={(event) => setWmDelay(event.target.value)} className="w-12 bg-slate-950 border border-slate-700 rounded px-1 py-1 text-center text-[11px]" />
      </div>
    </SectionPanel>
  );
}
