import re

file_path = "src/app/workspace/components/VideoEditorModal.tsx"
with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Remove activeTab state
content = re.sub(r"  // Tab Navigation State\n  const \[activeTab, setActiveTab\] = useState.*?\n\n", "", content, flags=re.DOTALL)

# 2. Replace TOP TABS with Simple Header
top_tabs_pattern = r"        {/\* TOP TABS \(Header\) \*/}.*?        {/\* MAIN CONTENT AREA \*/}"
new_top_tabs = """        {/* Header */}
        <div className="flex items-center justify-between bg-slate-900 border-b border-slate-700 px-6 py-4">
          <div>
            <h2 className="text-xl font-bold text-sky-500 uppercase tracking-widest flex items-center gap-2">
              <MonitorPlay size={20} /> TRÌNH DỰNG PHIM (Video Editor)
            </h2>
            <p className="text-slate-400 text-xs mt-1">Xử lý hiệu ứng, lách bản quyền và render từng video riêng lẻ.</p>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setShowAudioTools(true)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[11px] font-bold flex items-center gap-1.5 transition-colors border border-slate-700"
            >
              <FileAudio size={14} /> AUDIO TOOLS
            </button>
            <button 
              onClick={() => setShowDownloadStudio(true)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[11px] font-bold flex items-center gap-1.5 transition-colors border border-slate-700 mr-2"
            >
              <Download size={14} /> TẢI VIDEO
            </button>
            <button onClick={onClose} className="p-2 hover:bg-red-500 hover:text-white rounded-md text-slate-400 transition-colors">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* MAIN CONTENT AREA */}"""

content = re.sub(top_tabs_pattern, new_top_tabs, content, flags=re.DOTALL)

# 3. Remove conditional renders
content = re.sub(r"          {activeTab === 'auto-render' && <AutoRenderTab />}\s*", "", content)

# 4. Remove {activeTab === 'translate-srt' && ( ... )}
# Use a more robust regex that matches until the exact closing tag of this div block.
# Actually, since it's just two blocks, we can just replace the whole chunk from {activeTab === 'auto-render' ... to {activeTab === 'video-editor' && (
content = re.sub(r"          {activeTab === 'auto-render'.*?{activeTab === 'video-editor' && \(\s*<>\s*", "", content, flags=re.DOTALL)

# Also remove the ending tag
content = re.sub(r"          </div>\n\s*</>\n\s*\)}", "          </div>", content, flags=re.DOTALL)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("VideoEditorModal.tsx refactored successfully.")
