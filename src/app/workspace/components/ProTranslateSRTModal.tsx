import React, { useState, useRef, useEffect } from 'react';
import { X, Upload, Sparkles, Trash2, Rocket, Save, RefreshCw } from 'lucide-react';

import CustomSelect from './CustomSelect';

export interface ProTranslateSRTModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export interface GoogleAccount {
  id: string;
  stt: number;
  status: 'OFF' | 'ON' | 'ERROR';
  username: string;
  proxy: string;
}

const TRANSLATION_RULES = [
  { id: 'xianxia', name: '1. Tiên hiệp / Kiếm hiệp (仙侠剧)', desc: 'Mô tả: Sử dụng từ ngữ Hán Việt cổ kính, trang trọng, khí thế hào hùng.' },
  { id: 'romance', name: '2. Ngôn tình Cổ đại (言情古代剧)', desc: 'Mô tả: Lãng mạn, nhẹ nhàng, sử dụng xưng hô huynh - muội, chàng - thiếp.' },
  { id: 'wuxia', name: '3. Võ hiệp Cổ đại (武侠古代剧)', desc: 'Mô tả: Võ thuật, ân oán giang hồ.' },
  { id: 'palace', name: '4. Cung đấu Gia đấu (宫斗家斗剧)', desc: 'Mô tả: Tranh quyền đoạt vị, nội chiến gia tộc.' },
  { id: 'rich', name: '5. Hào môn Thế gia / Tổng tài (豪门世家/总裁剧)', desc: 'Mô tả: Giới siêu giàu, tổng tài bá đạo, ngôn từ hiện đại pha chút kiêu ngạo.' },
  { id: 'school', name: '6. Thanh xuân Vườn trường (青春校园剧)', desc: 'Mô tả: Tươi trẻ, hồn nhiên, thuật ngữ học đường, xưng hô cậu - tớ.' },
  { id: 'comedy', name: '7. Hài hước Lãng mạn (浪漫喜剧)', desc: 'Mô tả: Vui tươi, hài hước, ngôn từ hiện đại thoải mái.' },
  { id: 'horror', name: '8. Kinh dị Ly kỳ / Trinh thám (悬疑恐怖剧)', desc: 'Mô tả: Kịch tính, logic, lạnh lùng, thuật ngữ phá án/tâm lý.' },
  { id: 'action', name: '9. Hành động Phiêu lưu (动作冒险剧)', desc: 'Mô tả: Gọn gàng, mạnh mẽ, dứt khoát.' },
  { id: 'scifi', name: '10. Khoa học Viễn tưởng / Mạt thế (科幻末世剧)', desc: 'Mô tả: Sinh tồn, tương lai, công nghệ.' },
  { id: 'history', name: '11. Chiến tranh Lịch sử / Dân quốc (民国历史剧)', desc: 'Mô tả: Hào hùng, bi tráng, thời kỳ dân quốc/chiến tranh.' },
  { id: 'modern', name: '12. Hiện đại đô thị (都市剧)', desc: 'Mô tả: Tone chân thực, thực tế, đời sống thường ngày kết hợp thuật ngữ công sở và gia đình. Ngôn từ gần gũi.' },
  { id: 'strict', name: '13. Dịch 1-1 Nghiêm ngặt (Light Novel)', desc: 'Mô tả: Dịch 1-1 sát nghĩa gốc, bám sát cấu trúc ngữ pháp nguyên bản, không phóng tác, cực kỳ chuẩn xác, phù hợp Light Novel.' },
  { id: 'auto', name: '14. AI Tự động phân tích & Chọn thể loại', desc: 'Mô tả: AI tự động quét toàn bộ văn bản để phán đoán bối cảnh, từ đó linh hoạt điều chỉnh văn phong và đại từ nhân xưng cho phù hợp nhất.' },
];

const SOURCE_LANGS = [
  { value: 'ZH', label: 'ZH' },
  { value: 'EN', label: 'EN' },
  { value: 'VI', label: 'VI' },
  { value: 'JA', label: 'JA' },
  { value: 'KO', label: 'KO' },
  { value: 'ES', label: 'ES' },
  { value: 'FR', label: 'FR' },
  { value: 'DE', label: 'DE' },
  { value: 'PT', label: 'PT' },
  { value: 'RU', label: 'RU' }
];

const TARGET_LANGS = [
  { value: 'VI', label: 'VI' },
  { value: 'EN', label: 'EN' }
];

const CHUNK_SIZES = [
  { value: '100', label: '100 dòng' },
  { value: '300', label: '300 dòng' },
  { value: '500', label: '500 dòng' }
];

export default function ProTranslateSRTModal({ isOpen, onClose }: ProTranslateSRTModalProps) {
  const [sourceLang, setSourceLang] = useState('ZH');
  const [targetLang, setTargetLang] = useState('VI');
  const [chunkSize, setChunkSize] = useState(500);
  const [selectedRule, setSelectedRule] = useState(TRANSLATION_RULES[0].id);
  const [accounts, setAccounts] = useState<GoogleAccount[]>([]);
  
  const [originalSrt, setOriginalSrt] = useState('');
  const [translatedSrt, setTranslatedSrt] = useState('');
  const [consoleLogs, setConsoleLogs] = useState<string[]>(['[HỆ THỐNG] Khởi tạo cỗ máy dịch thuật AI...']);
  
  const [isTranslating, setIsTranslating] = useState(false);
  const [autoSave, setAutoSave] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const consoleRef = useRef<HTMLDivElement>(null);

  const fetchAccounts = async () => {
    try {
      const res = await fetch('/api/rpa-profile-manager');
      const data = await res.json();
      if (data.profiles) setAccounts(data.profiles);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchAccounts();
    }
  }, [isOpen]);

  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [consoleLogs]);

  if (!isOpen) return null;

  const addLog = (msg: string) => setConsoleLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setOriginalSrt(event.target?.result as string);
      addLog(`Đã import file SRT thành công (${file.name})`);
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleLoginProfile = async (profileId: string) => {
    addLog(`Đang gửi lệnh khởi động Chrome cho ${profileId}...`);
    try {
      const res = await fetch('/api/rpa-profile-manager', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', profileId })
      });
      const data = await res.json();
      if (data.success) {
        addLog(`Đã mở Chrome ${profileId}. Vui lòng đăng nhập trên giao diện hiện lên.`);
      } else {
        addLog(`[LỖI] ${data.error}`);
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      addLog(`[LỖI] ${err.message}`);
    }
  };

  const handleDeleteProfile = async (profileId: string) => {
    if (!confirm(`Bạn có chắc muốn xóa lịch sử Chrome của ${profileId} không?`)) return;
    try {
      const res = await fetch('/api/rpa-profile-manager', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', profileId })
      });
      const data = await res.json();
      if (data.success) {
        addLog(`Đã xóa sạch dữ liệu của ${profileId}.`);
        fetchAccounts();
      } else {
        addLog(`[LỖI] ${data.error}`);
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      addLog(`[LỖI] ${err.message}`);
    }
  };

  const handleDownload = () => {
    if (!translatedSrt) return;
    const blob = new Blob([translatedSrt], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `translated_pro_${Date.now()}.srt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleStartTranslate = async () => {
    if (!originalSrt.trim()) {
      addLog('[LỖI] Vui lòng Import file SRT trước khi dịch!');
      return;
    }
    if (accounts.length === 0) {
      addLog('[LỖI] Không có tài khoản Chrome nào khả dụng.');
      return;
    }

    setIsTranslating(true);
    setTranslatedSrt('');
    addLog(`[SYSTEM] Bắt đầu dịch ${sourceLang} -> ${targetLang}. Chia ${chunkSize} dòng/khối.`);
    
    // Cắt SRT
    const blocks = originalSrt.split(/\n\s*\n|\r\n\s*\r\n/).filter(b => b.trim() !== '');
    const chunks: string[] = [];
    for (let i = 0; i < blocks.length; i += chunkSize) {
      chunks.push(blocks.slice(i, i + chunkSize).join('\n\n'));
    }
    
    addLog(`Đã chia file thành ${chunks.length} khối (chunk).`);

    let finalResult = '';

    for (let i = 0; i < chunks.length; i++) {
      const currentChunk = chunks[i];
      // Luân phiên dùng tài khoản
      const accountToUse = accounts[i % accounts.length];
      
      addLog(`[Chunk ${i+1}/${chunks.length}] Đang xử lý bằng tài khoản ${accountToUse.id}...`);
      
      // Update UI Status
      setAccounts(prev => prev.map(a => a.id === accountToUse.id ? { ...a, status: 'ON' } : a));

      try {
        const res = await fetch('/api/rpa-translate-srt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            srtText: currentChunk,
            profileId: accountToUse.id,
            ruleId: selectedRule
          })
        });

        const data = await res.json();
        
        if (!res.ok) {
          throw new Error(data.error || 'Có lỗi khi dịch bằng RPA.');
        }

        finalResult += (finalResult ? '\n\n' : '') + data.translatedSrt;
        setTranslatedSrt(finalResult);
        addLog(`[Chunk ${i+1}/${chunks.length}] Thành công!`);
        
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        addLog(`[LỖI Chunk ${i+1}] ${err.message}`);
        // Ngừng dịch nếu lỗi để an toàn, hoặc có thể chọn tiếp tục. Ta sẽ dừng.
        addLog('[SYSTEM] Quá trình dịch bị gián đoạn do lỗi.');
        setAccounts(prev => prev.map(a => ({ ...a, status: 'OFF' })));
        setIsTranslating(false);
        return;
      }
      
      setAccounts(prev => prev.map(a => ({ ...a, status: 'OFF' })));
    }

    addLog('[SYSTEM] HOÀN TẤT DỊCH THUẬT 100%!');
    setIsTranslating(false);
    
    if (autoSave) {
      addLog('Đang tự động lưu file...');
      handleDownload();
    }
  };

  const activeRule = TRANSLATION_RULES.find(r => r.id === selectedRule) || TRANSLATION_RULES[0];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-[98vw] max-w-7xl h-[95vh] flex flex-col bg-[#0f0f0f] border border-amber-900/50 shadow-2xl rounded-lg overflow-hidden">
        
        <div className="relative flex items-center justify-center border-b border-amber-900/30 bg-[#151515] px-4 py-3 shrink-0">
          <h1 className="text-xl font-bold text-amber-500 uppercase tracking-[0.2em] drop-shadow-md">
            Hệ Thống Dịch Thuật AI
          </h1>
          <button onClick={onClose} disabled={isTranslating} className="absolute right-4 text-zinc-500 hover:text-red-500 transition-colors disabled:opacity-50 cursor-pointer">
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="flex flex-col flex-1 overflow-hidden p-4 gap-4">
          
          {/* TOP SECTION: Config & Accounts */}
          <div className="flex flex-col lg:flex-row gap-4 h-auto shrink-0">
            
            {/* Left: Settings */}
            <div className="flex flex-col flex-1 gap-4">
              <div className="flex flex-wrap items-center gap-4">
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isTranslating}
                  className="flex items-center gap-2 bg-green-600 hover:bg-green-500 text-white font-bold py-2 px-4 rounded border-2 border-green-400 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Upload className="h-4 w-4" /> IMPORT
                </button>
                <input type="file" accept=".srt" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
                
                <div className="flex items-center gap-2">
                  <span className="text-zinc-400 text-sm font-bold">Từ:</span>
                  <CustomSelect 
                    options={SOURCE_LANGS}
                    value={sourceLang} 
                    onChange={setSourceLang} 
                    disabled={isTranslating}
                    className="w-20"
                  />
                </div>
                
                <div className="flex items-center gap-2">
                  <span className="text-zinc-400 text-sm font-bold">Sang:</span>
                  <CustomSelect 
                    options={TARGET_LANGS}
                    value={targetLang} 
                    onChange={setTargetLang} 
                    disabled={isTranslating}
                    className="w-20"
                  />
                </div>

                <div className="flex items-center gap-2 ml-auto">
                  <span className="text-zinc-400 text-sm font-bold">Chia:</span>
                  <CustomSelect 
                    options={CHUNK_SIZES}
                    value={chunkSize.toString()} 
                    onChange={(val) => setChunkSize(Number(val))} 
                    disabled={isTranslating}
                    className="w-32"
                  />
                </div>
              </div>

              {/* Translation Rule Box */}
              <div className="border border-amber-600 rounded-lg p-3 bg-amber-950/10">
                <div className="text-amber-500 font-bold mb-3">Cấu hình Dịch thuật AI (Smart Translation)</div>
                <div className="flex items-center gap-3 relative z-40">
                  <span className="text-zinc-300 font-bold whitespace-nowrap">Quy tắc Dịch:</span>
                  <CustomSelect 
                    options={TRANSLATION_RULES.map(r => ({ value: r.id, label: r.name }))}
                    value={selectedRule} 
                    onChange={setSelectedRule} 
                    disabled={isTranslating}
                    className="flex-1"
                  />
                </div>
                <div className="mt-3 text-zinc-400 text-sm italic">
                  {activeRule.desc}
                </div>
              </div>
            </div>

            {/* Right: Accounts Manager */}
            <div className="flex flex-col flex-1 border border-zinc-800 rounded-lg overflow-hidden bg-black/50">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 bg-[#151515]">
                <Sparkles className="h-4 w-4 text-cyan-400" />
                <span className="text-cyan-400 font-bold uppercase text-sm tracking-wider">Google Accounts Manager</span>
                <button onClick={fetchAccounts} className="ml-auto text-zinc-500 hover:text-white cursor-pointer"><RefreshCw className="h-3 w-3" /></button>
              </div>
              <div className="overflow-auto flex-1">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#1a1a1a] text-amber-500 border-b border-zinc-800">
                    <tr>
                      <th className="px-2 py-2 font-bold text-center w-10">STT</th>
                      <th className="px-2 py-2 font-bold">CHROME</th>
                      <th className="px-2 py-2 font-bold text-center">STATUS</th>
                      <th className="px-2 py-2 font-bold text-center">RELOAD</th>
                      <th className="px-2 py-2 font-bold">USERNAME</th>
                      <th className="px-2 py-2 font-bold">PROXY</th>
                      <th className="px-2 py-2 font-bold text-center">DEL</th>
                    </tr>
                  </thead>
                  <tbody className="text-zinc-300 divide-y divide-zinc-800/50">
                    {accounts.map(acc => (
                      <tr key={acc.id} className="hover:bg-zinc-900/50 transition-colors">
                        <td className="px-2 py-2 text-center text-amber-500 font-bold">{acc.stt}</td>
                        <td className="px-2 py-2">
                          <button 
                            disabled={isTranslating}
                            onClick={() => handleLoginProfile(acc.id)}
                            className="bg-amber-600 hover:bg-amber-500 text-black font-bold px-2 py-0.5 rounded text-[10px] cursor-pointer disabled:opacity-50"
                          >
                            SETTING
                          </button>
                        </td>
                        <td className="px-2 py-2 text-center">
                          {acc.status === 'ON' ? (
                            <span className="border border-green-500 text-green-500 bg-green-500/10 px-2 py-0.5 rounded text-[10px] font-bold animate-pulse">ON</span>
                          ) : (
                            <span className="border border-red-500 text-red-500 px-2 py-0.5 rounded text-[10px]">OFF</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-center">
                          <button 
                            disabled={isTranslating}
                            onClick={() => handleLoginProfile(acc.id)}
                            className="text-amber-500 hover:text-amber-400 border border-amber-900 px-2 py-0.5 rounded text-[10px] cursor-pointer disabled:opacity-50"
                          >
                            LOGIN
                          </button>
                        </td>
                        <td className="px-2 py-2 text-emerald-500 truncate max-w-[100px]">{acc.id}</td>
                        <td className="px-2 py-2 text-zinc-500">{acc.proxy}</td>
                        <td className="px-2 py-2 text-center">
                          <button 
                            disabled={isTranslating}
                            onClick={() => handleDeleteProfile(acc.id)}
                            className="text-red-500 hover:text-red-400 cursor-pointer disabled:opacity-50"
                          >
                            <Trash2 className="h-3 w-3 mx-auto" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {accounts.length === 0 && (
                      <tr><td colSpan={7} className="text-center py-4 text-zinc-600">Đang tải danh sách profile...</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* BOTTOM SECTION: 3 Columns Text Areas */}
          <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
            {/* Col 1: Original */}
            <div className="flex flex-col flex-1 min-w-0">
              <div className="text-amber-500 font-bold text-xs mb-1 uppercase">Bản Gốc (SRT)</div>
              <textarea 
                value={originalSrt}
                onChange={(e) => setOriginalSrt(e.target.value)}
                readOnly={isTranslating}
                className="flex-1 bg-black border border-amber-900/50 rounded-md p-3 text-zinc-300 text-sm font-mono outline-none resize-none focus:border-amber-500 transition-colors"
                spellCheck={false}
              />
            </div>

            {/* Col 2: Translated */}
            <div className="flex flex-col flex-1 min-w-0">
              <div className="text-cyan-400 font-bold text-xs mb-1 uppercase">Bản Dịch</div>
              <textarea 
                value={translatedSrt}
                readOnly
                className="flex-1 bg-black border border-cyan-900/50 rounded-md p-3 text-emerald-400 text-sm font-mono outline-none resize-none"
              />
            </div>

            {/* Col 3: Console & Actions */}
            <div className="flex flex-col w-full lg:w-[350px] shrink-0 gap-3">
              <div className="flex flex-col flex-1 min-h-0">
                <div className="text-green-500 font-bold text-xs mb-1 uppercase">System Console</div>
                <div 
                  ref={consoleRef}
                  className="flex-1 bg-black border border-green-900/50 rounded-md p-3 text-green-500 text-[11px] font-mono overflow-y-auto"
                >
                  {consoleLogs.map((log, i) => (
                    <div key={i} className="mb-1 leading-relaxed">{log}</div>
                  ))}
                  {isTranslating && (
                    <div className="mb-1 leading-relaxed text-amber-500 animate-pulse">_ Đang xử lý...</div>
                  )}
                </div>
              </div>
              
              <label className="flex items-center gap-2 cursor-pointer mt-1">
                <input 
                  type="checkbox" 
                  checked={autoSave} 
                  onChange={(e) => setAutoSave(e.target.checked)}
                  disabled={isTranslating}
                  className="accent-green-500 h-4 w-4 disabled:opacity-50"
                />
                <span className="text-green-500 font-bold text-[11px] uppercase tracking-wide">Tự động lưu file khi dịch xong</span>
              </label>

              <button 
                onClick={handleStartTranslate}
                disabled={isTranslating}
                className="flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed text-black font-black py-4 px-4 rounded-md uppercase tracking-wider transition-all cursor-pointer"
              >
                {isTranslating ? <RefreshCw className="h-5 w-5 animate-spin" /> : <Rocket className="h-5 w-5" />}
                {isTranslating ? 'ĐANG DỊCH...' : 'BẮT ĐẦU DỊCH'}
              </button>

              <button 
                onClick={handleDownload}
                disabled={isTranslating || !translatedSrt}
                className="flex items-center justify-center gap-2 bg-[#1a1a1a] hover:bg-[#252525] disabled:opacity-50 disabled:cursor-not-allowed text-zinc-300 font-bold py-3 px-4 rounded-md uppercase text-[11px] border border-zinc-800 transition-colors cursor-pointer"
              >
                <Save className="h-4 w-4" />
                Lưu File (Thủ Công)
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
