import { API } from '@/contracts';
import React, { useState } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import { X, UploadCloud, Loader2 } from 'lucide-react';
import { toast } from '@/lib/toastBus';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ImportModal({ isOpen, onClose }: ImportModalProps) {
  const store = useNovelStore();
  const [textContent, setTextContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleImport = async () => {
    if (!textContent.trim()) {
      setError('Vui lòng dán nội dung truyện vào đây.');
      return;
    }

    const apiKeys = store.apiKeys && store.apiKeys.length > 0 ? store.apiKeys : (store.apiKey ? [store.apiKey] : []);
    if (apiKeys.length === 0) {
      setError('Vui lòng cấu hình API Key trong phần Header trước khi sử dụng.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const res = await fetch(API.generate, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestType: 'IMPORT_FOUNDATION',
          apiKeys: apiKeys,
          payload: { text_content: textContent.substring(0, 50000) } // Giới hạn ký tự để tránh lỗi payload
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lỗi từ Server');

      const foundation = data.foundation;
      if (foundation) {
        // Cập nhật Store
        if (foundation.mo_ta) store.setSetup({ mo_ta: foundation.mo_ta });
        
        if (foundation.nhan_vat && Array.isArray(foundation.nhan_vat)) {
          const names = foundation.nhan_vat.map((c: any) => c.name);
          store.updateNhanVat(names);
          foundation.nhan_vat.forEach((c: any) => {
            store.updateNhanVatPrompt(c.name, {
              gioi_tinh: c.gioi_tinh || '',
              tuoi: c.tuoi || '',
              dang_nguoi: c.dang_nguoi || '',
              vai_tro: c.vai_tro || '',
              quan_ao: c.quan_ao || '',
              so_thich: c.so_thich || '',
              thoi_quen: c.thoi_quen || '',
              dong_co: c.dong_co || '',
              giong_thoai: c.giong_thoai || '',
              ngoai_hinh: c.ngoai_hinh || '',
              dac_diem_nhan_dang: c.dac_diem_nhan_dang || '',
              khuet_tat: c.khuet_tat || '',
              prompt: c.prompt || '',
              angle_prompts: c.angle_prompts || {},
              expression_prompts: c.expression_prompts || {},
            });
          });
        }
        
        if (foundation.lorebook) {
          const lorebookStr = Object.entries(foundation.lorebook).map(([k, v]) => `## ${k}\n${v}`).join('\n\n');
          store.updateLorebook(lorebookStr);
        }
        
        if (foundation.dan_y_tong_the) {
          const outlineStr = Array.isArray(foundation.dan_y_tong_the) 
            ? foundation.dan_y_tong_the.map((arc: any) => `### ${arc.ten_cung}\n- Mục tiêu: ${arc.muc_tieu}\n- Mô tả: ${arc.mo_ta}`).join('\n\n')
            : JSON.stringify(foundation.dan_y_tong_the, null, 2);
          store.updateDanYTongThe(outlineStr);
        }
        
        toast.info('Notice', 'Kế thừa di sản thành công! Toàn bộ Bối cảnh, Nhân vật và Dàn ý đã được nạp vào hệ thống.');
        onClose();
      } else {
        throw new Error('AI trả về dữ liệu rỗng.');
      }
    } catch (err: any) {
      setError(err.message || 'Lỗi không xác định.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-3xl rounded-xl border border-indigo-900/50 bg-zinc-950 p-6 shadow-2xl shadow-indigo-900/20">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <UploadCloud className="h-6 w-6 text-indigo-500" />
            <h3 className="text-lg font-bold uppercase tracking-widest text-zinc-100 font-sans">
              KẾ THỪA DI SẢN (IMPORT TRUYỆN CŨ)
            </h3>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white" disabled={isLoading}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-xs text-zinc-400 font-sans mb-4">
          Dán nội dung các chương cũ của bạn vào đây (tối đa 50,000 ký tự). AI sẽ đọc và tự động <strong>dịch ngược thành Cấu trúc hệ thống</strong> (Dàn ý, Lorebook, Nhân vật) để bạn có thể tiếp tục viết chương mới cực kỳ mượt mà và không quên logic.
        </p>

        <textarea
          value={textContent}
          onChange={(e) => setTextContent(e.target.value)}
          placeholder="Dán nội dung truyện cũ vào đây..."
          disabled={isLoading}
          className="w-full h-[40vh] bg-zinc-900/50 border border-zinc-800 rounded p-3 text-sm text-zinc-300 focus:outline-none focus:border-indigo-500/50 resize-none custom-scrollbar mb-4"
        />

        {error && <p className="text-xs text-red-500 font-bold mb-4">{error}</p>}

        <div className="flex justify-end">
          <button
            onClick={handleImport}
            disabled={isLoading}
            className="flex items-center gap-2 rounded bg-indigo-600 hover:bg-indigo-500 px-6 py-2 text-sm font-bold text-white transition-colors disabled:opacity-50"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            Phân Tích & Kế Thừa
          </button>
        </div>
      </div>
    </div>
  );
}
