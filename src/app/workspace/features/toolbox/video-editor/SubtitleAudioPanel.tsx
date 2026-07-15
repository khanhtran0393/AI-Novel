'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import React from 'react';
import SectionPanel from './SectionPanel';
import { CustomCheckbox } from './VideoEditorControls';

export default function SubtitleAudioPanel(p: any) {
  const {
    enableSub,
    setEnableSub,
    srtMode,
    setSrtMode,
    audioLang,
    setAudioLang,
    tgtLang,
    setTgtLang,
    masterVoice,
    masterSpeed,
    aiEngine,
    setAiEngine,
    srtFont,
    setSrtFont,
    srtSize,
    setSrtSize,
    srtDelay,
    setSrtDelay,
    isRendering,
    handleSelectSrt,
    handleVoiceChange,
    handleVoiceSpeedChange,
    handleStepStt,
    handleStepTrans,
    handleStepTts,
    openSrtEditor,
    CAPASSISTANT_TTS_VOICES,
  } = p;

  return (
    <SectionPanel index={2} title="Phụ đề & Âm thanh Tự động">
      <CustomCheckbox checked={enableSub} onChange={setEnableSub} label="Bật Phụ đề (Hiển thị Text trên Video)" />

      <div className="flex gap-3 text-[11px] mt-1">
        <label className="flex items-center gap-1 cursor-pointer">
          <input type="radio" checked={srtMode === 'translated'} onChange={() => setSrtMode('translated')} /> SRT đã dịch
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input type="radio" checked={srtMode === 'untranslated'} onChange={() => setSrtMode('untranslated')} /> SRT chưa dịch
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input type="radio" checked={srtMode === 'auto'} onChange={() => setSrtMode('auto')} /> Nhận dạng từ Audio
        </label>
      </div>

      <div className="flex gap-2 mt-1">
        <button onClick={handleSelectSrt} className="flex-1 bg-slate-800 border border-slate-700 py-1 rounded text-[11px] text-slate-200">
          📄 Chọn SRT Gốc
        </button>
        <button
          onClick={() => openSrtEditor('original')}
          className="flex-1 bg-slate-800 border border-slate-700 py-1 rounded text-[11px] text-slate-200"
        >
          👀 Xem SRT Gốc
        </button>
        <button
          onClick={() => openSrtEditor('translated')}
          className="flex-1 bg-blue-600 hover:bg-blue-500 border border-blue-500 py-1 rounded text-[11px] font-bold text-white"
        >
          👀 Xem SRT đã dịch
        </button>
      </div>

      {srtMode === 'auto' && (
        <div className="mt-2 bg-slate-900/50 p-2 rounded border border-slate-800 flex flex-col gap-1 text-[11px]">
          <div className="flex items-center justify-between">
            <span className="text-slate-300">Ngôn ngữ gốc:</span>
            <select
              className="bg-slate-950 border border-slate-700 rounded px-1 w-[120px]"
              value={audioLang}
              onChange={(event) => setAudioLang(event.target.value)}
            >
              <option>Tiếng Trung (ZH)</option>
              <option>Tiếng Anh (EN)</option>
              <option>Tiếng Việt (VN)</option>
            </select>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-300">Ngôn ngữ Đích:</span>
            <select
              className="bg-slate-950 border border-slate-700 rounded px-1 w-[120px]"
              value={tgtLang}
              onChange={(event) => setTgtLang(event.target.value)}
            >
              <option>Tiếng Việt (VI)</option>
              <option>Tiếng Anh (EN)</option>
              <option>Tiếng Trung (ZH)</option>
            </select>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-300">Giọng đọc (TTS):</span>
            <select
              className="bg-slate-950 border border-slate-700 rounded px-1 flex-1 min-w-0"
              value={masterVoice}
              onChange={(event) => handleVoiceChange(event.target.value)}
            >
              {CAPASSISTANT_TTS_VOICES.map((voice: { name: string }) => (
                <option key={voice.name} value={voice.name}>
                  {voice.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-300">Tốc độ đọc:</span>
            <select
              className="bg-slate-950 border border-slate-700 rounded px-1 w-[120px]"
              value={masterSpeed}
              onChange={(event) => handleVoiceSpeedChange(event.target.value)}
            >
              <option>1.0</option>
              <option>1.1</option>
              <option>1.2</option>
            </select>
          </div>
          <div className="flex items-center justify-between mt-1 pt-1 border-t border-slate-800">
            <span className="text-slate-300">Chế độ chạy (AI):</span>
            <select
              className="bg-slate-950 border border-slate-700 rounded px-1 w-[150px]"
              value={aiEngine}
              onChange={(event) => setAiEngine(event.target.value)}
            >
              <option>CapCut Web (Nhanh - Chưa Ổn Định)</option>
              <option>CPU (Chậm - Ổn định)</option>
              <option>Nvidia GPU (CUDA)</option>
              <option>AMD GPU (OpenVINO)</option>
              <option>AMD GPU (DirectML)</option>
            </select>
          </div>
          <div className="flex gap-1 mt-1">
            <button onClick={handleStepStt} disabled={isRendering} className="flex-1 bg-sky-600 hover:bg-sky-500 text-white font-bold py-1 rounded disabled:opacity-50">
              Nhận dạng SRT
            </button>
            <button onClick={handleStepTrans} disabled={isRendering} className="flex-1 bg-green-600 hover:bg-green-500 text-white font-bold py-1 rounded disabled:opacity-50">
              Dịch SRT
            </button>
            <button onClick={() => handleStepTts(false)} disabled={isRendering} className="flex-1 bg-purple-600 hover:bg-purple-500 text-white font-bold py-1 rounded disabled:opacity-50">
              Đọc SRT
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mt-2 text-[11px]">
        <span className="text-slate-300">Font Phụ đề:</span>
        <select
          value={srtFont}
          onChange={(event) => setSrtFont(event.target.value)}
          className="bg-slate-950 border border-slate-700 rounded px-1 w-[150px]"
        >
          <option>UTM_Bebas</option>
          <option>Arial</option>
        </select>
      </div>
      <div className="flex items-center justify-between mt-1 text-[11px]">
        <span className="text-slate-300">Cỡ chữ SRT:</span>
        <input
          type="number"
          value={srtSize}
          onChange={(event) => setSrtSize(event.target.value)}
          className="bg-slate-950 border border-slate-700 rounded px-1 w-[80px] text-right"
        />
      </div>
      <div className="flex items-center justify-between mt-1 text-[11px]">
        <span className="text-slate-300">Độ trễ phụ đề:</span>
        <div className="flex gap-1">
          <input
            type="number"
            value={srtDelay}
            onChange={(event) => setSrtDelay(event.target.value)}
            step="0.1"
            className="bg-slate-950 border border-slate-700 rounded px-1 w-[80px] text-right"
          />{' '}
          <span className="text-slate-400">s</span>
        </div>
      </div>
    </SectionPanel>
  );
}
