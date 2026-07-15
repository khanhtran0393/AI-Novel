'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import React from 'react';
import SectionPanel from './SectionPanel';
import { CustomCheckbox, OrangeTab } from './VideoEditorControls';

export default function VideoPanel(p: any) {
  const {
    videoPath,
    videoList,
    exportRatio,
    setExportRatio,
    zoom,
    setZoom,
    speed,
    setSpeed,
    mute,
    setMute,
    vocalFilter,
    setVocalFilter,
    flip,
    setFlip,
    gpu,
    setGpu,
    volume,
    setVolume,
    handleSelectVideo,
    handleSuggestThumbnail,
  } = p;

  return (
    <SectionPanel index={1} title="Video & Tốc độ & Phóng to">
      <div className="flex gap-2">
        <button
          onClick={handleSelectVideo}
          className="flex-1 bg-blue-600 hover:bg-blue-500 text-white rounded py-1.5 flex justify-center items-center gap-1.5 font-bold text-[11px]"
        >
          🎬 Chọn Video
        </button>
        <button
          onClick={handleSuggestThumbnail}
          className="flex-1 bg-blue-600 hover:bg-blue-500 text-white rounded py-1.5 flex justify-center items-center gap-1.5 font-bold text-[11px]"
        >
          📸 Gợi Ý Thumbnail
        </button>
      </div>
      <div className="text-slate-400 italic text-[10px] truncate" title={videoPath || 'Chưa nạp video.'}>
        {videoPath ? videoPath : 'Chưa nạp video.'}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[11px] text-slate-300 w-[100px]">Tỉ lệ xuất:</span>
        <select
          value={exportRatio}
          onChange={(event) => setExportRatio(event.target.value)}
          className="flex-1 bg-slate-950 border border-slate-700 rounded px-1 py-1 text-[11px] text-white"
        >
          <option>Giữ nguyên (Theo Video đầu tiên)</option>
          <option>Ngang (16:9) - 1920x1080</option>
          <option>Dọc (9:16) - 1080x1920</option>
        </select>
      </div>
      <div className="text-[9px] text-slate-500 italic ml-[108px]">
        *(Chỉ áp dụng khi ghép từ 2 video trở lên)
      </div>

      <div className="bg-[#020617] border border-slate-700 h-[60px] rounded mt-1 overflow-y-auto">
        {videoList.map((video: string, index: number) => (
          <div key={`${video}-${index}`} className="text-[10px] p-1 border-b border-slate-800 text-slate-300 truncate">
            {video}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 mt-2">
        <span className="text-[11px] text-slate-300 w-[120px]">Tỉ lệ Phóng to (Zoom %):</span>
        <div className="flex flex-1 gap-1">
          <OrangeTab active={zoom === '100'} onClick={() => setZoom('100')}>
            100%
          </OrangeTab>
          <OrangeTab active={zoom === '110'} onClick={() => setZoom('110')}>
            110%
          </OrangeTab>
          <OrangeTab active={zoom === '120'} onClick={() => setZoom('120')}>
            120%
          </OrangeTab>
          <input
            type="text"
            value={zoom}
            onChange={(event) => setZoom(event.target.value)}
            placeholder="Tùy chỉnh"
            className="w-[60px] bg-slate-950 border border-slate-700 rounded text-center text-[11px]"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[11px] text-slate-300 w-[120px]">Tốc độ Video gốc (%):</span>
        <div className="flex flex-1 gap-1">
          <OrangeTab active={speed === '80'} onClick={() => setSpeed('80')}>
            80%
          </OrangeTab>
          <OrangeTab active={speed === '90'} onClick={() => setSpeed('90')}>
            90%
          </OrangeTab>
          <OrangeTab active={speed === '100'} onClick={() => setSpeed('100')}>
            100%
          </OrangeTab>
          <input
            type="text"
            value={speed}
            onChange={(event) => setSpeed(event.target.value)}
            placeholder="Tùy chỉnh"
            className="w-[60px] bg-slate-950 border border-slate-700 rounded text-center text-[11px]"
          />
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1 mt-1">
        <CustomCheckbox checked={mute} onChange={setMute} label="Mute" />
        <CustomCheckbox checked={vocalFilter} onChange={setVocalFilter} label="Lọc Vocal" />
        <CustomCheckbox checked={flip} onChange={setFlip} label="Lật Ngang" />
        <CustomCheckbox checked={gpu} onChange={setGpu} label="Dùng GPU" />
      </div>

      <div className="flex items-center gap-2 mt-1">
        <span className="text-[11px] text-slate-300 w-[120px]">Âm lượng gốc: {volume}%</span>
        <input
          type="range"
          min="0"
          max="200"
          value={volume}
          onChange={(event) => setVolume(event.target.value)}
          className="flex-1 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-orange-500"
        />
      </div>
    </SectionPanel>
  );
}
