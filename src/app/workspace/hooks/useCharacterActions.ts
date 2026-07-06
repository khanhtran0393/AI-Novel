'use client';

import { useState } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import {
  generateCharPromptAction,
  regenerateCharPromptOnlyAction,
  generateCharImageAction
} from '../modules/characterModule';

export function useCharacterActions() {
  const store = useNovelStore();

  // Trạng thái cấu hình Hồ sơ nhân vật trực tiếp ở Sidebar trái
  const [editingChar, setEditingChar] = useState<string | null>(null);
  const [gioiTinh, setGioiTinh] = useState('');
  const [quanAo, setQuanAo] = useState('');
  const [soThich, setSoThich] = useState('');
  const [thoiQuen, setThoiQuen] = useState('');
  const [charPrompt, setCharPrompt] = useState('');
  
  // Trạng thái loading
  const [generatingCharPrompt, setGeneratingCharPrompt] = useState(false);
  const [generatingCharImage, setGeneratingCharImage] = useState(false);
  const [regeneratingCharPromptOnly, setRegeneratingCharPromptOnly] = useState(false);

  // Trình gõ nút tag nhân vật
  const handleCharTagClick = (char: string) => {
    if (editingChar === char) {
      setEditingChar(null);
    } else {
      setEditingChar(char);
      const data = store.nhan_vat_prompts?.[char] || { gioi_tinh: '', quan_ao: '', so_thich: '', thoi_quen: '', prompt: '' };
      setGioiTinh(data.gioi_tinh || '');
      setQuanAo(data.quan_ao || '');
      setSoThich(data.so_thich || '');
      setThoiQuen(data.thoi_quen || '');
      setCharPrompt(data.prompt || '');
    }
  };

  // Sáng tạo toàn bộ hồ sơ nhân vật và prompt ngoại hình bằng AI
  const handleGenerateCharPrompt = async (char: string) => {
    setGeneratingCharPrompt(true);
    try {
      const data = await generateCharPromptAction({
        char,
        dan_y_tong_the: store.dan_y_tong_the,
        lorebook: store.lorebook,
        gioiTinh,
        quanAo,
        soThich,
        thoiQuen,
        apiKeys: store.apiKeys || [],
        apiKey: store.apiKey,
        useMock: false
      });

      if (data.gioi_tinh) setGioiTinh(data.gioi_tinh);
      if (data.quan_ao) setQuanAo(data.quan_ao);
      if (data.so_thich) setSoThich(data.so_thich);
      if (data.thoi_quen) setThoiQuen(data.thoi_quen);
      if (data.prompt) setCharPrompt(data.prompt);

      // Cập nhật trạng thái duy nhất toàn cục ngay lập tức (1 trạng thái duy nhất)
      store.updateNhanVatPrompt(char, {
        gioi_tinh: data.gioi_tinh || gioiTinh,
        quan_ao: data.quan_ao || quanAo,
        so_thich: data.so_thich || soThich,
        thoi_quen: data.thoi_quen || thoiQuen,
        prompt: data.prompt || charPrompt
      });

      alert(`🎉 Đã tự động sinh và điền toàn bộ hồ sơ AI cho nhân vật "${char}" thành công!`);
    } catch (err: unknown) {
      alert(`❌ Lỗi tạo hồ sơ nhân vật: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setGeneratingCharPrompt(false);
    }
  };

  // Chỉ sinh/tạo lại prompt vẽ ảnh chân dung cực kỳ an toàn
  const handleRegenerateCharPromptOnly = async (char: string) => {
    setRegeneratingCharPromptOnly(true);
    try {
      const prompt = await regenerateCharPromptOnlyAction({
        char,
        gioiTinh,
        quanAo,
        soThich,
        thoiQuen,
        apiKeys: store.apiKeys || [],
        apiKey: store.apiKey,
        useMock: false
      });

      if (prompt) {
        setCharPrompt(prompt);
        // Cập nhật trạng thái duy nhất toàn cục ngay lập tức
        store.updateNhanVatPrompt(char, { prompt });
        alert('🎉 Đã tạo lại prompt vẽ ảnh cực kỳ an toàn để tránh vi phạm chính sách!');
      }
    } catch (err: unknown) {
      alert(`❌ Lỗi tạo lại prompt: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRegeneratingCharPromptOnly(false);
    }
  };

  // Sinh ảnh concept art chân dung cho nhân vật bằng AI Whisk
  const handleGenerateCharImage = async (char: string) => {
    setGeneratingCharImage(true);
    store.addGeneratedImage(`char_${char}`, '');
    try {
      const data = await generateCharImageAction({
        char,
        charPrompt,
        savePathCharacter: store.savePathCharacter || '',
        googleDrivePath: store.googleDrivePath || '',
        ten_tac_pham: store.ten_tac_pham || 'Kịch Bản Vô Danh',
        googleStudioCookies: store.googleStudioCookies || [],
        googleStudioCookie: store.googleStudioCookie || '',
        useMock: false
      });

      const imagePath = data.imagePath + '?t=' + Date.now();
      store.addGeneratedImage(`char_${char}`, imagePath);
      if (data.projectUrl) {
        store.addProjectUrl(`char_${char}`, data.projectUrl);
      }
      alert(`🎉 Đã sinh ảnh chân dung cho nhân vật "${char}" thành công!`);
    } catch (err: unknown) {
      alert(`❌ Lỗi sinh ảnh nhân vật: ${err instanceof Error ? err.message : String(err)}\n💡 Hãy đảm bảo bạn đã nhập Cookie và tắt chặn địa lý (hoặc dùng Warp 1.1.1.1).`);
    } finally {
      setGeneratingCharImage(false);
    }
  };

  // Lưu hồ sơ nhân vật
  const handleSaveChar = (char: string) => {
    store.updateNhanVatPrompt(char, {
      gioi_tinh: gioiTinh,
      quan_ao: quanAo,
      so_thich: soThich,
      thoi_quen: thoiQuen,
      prompt: charPrompt
    });
    alert(`🎉 Đã lưu cấu hình tạo hình cho nhân vật "${char}"!`);
    setEditingChar(null);
  };

  return {
    editingChar,
    setEditingChar,
    gioiTinh,
    setGioiTinh,
    quanAo,
    setQuanAo,
    soThich,
    setSoThich,
    thoiQuen,
    setThoiQuen,
    charPrompt,
    setCharPrompt,
    generatingCharPrompt,
    generatingCharImage,
    regeneratingCharPromptOnly,
    handleCharTagClick,
    handleGenerateCharPrompt,
    handleRegenerateCharPromptOnly,
    handleGenerateCharImage,
    handleSaveChar
  };
}
