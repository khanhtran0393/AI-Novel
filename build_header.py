import os

with open('src/app/workspace/components/Header.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

out = []
i = 0
while i < len(lines):
    line = lines[i]
    
    # 1. Imports
    if "  RefreshCw," in line:
        out.append(line)
        out.append("  Copy,\n")
        out.append("  Check,\n")
        out.append("  Settings,\n")
        out.append("  Image,\n")
        out.append("  FileText\n")
        out.append("} from 'lucide-react';\n")
        out.append("import TTSConfigModal from './TTSConfigModal';\n")
        out.append("import MediaConfigModal from './MediaConfigModal';\n")
        out.append("import ProTranslateSRTModal from './ProTranslateSRTModal';\n")
        i += 4
        continue

    # 2. States
    if "const [showDriveManager, setShowDriveManager] = useState(false);" in line:
        out.append(line)
        out.append("  const [showSettingsManager, setShowSettingsManager] = useState(false);\n")
        out.append("  const [isTTSModalOpen, setIsTTSModalOpen] = useState(false);\n")
        out.append("  const [isMediaConfigModalOpen, setIsMediaConfigModalOpen] = useState(false);\n")
        out.append("  const [isSRTModalOpen, setIsSRTModalOpen] = useState(false);\n")
        i += 3 # skip showCookieManager and showApiManager
        continue
    
    # Remove state toggle
    if "setShowCookieManager(" in line or "setShowApiManager(" in line:
        i += 1
        continue

    # 3. Main block replacement
    if "{/* Quản lý Multi-Cookie Studio */}" in line:
        # Start inserting our new block
        new_block = """        {/* 4 Nút Hành Động Nhanh */}
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
                  alert(`🎉 Đã xuất dự án CapCut thành công!\\nĐường dẫn: ${data.projectPath}`);
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
"""
        out.append(new_block)
        
        # Skip down to where the cookie body actually starts
        while "{/* Nút Trích Xuất Cookie Tự Động */}" not in lines[i]:
            i += 1
        
        # Add cookie body lines until its closing div
        while "            </div>" not in lines[i] or "          )}" not in lines[i+1]:
            out.append(lines[i])
            i += 1
        
        # Now close cookie section
        out.append("              </div>\n")
        out.append("\n")
        out.append("              {/* Phần 2: Quản lý API Keys */}\n")
        out.append("              {!store.useMock && (\n")
        out.append("                <div className=\"pt-4 border-t border-zinc-800\">\n")
        out.append("                  <h4 className=\"text-[10px] font-bold text-sky-500 uppercase mb-3 flex items-center gap-1.5 tracking-wider\">\n")
        out.append("                    <Key className=\"h-3 w-3\" />\n")
        out.append("                    API Keys ({(store.apiKeys && store.apiKeys.length > 0) ? store.apiKeys.length : (store.apiKey ? 1 : 0)})\n")
        out.append("                  </h4>\n")
        
        # Skip down to where the api body actually starts
        while "<div className=\"space-y-2 max-h-40 overflow-y-auto pr-1\">" not in lines[i]:
            i += 1
            
        # Add api body lines until its closing div
        while "              </div>" not in lines[i] or "            )}" not in lines[i+1] or "          </div>" not in lines[i+2]:
            out.append(lines[i])
            i += 1
        
        # Now close the rest of the file
        out.append("                </div>\n")
        out.append("              )}\n")
        out.append("            </div>\n")
        out.append("          )}\n")
        out.append("        </div>\n")
        out.append("      </div>\n")
        
        # Add modals
        out.append("      {/* Modals from Sidebar */}\n")
        out.append("      <TTSConfigModal isOpen={isTTSModalOpen} onClose={() => setIsTTSModalOpen(false)} />\n")
        out.append("      <MediaConfigModal isOpen={isMediaConfigModalOpen} onClose={() => setIsMediaConfigModalOpen(false)} />\n")
        out.append("      <ProTranslateSRTModal isOpen={isSRTModalOpen} onClose={() => setIsSRTModalOpen(false)} />\n")
        out.append("    </header>\n")
        out.append("  );\n")
        out.append("}\n")
        break

    out.append(line)
    i += 1

with open('src/app/workspace/components/Header.tsx', 'w', encoding='utf-8') as f:
    f.writelines(out)
