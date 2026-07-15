'use client';

import React from 'react';
import {
  FolderOpen,
  Loader2,
  MonitorPlay,
  FileAudio,
  Mic2,
  Shield,
  Scissors,
  Upload,
  Download,
} from 'lucide-react';
import {
  DOWNLOAD_MODES,
  DOWNLOAD_PLATFORMS,
  type DownloadMode,
  type DownloadPlatformId,
} from '../../download';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type NavToolFormsProps = Record<string, any>;

/**
 * Toàn bộ form 6 tool NavTools — state/handlers inject từ NavToolsPanel.
 * Tách UI khỏi shell modal (header/menu/log).
 */
export default function NavToolForms(p: NavToolFormsProps) {
  const {
    activeTool,
    processing,
    subtitleVideoPath, setSubtitleVideoPath,
    subtitleOutputPath, setSubtitleOutputPath,
    subtitleModel, setSubtitleModel,
    subtitleLanguage, setSubtitleLanguage,
    handleSelectSubtitleVideo, handleSelectSubtitleOutputDir, runSubtitle,
    mediaPath, setMediaPath,
    audioOutputDir, setAudioOutputDir,
    language, setLanguage,
    handleSelectMediaPath, handleSelectAudioOutputDir,
    runAudioTool,
    watermarkMode, setWatermarkMode,
    splitDuration, setSplitDuration,
    downloadPlatform, setDownloadPlatform,
    downloadType, setDownloadType,
    downloadInput, setDownloadInput,
    downloadCount, setDownloadCount,
    downloadOutputDir, setDownloadOutputDir,
    handleImportDownloadInput, handleSelectDownloadOutputDir, runDownload,
  } = p;

  return (
    <>
              {activeTool === 'whisper_sub' && (
                <div className="space-y-4 max-w-2xl">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Đường dẫn file video (Mỗi dòng 1 file)</label>
                      <button onClick={handleSelectSubtitleVideo} className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300 cursor-pointer">
                        <FolderOpen className="h-4 w-4" /> Chọn file video
                      </button>
                    </div>
                    <textarea
                      value={subtitleVideoPath}
                      onChange={(e) => setSubtitleVideoPath(e.target.value)}
                      placeholder="Ví dụ: D:\Videos\movie.mp4&#10;Chọn 1 hoặc nhiều video để xử lý hàng loạt..."
                      className="h-24 w-full rounded border border-zinc-800 bg-black/60 p-3 text-xs text-zinc-200 outline-none focus:border-emerald-500 font-mono"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Thư mục xuất file (.srt)</label>
                      <button onClick={handleSelectSubtitleOutputDir} className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300 cursor-pointer">
                        <FolderOpen className="h-4 w-4" /> Chọn thư mục lưu
                      </button>
                    </div>
                    <input
                      value={subtitleOutputPath}
                      onChange={(e) => setSubtitleOutputPath(e.target.value)}
                      placeholder="Mặc định lưu cùng thư mục chứa video gốc..."
                      className="w-full rounded border border-zinc-800 bg-black/60 px-3 py-2.5 text-xs text-zinc-200 outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400 font-sans">Whisper Model</label>
                      <select
                        value={subtitleModel}
                        onChange={(e) => setSubtitleModel(e.target.value)}
                        className="w-full rounded border border-zinc-800 bg-black/60 px-3 py-2.5 text-xs text-zinc-200 outline-none focus:border-emerald-500"
                      >
                        <option value="tiny">Tiny (Rất nhanh)</option>
                        <option value="base">Base (Nhanh)</option>
                        <option value="small">Small (Khuyên dùng - Cân bằng)</option>
                        <option value="medium">Medium (Chính xác cao)</option>
                        <option value="large">Large (Chính xác tối đa)</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400 font-sans">Ngôn Ngữ</label>
                      <select
                        value={subtitleLanguage}
                        onChange={(e) => setSubtitleLanguage(e.target.value)}
                        className="w-full rounded border border-zinc-800 bg-black/60 px-3 py-2.5 text-xs text-zinc-200 outline-none focus:border-emerald-500"
                      >
                        <option value="auto">Tự động phát hiện (Auto)</option>
                        <option value="vi">Tiếng Việt (Vietnamese)</option>
                        <option value="en">Tiếng Anh (English)</option>
                        <option value="zh">Tiếng Trung (Chinese)</option>
                      </select>
                    </div>
                  </div>

                  <button onClick={runSubtitle} disabled={processing} className="flex w-full items-center justify-center gap-2 rounded bg-emerald-500 py-3 text-xs font-bold text-black hover:bg-emerald-400 disabled:opacity-50 cursor-pointer shadow-lg shadow-emerald-500/15">
                    {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <MonitorPlay className="h-4 w-4" />}
                    {processing ? 'ĐANG TIẾN HÀNH TRÍCH XUẤT...' : 'BẮT ĐẦU TẠO PHỤ ĐỀ (.SRT)'}
                  </button>
                </div>
              )}

              {/* 2. Form Tách Giọng / Nhạc Nền */}
              {activeTool === 'isolate_vocals' && (
                <div className="space-y-4 max-w-2xl">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Đường dẫn file âm thanh/video (Mỗi dòng 1 file)</label>
                      <button onClick={handleSelectMediaPath} className="flex items-center gap-1.5 text-xs font-semibold text-violet-400 hover:text-violet-300 cursor-pointer">
                        <FolderOpen className="h-4 w-4" /> Chọn file media
                      </button>
                    </div>
                    <textarea
                      value={mediaPath}
                      onChange={(e) => setMediaPath(e.target.value)}
                      placeholder="Ví dụ: D:\Audio\song.mp3&#10;Hỗ trợ xử lý hàng loạt nhiều file..."
                      className="h-24 w-full rounded border border-zinc-800 bg-black/60 p-3 text-xs text-zinc-200 outline-none focus:border-violet-500 font-mono"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Thư mục xuất file kết quả</label>
                      <button onClick={handleSelectAudioOutputDir} className="flex items-center gap-1.5 text-xs font-semibold text-violet-400 hover:text-violet-300 cursor-pointer">
                        <FolderOpen className="h-4 w-4" /> Chọn thư mục lưu
                      </button>
                    </div>
                    <input
                      value={audioOutputDir}
                      onChange={(e) => setAudioOutputDir(e.target.value)}
                      placeholder="Mặc định lưu cùng thư mục chứa file gốc..."
                      className="w-full rounded border border-zinc-800 bg-black/60 px-3 py-2.5 text-xs text-zinc-200 outline-none focus:border-violet-500"
                    />
                  </div>

                  <button onClick={runAudioTool('isolate')} disabled={processing} className="flex w-full items-center justify-center gap-2 rounded bg-violet-500 py-3 text-xs font-bold text-black hover:bg-violet-400 disabled:opacity-50 cursor-pointer shadow-lg shadow-violet-500/15">
                    {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileAudio className="h-4 w-4" />}
                    {processing ? 'ĐANG TÁCH GIỌNG BẰNG AI...' : 'BẮT ĐẦU TÁCH GIỌNG & NHẠC NỀN'}
                  </button>
                </div>
              )}

              {/* 3. Form Nhận Diện Phụ Đề */}
              {activeTool === 'transcribe_sub' && (
                <div className="space-y-4 max-w-2xl">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Đường dẫn file âm thanh/video (Mỗi dòng 1 file)</label>
                      <button onClick={handleSelectMediaPath} className="flex items-center gap-1.5 text-xs font-semibold text-amber-400 hover:text-amber-300 cursor-pointer">
                        <FolderOpen className="h-4 w-4" /> Chọn file media
                      </button>
                    </div>
                    <textarea
                      value={mediaPath}
                      onChange={(e) => setMediaPath(e.target.value)}
                      placeholder="Ví dụ: D:\Audio\speech.wav..."
                      className="h-24 w-full rounded border border-zinc-800 bg-black/60 p-3 text-xs text-zinc-200 outline-none focus:border-amber-500 font-mono"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400">Ngôn ngữ nguồn</label>
                      <input
                        value={language}
                        onChange={(e) => setLanguage(e.target.value)}
                        placeholder="vi, en, zh..."
                        className="w-full rounded border border-zinc-800 bg-black/60 px-3 py-2.5 text-xs text-zinc-200 outline-none focus:border-amber-500"
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Thư mục xuất file</label>
                        <button onClick={handleSelectAudioOutputDir} className="flex items-center gap-1.5 text-xs font-semibold text-amber-400 hover:text-amber-300 cursor-pointer">
                          <FolderOpen className="h-4 w-4" /> Chọn thư mục
                        </button>
                      </div>
                      <input
                        value={audioOutputDir}
                        onChange={(e) => setAudioOutputDir(e.target.value)}
                        placeholder="Mặc định lưu cùng thư mục file gốc..."
                        className="w-full rounded border border-zinc-800 bg-black/60 px-3 py-2.5 text-xs text-zinc-200 outline-none focus:border-amber-500"
                      />
                    </div>
                  </div>

                  <button onClick={runAudioTool('transcribe')} disabled={processing} className="flex w-full items-center justify-center gap-2 rounded bg-amber-500 py-3 text-xs font-bold text-black hover:bg-amber-400 disabled:opacity-50 cursor-pointer shadow-lg shadow-amber-500/15">
                    {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic2 className="h-4 w-4" />}
                    {processing ? 'ĐANG NHẬN DIỆN VĂN BẢN...' : 'BẮT ĐẦU NHẬN DIỆN PHỤ ĐỀ'}
                  </button>
                </div>
              )}

              {/* 4. Form Nhúng Watermark Ẩn */}
              {activeTool === 'watermark' && (
                <div className="space-y-4 max-w-2xl">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Đường dẫn file âm thanh cần nhúng (Mỗi dòng 1 file)</label>
                      <button onClick={handleSelectMediaPath} className="flex items-center gap-1.5 text-xs font-semibold text-sky-400 hover:text-sky-300 cursor-pointer">
                        <FolderOpen className="h-4 w-4" /> Chọn file audio
                      </button>
                    </div>
                    <textarea
                      value={mediaPath}
                      onChange={(e) => setMediaPath(e.target.value)}
                      placeholder="Ví dụ: D:\Audio\music.wav..."
                      className="h-24 w-full rounded border border-zinc-800 bg-black/60 p-3 text-xs text-zinc-200 outline-none focus:border-sky-500 font-mono"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400">Chế độ đóng dấu</label>
                      <select
                        value={watermarkMode}
                        onChange={(e) => setWatermarkMode(e.target.value as 'embed' | 'detect')}
                        className="w-full rounded border border-zinc-800 bg-black/60 px-3 py-2.5 text-xs text-zinc-200 outline-none focus:border-sky-500"
                      >
                        <option value="embed">Nhúng bản quyền ẩn (Embed watermark)</option>
                        <option value="detect">Quét/Phát hiện bản quyền ẩn (Detect watermark)</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Thư mục đầu ra</label>
                        <button onClick={handleSelectAudioOutputDir} className="flex items-center gap-1.5 text-xs font-semibold text-sky-400 hover:text-sky-300 cursor-pointer">
                          <FolderOpen className="h-4 w-4" /> Chọn thư mục
                        </button>
                      </div>
                      <input
                        value={audioOutputDir}
                        onChange={(e) => setAudioOutputDir(e.target.value)}
                        placeholder="Mặc định lưu cùng thư mục file gốc..."
                        className="w-full rounded border border-zinc-800 bg-black/60 px-3 py-2.5 text-xs text-zinc-200 outline-none focus:border-sky-500"
                      />
                    </div>
                  </div>

                  <button onClick={runAudioTool('watermark')} disabled={processing} className="flex w-full items-center justify-center gap-2 rounded bg-sky-500 py-3 text-xs font-bold text-black hover:bg-sky-400 disabled:opacity-50 cursor-pointer shadow-lg shadow-sky-500/15">
                    {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
                    {processing ? 'ĐANG TIẾN HÀNH XỬ LÝ WATERMARK...' : 'BẮT ĐẦU CHẠY WATERMARK'}
                  </button>
                </div>
              )}

              {/* 5. Form Cắt Video Theo Cảnh */}
              {activeTool === 'split_video' && (
                <div className="space-y-4 max-w-2xl">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Đường dẫn video cần cắt (Mỗi dòng 1 file)</label>
                      <button onClick={handleSelectMediaPath} className="flex items-center gap-1.5 text-xs font-semibold text-rose-400 hover:text-rose-300 cursor-pointer">
                        <FolderOpen className="h-4 w-4" /> Chọn file video
                      </button>
                    </div>
                    <textarea
                      value={mediaPath}
                      onChange={(e) => setMediaPath(e.target.value)}
                      placeholder="Ví dụ: D:\Videos\movie.mp4..."
                      className="h-24 w-full rounded border border-zinc-800 bg-black/60 p-3 text-xs text-zinc-200 outline-none focus:border-rose-500 font-mono"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400">Thời lượng mỗi đoạn (Giây)</label>
                      <input
                        value={splitDuration}
                        onChange={(e) => setSplitDuration(e.target.value)}
                        placeholder="Ví dụ: 30"
                        className="w-full rounded border border-zinc-800 bg-black/60 px-3 py-2.5 text-xs text-zinc-200 outline-none focus:border-rose-500"
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Thư mục đầu ra</label>
                        <button onClick={handleSelectAudioOutputDir} className="flex items-center gap-1.5 text-xs font-semibold text-rose-400 hover:text-rose-300 cursor-pointer">
                          <FolderOpen className="h-4 w-4" /> Chọn thư mục
                        </button>
                      </div>
                      <input
                        value={audioOutputDir}
                        onChange={(e) => setAudioOutputDir(e.target.value)}
                        placeholder="Mặc định lưu cùng thư mục file gốc..."
                        className="w-full rounded border border-zinc-800 bg-black/60 px-3 py-2.5 text-xs text-zinc-200 outline-none focus:border-rose-500"
                      />
                    </div>
                  </div>

                  <button onClick={runAudioTool('split')} disabled={processing} className="flex w-full items-center justify-center gap-2 rounded bg-rose-500 py-3 text-xs font-bold text-black hover:bg-rose-400 disabled:opacity-50 cursor-pointer shadow-lg shadow-rose-500/15">
                    {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scissors className="h-4 w-4" />}
                    {processing ? 'ĐANG TIẾN HÀNH CẮT VIDEO...' : 'BẮT ĐẦU CẮT VIDEO'}
                  </button>
                </div>
              )}

              {/* 6. Form Tải Video (Crawler) */}
              {activeTool === 'download_video' && (
                <div className="space-y-4 max-w-2xl">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400">Nền tảng mạng xã hội</label>
                      <select
                        value={downloadPlatform}
                        onChange={(e) => setDownloadPlatform(e.target.value as DownloadPlatformId)}
                        className="w-full rounded border border-zinc-800 bg-black/60 px-3 py-2.5 text-xs text-zinc-200 outline-none focus:border-indigo-500"
                      >
                        {DOWNLOAD_PLATFORMS.map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400">Kiểu tải</label>
                      <select
                        value={downloadType}
                        onChange={(e) => setDownloadType(e.target.value as DownloadMode)}
                        className="w-full rounded border border-zinc-800 bg-black/60 px-3 py-2.5 text-xs text-zinc-200 outline-none focus:border-indigo-500"
                      >
                        {DOWNLOAD_MODES.map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Nhập link hoặc từ khóa (mỗi dòng 1 mục)</label>
                      <button onClick={handleImportDownloadInput} className="flex items-center gap-1.5 text-xs font-semibold text-indigo-400 hover:text-indigo-300 cursor-pointer">
                        <Upload className="h-4 w-4" /> Nhập từ file text
                      </button>
                    </div>
                    <textarea
                      value={downloadInput}
                      onChange={(e) => setDownloadInput(e.target.value)}
                      placeholder="Ví dụ: nhac thien mạt the&#10;https://www.youtube.com/watch?v=...&#10;Hỗ trợ tải hàng loạt..."
                      className="h-24 w-full rounded border border-zinc-800 bg-black/60 p-3 text-xs text-zinc-200 outline-none focus:border-indigo-500 font-mono"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400">Số lượng tải tối đa</label>
                      <input
                        value={downloadCount}
                        onChange={(e) => setDownloadCount(e.target.value)}
                        placeholder="Mặc định: 10"
                        className="w-full rounded border border-zinc-800 bg-black/60 px-3 py-2.5 text-xs text-zinc-200 outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">Thư mục lưu video tải</label>
                        <button onClick={handleSelectDownloadOutputDir} className="flex items-center gap-1.5 text-xs font-semibold text-indigo-400 hover:text-indigo-300 cursor-pointer">
                          <FolderOpen className="h-4 w-4" /> Chọn thư mục
                        </button>
                      </div>
                      <input
                        value={downloadOutputDir}
                        onChange={(e) => setDownloadOutputDir(e.target.value)}
                        placeholder="Mặc định lưu vào public/downloads..."
                        className="w-full rounded border border-zinc-800 bg-black/60 px-3 py-2.5 text-xs text-zinc-200 outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>

                  <button onClick={runDownload} disabled={processing} className="flex w-full items-center justify-center gap-2 rounded bg-indigo-500 py-3 text-xs font-bold text-black hover:bg-indigo-400 disabled:opacity-50 cursor-pointer shadow-lg shadow-indigo-500/15">
                    {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    {processing ? 'ĐANG TIẾN HÀNH TẢI VIDEO...' : 'BẮT ĐẦU TẢI VIDEO'}
                  </button>
                </div>
              )}
    </>
  );
}
