'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import React from 'react';
import AdvancedPanel from './AdvancedPanel';
import BrandPanel from './BrandPanel';
import MusicPanel from './MusicPanel';
import SubtitleAudioPanel from './SubtitleAudioPanel';
import SubtitleStyleBlurPanel from './SubtitleStyleBlurPanel';
import TrimPanel from './TrimPanel';
import VideoPanel from './VideoPanel';

export default function VideoEditorLeftColumn(p: any) {
  const { appendPanelLog, setPanelLog, store, toast } = p;

  return (
    <div
      className="flex flex-col overflow-y-auto custom-scrollbar bg-[#0f172a]/50 border-r border-slate-800 p-3"
      style={{ width: '420px', minWidth: '420px', flexShrink: 0 }}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[13px] text-emerald-500 font-bold">Bản quyền: AI Novel Pro</span>
        <div className="flex gap-1">
          <button
            className="px-3 py-1 bg-slate-800 text-[11px] font-bold rounded border border-slate-700"
            onClick={() => {
              const msg = 'AI Novel Video Editor dang dung engine CapAssistant local: /api/video-editor + /api/capassistant/join.';
              setPanelLog(msg);
              toast.info('Notice', msg);
            }}
          >
            🔄 Update
          </button>
          <button
            className="px-3 py-1 bg-slate-800 text-[11px] font-bold rounded border border-slate-700"
            onClick={() => {
              const key = prompt('Nhap Gemini/API key dung cho dich SRT:', store.apiKey || '');
              if (key !== null) {
                store.setApiKey(key.trim());
                if (key.trim()) store.prioritizeApiKey(key.trim());
                appendPanelLog('[KEY] Da cap nhat API key cho dich SRT.');
              }
            }}
          >
            🔑 Đổi Key
          </button>
        </div>
      </div>

      <VideoPanel {...p} />
      <SubtitleAudioPanel {...p} />
      <MusicPanel {...p} />
      <SubtitleStyleBlurPanel {...p} />
      <BrandPanel {...p} />
      <TrimPanel {...p} />
      <AdvancedPanel {...p} />
    </div>
  );
}
