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
    // Xóa prompt cũ để UI không hiển thị nội dung tồn đọng
    const assetKey = `${store.chuong_dang_chon}_${sceneIndex}`;
    store.addGeneratedPrompts(assetKey, []);
    try {
      const prompts = await generateImagePromptAction({
        useMock: false,
        apiKey: store.apiKey,
        apiKeys: store.apiKeys || [],
        sceneText,
        duration,
        style: store.visualDnaPrompt || 'Cinematic, cinematic lighting, highly detailed',
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
        useMock: false,
        apiKey: store.apiKey,
        apiKeys: store.apiKeys || [],
        sceneIndex,
        promptIndex,
        sentence,
        currentPrompt,
        style: store.visualDnaPrompt || 'Cinematic, cinematic lighting, highly detailed',
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
  const handleGenerateImage = async (sceneIndex: number, promptIndex: number, prompt: string, sentence: string, silentError: boolean = false) => {
    if (!store.deductCredits(1)) {
      if (!silentError) alert('⚠️ Bạn đã hết Tín dụng. Vui lòng nạp thêm để tiếp tục sử dụng tính năng vẽ ảnh!');
      throw new Error('HẾT_TÍN_DỤNG');
    }
    const key = `${store.chuong_dang_chon}_${sceneIndex}_${promptIndex}`;
    
    // Xóa ảnh cũ ngay lập tức để UI chuyển sang trạng thái Loading, đảm bảo 1 trạng thái duy nhất
    store.addGeneratedImage(key, '');
    setGeneratingImage(prev => ({ ...prev, [key]: true }));

    try {
      // Xoay vòng Cookie để đa luồng sinh song song không bị nghẽn
      const cookiesList = store.googleStudioCookies || [];
      const selectedCookie = cookiesList[promptIndex % Math.max(1, cookiesList.length)] || store.googleStudioCookie;

      let resolvedImageApiKey = '';
      if (store.imageProvider === 'openai') {
        resolvedImageApiKey = store.openaiApiKey || (store.openaiApiKeys && store.openaiApiKeys[0]) || '';
      } else if (store.imageProvider === 'falai') {
        resolvedImageApiKey = store.falaiApiKey || (store.falaiApiKeys && store.falaiApiKeys[0]) || '';
      } else if (store.imageProvider === 'gemini') {
        resolvedImageApiKey = store.apiKey || (store.apiKeys && store.apiKeys[0]) || '';
      }

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
        useMock: false,
        apiKey: store.apiKey,
        apiKeys: store.apiKeys || [],
        model: store.imageModel,
        imageProvider: store.imageProvider,
        imageApiKey: resolvedImageApiKey,
        imageAspectRatio: store.imageAspectRatio || '16:9',
        aiMasterApiKey: store.aiMasterApiKey,
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
      if (!silentError) alert(`❌ Lỗi sinh ảnh: ${err instanceof Error ? err.message : String(err)}\n\n💡 Hãy chắc chắn rằng bạn đã cấu hình API Key Google (ở Header) để sinh ảnh bằng Google Imagen 3 siêu tốc, hoặc cấu hình Cookie Google Studio đầy đủ nếu muốn tự động hóa qua Google Labs Whisk.`);
      throw err;
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
    if (!hasApiKey && !hasCookie) {
      alert('⚠️ Chưa cấu hình API Key Google hoặc Cookie Google Studio để sinh ảnh.');
      return;
    }

    alert(`🚀 Đang khởi tạo chạy đa luồng song song ngầm để tự động vẽ ${promptsAsset.length} ảnh cho phân cảnh...`);

    let outOfCredits = false;
    let errorCount = 0;
    let lastErrorMsg = '';

    // Chạy song song tất cả các luồng sinh ảnh!
    const promises = promptsAsset.map(async (promptItem, pIdx) => {
      if (outOfCredits) return; // Nếu đã hết tín dụng thì không gọi API nữa
      try {
        await handleGenerateImage(sceneIndex, pIdx, promptItem.prompt, promptItem.sentence || '', true);
      } catch (err: any) {
        if (err.message === 'HẾT_TÍN_DỤNG') {
          outOfCredits = true;
        } else {
          errorCount++;
          lastErrorMsg = err.message || String(err);
        }
      }
    });

    await Promise.all(promises);
    
    if (outOfCredits) {
      alert('⚠️ Quá trình đã dừng lại vì bạn đã hết Tín dụng. Vui lòng nạp thêm để tiếp tục!');
    } else if (errorCount > 0) {
      alert(`❌ Đã xảy ra lỗi với ${errorCount} ảnh. Lỗi tiêu biểu: ${lastErrorMsg}\n\n💡 Hãy chắc chắn rằng API Key Google hoặc Cookie Google Studio vẫn còn hoạt động tốt.`);
    } else {
      alert('🎉 Đã hoàn tất luồng sinh tất cả ảnh cho phân cảnh này!');
    }
  };

  // Sinh video từ 2 ảnh prompt
  const handleGenerateVideo = async (sceneIndex: number, startPromptIndex: number, endPromptIndex: number, prompt: string, silentError: boolean = false) => {
    if (!store.deductCredits(2)) {
      if (!silentError) alert('⚠️ Bạn đã hết Tín dụng. Vui lòng nâng cấp gói Pro để tiếp tục sinh Video!');
      throw new Error('HẾT_TÍN_DỤNG');
    }
    const key = `${store.chuong_dang_chon}_${sceneIndex}_${endPromptIndex}_video`;
    setGeneratingVideo(prev => ({ ...prev, [key]: true }));
    // Xóa video cũ để UI không hiển thị video của lần tạo trước
    store.addGeneratedVideo(key, '');

    try {
      const assetKey = `${store.chuong_dang_chon}_${sceneIndex}`;
      const startKey = `${assetKey}_${startPromptIndex}`;
      const endKey = `${assetKey}_${endPromptIndex}`;
      const startImage = store.generatedImages?.[startKey];
      const endImage = store.generatedImages?.[endKey];

      if (!startImage || !endImage) {
        throw new Error('Cần phải sinh ảnh cho cả 2 Prompt trước khi tạo Video nội suy giữa chúng!');
      }

      let resolvedVideoApiKey = '';
      if (store.videoProvider === 'luma') {
        resolvedVideoApiKey = store.lumaApiKey || (store.lumaApiKeys && store.lumaApiKeys[0]) || '';
      } else if (store.videoProvider === 'runway') {
        resolvedVideoApiKey = store.runwayApiKey || (store.runwayApiKeys && store.runwayApiKeys[0]) || '';
      } else if (store.videoProvider === 'sora') {
        resolvedVideoApiKey = store.openaiApiKey || (store.openaiApiKeys && store.openaiApiKeys[0]) || '';
      } else if (store.videoProvider === 'veo') {
        resolvedVideoApiKey = store.apiKey || (store.apiKeys && store.apiKeys[0]) || '';
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
        videoProvider: store.videoProvider,
        videoApiKey: resolvedVideoApiKey,
        videoAspectRatio: store.videoAspectRatio || '16:9',
      });

      console.log(`[Video Builder] Successfully generated video: ${data.videoPath}`);
      if (data.videoPath) {
        store.addGeneratedVideo(key, data.videoPath);
      }
      // Lệnh này hiện tại mô phỏng việc lưu vào store, nhưng ta có thể báo alert thành công
      if (!silentError) alert(`🎉 Đã sinh thành công Video cho đoạn c${sceneIndex+1}-${String(endPromptIndex+1).padStart(2, '0')}!`);
    } catch (err: unknown) {
      if (!silentError) alert(`❌ Lỗi sinh video: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
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
    
    let outOfCredits = false;
    let errorCount = 0;
    let lastErrorMsg = '';

    // Sinh tuần tự thay vì song song để tránh bị Google block
    for (let i = 1; i < promptsAsset.length; i++) {
      if (outOfCredits) break;
      const startIdx = i - 1;
      const endIdx = i;
      try {
        await handleGenerateVideo(sceneIndex, startIdx, endIdx, promptsAsset[i].prompt, true);
      } catch (err: any) {
        if (err.message === 'HẾT_TÍN_DỤNG') {
          outOfCredits = true;
        } else {
          errorCount++;
          lastErrorMsg = err.message || String(err);
        }
      }
    }
    
    if (outOfCredits) {
      alert('⚠️ Quá trình sinh Video đã dừng lại vì bạn đã hết Tín dụng. Vui lòng nạp thêm để tiếp tục!');
    } else if (errorCount > 0) {
      alert(`❌ Đã xảy ra lỗi với ${errorCount} video. Lỗi tiêu biểu: ${lastErrorMsg}`);
    } else {
      alert('🎉 Đã hoàn tất luồng sinh tất cả Video!');
    }
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
