'use client';

import { useState } from 'react';
import { useNovelStore } from '@/store/useNovelStore';
import {
  generateImagePromptAction,
  regenPromptAction,
  generateImageAction
} from '../modules/imageModule';
import { generateVideoAction } from '../modules/videoModule';

export function useImagePromptActions() {
  const store = useNovelStore();
  const [generatingPrompt, setGeneratingPrompt] = useState<{ [sceneIndex: number]: boolean }>({});
  const [regeneratingSinglePrompt, setRegeneratingSinglePrompt] = useState<{ [key: string]: boolean }>({});
  const [generatingImage, setGeneratingImage] = useState<Record<string, boolean>>({});
  const [generatingVideo, setGeneratingVideo] = useState<Record<string, boolean>>({});

  // Gọi API backend phân tích kịch bản sinh prompt vẽ ảnh/video (theo từng câu + cảm xúc)
  const handleGenerateImagePrompt = async (sceneText: string, sceneIndex: number, duration: number) => {
    setGeneratingPrompt(prev => ({ ...prev, [sceneIndex]: true }));
    try {
      const prompts = await generateImagePromptAction({
        useMock: store.useMock,
        apiKey: store.apiKey,
        apiKeys: store.apiKeys || [],
        sceneText,
        duration,
        style: 'Cinematic Dark Cyberpunk Sci-Fi Fantasy',
        nhan_vat_prompts: store.nhan_vat_prompts
      });

      // Ghi nhận API key nếu có trả về
      const promptsWithKey = prompts as unknown as { usedApiKey?: string };
      if (promptsWithKey.usedApiKey) {
        store.prioritizeApiKey(promptsWithKey.usedApiKey);
      }

      const assetKey = `${store.chuong_dang_chon}_${sceneIndex}`;
      store.addGeneratedPrompts(assetKey, prompts);
      alert(`🎉 Đã sinh ${prompts.length} Prompt phân cảnh theo từng câu thành công!`);
    } catch (err: unknown) {
      alert(`❌ Lỗi sinh Prompt: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setGeneratingPrompt(prev => ({ ...prev, [sceneIndex]: false }));
    }
  };

  // Gọi API viết lại 1 prompt đơn lẻ bị lỗi hoặc vi phạm
  const handleRegenPrompt = async (
    sceneIndex: number,
    promptIndex: number,
    sentence: string,
    currentPrompt: string
  ) => {
    const assetKey = `${store.chuong_dang_chon}_${sceneIndex}`;
    const key = `${assetKey}_${promptIndex}`;

    setRegeneratingSinglePrompt(prev => ({ ...prev, [key]: true }));
    try {
      const newPromptStr = await regenPromptAction({
        useMock: store.useMock,
        apiKey: store.apiKey,
        apiKeys: store.apiKeys || [],
        sceneIndex,
        promptIndex,
        sentence,
        currentPrompt,
        style: 'Cinematic Dark Cyberpunk Sci-Fi Fantasy',
        nhan_vat_prompts: store.nhan_vat_prompts
      });

      if (newPromptStr) {
        const currentPrompts = store.generatedPrompts[assetKey] || [];
        const updated = [...currentPrompts];
        if (updated[promptIndex]) {
          updated[promptIndex] = { ...updated[promptIndex], prompt: newPromptStr };
          store.addGeneratedPrompts(assetKey, updated);
        }
      }
    } catch (err: unknown) {
      alert(`❌ Lỗi viết lại prompt: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRegeneratingSinglePrompt(prev => ({ ...prev, [key]: false }));
    }
  };

  // Gọi API sinh ảnh tự động từ Google Labs Whisk chạy ngầm (Headless) hoặc Google Imagen 3 API
  const handleGenerateImage = async (sceneIndex: number, promptIndex: number, prompt: string, sentence: string) => {
    if (!store.deductCredits(1)) {
      alert('⚠️ Bạn đã hết Tín dụng. Vui lòng nạp thêm để tiếp tục sử dụng tính năng vẽ ảnh!');
      return;
    }
    const key = `${store.chuong_dang_chon}_${sceneIndex}_${promptIndex}`;
    setGeneratingImage(prev => ({ ...prev, [key]: true }));

    try {
      // Xoay vòng Cookie để đa luồng sinh song song không bị nghẽn
      const cookiesList = store.googleStudioCookies || [];
      const selectedCookie = cookiesList[promptIndex % Math.max(1, cookiesList.length)] || store.googleStudioCookie;

      const data = await generateImageAction({
        prompt,
        sentence,
        chapterNum: store.chuong_dang_chon,
        sceneIndex,
        promptIndex,
        savePathImage: store.savePathImage || '',
        googleDrivePath: store.googleDrivePath || '',
        ten_tac_pham: store.ten_tac_pham || 'Kịch Bản Vô Danh',
        selectedCookie,
        nhan_vat: store.nhan_vat || [],
        nhan_vat_prompts: store.nhan_vat_prompts,
        useMock: store.useMock,
        apiKey: store.apiKey,
        apiKeys: store.apiKeys || [],
        model: store.imageModel,
      });

      // Nếu API vẽ ảnh thành công sử dụng API Key nào, đẩy Key đó lên đầu tiên
      if (data.usedApiKey) {
        store.prioritizeApiKey(data.usedApiKey);
      }

      store.addGeneratedImage(key, data.imagePath + '?t=' + Date.now());
      if (data.projectUrl) {
        store.addProjectUrl(key, data.projectUrl);
      }
      console.log(`[Image Builder] Successfully generated image for c${sceneIndex+1}-${promptIndex+1} using ${data.method || 'unknown'}: ${data.imagePath}`);
    } catch (err: unknown) {
      alert(`❌ Lỗi sinh ảnh: ${err instanceof Error ? err.message : String(err)}\n\n💡 Hãy chắc chắn rằng bạn đã cấu hình API Key Google (ở Header) để sinh ảnh bằng Google Imagen 3 siêu tốc, hoặc cấu hình Cookie Google Studio đầy đủ nếu muốn tự động hóa qua Google Labs Whisk.`);
    } finally {
      setGeneratingImage(prev => ({ ...prev, [key]: false }));
    }
  };

  // Đa luồng sinh toàn bộ ảnh cho phân cảnh song song
  const handleGenerateAllImages = async (sceneIndex: number) => {
    const assetKey = `${store.chuong_dang_chon}_${sceneIndex}`;
    const promptsAsset = store.generatedPrompts[assetKey] || [];
    if (promptsAsset.length === 0) {
      alert('⚠️ Chưa có danh sách prompt vẽ ảnh. Vui lòng bấm "Gen Prompt Studio" trước.');
      return;
    }

    const hasApiKey = !!store.apiKey || (store.apiKeys && store.apiKeys.length > 0);
    const hasCookie = !!store.googleStudioCookie || (store.googleStudioCookies && store.googleStudioCookies.length > 0);
    if (!store.useMock && !hasApiKey && !hasCookie) {
      alert('⚠️ Chưa cấu hình API Key Google hoặc Cookie Google Studio để sinh ảnh.');
      return;
    }

    alert(`🚀 Đang khởi tạo chạy đa luồng song song ngầm để tự động vẽ ${promptsAsset.length} ảnh cho phân cảnh...`);

    // Chạy song song tất cả các luồng sinh ảnh!
    const promises = promptsAsset.map((promptItem, pIdx) => 
      handleGenerateImage(sceneIndex, pIdx, promptItem.prompt, promptItem.sentence || '')
    );

    await Promise.all(promises);
    alert('🎉 Đã hoàn tất luồng sinh tất cả ảnh cho phân cảnh này!');
  };

  // Sinh video từ 2 ảnh prompt
  const handleGenerateVideo = async (sceneIndex: number, startPromptIndex: number, endPromptIndex: number, prompt: string) => {
    if (!store.deductCredits(2)) {
      alert('⚠️ Bạn đã hết Tín dụng. Vui lòng nâng cấp gói Pro để tiếp tục sinh Video!');
      return;
    }
    const key = `${store.chuong_dang_chon}_${sceneIndex}_${endPromptIndex}_video`;
    setGeneratingVideo(prev => ({ ...prev, [key]: true }));

    try {
      const assetKey = `${store.chuong_dang_chon}_${sceneIndex}`;
      const startKey = `${assetKey}_${startPromptIndex}`;
      const endKey = `${assetKey}_${endPromptIndex}`;
      const startImage = store.generatedImages?.[startKey];
      const endImage = store.generatedImages?.[endKey];

      if (!startImage || !endImage) {
        throw new Error('Cần phải sinh ảnh cho cả 2 Prompt trước khi tạo Video nội suy giữa chúng!');
      }

      const data = await generateVideoAction({
        chapterNum: store.chuong_dang_chon,
        sceneIndex,
        promptIndex: endPromptIndex,
        prompt,
        duration: 5,
        startImage,
        endImage,
        model: store.videoModel,
      });

      console.log(`[Video Builder] Successfully generated video: ${data.videoPath}`);
      if (data.videoPath) {
        store.addGeneratedVideo(key, data.videoPath);
      }
      // Lệnh này hiện tại mô phỏng việc lưu vào store, nhưng ta có thể báo alert thành công
      alert(`🎉 Đã sinh thành công Video cho đoạn c${sceneIndex+1}-${String(endPromptIndex+1).padStart(2, '0')}!`);
    } catch (err: unknown) {
      alert(`❌ Lỗi sinh video: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setGeneratingVideo(prev => ({ ...prev, [key]: false }));
    }
  };

  const handleGenerateAllVideos = async (sceneIndex: number) => {
    const assetKey = `${store.chuong_dang_chon}_${sceneIndex}`;
    const promptsAsset = store.generatedPrompts[assetKey] || [];
    if (promptsAsset.length < 2) {
      alert('⚠️ Cần ít nhất 2 prompt để nối thành Video.');
      return;
    }

    alert(`🚀 Đang tự động chạy sinh tuần tự toàn bộ Video cho phân cảnh...`);
    
    // Sinh tuần tự thay vì song song để tránh bị Google block
    for (let i = 1; i < promptsAsset.length; i++) {
      const startIdx = i - 1;
      const endIdx = i;
      await handleGenerateVideo(sceneIndex, startIdx, endIdx, promptsAsset[i].prompt);
    }
    
    alert('🎉 Đã hoàn tất luồng sinh tất cả Video!');
  };

  return {
    generatingPrompt,
    regeneratingSinglePrompt,
    generatingImage,
    generatingVideo,
    handleGenerateImagePrompt,
    handleRegenPrompt,
    handleGenerateImage,
    handleGenerateAllImages,
    handleGenerateVideo,
    handleGenerateAllVideos
  };
}
