'use client';

import React, { useState } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import { useFolderActions } from '../hooks/useFolderActions';
import { useCookieActions } from '../hooks/useCookieActions';
import { useApiKeyActions } from '../hooks/useApiKeyActions';
import {
  Sparkles,
  Plus,
  Minus,
  Key,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  Wifi,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  WifiOff,
  RefreshCw,
  Copy,
  Check,
  Settings,
  Image,
  FileText
} from 'lucide-react';
import TTSConfigModal from './TTSConfigModal';
import MediaConfigModal from './MediaConfigModal';
import ProTranslateSRTModal from './ProTranslateSRTModal';

export default function Header() {
  const store = useNovelStore();
  
  // Custom Hooks để quản lý các sự kiện click
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { handleOpenFolder } = useFolderActions();
  const { isImportingCookie, handleAutoImportCookie, handleAddCookie, handleRemoveCookie } = useCookieActions();
  const { handleAddApiKey, handleRemoveApiKey, handleRemoveMainApiKey } = useApiKeyActions();

  // Trạng thái cục bộ chỉ kiểm soát hiển thị giao diện dropdowns
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [showDriveManager, setShowDriveManager] = useState(false);
  const [showSettingsManager, setShowSettingsManager] = useState(false);
  const [isTTSModalOpen, setIsTTSModalOpen] = useState(false);
  const [isMediaConfigModalOpen, setIsMediaConfigModalOpen] = useState(false);
  const [isSRTModalOpen, setIsSRTModalOpen] = useState(false);
  const [newCookieInput, setNewCookieInput] = useState('');
  const [newApiInput, setNewApiInput] = useState('');

  const [copiedItem, setCopiedItem] = useState<{ type: 'cookie' | 'api', index: number } | null>(null);

  const handleCopy = (text: string, type: 'cookie' | 'api', index: number) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedItem({ type, index });
      setTimeout(() => setCopiedItem(null), 2000);
    }
  };

  return (
    <>
      <header className="sticky top-0 z-50 flex h-16 w-full items-center justify-between border-b border-zinc-900 bg-zinc-950/80 px-6 backdrop-blur-md">
        <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500 text-black shadow-lg shadow-amber-500/20">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-md font-bold tracking-wider text-zinc-100 uppercase">
            AI Novel & Script Generator
          </h1>
          <p className="text-[10px] text-amber-500 uppercase tracking-widest font-semibold">
            Trợ Lý Biên Kịch Mạt Thế v2
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4">

        {/* VIP Status & Credits */}
        <div className="flex items-center gap-2 mr-2">
          {store.is_pro || store.is_vip ? (
            <div className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-yellow-400 to-yellow-600 px-3 py-1 text-xs font-bold uppercase tracking-wider text-black shadow-lg shadow-yellow-500/20">
              <Sparkles className="h-3.5 w-3.5" />
              PRO TIER
            </div>
          ) : (
            <div className="flex items-center gap-1.5 rounded-full border border-amber-900/50 bg-amber-950/20 px-3 py-1 text-xs font-semibold tracking-wider text-amber-500">
              <span>💎 {store.credits} Tín dụng</span>
            </div>
          )}
        </div>

        {/* Nút Tải 1.1.1.1 VPN Bypass Chặn */}
        <a
          href="https://1.1.1.1/"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-orange-500 to-amber-600 px-3.5 py-1 text-xs font-bold uppercase tracking-wider text-black shadow-lg shadow-orange-500/20 hover:scale-105 active:scale-95 transition-all duration-300 cursor-pointer select-none"
          title="Tải ứng dụng Warp 1.1.1.1 để chạy đa luồng cực nhanh và tránh bị Google chặn địa lý hoặc chặn IP."
        >
          ⚡ TẢI 1.1.1.1 VPN
        </a>

        {/* Nút Mở Thư Mục Lưu */}
        <button
          type="button"
          onClick={() => handleOpenFolder('.')}
          className="flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/60 px-3.5 py-1 text-xs font-bold uppercase tracking-wider text-zinc-300 hover:bg-zinc-800 hover:text-white transition-all duration-300 cursor-pointer"
          title="Mở nhanh thư mục dự án cục bộ"
        >
          📁 Mở thư mục lưu
        </button>



        {/* 4 Nút Hành Động Nhanh */}
        <div className="flex items-center gap-2 mr-2">
          <button
            type="button"
            onClick={() => setIsSRTModalOpen(true)}
            className="flex items-center justify-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-3 py-1 text-xs font-bold uppercase tracking-wider text-emerald-400 hover:bg-emerald-500/10 transition-colors cursor-pointer"
          >
            <FileText className="h-3.5 w-3.5" />
            Dịch SRT (PRO)
          </button>
          
          <button
            type="button"
            onClick={() => setIsMediaConfigModalOpen(true)}
            className="flex items-center justify-center gap-1.5 rounded-full border border-indigo-500/20 bg-indigo-500/5 px-3 py-1 text-xs font-bold uppercase tracking-wider text-indigo-400 hover:bg-indigo-500/10 transition-colors cursor-pointer"
          >
            <Image className="h-3.5 w-3.5" />
            Đầu Ra (IMG/VID)
          </button>

          <button
            type="button"
            onClick={() => setIsTTSModalOpen(true)}
            className="flex items-center justify-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/5 px-3 py-1 text-xs font-bold uppercase tracking-wider text-amber-500 hover:bg-amber-500/10 transition-colors cursor-pointer"
          >
            <Settings className="h-3.5 w-3.5" />
            Giọng Đọc (TTS)
          </button>

          <button
            type="button"
            disabled={store.dang_tai || (!store.is_pro && !store.is_vip)}
            onClick={async () => {
              if (!store.is_pro && !store.is_vip) {
                alert('⚠️ Tính năng này yêu cầu nâng cấp gói Pro/VIP!');
                return;
              }
              if (confirm('⚠️ Bạn có chắc chắn muốn xuất kịch bản này ra CapCut (Bao gồm Audio, Video, Ảnh)?')) {
                try {
                  store.setDangTai(true);
                  const res = await fetch('/api/export-capcut', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      chapterNum: store.chuong_dang_chon,
                      ten_tac_pham: store.ten_tac_pham,
                      generatedAudioPaths: store.generatedAudioPaths,
                      generatedImages: store.generatedImages,
                      generatedVideos: store.generatedVideos
                    })
                  });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data.error);
                  alert(`🎉 Đã xuất dự án CapCut thành công!\nĐường dẫn: ${data.projectPath}`);
                } catch (error: any) {
                  alert(`❌ Lỗi xuất CapCut: ${error.message}`);
                } finally {
                  store.setDangTai(false);
                }
              }
            }}
            className="flex items-center justify-center gap-1.5 rounded-full border border-sky-500/40 bg-sky-500/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-sky-400 shadow-lg transition-all duration-300 hover:bg-sky-500 hover:text-black cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed font-sans"
          >
            {store.dang_tai ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ĐANG XUẤT...
              </>
            ) : (
              <>
                ✂️ 1-Click Xuất CapCut
              </>
            )}
          </button>
        </div>

        {/* Cài đặt chung (Cookie & API Keys) */}
        <div className="relative">
          <button
            onClick={() => {
              setShowSettingsManager(!showSettingsManager);
              setShowDriveManager(false);
            }}
            className="flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
          >
            <Settings className="h-3.5 w-3.5" />
            Cài đặt chung
          </button>

          {showSettingsManager && (
            <div className="absolute right-0 mt-2 w-[340px] rounded-xl border border-zinc-800 bg-zinc-950 p-4 shadow-2xl z-50 animate-in slide-in-from-top-2 duration-200 overflow-y-auto max-h-[85vh]">
              <h3 className="mb-4 text-sm font-bold text-zinc-100 uppercase tracking-wide border-b border-zinc-800 pb-2 flex items-center gap-2">
                ⚙️ Cài đặt chung
              </h3>

              {/* Phần 1: Quản lý Cookie */}
              <div className="mb-6">
                <h4 className="text-[10px] font-bold text-amber-500 uppercase mb-3 flex items-center gap-1.5 tracking-wider">
                  <Key className="h-3 w-3" />
                  Cookie AI Studio ({store.googleStudioCookies?.length || 0})
                </h4>
              {/* Nút Trích Xuất Cookie Tự Động */}
              <button
                type="button"
                disabled={isImportingCookie}
                onClick={handleAutoImportCookie}
                className="w-full mb-3 flex items-center justify-center gap-1.5 rounded bg-gradient-to-r from-amber-500 to-orange-600 py-2.5 text-xs font-bold text-black hover:scale-[1.02] active:scale-95 transition-all duration-300 cursor-pointer disabled:opacity-50 select-none font-sans"
              >
                {isImportingCookie ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    ĐANG LẤY COOKIE...
                  </>
                ) : (
                  <>
                    🤖 Lấy Cookie Tự Động (AI Studio)
                  </>
                )}
              </button>
              
              <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                {(store.googleStudioCookies || []).map((cookie, idx) => {
                  const collapsedCookie = cookie.length > 30
                    ? `${cookie.substring(0, 15)}...${cookie.slice(-15)}`
                    : cookie;
                  return (
                    <div key={idx} className="flex items-center justify-between bg-zinc-900/50 rounded border border-zinc-800 p-2 text-xs">
                      <div className="flex flex-col overflow-hidden max-w-[180px]">
                        <span className="text-[9px] text-emerald-500 font-bold uppercase">Luồng {idx + 1}</span>
                        <span className="text-[11px] text-zinc-400 font-mono break-all leading-normal" title={cookie}>{collapsedCookie}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleCopy(cookie, 'cookie', idx)}
                          className="text-zinc-400 hover:text-amber-500 transition-colors p-1.5 rounded hover:bg-zinc-800 cursor-pointer"
                          title="Sao chép Cookie"
                        >
                          {copiedItem?.type === 'cookie' && copiedItem?.index === idx ? (
                            <Check className="h-3.5 w-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <button
                          onClick={() => handleRemoveCookie(idx)}
                          className="text-zinc-500 hover:text-red-500 transition-colors p-1.5 rounded hover:bg-zinc-800 cursor-pointer"
                          title="Xóa luồng này"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
                {(!store.googleStudioCookies || store.googleStudioCookies.length === 0) && (
                  <p className="text-xs text-zinc-500 italic text-center py-2">Chưa có cookie nào.</p>
                )}
              </div>

              <div className="mt-2 text-[10px] text-zinc-400 bg-amber-950/10 border border-amber-950/30 rounded p-2 leading-relaxed">
                💡 <strong>Mẹo:</strong> Để vẽ ảnh AI thật, hãy mở trang <strong>labs.google/fx/tools/flow?from=whisk</strong>, đăng nhập và sao chép chuỗi Cookie ở tab đó thay vì chỉ lấy ở AI Studio nhé!
              </div>

              <div className="mt-4 pt-3 border-t border-zinc-800 flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Dán mã Cookie Studio vào đây..."
                  value={newCookieInput}
                  onChange={(e) => setNewCookieInput(e.target.value)}
                  className="flex-1 h-8 rounded border border-zinc-800 bg-black px-2 text-xs text-zinc-300 outline-none focus:border-amber-500"
                />
                <button
                  onClick={() => {
                    if (newCookieInput.trim()) {
                      handleAddCookie(newCookieInput);
                      setNewCookieInput('');
                    }
                  }}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-amber-500 text-black hover:bg-amber-400 transition-colors"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              </div>

              {/* Phần 2: Quản lý API Keys */}
              {!store.useMock && (
                <div className="pt-4 border-t border-zinc-800">
                  <h4 className="text-[10px] font-bold text-sky-500 uppercase mb-3 flex items-center gap-1.5 tracking-wider">
                    <Key className="h-3 w-3" />
                    API Keys ({(store.apiKeys && store.apiKeys.length > 0) ? store.apiKeys.length : (store.apiKey ? 1 : 0)})
                  </h4>
                <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                  {/* Hiển thị key cũ từ store.apiKey */}
                  {store.apiKey && (!store.apiKeys || store.apiKeys.length === 0) && (
                    <div className="flex items-center justify-between bg-amber-950/20 rounded border border-amber-900/50 p-2 text-xs">
                      <div className="flex flex-col overflow-hidden">
                        <span className="text-[10px] text-amber-500 font-bold uppercase">Key Chính</span>
                        <span className="text-xs text-zinc-400 truncate w-36" title={store.apiKey}>{store.apiKey.substring(0, 15)}...</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleCopy(store.apiKey, 'api', 999)}
                          className="text-zinc-400 hover:text-amber-500 transition-colors p-1.5 rounded hover:bg-zinc-800 cursor-pointer"
                          title="Sao chép API Key"
                        >
                          {copiedItem?.type === 'api' && copiedItem?.index === 999 ? (
                            <Check className="h-3.5 w-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <button
                          onClick={handleRemoveMainApiKey}
                          className="text-zinc-500 hover:text-red-500 transition-colors p-1.5 rounded hover:bg-zinc-800 cursor-pointer"
                          title="Xóa Key này"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                  
                  {/* Hiển thị danh sách apiKeys */}
                  {(store.apiKeys || []).map((key, idx) => (
                    <div key={idx} className="flex items-center justify-between bg-zinc-900/50 rounded border border-zinc-800 p-2 text-xs">
                      <div className="flex flex-col overflow-hidden">
                        <span className="text-[10px] text-emerald-500 font-bold uppercase">Key {idx + 1}</span>
                        <span className="text-xs text-zinc-400 truncate w-36" title={key}>{key.substring(0, 15)}...</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleCopy(key, 'api', idx)}
                          className="text-zinc-400 hover:text-amber-500 transition-colors p-1.5 rounded hover:bg-zinc-800 cursor-pointer"
                          title="Sao chép API Key"
                        >
                          {copiedItem?.type === 'api' && copiedItem?.index === idx ? (
                            <Check className="h-3.5 w-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <button
                          onClick={() => handleRemoveApiKey(idx)}
                          className="text-zinc-500 hover:text-red-500 transition-colors p-1.5 rounded hover:bg-zinc-800 cursor-pointer"
                          title="Xóa Key này"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {(!store.apiKeys || store.apiKeys.length === 0) && !store.apiKey && (
                    <p className="text-xs text-zinc-500 italic text-center py-2">Chưa có API Key nào.</p>
                  )}
                </div>

                <div className="mt-2 text-[10px] text-zinc-400 bg-amber-950/10 border border-amber-950/30 rounded p-2 leading-relaxed">
                  💡 <strong>Mẹo:</strong> Lấy API Key miễn phí tại <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-amber-500 underline hover:text-amber-400">aistudio.google.com</a>. Thêm nhiều Key, hệ thống sẽ <strong>tự động xoay vòng</strong> khi cạn quota.
                </div>

                <div className="mt-4 pt-3 border-t border-zinc-800 flex items-start gap-2">
                  <textarea
                    placeholder="Dán mã Gemini API Key (mỗi key 1 dòng)..."
                    value={newApiInput}
                    onChange={(e) => setNewApiInput(e.target.value)}
                    className="flex-1 h-16 min-h-[40px] max-h-40 rounded border border-zinc-800 bg-black p-2 text-xs text-zinc-300 outline-none focus:border-amber-500 resize-y font-mono"
                  />
                  <button
                    onClick={() => {
                      if (newApiInput.trim()) {
                        const keys = newApiInput.split('\n').map(k => k.trim()).filter(k => k);
                        keys.forEach(k => handleAddApiKey(k));
                        setNewApiInput('');
                      }
                    }}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-amber-500 text-black hover:bg-amber-400 transition-colors mt-1"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      </header>
      {/* Modals from Sidebar */}
      <TTSConfigModal isOpen={isTTSModalOpen} onClose={() => setIsTTSModalOpen(false)} />
      <MediaConfigModal isOpen={isMediaConfigModalOpen} onClose={() => setIsMediaConfigModalOpen(false)} />
      <ProTranslateSRTModal isOpen={isSRTModalOpen} onClose={() => setIsSRTModalOpen(false)} />
    </>
  );
}
