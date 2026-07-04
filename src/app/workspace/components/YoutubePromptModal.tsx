import React, { useState } from 'react';
import { X, PlaySquare, Copy, RefreshCw } from 'lucide-react';

export interface YoutubePromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  novelTitle?: string;
}

export default function YoutubePromptModal({ isOpen, onClose, novelTitle = '' }: YoutubePromptModalProps) {
  const [scriptText, setScriptText] = useState('');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleGenerate = async () => {
    if (!scriptText.trim()) {
      alert("Vui lòng dán kịch bản hoặc văn bản cần phân tích!");
      return;
    }
    
    setLoading(true);
    try {
      // Giả lập gọi API youtube prompt của NAVTools
      setTimeout(() => {
        setResult(`Tiêu đề đề xuất:\n1. 🚨 SỐC: BÍ MẬT ĐẰNG SAU ${novelTitle.toUpperCase()} - BẠN ĐÃ BIẾT CHƯA?\n2. 🔥 ${novelTitle} - SỰ THẬT KHỦNG KHIẾP ĐƯỢC HÉ LỘ!\n\nMô tả:\nTrong video này, chúng ta sẽ cùng khám phá câu chuyện đầy hấp dẫn về ${novelTitle}...\n\nHashtags:\n#${novelTitle.replace(/\s+/g, '')} #TruyenTranh #KhamPha`);
        setLoading(false);
      }, 1500);
    } catch (error) {
      console.error(error);
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur p-4 font-sans text-white">
      <div className="flex flex-col w-full max-w-2xl h-[80vh] bg-zinc-950 rounded-lg shadow-2xl border border-amber-900/40 overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between bg-zinc-900/60 border-b border-zinc-800 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-amber-500 uppercase tracking-widest flex items-center gap-2">
              <PlaySquare size={18} /> YOUTUBE PROMPT (NAVTools)
            </h2>
            <p className="text-zinc-400 text-xs mt-1">Tạo Tiêu đề, Mô tả và Hashtag chuẩn SEO từ kịch bản của bạn.</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-red-500 hover:text-white rounded-md text-zinc-400 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col flex-1 p-6 gap-4 overflow-y-auto">
          <div className="flex flex-col gap-2">
            <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Kịch bản gốc</label>
            <textarea
              value={scriptText}
              onChange={(e) => setScriptText(e.target.value)}
              placeholder="Dán toàn bộ kịch bản hoặc phần giới thiệu vào đây..."
              className="w-full h-32 bg-zinc-900/50 border border-zinc-800 rounded p-3 text-sm text-zinc-300 outline-none focus:border-amber-500 resize-none font-sans"
            />
          </div>
          
          <button
            type="button"
            disabled={loading}
            onClick={handleGenerate}
            className="w-full h-10 flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-bold uppercase tracking-wider rounded transition-colors disabled:opacity-50"
          >
            {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <PlaySquare className="h-4 w-4" />}
            {loading ? 'Đang phân tích SEO...' : 'Tạo Metadata Youtube'}
          </button>

          {result && (
            <div className="flex flex-col gap-2 mt-2 animate-in fade-in duration-300">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Kết quả SEO</label>
                <button
                  onClick={() => navigator.clipboard.writeText(result)}
                  className="flex items-center gap-1 text-[10px] bg-zinc-800 hover:bg-zinc-700 px-2 py-1 rounded text-zinc-300 transition-colors"
                >
                  <Copy size={12} /> Copy Toàn Bộ
                </button>
              </div>
              <textarea
                readOnly
                value={result}
                className="w-full h-48 bg-black/60 border border-emerald-900/50 rounded p-3 text-sm text-zinc-300 outline-none resize-none font-sans whitespace-pre-wrap"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
