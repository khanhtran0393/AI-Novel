'use client';

import React from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import { useCharacterActions } from '../../hooks/useCharacterActions';
import {
  Sparkles,
  User,
} from 'lucide-react';
import {
  charImageKey,
  getCharacterProfileSetupStatus,
} from '@/lib/characterProfile';
import CharacterProfileForm from './CharacterProfileForm';

type Props = { onImageZoom: (url: string) => void };

/**
 * Hồ sơ nhân vật: tag list + form identity/voice/sheet.
 * Tách khỏi Sidebar shell (title, chapters, outline, write actions).
 */
export default function CharacterRoster({ onImageZoom }: Props) {
  // Raw store refs only — never `|| []` / map inside selector (infinite getSnapshot loop)
  const nhanVat = useNovelStore((s) => s.nhan_vat);
  const nhanVatPrompts = useNovelStore((s) => s.nhan_vat_prompts);
  const generatedImages = useNovelStore((s) => s.generatedImages);

  const {
    editingChar,
    setEditingChar,
    profileDraft,
    patchDraft,
    generatingCharPrompt,
    generatingAllCharPrompts,
    genAllProgress,
    generatingCharImage,
    regeneratingCharPromptOnly,
    renameDraft,
    setRenameDraft,
    replaceNameInText,
    setReplaceNameInText,
    handleCharTagClick,
    handleGenerateCharPrompt,
    handleGenerateAllCharPrompts,
    handleRegenerateCharPromptOnly,
    handleGenerateCharImage,
    handleGenerateWardrobeImage,
    handleSaveChar,
    handleRenameChar,
  } = useCharacterActions();

  if (!nhanVat?.length) return null;

  return (
        <div className="mb-6 border-t border-zinc-900 pt-4">
          <div className="mb-2.5 flex items-center justify-between gap-2 flex-wrap">
            <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              HỒ SƠ NHÂN VẬT ĐÃ PHÁT HIỆN
              <span className="ml-1.5 font-normal normal-case tracking-normal text-zinc-600">
                (song song · không chặn sinh chương)
              </span>
            </label>
            <button
              type="button"
              disabled={generatingAllCharPrompts || generatingCharPrompt}
              onClick={() => void handleGenerateAllCharPrompts({ applyCastVoices: true })}
              className="inline-flex items-center gap-1 rounded-md border border-amber-800/50 bg-amber-500/15 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-amber-400 hover:bg-amber-500/25 hover:border-amber-600 disabled:opacity-50 disabled:cursor-wait cursor-pointer transition-colors"
              title="Gen Prompt AI cho tất cả NV + gán chất giọng theo giới tính/tính cách"
            >
              <Sparkles className="h-3 w-3" />
              {generatingAllCharPrompts && genAllProgress
                ? `Gen ${genAllProgress.current}/${genAllProgress.total}…`
                : `Gen Prompt tất cả (${nhanVat.length})`}
            </button>
          </div>
          {generatingAllCharPrompts && genAllProgress && (
            <p className="mb-2 text-[9px] text-amber-400/90 leading-relaxed">
              Đang gen hồ sơ: <span className="font-bold">{genAllProgress.name}</span> (
              {genAllProgress.current}/{genAllProgress.total})
            </p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {nhanVat.map((char, idx) => {
              const status = getCharacterProfileSetupStatus(
                nhanVatPrompts?.[char],
                {
                  hasReferenceImage: !!generatedImages?.[charImageKey(char)],
                },
              );
              const setupDone = status.complete;
              const isSelected = editingChar === char;
              // Đỏ = chưa setup · Xanh = đủ trường + ảnh + giọng TTS
              const frameColor = setupDone ? '#10b981' : '#ef4444';
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleCharTagClick(char)}
                  className="flex items-center gap-1 rounded border-2 px-2 py-1 text-xs transition-all duration-200 cursor-pointer font-sans font-semibold"
                  style={{
                    borderColor: frameColor,
                    color: frameColor,
                    backgroundColor: setupDone
                      ? 'rgba(16, 185, 129, 0.12)'
                      : 'rgba(239, 68, 68, 0.12)',
                    boxShadow: isSelected
                      ? `0 0 0 2px ${frameColor}55, 0 0 12px ${frameColor}44`
                      : `0 0 8px ${frameColor}22`,
                  }}
                  title={
                    setupDone
                      ? `"${char}" — đã setup đủ (trường + ảnh + giọng TTS) ✓`
                      : `"${char}" — CHƯA đủ: ${status.missing.join(', ') || 'thiếu dữ liệu'}`
                  }
                >
                  <User className="h-3 w-3 shrink-0" style={{ color: frameColor }} />
                  <span>{char}</span>
                  <span className="text-[8px] font-bold uppercase opacity-80">
                    {setupDone ? 'OK' : '!'}
                  </span>
                </button>
              );
            })}
          </div>

          <CharacterProfileForm
            editingChar={editingChar}
            profileDraft={profileDraft}
            patchDraft={patchDraft}
            renameDraft={renameDraft}
            setRenameDraft={setRenameDraft}
            replaceNameInText={replaceNameInText}
            setReplaceNameInText={setReplaceNameInText}
            generatingCharPrompt={generatingCharPrompt}
            generatingCharImage={generatingCharImage}
            regeneratingCharPromptOnly={regeneratingCharPromptOnly}
            handleGenerateCharPrompt={handleGenerateCharPrompt}
            handleRegenerateCharPromptOnly={handleRegenerateCharPromptOnly}
            handleGenerateCharImage={handleGenerateCharImage}
            handleGenerateWardrobeImage={handleGenerateWardrobeImage}
            handleSaveChar={handleSaveChar}
            handleRenameChar={handleRenameChar}
            setEditingChar={setEditingChar}
            onImageZoom={onImageZoom}
          />
        </div>
  );
}
