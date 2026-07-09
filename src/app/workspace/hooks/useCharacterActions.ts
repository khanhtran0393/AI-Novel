'use client';

import { useState } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import {
  emptyNhanVatProfile,
  normalizeNhanVatProfile,
  type NhanVatProfile,
} from '@/lib/characterProfile';
import {
  generateCharPromptAction,
  regenerateCharPromptOnlyAction,
  generateCharImageAction,
} from '../modules/characterModule';
import { composeCharacterReferenceSheetPrompt } from '@/lib/characterProfile';

export function useCharacterActions() {
  const store = useNovelStore();

  const [editingChar, setEditingChar] = useState<string | null>(null);
  const [profileDraft, setProfileDraft] = useState<NhanVatProfile>(emptyNhanVatProfile());
  const [renameDraft, setRenameDraft] = useState('');
  const [replaceNameInText, setReplaceNameInText] = useState(true);

  const [generatingCharPrompt, setGeneratingCharPrompt] = useState(false);
  const [generatingCharImage, setGeneratingCharImage] = useState(false);
  const [regeneratingCharPromptOnly, setRegeneratingCharPromptOnly] = useState(false);

  const patchDraft = (partial: Partial<NhanVatProfile>) => {
    setProfileDraft((prev) =>
      normalizeNhanVatProfile({
        ...prev,
        ...partial,
        angle_prompts: {
          ...(prev.angle_prompts || {}),
          ...(partial.angle_prompts || {}),
        },
        expression_prompts: {
          ...(prev.expression_prompts || {}),
          ...(partial.expression_prompts || {}),
        },
      }),
    );
  };

  const handleCharTagClick = (char: string) => {
    if (editingChar === char) {
      setEditingChar(null);
    } else {
      setEditingChar(char);
      setRenameDraft(char);
      setProfileDraft(normalizeNhanVatProfile(store.nhan_vat_prompts?.[char]));
    }
  };

  /** Đổi tên nhân vật — chuyển hồ sơ/ảnh + tuỳ chọn thay trong kịch bản */
  const handleRenameChar = (oldName: string) => {
    const next = renameDraft.trim().normalize('NFC');
    if (!next || next === oldName) {
      alert('⚠️ Nhập tên mới khác tên hiện tại.');
      return;
    }
    // Lưu draft hồ sơ trước khi đổi key
    persistProfile(oldName, profileDraft);

    const result = store.renameNhanVat(oldName, next, {
      replaceInText: replaceNameInText,
    });
    if (!result.ok) {
      alert(`❌ ${result.error}`);
      return;
    }
    setEditingChar(result.newName);
    setRenameDraft(result.newName);
    setProfileDraft(
      normalizeNhanVatProfile(useNovelStore.getState().nhan_vat_prompts?.[result.newName]),
    );
    alert(
      replaceNameInText
        ? `🎉 Đã đổi "${oldName}" → "${result.newName}" (hồ sơ + kịch bản/lore).`
        : `🎉 Đã đổi "${oldName}" → "${result.newName}" (chỉ hồ sơ & key ảnh).`,
    );
  };

  const persistProfile = (char: string, data: Partial<NhanVatProfile>) => {
    store.updateNhanVatPrompt(char, data);
  };

  const handleGenerateCharPrompt = async (char: string) => {
    setGeneratingCharPrompt(true);
    try {
      const data = await generateCharPromptAction({
        char,
        dan_y_tong_the: store.dan_y_tong_the,
        lorebook: store.lorebook,
        profile: profileDraft,
      });

      const merged = normalizeNhanVatProfile({
        ...profileDraft,
        ...data,
        angle_prompts: {
          ...(profileDraft.angle_prompts || {}),
          ...(data.angle_prompts || {}),
        },
        expression_prompts: {
          ...(profileDraft.expression_prompts || {}),
          ...(data.expression_prompts || {}),
        },
      });
      setProfileDraft(merged);
      persistProfile(char, merged);
      alert(`🎉 Đã sinh hồ sơ đầy đủ (identity lock + 4 góc + biểu cảm) cho "${char}"!`);
    } catch (err: unknown) {
      alert(`❌ Lỗi tạo hồ sơ nhân vật: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setGeneratingCharPrompt(false);
    }
  };

  const handleRegenerateCharPromptOnly = async (char: string) => {
    setRegeneratingCharPromptOnly(true);
    try {
      const prompt = await regenerateCharPromptOnlyAction({
        char,
        profile: profileDraft,
      });
      if (prompt) {
        patchDraft({ prompt });
        persistProfile(char, { prompt });
        alert('🎉 Đã tạo lại master identity lock (an toàn policy)!');
      }
    } catch (err: unknown) {
      alert(`❌ Lỗi tạo lại prompt: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRegeneratingCharPromptOnly(false);
    }
  };

  const imageCtx = () => ({
    savePathCharacter: store.savePathCharacter || '',
    googleDrivePath: store.googleDrivePath || '',
    ten_tac_pham: store.ten_tac_pham || 'Kịch Bản Vô Danh',
    googleStudioCookies: store.googleStudioCookies || [],
    googleStudioCookie: store.googleStudioCookie || '',
  });

  const applyImageResult = (key: string, path: string, projectUrl?: string) => {
    const imagePath = path + (path.includes('?') ? '&' : '?') + 't=' + Date.now();
    store.addGeneratedImage(key, imagePath);
    if (projectUrl) store.addProjectUrl(key, projectUrl);
  };

  /**
   * Gen 1 ảnh sheet gộp: chân dung front + 4 chiều + biểu cảm khuôn mặt.
   */
  const handleGenerateCharImage = async (char: string) => {
    if (!profileDraft.prompt?.trim() && !profileDraft.ngoai_hinh?.trim() && !profileDraft.dac_diem_nhan_dang?.trim()) {
      alert('⚠️ Cần master prompt / face lock / đặc điểm nhận dạng trước. Bấm "Gen Prompt AI".');
      return;
    }
    setGeneratingCharImage(true);
    store.addGeneratedImage(`char_${char}`, '');
    try {
      persistProfile(char, profileDraft);
      const sheetPrompt = composeCharacterReferenceSheetPrompt(profileDraft, char);
      const data = await generateCharImageAction({
        char,
        charPrompt: sheetPrompt,
        profile: profileDraft,
        ...imageCtx(),
      });
      applyImageResult(`char_${char}`, data.imagePath, data.projectUrl);
      alert(
        `🎉 Đã sinh 1 ảnh sheet tham chiếu cho "${char}"\n(front + 4 chiều + biểu cảm gộp chung).`,
      );
    } catch (err: unknown) {
      alert(
        `❌ Lỗi sinh ảnh nhân vật: ${err instanceof Error ? err.message : String(err)}\n💡 Kiểm tra Cookie Google Labs / session còn hợp lệ không.`,
      );
    } finally {
      setGeneratingCharImage(false);
    }
  };

  // Compat stubs (UI cũ gọi 4 góc / biểu cảm → cùng 1 sheet)
  const handleGenerateTurnaround = handleGenerateCharImage;
  const handleGenerateExpressions = handleGenerateCharImage;

  const handleSaveChar = (char: string) => {
    persistProfile(char, profileDraft);
    alert(`🎉 Đã lưu hồ sơ tạo hình đầy đủ cho "${char}"!`);
    setEditingChar(null);
  };

  // Legacy field setters for minimal Sidebar churn — map onto profileDraft
  return {
    editingChar,
    setEditingChar,
    profileDraft,
    setProfileDraft,
    renameDraft,
    setRenameDraft,
    replaceNameInText,
    setReplaceNameInText,
    patchDraft,
    // convenience aliases
    gioiTinh: profileDraft.gioi_tinh,
    setGioiTinh: (v: string) => patchDraft({ gioi_tinh: v }),
    quanAo: profileDraft.quan_ao,
    setQuanAo: (v: string) => patchDraft({ quan_ao: v }),
    soThich: profileDraft.so_thich,
    setSoThich: (v: string) => patchDraft({ so_thich: v }),
    thoiQuen: profileDraft.thoi_quen,
    setThoiQuen: (v: string) => patchDraft({ thoi_quen: v }),
    charPrompt: profileDraft.prompt,
    setCharPrompt: (v: string) => patchDraft({ prompt: v }),
    generatingCharPrompt,
    generatingCharImage,
    regeneratingCharPromptOnly,
    generatingTurnaround: generatingCharImage,
    generatingExpressions: generatingCharImage,
    sheetProgress: null as null,
    handleCharTagClick,
    handleGenerateCharPrompt,
    handleRegenerateCharPromptOnly,
    handleGenerateCharImage,
    handleGenerateTurnaround,
    handleGenerateExpressions,
    handleSaveChar,
    handleRenameChar,
  };
}
