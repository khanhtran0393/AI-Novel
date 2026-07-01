import { NextResponse } from 'next/server';
import { createDraftFromSpec } from 'cutsdk';
import type { DraftSpec, TrackSpec, ClipSpec } from 'cutsdk';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { 
      chapterNum, 
      ten_tac_pham, 
      generatedAudioPaths, 
      generatedImages, 
      generatedVideos 
    } = body;

    if (!chapterNum) {
      return NextResponse.json({ error: 'Missing chapterNum' }, { status: 400 });
    }

    const title = `${ten_tac_pham || 'Project'}_Ch${chapterNum}_CapCut`;

    // 1. Build tracks
    const videoClips: ClipSpec[] = [];
    const audioClips: ClipSpec[] = [];

    // Lấy danh sách các scene đã có media
    const sceneIndices = Array.from(new Set([
      ...Object.keys(generatedImages || {}),
      ...Object.keys(generatedVideos || {}),
      ...Object.keys(generatedAudioPaths || {})
    ])).map(Number).sort((a, b) => a - b);

    // Tính toán Start time tuần tự
    let currentTime = 0;

    // Cinematic Transitions Pool (Phase 2)
    const transitions = ['fade_in', 'fade_out', 'zoom_in', 'slide_left'];

    for (const idx of sceneIndices) {
      const audioUrl = generatedAudioPaths?.[idx];
      const videoUrl = generatedVideos?.[idx];
      const imageUrl = generatedImages?.[idx];

      // Mặc định duration mỗi đoạn là 5s nếu không có audio
      // Thực tế nếu có audio, ta sẽ gán duration = audio duration
      // Nhưng do ở backend không parse được audio duration dễ dàng nếu không dùng FFmpeg,
      // ta set cứng duration = 5, cutsdk có thể tính lại nếu import, hoặc cho mặc định 5s
      const clipDuration = 5; 

      // Chọn random một cinematic transition (Phase 2)
      const transitionName = transitions[Math.floor(Math.random() * transitions.length)];

      if (videoUrl || imageUrl) {
        // Handle path format
        const absolutePath = (videoUrl || imageUrl).replace('http://localhost:3000', 'd:\\chuyen gia mac the app\\public').replace(/\//g, '\\');
        
        videoClips.push({
          type: videoUrl ? 'video' : 'image',
          src: absolutePath,
          start: currentTime,
          duration: clipDuration,
          // Transition (Phase 2)
          transition: { name: transitionName, duration: 1 }
        });
      }

      if (audioUrl) {
        const audioAbsPath = audioUrl.replace('http://localhost:3000', 'd:\\chuyen gia mac the app\\public').replace(/\//g, '\\');
        audioClips.push({
          type: 'audio',
          src: audioAbsPath,
          start: currentTime,
          duration: clipDuration
        });
      }

      currentTime += clipDuration;
    }

    const tracks: TrackSpec[] = [];
    
    if (videoClips.length > 0) {
      tracks.push({ type: 'visual', clips: videoClips });
    }
    
    if (audioClips.length > 0) {
      tracks.push({ type: 'audio', clips: audioClips });
    }

    if (tracks.length === 0) {
      return NextResponse.json({ error: 'Không có media nào để xuất!' }, { status: 400 });
    }

    // 2. Build DraftSpec
    const draftSpec: DraftSpec = {
      version: '1.0',
      tracks: tracks
    };

    // 3. Gọi SDK để tạo Draft
    const result = await createDraftFromSpec(draftSpec);

    return NextResponse.json({ 
      success: true, 
      draftId: result.draftId,
      projectPath: result.filePath
    });
  } catch (error: unknown) {
    console.error('[Export CapCut] Error:', error);
    const err = error as Error;
    return NextResponse.json(
      { error: err.message || 'Lỗi hệ thống khi xuất CapCut' },
      { status: 500 }
    );
  }
}
