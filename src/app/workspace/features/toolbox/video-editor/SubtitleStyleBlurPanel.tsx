'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import React from 'react';
import SectionPanel from './SectionPanel';
import { CustomCheckbox } from './VideoEditorControls';

export default function SubtitleStyleBlurPanel(p: any) {
  const {
    srtStyle,
    setSrtStyle,
    bgPadding,
    setBgPadding,
    padX,
    setPadX,
    padY,
    setPadY,
    smartBlur,
    setSmartBlur,
    blurs,
    setBlurs,
    blurX,
    setBlurX,
    blurY,
    setBlurY,
    blurW,
    setBlurW,
    blurH,
    setBlurH,
    blurStart,
    setBlurStart,
    blurDur,
    setBlurDur,
    blurPower,
    setBlurPower,
  } = p;

  return (
    <SectionPanel index={4} title="Kiểu Phụ Đề & Vùng Che Mờ">
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="text-sky-400 font-bold">Style Phụ Đề:</span>
        <CustomCheckbox checked={bgPadding} onChange={setBgPadding} label="Bật Nền" className="text-yellow-500" />
        <select
          value={srtStyle}
          onChange={(event) => setSrtStyle(event.target.value)}
          className="bg-slate-900 font-bold text-white border border-slate-700 rounded px-1 w-[180px]"
        >
          <option>Viền đen nổi bật (Mặc định)</option>
          <option>Nền Đen mờ (Netflix)</option>
          <option>Nền Vàng chữ Đen (TikTok)</option>
          <option>Nền Trắng chữ Đen</option>
          <option>Nền Xanh Blue chữ Trắng</option>
        </select>
      </div>
      <div className="flex items-center gap-2 text-[11px] mb-2">
        <span className="text-emerald-300 font-bold">Đệm Dọc (Y):</span>
        <input type="number" value={padY} onChange={(event) => setPadY(event.target.value)} className="w-12 bg-slate-950 border border-slate-700 rounded px-1 text-center" />
        <span className="text-emerald-300 font-bold ml-2">Đệm Ngang (X):</span>
        <input type="number" value={padX} onChange={(event) => setPadX(event.target.value)} className="w-12 bg-slate-950 border border-slate-700 rounded px-1 text-center" />
      </div>

      <CustomCheckbox checked={smartBlur} onChange={setSmartBlur} label="Smart Blur (Che mờ sub gốc tự động)" className="text-yellow-500 font-bold mt-1" />

      <div className="h-[1px] bg-slate-700 my-2" />

      <div className="text-slate-400 italic text-[11px]">Cấu hình Che mờ thủ công (Multi-Blur):</div>
      <div className="bg-[#020617] border border-slate-700 h-[50px] rounded mt-1 overflow-y-auto">
        {blurs.map((blur: any, index: number) => (
          <div key={`${blur.x}-${blur.y}-${index}`} className="text-[10px] p-1 border-b border-slate-800 text-slate-300">
            X:{blur.x} Y:{blur.y} W:{blur.w} H:{blur.h} Start:{blur.start} Dur:{blur.dur}
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-1">
        <button
          className="bg-slate-800 border border-slate-700 py-1 px-2 rounded text-[10px] text-slate-200"
          onClick={() => {
            if (blurW && blurH) setBlurs([...blurs, { x: blurX, y: blurY, w: blurW, h: blurH, start: blurStart, dur: blurDur }]);
          }}
        >
          [+] Thêm vùng
        </button>
        <button className="bg-red-900/50 hover:bg-red-800 border border-red-900 py-1 px-2 rounded text-[10px] text-red-200" onClick={() => setBlurs([])}>
          [-] Xóa vùng
        </button>
      </div>
      <div className="flex items-center gap-1 mt-1 text-[10px] text-slate-300">
        <span>X:</span>
        <input type="number" value={blurX} onChange={(event) => setBlurX(event.target.value)} className="w-12 bg-slate-950 border border-slate-700 rounded px-1 text-center" />
        <span className="ml-1">Y:</span>
        <input type="number" value={blurY} onChange={(event) => setBlurY(event.target.value)} className="w-12 bg-slate-950 border border-slate-700 rounded px-1 text-center" />
      </div>
      <div className="flex items-center gap-1 mt-1 text-[10px] text-slate-300">
        <span>W:</span>
        <input type="number" value={blurW} onChange={(event) => setBlurW(event.target.value)} className="w-12 bg-slate-950 border border-slate-700 rounded px-1 text-center" />
        <span className="ml-1">H:</span>
        <input type="number" value={blurH} onChange={(event) => setBlurH(event.target.value)} className="w-12 bg-slate-950 border border-slate-700 rounded px-1 text-center" />
      </div>
      <div className="flex items-center gap-1 mt-1 text-[10px] text-slate-300">
        <span>Bắt đầu:</span>
        <input type="text" placeholder="01:20" value={blurStart} onChange={(event) => setBlurStart(event.target.value)} className="w-16 bg-slate-950 border border-slate-700 rounded px-1 text-center" />
        <span className="ml-1">Độ dài:</span>
        <input type="text" placeholder="0=Full" value={blurDur} onChange={(event) => setBlurDur(event.target.value)} className="w-16 bg-slate-950 border border-slate-700 rounded px-1 text-center" />
      </div>
      <div className="flex items-center gap-2 mt-2">
        <span className="text-[11px] text-slate-300 w-[100px]">Cường độ làm mờ:</span>
        <input
          type="range"
          min="5"
          max="60"
          value={blurPower}
          onChange={(event) => setBlurPower(event.target.value)}
          className="flex-1 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-orange-500"
        />
      </div>
    </SectionPanel>
  );
}
