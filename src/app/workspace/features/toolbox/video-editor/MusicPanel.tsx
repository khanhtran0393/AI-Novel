'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import React from 'react';
import SectionPanel from './SectionPanel';
import { CustomCheckbox } from './VideoEditorControls';

export default function MusicPanel(p: any) {
  const {
    musicList,
    setMusicList,
    selectedMusicIndex,
    setSelectedMusicIndex,
    presetAudios,
    mVol,
    setMVol,
    mDelay,
    setMDelay,
    mDur,
    setMDur,
    mLoop,
    setMLoop,
    handleQuickAudio,
    selectLocalFiles,
    addMusicPath,
    updateSelectedMusic,
  } = p;

  return (
    <SectionPanel index={3} title="Playlist Nhạc Nền">
      <div className="flex items-center gap-2 text-[11px]">
        <span className="text-slate-300">🎵 Nhạc nhanh (Bấm để thêm):</span>
        <div className="flex gap-1 flex-1">
          {['1', '2', '3', '4'].map((item, index) => (
            <button
              key={item}
              onClick={() => handleQuickAudio(index)}
              title={presetAudios[index] || 'Chua gan file, bam de chon'}
              className="flex-1 bg-orange-600 hover:bg-orange-500 text-white font-bold py-0.5 rounded"
            >
              Audio {item}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-2 mt-1">
        <button
          className="bg-slate-800 border border-slate-700 py-1 px-3 rounded text-[11px] text-slate-200"
          onClick={async () => {
            const paths = await selectLocalFiles('audio', 'Chon nhac nen', true);
            paths.forEach(addMusicPath);
          }}
        >
          [+] Chọn file
        </button>
        <button
          className="bg-red-900/50 hover:bg-red-800 text-red-200 border border-red-900 py-1 px-3 rounded text-[11px]"
          onClick={() => {
            if (musicList.length === 0) return;
            const removeIndex = selectedMusicIndex ?? musicList.length - 1;
            setMusicList(musicList.filter((_: any, index: number) => index !== removeIndex));
            setSelectedMusicIndex(null);
          }}
        >
          [-] Xóa bài
        </button>
      </div>
      <div className="bg-[#020617] border border-slate-700 h-[60px] rounded mt-1 overflow-y-auto">
        {musicList.map((music: any, index: number) => (
          <button
            key={`${music.path}-${index}`}
            onClick={() => {
              setSelectedMusicIndex(index);
              setMVol(music.vol);
              setMDelay(music.delay);
              setMDur(music.dur);
              setMLoop(music.loop);
            }}
            className={`block w-full truncate border-b border-slate-800 p-1 text-left text-[10px] ${
              selectedMusicIndex === index ? 'bg-orange-500 text-black' : 'text-slate-300 hover:bg-slate-900'
            }`}
            title={music.path}
          >
            {index + 1}. {music.path} ({music.vol}% | {music.delay}s | dur {music.dur || '0'} |{' '}
            {music.loop ? 'loop' : 'once'})
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1 mt-1 text-[10px] text-slate-300">
        <span>V:</span>
        <input
          type="number"
          max="200"
          value={mVol}
          onChange={(event) => {
            setMVol(event.target.value);
            updateSelectedMusic({ vol: event.target.value });
          }}
          className="w-10 bg-slate-950 border border-slate-700 rounded px-1 py-1 text-center"
        />
        <span>%</span>
        <span className="ml-1">D:</span>
        <input
          type="number"
          value={mDelay}
          onChange={(event) => {
            setMDelay(event.target.value);
            updateSelectedMusic({ delay: event.target.value });
          }}
          className="w-10 bg-slate-950 border border-slate-700 rounded px-1 py-1 text-center"
        />
        <span>s</span>
        <span className="ml-1">Dur:</span>
        <input
          type="number"
          value={mDur}
          onChange={(event) => {
            setMDur(event.target.value);
            updateSelectedMusic({ dur: event.target.value });
          }}
          className="w-10 bg-slate-950 border border-slate-700 rounded px-1 py-1 text-center"
          title="Thời lượng phát (0 = Phát hết bài)"
        />
        <CustomCheckbox
          checked={mLoop}
          onChange={(value) => {
            setMLoop(value);
            updateSelectedMusic({ loop: value });
          }}
          label="Loop"
          className="text-yellow-500 font-bold ml-1"
        />
      </div>
    </SectionPanel>
  );
}
