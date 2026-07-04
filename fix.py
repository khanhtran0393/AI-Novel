import re

filepath = 'src/app/workspace/components/Header.tsx'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update imports
content = content.replace(
    "RefreshCw,\n  Copy,\n  Check\n} from 'lucide-react';",
    "RefreshCw,\n  Copy,\n  Check,\n  Settings,\n  Image,\n  FileText\n} from 'lucide-react';\nimport TTSConfigModal from './TTSConfigModal';\nimport MediaConfigModal from './MediaConfigModal';\nimport ProTranslateSRTModal from './ProTranslateSRTModal';"
)

# 2. Add states for modals
content = content.replace(
    "const [showCookieManager, setShowCookieManager] = useState(false);\n  const [showApiManager, setShowApiManager] = useState(false);",
    "const [showSettingsManager, setShowSettingsManager] = useState(false);\n  const [isTTSModalOpen, setIsTTSModalOpen] = useState(false);\n  const [isMediaConfigModalOpen, setIsMediaConfigModalOpen] = useState(false);\n  const [isSRTModalOpen, setIsSRTModalOpen] = useState(false);"
)

# Strip out setShowCookieManager(false); and setShowApiManager(false);
content = re.sub(r'setShowCookieManager\(false\);\n?\s*', '', content)
content = re.sub(r'setShowApiManager\(false\);\n?\s*', '', content)

# Extract cookie and API UI
cookie_pattern = re.compile(r'\{\/\* Nút Trích Xuất Cookie Tự Động \*\/}(.*?)<\/div>\s*\)\}\s*<\/div>', re.DOTALL)
api_pattern = re.compile(r'<div className="space-y-2 max-h-40 overflow-y-auto pr-1">(.*?)<\/div>\s*\}\)\}\s*<\/div>\s*\}\)\}\s*<\/div>\s*\}\)\}\s*<\/div>\s*<\/header>', re.DOTALL)
# That's too complex and brittle.

# Let's extract them using simple string indexing
idx1 = content.find('{/* Nút Trích Xuất Cookie Tự Động */}')
idx2 = content.find('        {/* Quản lý Multi-API Key */}')
cookie_body = content[idx1:idx2]
# Trim the trailing tags of cookie_body
# In original, it ends with:
#                 </button>
#               </div>
#             </div>
#           )}
#         </div>
# We want to keep everything up to the `</button>\n              </div>`
trim_idx = cookie_body.rfind('              </div>\n            </div>\n          )\}\n        </div>')
if trim_idx != -1:
    cookie_body = cookie_body[:trim_idx + 20]

idx3 = content.find('<div className="space-y-2 max-h-40 overflow-y-auto pr-1">')
idx4 = content.find('      </div>\n    </header>')
api_body = content[idx3:idx4]
# Trim the trailing tags of api_body
trim_idx_api = api_body.rfind('              </div>\n            )}\n          </div>\n        )}')
if trim_idx_api != -1:
    api_body = api_body[:trim_idx_api + 20]


new_ui = """        {/* 4 Nút Hành Động Nhanh */}
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
            onClick={() => setShowSettingsManager(!showSettingsManager)}
            className="flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white cursor-pointer"
          >
            <Settings className="h-3.5 w-3.5" />
            Cài đặt chung
          </button>

          {showSettingsManager && (
            <div className="absolute right-0 mt-2 w-[340px] rounded-xl border border-zinc-800 bg-zinc-950 p-4 shadow-2xl z-50 animate-in slide-in-from-top-2 duration-200 max-h-[85vh] overflow-y-auto">
              <h3 className="mb-4 text-sm font-bold text-zinc-100 uppercase tracking-wide border-b border-zinc-800 pb-2 flex items-center gap-2">
                Cài đặt chung
              </h3>

              {/* Phần 1: Quản lý Cookie */}
              <div className="mb-6">
                <h4 className="text-[10px] font-bold text-amber-500 uppercase mb-3 flex items-center gap-1.5 tracking-wider">
                  <Key className="h-3 w-3" />
                  Cookie AI Studio ({store.googleStudioCookies?.length || 0})
                </h4>
""" + cookie_body + """
              </div>

              {/* Phần 2: Quản lý API Keys */}
              {!store.useMock && (
                <div className="pt-4 border-t border-zinc-800">
                  <h4 className="text-[10px] font-bold text-sky-500 uppercase mb-3 flex items-center gap-1.5 tracking-wider">
                    <Key className="h-3 w-3" />
                    API Keys ({(store.apiKeys && store.apiKeys.length > 0) ? store.apiKeys.length : (store.apiKey ? 1 : 0)})
                  </h4>
""" + api_body + """
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      
      {/* Modals from Sidebar */}
      <TTSConfigModal
        isOpen={isTTSModalOpen}
        onClose={() => setIsTTSModalOpen(false)}
      />
      <MediaConfigModal
        isOpen={isMediaConfigModalOpen}
        onClose={() => setIsMediaConfigModalOpen(false)}
      />
      <ProTranslateSRTModal
        isOpen={isSRTModalOpen}
        onClose={() => setIsSRTModalOpen(false)}
      />
    </header>
  );
}"""

idx_start = content.find('{/* Quản lý Multi-Cookie Studio */}')
content = content[:idx_start] + new_ui

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)
