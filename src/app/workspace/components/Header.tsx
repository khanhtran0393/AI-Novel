'use client';

import React, { useState, useEffect } from 'react';
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
  FileText,
  Briefcase
} from 'lucide-react';
import TTSConfigModal from './TTSConfigModal';
import MediaConfigModal from './MediaConfigModal';
import ProTranslateSRTModal from './ProTranslateSRTModal';
import NavToolsPanel from './NavToolsPanel';
import VideoEditorModal from './VideoEditorModal';
import AutoRenderModal from './AutoRenderModal';

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
  const [isNavToolsOpen, setIsNavToolsOpen] = useState(false);
  const [isVideoEditorOpen, setIsVideoEditorOpen] = useState(false);
  const [isAutoRenderOpen, setIsAutoRenderOpen] = useState(false);
  const [showToolsDropdown, setShowToolsDropdown] = useState(false);
  const [newCookieInput, setNewCookieInput] = useState('');
  const [newApiInput, setNewApiInput] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<'gemini' | 'openai' | 'grok' | 'luma' | 'runway' | 'falai'>('gemini');

  const [copiedItem, setCopiedItem] = useState<{ type: 'cookie' | 'api', index: number } | null>(null);

  const [systemInfo, setSystemInfo] = useState<any>(null);
  const [isLoadingSysInfo, setIsLoadingSysInfo] = useState(false);
  const [installerStatus, setInstallerStatus] = useState<any>({ status: 'idle', progress: 0 });

  const fetchSystemInfo = async () => {
    setIsLoadingSysInfo(true);
    try {
      const res = await fetch('/api/system-info');
      if (res.ok) {
        const data = await res.json();
        setSystemInfo(data);
        if (data.installStatus) {
          setInstallerStatus(data.installStatus);
        }
      }
    } catch (err) {
      console.error('Lỗi tải system info:', err);
    } finally {
      setIsLoadingSysInfo(false);
    }
  };

  const handleStartGpuInstall = async () => {
    try {
      setInstallerStatus({ status: 'installing', progress: 5, message: 'Đang khởi động...' });
      const vendor = systemInfo?.gpu?.vendor || 'nvidia';
      const res = await fetch('/api/system-info/install-gpu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendor })
      });
      if (!res.ok) {
        const data = await res.json();
        alert(`❌ Lỗi cài đặt: ${data.error}`);
      }
    } catch (err: any) {
      alert(`❌ Lỗi kết nối: ${err.message}`);
    }
  };

  useEffect(() => {
    let interval: any;
    if (installerStatus?.status === 'installing') {
      interval = setInterval(async () => {
        try {
          const res = await fetch('/api/system-info/install-status');
          if (res.ok) {
            const data = await res.json();
            setInstallerStatus(data);
            if (data.status !== 'installing') {
              fetchSystemInfo();
            }
          }
        } catch {}
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [installerStatus?.status]);

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
          {/* Dropdown Bộ Công Cụ Nâng Cao */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowToolsDropdown(!showToolsDropdown)}
              className="flex items-center justify-center gap-1.5 rounded-full border border-sky-500/20 bg-sky-500/5 px-3.5 py-1 text-xs font-bold uppercase tracking-wider text-sky-400 hover:bg-sky-500/10 transition-colors cursor-pointer"
            >
              <Briefcase className="h-3.5 w-3.5" />
              BỘ CÔNG CỤ (PRO)
            </button>
            
            {showToolsDropdown && (
              <div className="absolute left-0 mt-2 w-[220px] rounded-xl border border-zinc-800 bg-zinc-950 p-2 shadow-2xl z-50 animate-in slide-in-from-top-2 duration-200">
                <button
                  type="button"
                  onClick={() => {
                    setIsNavToolsOpen(true);
                    setShowToolsDropdown(false);
                  }}
                  className="w-full text-left rounded-lg px-3 py-2 text-xs font-bold text-zinc-300 hover:bg-zinc-900 hover:text-white transition-colors cursor-pointer flex items-center gap-2"
                >
                  💼 6 Công Cụ Media & Crawler
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsVideoEditorOpen(true);
                    setShowToolsDropdown(false);
                  }}
                  className="w-full text-left rounded-lg px-3 py-2 text-xs font-bold text-zinc-300 hover:bg-zinc-900 hover:text-white transition-colors cursor-pointer flex items-center gap-2"
                >
                  🎬 Video Editor Chuyên Nghiệp
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsAutoRenderOpen(true);
                    setShowToolsDropdown(false);
                  }}
                  className="w-full text-left rounded-lg px-3 py-2 text-xs font-bold text-zinc-300 hover:bg-zinc-900 hover:text-white transition-colors cursor-pointer flex items-center gap-2"
                >
                  ⚡ Auto Render Hàng Loạt
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsSRTModalOpen(true);
                    setShowToolsDropdown(false);
                  }}
                  className="w-full text-left rounded-lg px-3 py-2 text-xs font-bold text-zinc-300 hover:bg-zinc-900 hover:text-white transition-colors cursor-pointer flex items-center gap-2"
                >
                  📄 Dịch SRT Nâng Cao (PRO)
                </button>
              </div>
            )}
          </div>
          
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
              const nextVal = !showSettingsManager;
              setShowSettingsManager(nextVal);
              setShowDriveManager(false);
              if (nextVal) {
                fetchSystemInfo();
              }
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
              <div className="pt-4 border-t border-zinc-800">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-[10px] font-bold text-sky-500 uppercase flex items-center gap-1.5 tracking-wider">
                    <Key className="h-3 w-3" />
                    API Keys ({(() => {
                      switch (selectedProvider) {
                        case 'openai': return (store.openaiApiKeys?.length || 0) > 0 ? store.openaiApiKeys.length : (store.openaiApiKey ? 1 : 0);
                        case 'grok': return (store.grokApiKeys?.length || 0) > 0 ? store.grokApiKeys.length : (store.grokApiKey ? 1 : 0);
                        case 'luma': return (store.lumaApiKeys?.length || 0) > 0 ? store.lumaApiKeys.length : (store.lumaApiKey ? 1 : 0);
                        case 'runway': return (store.runwayApiKeys?.length || 0) > 0 ? store.runwayApiKeys.length : (store.runwayApiKey ? 1 : 0);
                        case 'falai': return (store.falaiApiKeys?.length || 0) > 0 ? store.falaiApiKeys.length : (store.falaiApiKey ? 1 : 0);
                        case 'gemini':
                        default: return (store.apiKeys?.length || 0) > 0 ? store.apiKeys.length : (store.apiKey ? 1 : 0);
                      }
                    })()})
                  </h4>
                  {/* Dropdown chọn nhà cung cấp */}
                  <select
                    value={selectedProvider}
                    onChange={(e: any) => setSelectedProvider(e.target.value)}
                    className="rounded border border-zinc-800 bg-black px-2 py-0.5 text-[10px] font-bold text-zinc-300 outline-none focus:border-amber-500 cursor-pointer"
                  >
                    <option value="gemini">Google Gemini</option>
                    <option value="openai">OpenAI</option>
                    <option value="grok">Groq / Grok</option>
                    <option value="falai">Fal.ai (Flux)</option>
                    <option value="luma">Luma AI</option>
                    <option value="runway">Runway AI</option>
                  </select>
                </div>

                {(() => {
                  const getProviderConfig = () => {
                    switch (selectedProvider) {
                      case 'openai':
                        return {
                          keys: store.openaiApiKeys || [],
                          mainKey: store.openaiApiKey || '',
                          setKeys: store.setOpenaiApiKeys,
                          setMainKey: store.setOpenaiApiKey,
                          label: 'OpenAI Keys',
                          placeholder: 'Dán mã OpenAI API Key (mỗi key 1 dòng)...',
                          hint: 'Lấy API Key tại platform.openai.com. Hỗ trợ xoay vòng.',
                        };
                      case 'grok':
                        return {
                          keys: store.grokApiKeys || [],
                          mainKey: store.grokApiKey || '',
                          setKeys: store.setGrokApiKeys,
                          setMainKey: store.setGrokApiKey,
                          label: 'Groq / Grok Keys',
                          placeholder: 'Dán mã Groq hoặc Grok API Key (mỗi key 1 dòng)...',
                          hint: 'Dùng cho Llama 3.3 (Groq) hoặc Grok-2 (xAI).',
                        };
                      case 'luma':
                        return {
                          keys: store.lumaApiKeys || [],
                          mainKey: store.lumaApiKey || '',
                          setKeys: store.setLumaApiKeys,
                          setMainKey: store.setLumaApiKey,
                          label: 'Luma Keys',
                          placeholder: 'Dán mã Luma AI API Key (mỗi key 1 dòng)...',
                          hint: 'Dùng sinh video nội suy chuyển cảnh qua Luma API.',
                        };
                      case 'runway':
                        return {
                          keys: store.runwayApiKeys || [],
                          mainKey: store.runwayApiKey || '',
                          setKeys: store.setRunwayApiKeys,
                          setMainKey: store.setRunwayApiKey,
                          label: 'Runway Keys',
                          placeholder: 'Dán mã Runway API Key (mỗi key 1 dòng)...',
                          hint: 'Dùng sinh video chất lượng cao qua Runway Gen-3.',
                        };
                      case 'falai':
                        return {
                          keys: store.falaiApiKeys || [],
                          mainKey: store.falaiApiKey || '',
                          setKeys: store.setFalaiApiKeys,
                          setMainKey: store.setFalaiApiKey,
                          label: 'Fal.ai Keys',
                          placeholder: 'Dán mã Fal.ai API Key (mỗi key 1 dòng)...',
                          hint: 'Dùng sinh ảnh nghệ thuật Flux.1 siêu nhanh qua Fal.ai.',
                        };
                      case 'gemini':
                      default:
                        return {
                          keys: store.apiKeys || [],
                          mainKey: store.apiKey || '',
                          setKeys: store.setApiKeys,
                          setMainKey: store.setApiKey,
                          label: 'Gemini Keys',
                          placeholder: 'Dán mã Gemini API Key (mỗi key 1 dòng)...',
                          hint: 'Lấy API Key tại aistudio.google.com. Hỗ trợ xoay vòng.',
                        };
                    }
                  };

                  const config = getProviderConfig();

                  return (
                    <>
                      <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                        {/* Hiển thị key chính khi keys trống */}
                        {config.mainKey && config.keys.length === 0 && (
                          <div className="flex items-center justify-between bg-amber-950/20 rounded border border-amber-900/50 p-2 text-xs">
                            <div className="flex flex-col overflow-hidden">
                              <span className="text-[10px] text-amber-500 font-bold uppercase">Key Chính</span>
                              <span className="text-xs text-zinc-400 truncate w-36" title={config.mainKey}>
                                {config.mainKey.substring(0, 15)}...
                              </span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={() => handleCopy(config.mainKey, 'api', 999)}
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
                                onClick={() => config.setMainKey('')}
                                className="text-zinc-500 hover:text-red-500 transition-colors p-1.5 rounded hover:bg-zinc-800 cursor-pointer"
                                title="Xóa Key này"
                              >
                                <Minus className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Hiển thị danh sách keys */}
                        {config.keys.map((key, idx) => (
                          <div key={idx} className="flex items-center justify-between bg-zinc-900/50 rounded border border-zinc-800 p-2 text-xs">
                            <div className="flex flex-col overflow-hidden">
                              <span className="text-[10px] text-emerald-500 font-bold uppercase">Key {idx + 1}</span>
                              <span className="text-xs text-zinc-400 truncate w-36" title={key}>
                                {key.substring(0, 15)}...
                              </span>
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
                                onClick={() => {
                                  const remaining = config.keys.filter((_, i) => i !== idx);
                                  config.setKeys(remaining);
                                  if (config.mainKey === key) {
                                    config.setMainKey(remaining[0] || '');
                                  }
                                }}
                                className="text-zinc-500 hover:text-red-500 transition-colors p-1.5 rounded hover:bg-zinc-800 cursor-pointer"
                                title="Xóa Key này"
                              >
                                <Minus className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                        {config.keys.length === 0 && !config.mainKey && (
                          <p className="text-xs text-zinc-500 italic text-center py-2">Chưa có API Key nào.</p>
                        )}
                      </div>

                      <div className="mt-2 text-[10px] text-zinc-400 bg-amber-950/10 border border-amber-950/30 rounded p-2 leading-relaxed">
                        💡 <strong>Mẹo:</strong> {config.hint}
                      </div>

                      <div className="mt-4 pt-3 border-t border-zinc-800 flex items-start gap-2">
                        <textarea
                          placeholder={config.placeholder}
                          value={newApiInput}
                          onChange={(e) => setNewApiInput(e.target.value)}
                          className="flex-1 h-16 min-h-[40px] max-h-40 rounded border border-zinc-800 bg-black p-2 text-xs text-zinc-300 outline-none focus:border-amber-500 resize-y font-mono"
                        />
                        <button
                          onClick={() => {
                            if (newApiInput.trim()) {
                              const inputKeys = newApiInput.split('\n').map(k => k.trim()).filter(Boolean);
                              const currentKeys = config.keys;
                              const uniqueNewKeys = inputKeys.filter(k => !currentKeys.includes(k));
                              if (uniqueNewKeys.length > 0) {
                                const nextKeys = [...currentKeys, ...uniqueNewKeys];
                                config.setKeys(nextKeys);
                                if (!config.mainKey) {
                                  config.setMainKey(nextKeys[0]);
                                }
                              }
                              setNewApiInput('');
                            }
                          }}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-amber-500 text-black hover:bg-amber-400 transition-colors mt-1"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* Phần 3: Tăng tốc phần cứng (GPU) */}
              <div className="pt-4 mt-4 border-t border-zinc-800">
                <h4 className="text-[10px] font-bold text-emerald-500 uppercase mb-3 flex items-center gap-1.5 tracking-wider">
                  🖥️ Tăng tốc phần cứng (GPU)
                </h4>
                
                {isLoadingSysInfo && !systemInfo ? (
                  <div className="flex items-center justify-center gap-2 py-4">
                    <RefreshCw className="h-4 w-4 animate-spin text-emerald-500" />
                    <span className="text-xs text-zinc-400">Đang quét cấu hình máy...</span>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Thông tin GPU */}
                    <div className="bg-zinc-900/40 rounded border border-zinc-800 p-2.5 text-xs">
                      <div className="flex justify-between items-start mb-1.5">
                        <span className="text-zinc-400 font-medium">Card đồ họa:</span>
                        <span className="text-zinc-200 font-bold text-right max-w-[180px] truncate" title={systemInfo?.gpu?.name || 'Đang quét...'}>
                          {systemInfo?.gpu?.name || 'Đang quét...'}
                        </span>
                      </div>
                      {systemInfo?.gpu?.hasNvidia && (
                        <div className="flex justify-between items-center text-[10px] text-zinc-500">
                          <span>Dung lượng RAM GPU:</span>
                          <span className="text-zinc-400 font-mono">{systemInfo?.gpu?.ram || 'N/A'}</span>
                        </div>
                      )}
                    </div>

                    {/* Trạng thái các thư viện tăng tốc */}
                    <div className="space-y-2">
                      {/* 1. PyTorch / DirectML GPU Acceleration */}
                      <div className="flex items-center justify-between text-xs bg-zinc-950/60 p-2 rounded border border-zinc-900">
                        <div className="flex flex-col">
                          <span className="font-semibold text-zinc-300">Tăng tốc tính toán (PyTorch / DirectML)</span>
                          <span className="text-[10px] text-zinc-500 font-sans">
                            {systemInfo?.python?.torchVersion ? `Bản hiện tại: ${systemInfo.python.torchVersion}` : 'Chưa quét'}
                          </span>
                        </div>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                          (systemInfo?.python?.cudaAvailable || systemInfo?.python?.directmlAvailable)
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                        }`}>
                          {systemInfo?.python?.cudaAvailable ? 'CUDA Enabled' :
                           systemInfo?.python?.directmlAvailable ? 'DirectML Enabled' : 'CPU (Chậm)'}
                        </span>
                      </div>

                      {/* 2. ONNX Runtime GPU */}
                      <div className="flex items-center justify-between text-xs bg-zinc-950/60 p-2 rounded border border-zinc-900">
                        <div className="flex flex-col">
                          <span className="font-semibold text-zinc-300">ONNX GPU (Tách ảnh & RemBG)</span>
                          <span className="text-[10px] text-zinc-500 font-mono text-ellipsis overflow-hidden w-40 truncate">
                            {systemInfo?.python?.onnxProviders?.join(', ') || 'Chưa kiểm tra'}
                          </span>
                        </div>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                          (systemInfo?.python?.onnxProviders?.includes('CUDAExecutionProvider') || systemInfo?.python?.onnxProviders?.includes('DmlExecutionProvider'))
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                        }`}>
                          {(systemInfo?.python?.onnxProviders?.includes('CUDAExecutionProvider') || systemInfo?.python?.onnxProviders?.includes('DmlExecutionProvider')) ? 'GPU (Nhanh)' : 'CPU'}
                        </span>
                      </div>

                      {/* 3. FFmpeg GPU Video */}
                      <div className="flex items-center justify-between text-xs bg-zinc-950/60 p-2 rounded border border-zinc-900">
                        <div className="flex flex-col">
                          <span className="font-semibold text-zinc-300">FFmpeg GPU (Render Video)</span>
                          <span className="text-[10px] text-zinc-500">
                            {systemInfo?.ffmpeg?.nvencSupported ? 'Nvidia NVENC' :
                             systemInfo?.ffmpeg?.amfSupported ? 'AMD AMF' :
                             systemInfo?.ffmpeg?.qsvSupported ? 'Intel QSV' : 'Chưa hỗ trợ'}
                          </span>
                        </div>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                          (systemInfo?.ffmpeg?.nvencSupported || systemInfo?.ffmpeg?.amfSupported || systemInfo?.ffmpeg?.qsvSupported)
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                        }`}>
                          {(systemInfo?.ffmpeg?.nvencSupported || systemInfo?.ffmpeg?.amfSupported || systemInfo?.ffmpeg?.qsvSupported) ? 'Hỗ trợ' : 'Không'}
                        </span>
                      </div>
                    </div>

                    {/* Tùy chọn bật/tắt tăng tốc FFmpeg */}
                    {(systemInfo?.ffmpeg?.nvencSupported || systemInfo?.ffmpeg?.amfSupported || systemInfo?.ffmpeg?.qsvSupported) && (
                      <div className="flex items-center justify-between p-2 rounded bg-emerald-950/10 border border-emerald-900/30">
                        <span className="text-xs text-zinc-300 font-semibold">Tăng tốc sinh video (FFmpeg GPU)</span>
                        <input
                          type="checkbox"
                          checked={store.useGpuAcceleration}
                          onChange={(e) => store.setUseGpuAcceleration(e.target.checked)}
                          className="h-4 w-4 accent-emerald-500 cursor-pointer"
                        />
                      </div>
                    )}

                    {/* Bộ cài đặt GPU tự động */}
                    {installerStatus.status === 'installing' ? (
                      <div className="mt-3 p-3 bg-zinc-900/80 rounded border border-zinc-800 space-y-2">
                        <div className="flex items-center justify-between text-xs font-semibold text-emerald-400">
                          <span>Đang cài đặt GPU...</span>
                          <span className="font-mono">{installerStatus.progress}%</span>
                        </div>
                        <div className="w-full bg-black/60 rounded-full h-1.5 overflow-hidden">
                          <div className="bg-emerald-500 h-1.5 rounded-full transition-all duration-500" style={{ width: `${installerStatus.progress}%` }}></div>
                        </div>
                        <p className="text-[10px] text-zinc-400 italic font-medium leading-relaxed">{installerStatus.message}</p>
                        
                        {/* Live pip log box */}
                        <div className="mt-2">
                          <span className="text-[9px] text-zinc-500 uppercase tracking-wider font-bold block mb-1 font-sans">Pip Console Output:</span>
                          <textarea
                            readOnly
                            value={installerStatus.log || ''}
                            ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}
                            className="w-full h-20 bg-black border border-zinc-800 rounded p-1 text-[8px] font-mono text-zinc-400 focus:outline-none resize-none leading-normal"
                          />
                        </div>
                      </div>
                    ) : (
                      <>
                        {/* Cài đặt dựa trên loại card đồ hoạ phát hiện được */}
                        {systemInfo?.gpu?.vendor === 'nvidia' && (!systemInfo?.python?.cudaAvailable || !systemInfo?.python?.onnxProviders?.includes('CUDAExecutionProvider')) && (
                          <div className="mt-3">
                            <button
                              type="button"
                              onClick={handleStartGpuInstall}
                              className="w-full flex items-center justify-center gap-1.5 rounded bg-gradient-to-r from-emerald-500 to-teal-600 py-2.5 text-xs font-bold text-black hover:scale-[1.02] active:scale-95 transition-all duration-300 cursor-pointer shadow-lg shadow-emerald-500/10 font-sans"
                            >
                              ⚡ Tự Động Cấu Hình NVIDIA GPU (CUDA)
                            </button>
                            <span className="text-[9px] text-zinc-500 italic block mt-1.5 text-center leading-normal">
                              Tải & cấu hình PyTorch CUDA và ONNX GPU cho card NVIDIA ({systemInfo.gpu.name}) để chạy Whisper/Demucs nhanh gấp 5-10 lần!
                            </span>
                          </div>
                        )}

                        {(systemInfo?.gpu?.vendor === 'amd' || systemInfo?.gpu?.vendor === 'intel') && (!systemInfo?.python?.directmlAvailable || !systemInfo?.python?.onnxProviders?.includes('DmlExecutionProvider')) && (
                          <div className="mt-3">
                            <button
                              type="button"
                              onClick={handleStartGpuInstall}
                              className="w-full flex items-center justify-center gap-1.5 rounded bg-gradient-to-r from-emerald-500 to-teal-600 py-2.5 text-xs font-bold text-black hover:scale-[1.02] active:scale-95 transition-all duration-300 cursor-pointer shadow-lg shadow-emerald-500/10 font-sans"
                            >
                              ⚡ Cấu Hình Tăng Tốc AMD/Intel (DirectML)
                            </button>
                            <span className="text-[9px] text-zinc-500 italic block mt-1.5 text-center leading-normal">
                              Cài đặt DirectML tăng tốc tính toán trên GPU {systemInfo.gpu.vendor.toUpperCase()} ({systemInfo.gpu.name}) của bạn trên Windows!
                            </span>
                          </div>
                        )}

                        {installerStatus.status === 'success' && (
                          <div className="p-2.5 bg-emerald-950/20 border border-emerald-900/50 rounded text-xs text-emerald-400 leading-relaxed">
                            🎉 <strong>Cài đặt thành công!</strong> Hãy khởi động lại các tiến trình chạy âm thanh hoặc video để chạy bằng GPU.
                          </div>
                        )}
                        {installerStatus.status === 'failed' && (
                          <div className="p-2.5 bg-red-950/20 border border-red-900/50 rounded text-xs text-red-400 space-y-1">
                            <p>❌ <strong>Cài đặt thất bại:</strong> {installerStatus.message}</p>
                            <button
                              type="button"
                              onClick={handleStartGpuInstall}
                              className="text-[10px] text-zinc-200 underline hover:text-white cursor-pointer"
                            >
                              Thử lại cài đặt
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      </header>
      {/* Modals from Sidebar */}
      <TTSConfigModal isOpen={isTTSModalOpen} onClose={() => setIsTTSModalOpen(false)} />
      <MediaConfigModal isOpen={isMediaConfigModalOpen} onClose={() => setIsMediaConfigModalOpen(false)} />
      <ProTranslateSRTModal isOpen={isSRTModalOpen} onClose={() => setIsSRTModalOpen(false)} />
      <NavToolsPanel isOpen={isNavToolsOpen} onClose={() => setIsNavToolsOpen(false)} />
      <VideoEditorModal isOpen={isVideoEditorOpen} onClose={() => setIsVideoEditorOpen(false)} />
      <AutoRenderModal isOpen={isAutoRenderOpen} onClose={() => setIsAutoRenderOpen(false)} />
    </>
  );
}
