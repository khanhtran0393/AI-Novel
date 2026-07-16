'use client';

import { useState } from 'react';
import { characterImageKey } from '@/contracts';
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
import { toast } from '@/lib/toastBus';
import {
  profilePromptCacheKey,
  getCachedConceptPromptDurable,
  setCachedConceptPrompt,
} from '@/lib/conceptPromptCache';

export function useCharacterActions() {
  // getState only — parent CharacterRoster selects data slices
  const store = () => useNovelStore.getState();

  const [editingChar, setEditingChar] = useState<string | null>(null);
  const [profileDraft, setProfileDraft] = useState<NhanVatProfile>(emptyNhanVatProfile());
  const [renameDraft, setRenameDraft] = useState('');
  const [replaceNameInText, setReplaceNameInText] = useState(true);

  const [generatingCharPrompt, setGeneratingCharPrompt] = useState(false);
  const [generatingAllCharPrompts, setGeneratingAllCharPrompts] = useState(false);
  const [genAllProgress, setGenAllProgress] = useState<{
    current: number;
    total: number;
    name: string;
  } | null>(null);
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
      setProfileDraft(normalizeNhanVatProfile(store().nhan_vat_prompts?.[char]));
    }
  };

  /** Đổi tên nhân vật — chuyển hồ sơ/ảnh + tuỳ chọn thay trong kịch bản */
  const handleRenameChar = (oldName: string) => {
    const next = renameDraft.trim().normalize('NFC');
    if (!next || next === oldName) {
      toast.warn('Đổi tên', 'Nhập tên mới khác tên hiện tại.');
      return;
    }
    // Lưu draft hồ sơ trước khi đổi key
    persistProfile(oldName, profileDraft);

    const result = store().renameNhanVat(oldName, next, {
      replaceInText: replaceNameInText,
    });
    if (!result.ok) {
      toast.error('Đổi tên', result.error || 'Lỗi');
      return;
    }
    setEditingChar(result.newName);
    setRenameDraft(result.newName);
    setProfileDraft(
      normalizeNhanVatProfile(useNovelStore.getState().nhan_vat_prompts?.[result.newName]),
    );
    toast.success(
      'Đổi tên',
      replaceNameInText
        ? `${oldName} → ${result.newName} (hồ sơ + kịch bản)`
        : `${oldName} → ${result.newName} (hồ sơ)`,
    );
  };

  const persistProfile = (char: string, data: Partial<NhanVatProfile>) => {
    store().updateNhanVatPrompt(char, data);
  };

  const handleGenerateCharPrompt = async (char: string) => {
    setGeneratingCharPrompt(true);
    try {
      const cacheKey = profilePromptCacheKey(
        char,
        profileDraft as unknown as Record<string, unknown>,
      );
      const cached = getCachedConceptPromptDurable(cacheKey);
      let data: Record<string, unknown>;
      if (cached && profileDraft.prompt) {
        // Profile fields unchanged → reuse sheet prompt text when present
        data = { prompt: cached };
        toast.info('Cache concept', `Dùng prompt đã cache cho "${char}"`);
      } else {
        data = (await generateCharPromptAction({
          char,
          dan_y_tong_the: store().dan_y_tong_the,
          lorebook: store().lorebook,
          profile: profileDraft,
        })) as Record<string, unknown>;
        if (typeof data.prompt === 'string' && data.prompt.trim()) {
          setCachedConceptPrompt(
            profilePromptCacheKey(
              char,
              { ...profileDraft, ...data } as unknown as Record<string, unknown>,
            ),
            data.prompt,
          );
        }
      }

      const merged = normalizeNhanVatProfile({
        ...profileDraft,
        ...data,
        tts_voice: profileDraft.tts_voice,
        angle_prompts: {
          ...(profileDraft.angle_prompts || {}),
          ...((data.angle_prompts as object) || {}),
        },
        expression_prompts: {
          ...(profileDraft.expression_prompts || {}),
          ...((data.expression_prompts as object) || {}),
        },
      });
      setProfileDraft(merged);
      persistProfile(char, merged);
      toast.success('Hồ sơ NV', `Đã sinh identity lock + góc/biểu cảm cho "${char}"`);
    } catch (err: unknown) {
      toast.error('Lỗi hồ sơ NV', err instanceof Error ? err.message : String(err));
    } finally {
      setGeneratingCharPrompt(false);
    }
  };

  /**
   * Gen Prompt AI cho **tất cả** NV đã phát hiện.
   * `applyCastVoices`: sau khi gen, gán giọng Role Casting theo giới tính / tính cách / quirk.
   */
  const handleGenerateAllCharPrompts = async (opts?: {
    applyCastVoices?: boolean;
    silent?: boolean;
  }) => {
    const chars = (store().nhan_vat || []).map((c) => c.normalize('NFC').trim()).filter(Boolean);
    if (!chars.length) {
      if (!opts?.silent) toast.warn('NV', 'Chưa có nhân vật nào trong danh sách.');
      return { ok: 0, fail: 0, castUpdated: 0 };
    }
    if (generatingAllCharPrompts || generatingCharPrompt) return { ok: 0, fail: 0, castUpdated: 0 };

    if (
      !opts?.silent &&
      !window.confirm(
        `✨ Gen Prompt AI cho TẤT CẢ ${chars.length} nhân vật?\n\n` +
          'Mỗi NV: hồ sơ đầy đủ (giới tính, tính cách, face lock, 4 góc, biểu cảm).\n' +
          (opts?.applyCastVoices !== false
            ? 'Sau đó gán chất giọng Role Casting theo giới tính / quirk / động cơ.'
            : ''),
      )
    ) {
      return { ok: 0, fail: 0, castUpdated: 0 };
    }

    setGeneratingAllCharPrompts(true);
    let ok = 0;
    let fail = 0;
    const failNames: string[] = [];

    try {
      for (let i = 0; i < chars.length; i++) {
        const char = chars[i];
        setGenAllProgress({ current: i + 1, total: chars.length, name: char });
        try {
          const base =
            editingChar === char
              ? profileDraft
              : normalizeNhanVatProfile(useNovelStore.getState().nhan_vat_prompts?.[char]);

          const data = await generateCharPromptAction({
            char,
            dan_y_tong_the: store().dan_y_tong_the,
            lorebook: store().lorebook,
            profile: base,
          });

          const merged = normalizeNhanVatProfile({
            ...base,
            ...data,
            tts_voice: base.tts_voice || '',
            angle_prompts: {
              ...(base.angle_prompts || {}),
              ...(data.angle_prompts || {}),
            },
            expression_prompts: {
              ...(base.expression_prompts || {}),
              ...(data.expression_prompts || {}),
            },
          });

          store().updateNhanVatPrompt(char, merged);
          if (editingChar === char) {
            setProfileDraft(merged);
          }
          ok += 1;
        } catch (err) {
          fail += 1;
          failNames.push(
            `${char}: ${err instanceof Error ? err.message : String(err)}`,
          );
          console.error(`[GenAllCharPrompts] ${char}:`, err);
        }
      }

      let castUpdated = 0;
      void opts?.applyCastVoices;

      if (!opts?.silent) {
        const castNote =
          opts?.applyCastVoices !== false
            ? ` · cast ${castUpdated} role`
            : '';
        toast.success(
          'Gen all NV',
          `${ok}/${chars.length} OK${fail ? `, ${fail} lỗi` : ''}${castNote}`,
        );
        if (failNames.length) {
          toast.warn('NV lỗi', failNames.slice(0, 5).join(' · '));
        }
      }
      return { ok, fail, castUpdated };
    } finally {
      setGeneratingAllCharPrompts(false);
      setGenAllProgress(null);
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
        toast.success('Identity lock', 'Đã tạo lại master prompt');
      }
    } catch (err: unknown) {
      toast.error('Tạo lại prompt', err instanceof Error ? err.message : String(err));
    } finally {
      setRegeneratingCharPromptOnly(false);
    }
  };

  const imageCtx = () => {
    const title = (store().ten_tac_pham || '').trim();
    if (!title) {
      throw new Error('Chua nhap ten_tac_pham. App khong tu gan ten truyen.');
    }
    return {
      savePathCharacter: store().savePathCharacter || '',
      googleDrivePath: store().googleDrivePath || '',
      ten_tac_pham: title,
      googleStudioCookies: store().googleStudioCookies || [],
      googleStudioCookie: store().googleStudioCookie || '',
    };
  };

  const applyImageResult = (key: string, path: string, projectUrl?: string) => {
    const imagePath = path + (path.includes('?') ? '&' : '?') + 't=' + Date.now();
    store().addGeneratedImage(key, imagePath);
    if (projectUrl) store().addProjectUrl(key, projectUrl);
  };

  /**
   * Gen 1 ảnh sheet gộp: chân dung front + 4 chiều + biểu cảm khuôn mặt.
   */
  const handleGenerateCharImage = async (char: string) => {
    if (!profileDraft.prompt?.trim() && !profileDraft.ngoai_hinh?.trim() && !profileDraft.dac_diem_nhan_dang?.trim()) {
      toast.warn('Gen ảnh NV', 'Cần master prompt / face lock trước. Bấm Gen Prompt AI.');
      return;
    }
    setGeneratingCharImage(true);
    const charKey = characterImageKey(char);
    store().addGeneratedImage(charKey, '');
    try {
      persistProfile(char, profileDraft);
      const sheetPrompt = composeCharacterReferenceSheetPrompt(profileDraft, char);
      const data = await generateCharImageAction({
        char,
        charPrompt: sheetPrompt,
        profile: profileDraft,
        ...imageCtx(),
      });
      applyImageResult(charKey, data.imagePath, data.projectUrl);
      // Face-lock path for identity on scene gen
      const facePath = String(data.imagePath || '').split('?')[0];
      if (facePath) {
        const next = normalizeNhanVatProfile({
          ...profileDraft,
          face_ref: facePath,
          identity_lock: `sheet:${char}`,
        } as NhanVatProfile);
        setProfileDraft(next);
        persistProfile(char, next);
      }
      toast.success('Ảnh concept', `Sheet tham chiếu cho ${char}`);
    } catch (err: unknown) {
      toast.error(
        'Ảnh concept',
        (err instanceof Error ? err.message : String(err)) +
          ' · Kiểm tra Cookie / API engine ảnh.',
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
    toast.success('Lưu hồ sơ', `Đã lưu tạo hình cho ${char}`);
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
    generatingAllCharPrompts,
    genAllProgress,
    generatingCharImage,
    regeneratingCharPromptOnly,
    generatingTurnaround: generatingCharImage,
    generatingExpressions: generatingCharImage,
    sheetProgress: null as null,
    handleCharTagClick,
    handleGenerateCharPrompt,
    handleGenerateAllCharPrompts,
    handleRegenerateCharPromptOnly,
    handleGenerateCharImage,
    handleGenerateTurnaround,
    handleGenerateExpressions,
    handleSaveChar,
    handleRenameChar,
  };
}
