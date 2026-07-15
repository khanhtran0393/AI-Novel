import React, { useState, useRef } from 'react';
import { API } from '@/contracts';
import { useNovelStore } from '@/store/useNovelStore';
import { X, Upload, Download, Sparkles, RefreshCw, ChevronDown } from 'lucide-react';

interface TranslateSRTModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const TRANSLATION_RULES = [
  { id: 'xianxia', name: '1. Tiên hiệp / Kiếm hiệp (仙侠剧)' },
  { id: 'romance', name: '2. Ngôn tình Cổ đại (言情古代剧)' },
  { id: 'wuxia', name: '3. Võ hiệp Cổ đại (武侠古代剧)' },
  { id: 'palace', name: '4. Cung đấu Gia đấu (宫斗家斗剧)' },
  { id: 'rich', name: '5. Hào môn Thế gia / Tổng tài (豪门世家/总裁剧)' },
  { id: 'school', name: '6. Thanh xuân Vườn trường (青春校园剧)' },
  { id: 'comedy', name: '7. Hài hước Lãng mạn (浪漫喜剧)' },
  { id: 'horror', name: '8. Kinh dị Ly kỳ / Trinh thám (悬疑恐怖剧)' },
  { id: 'action', name: '9. Hành động Phiêu lưu (动作冒险剧)' },
  { id: 'scifi', name: '10. Khoa học Viễn tưởng / Mạt thế (科幻末世剧)' },
  { id: 'history', name: '11. Chiến tranh Lịch sử / Dân quốc (民国历史剧)' },
  { id: 'modern', name: '12. Hiện đại đô thị (都市剧)' },
  { id: 'strict', name: '13. Dịch 1-1 Nghiêm ngặt (Light Novel)' },
  { id: 'auto', name: '14. AI Tự động phân tích & Chọn thể loại' },
];

export default function TranslateSRTModal({ isOpen, onClose }: TranslateSRTModalProps) {
  const store = useNovelStore();
  const [srtInput, setSrtInput] = useState('');
  const [srtOutput, setSrtOutput] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [translateMethod, setTranslateMethod] = useState<'api' | 'rpa'>('api');
  const [selectedRule, setSelectedRule] = useState(TRANSLATION_RULES[11].id); // Mặc định là Hiện đại đô thị
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setSrtInput(content);
      setError('');
    };
    reader.onerror = () => {
      setError('Lỗi khi đọc file SRT.');
    };
    reader.readAsText(file);
    
    // Reset input để có thể chọn lại cùng 1 file
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleTranslate = async () => {
    if (!srtInput.trim()) {
      setError('Vui lòng nhập hoặc tải lên nội dung SRT.');
      return;
    }

    const keysToUse = store.apiKeys && store.apiKeys.length > 0 
      ? store.apiKeys 
      : (store.apiKey ? [store.apiKey] : []);

    if (translateMethod === 'api' && keysToUse.length === 0) {
      setError('Thiếu API Key. Vui lòng cấu hình Gemini API Key trên thanh Header hoặc chọn phương thức Google Studio RPA.');
      return;
    }

    setIsTranslating(true);
    setError('');
    setSrtOutput('');

    try {
      const endpoint = translateMethod === 'api' ? API.translateSrt : API.rpaTranslateSrt;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          srtText: srtInput,
          ruleId: selectedRule,
          apiKeys: translateMethod === 'api' ? keysToUse : []
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Có lỗi xảy ra khi dịch.');
      }

      setSrtOutput(data.translatedSrt);
    } catch (err: unknown) {
      const errorObj = err as Error;
      setError(errorObj.message);
    } finally {
      setIsTranslating(false);
    }
  };

  const handleDownload = () => {
    if (!srtOutput) return;
    
    const blob = new Blob([srtOutput], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `translated_subtitles_${Date.now()}.srt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="w-[90vw] max-w-4xl h-[85vh] rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-900 bg-zinc-900/50 px-5 py-3 shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/20 text-amber-500">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-100 uppercase tracking-widest font-sans">
                Tool Dịch SRT
              </h2>
              <p className="text-[10px] text-zinc-500">Dịch thuật tự động như một tiểu thuyết gia thực thụ</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-red-500 transition-colors p-2 hover:bg-zinc-800 rounded-lg cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Method Selector */}
        <div className="flex items-center gap-4 border-b border-zinc-900 bg-black/40 px-5 py-2 shrink-0">
          <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest font-sans">
            Phương Thức:
          </span>
          <label className="flex items-center gap-1.5 cursor-pointer text-xs font-bold text-zinc-300 hover:text-amber-500 transition-colors">
            <input 
              type="radio" 
              name="translateMethod" 
              value="api" 
              checked={translateMethod === 'api'}
              onChange={() => setTranslateMethod('api')}
              className="accent-amber-500"
            />
            Dịch ngầm (API Key)
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer text-xs font-bold text-zinc-300 hover:text-emerald-500 transition-colors" title="Mở Chrome thao tác tự động trên Google AI Studio. Không cần API Key!">
            <input 
              type="radio" 
              name="translateMethod" 
              value="rpa" 
              checked={translateMethod === 'rpa'}
              onChange={() => setTranslateMethod('rpa')}
              className="accent-emerald-500"
            />
            Google Studio RPA (Miễn phí)
          </label>

          <div className="flex items-center gap-2 ml-auto border-l border-zinc-800 pl-4">
            <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest font-sans">
              Quy Tắc:
            </span>
            <div className="relative">
              <select 
                value={selectedRule} 
                onChange={(e) => setSelectedRule(e.target.value)} 
                disabled={isTranslating}
                className="appearance-none bg-black/60 text-amber-500 border border-zinc-800 hover:border-amber-700/50 rounded px-2 py-1 pr-6 outline-none text-xs font-bold cursor-pointer transition-colors disabled:opacity-50 max-w-[200px] truncate"
              >
                {TRANSLATION_RULES.map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-amber-500/70 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex flex-1 flex-col md:flex-row gap-4 p-5 overflow-hidden">
          
          {/* Cột Trái: Input */}
          <div className="flex flex-col flex-1 gap-2 min-h-0">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-amber-500 uppercase tracking-widest font-sans">
                SRT Gốc (Tiếng nước ngoài)
              </label>
              
              <input 
                type="file" 
                accept=".srt" 
                className="hidden" 
                ref={fileInputRef}
                onChange={handleFileUpload}
              />
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 px-2 py-1 text-[10px] text-zinc-300 transition-colors cursor-pointer"
              >
                <Upload className="h-3 w-3" />
                Tải file .srt lên
              </button>
            </div>
            
            <textarea
              value={srtInput}
              onChange={(e) => setSrtInput(e.target.value)}
              placeholder="Dán nội dung SRT thô vào đây...
Ví dụ:
1
00:00:01,000 --> 00:00:03,000
Hello world"
              className="flex-1 resize-none rounded-lg border border-zinc-800 bg-black/60 p-3 text-xs text-zinc-300 outline-none focus:border-amber-500 font-mono leading-relaxed"
            />
          </div>

          {/* Nút Dịch ở giữa */}
          <div className="flex items-center justify-center md:flex-col md:w-16 shrink-0 py-2 md:py-0">
            <button
              disabled={isTranslating || !srtInput}
              onClick={handleTranslate}
              className="group flex flex-col items-center justify-center gap-1 rounded-xl bg-amber-500/10 hover:bg-amber-500 border border-amber-500/30 hover:border-amber-500 p-3 text-amber-500 hover:text-black transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer h-full max-h-32 w-full shadow-lg shadow-amber-500/5"
            >
              {isTranslating ? (
                <RefreshCw className="h-6 w-6 animate-spin" />
              ) : (
                <Sparkles className="h-6 w-6 group-hover:animate-pulse" />
              )}
              <span className="text-[10px] font-bold uppercase tracking-wider text-center hidden md:block">
                {isTranslating ? 'Đang Dịch...' : 'Dịch SRT'}
              </span>
            </button>
          </div>

          {/* Cột Phải: Output */}
          <div className="flex flex-col flex-1 gap-2 min-h-0">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-emerald-500 uppercase tracking-widest font-sans">
                SRT Đã Dịch (Tiểu thuyết gia)
              </label>
              <button 
                disabled={!srtOutput}
                onClick={handleDownload}
                className="flex items-center gap-1.5 rounded bg-emerald-500/10 hover:bg-emerald-500 border border-emerald-500/30 hover:border-emerald-500 px-2 py-1 text-[10px] text-emerald-500 hover:text-black transition-colors cursor-pointer disabled:opacity-50"
              >
                <Download className="h-3 w-3" />
                Tải về .srt
              </button>
            </div>
            
            <textarea
              value={srtOutput}
              onChange={(e) => setSrtOutput(e.target.value)}
              placeholder="Kết quả dịch sẽ hiển thị ở đây..."
              className="flex-1 resize-none rounded-lg border border-zinc-800 bg-black/60 p-3 text-xs text-zinc-300 outline-none focus:border-emerald-500 font-mono leading-relaxed"
            />
          </div>

        </div>

        {/* Footer Errors */}
        {error && (
          <div className="px-5 pb-4">
            <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-3 text-xs text-red-400">
              ⚠️ Lỗi: {error}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
