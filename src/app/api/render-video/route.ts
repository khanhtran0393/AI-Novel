import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

export const runtime = 'nodejs';

// HAm phAn tA-ch k<ch bn thAnh cAc Cnh riAng bit
function parseScenes(text: string): { title: string; content: string }[] {
  if (!text) return [];
  const normalizedText = text.normalize('NFC');
  const regex = /(\[CNH\s+\d+\s*:[^\]\n]+\])/gi;
  const parts = normalizedText.split(regex);

  if (parts.length <= 1) {
    return [{ title: 'KSCH BN', content: normalizedText }];
  }

  const scenes: { title: string; content: string }[] = [];
  if (parts[0].trim()) {
    scenes.push({ title: 'Mz ?U', content: parts[0].trim() });
  }

  for (let i = 1; i < parts.length; i += 2) {
    const title = parts[i].trim();
    const content = parts[i + 1] ? parts[i + 1].trim() : '';
    scenes.push({ title, content });
  }
  return scenes;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { chapterNum, chapterData, images, ten_tac_pham, setup, renderSettings } = body;
    
    // Khởi tạo các giá trị render settings mặc định
    const { 
      arRatio = 'Giữ nguyên (Theo Video đầu)', 
      arFlip = false, 
      arGpu = true, 
      arEnableSub = true, 
      arSpeed = '100%', 
      arZoom = '100%' 
    } = renderSettings || {};

    let speedFactor = 1.0;
    if (arSpeed && arSpeed !== '100%') {
       const parsed = parseInt(arSpeed);
       if (!isNaN(parsed) && parsed > 0) speedFactor = parsed / 100;
    }
    const durationPerImage = 5 / speedFactor; // Base is 5s
    const zoomFactor = arZoom && arZoom !== '100%' ? parseFloat(arZoom) / 100 : 1.0;

    const openMontageDir = path.join(process.cwd(), 'OpenMontage');
    const composerDir = path.join(openMontageDir, 'remotion-composer');
    
    const cuts: any[] = [];
    const overlays: any[] = [];
    
    // 1. Title sequence
    cuts.push({
      id: 'title-card',
      type: 'hero_title',
      in_seconds: 0,
      out_seconds: 4,
      text: ten_tac_pham || "Chưa có tên tác phẩm",
      subtitle: `Chương ${chapterNum}`,
      backgroundColor: "#0F172A"
    });

    let currentSeconds = 4;

    // Lấy danh sách cảnh từ nội dung chương
    const scenes = chapterData?.noi_dung ? parseScenes(chapterData.noi_dung) : [];
    const chapterImages = Object.keys(images || {}).filter(k => k.startsWith(`${chapterNum}_`));

    if (chapterImages.length > 0) {
      // Sắp xếp các key để render theo đúng thứ tự (sceneIndex, promptIndex)
      chapterImages.sort((a, b) => {
        const partsA = a.split('_').map(Number);
        const partsB = b.split('_').map(Number);
        if (partsA[1] !== partsB[1]) return partsA[1] - partsB[1];
        return partsA[2] - partsB[2];
      });

      chapterImages.forEach((key, index) => {
        const imgUrl = images[key];
        if (!imgUrl) return;

        // Trích xuất text tóm tắt cảnh nếu có (phụ đề dưới ảnh)
        const parts = key.split('_');
        const sceneIdx = parseInt(parts[1], 10);
        let sceneText = "";
        if (scenes[sceneIdx]) {
           const words = scenes[sceneIdx].content.split(" ").slice(0, 15).join(" ") + "...";
           sceneText = words;
        }

        // Fix absolute path for Windows (Remotion only reads file:// absolute paths or public relative paths)
        let resolvedImgUrl = imgUrl;
        if (resolvedImgUrl.includes("?t=")) resolvedImgUrl = resolvedImgUrl.split("?t=")[0];
        
        // Convert to properly formatted file:// URI for Remotion staticFile if it's absolute
        if (/^[A-Za-z]:[\\/]/.test(resolvedImgUrl)) {
          resolvedImgUrl = `file:///${resolvedImgUrl.replace(/\\/g, "/")}`;
        }

        cuts.push({
          id: `anime-scene-${index}`,
          type: 'anime_scene',
          in_seconds: currentSeconds,
          out_seconds: currentSeconds + durationPerImage,
          images: [resolvedImgUrl],
          animation: index % 2 === 0 ? "ken-burns" : "pan-right",
          particles: index % 3 === 0 ? "fireflies" : "mist",
          particleColor: "#22D3EE",
          particleCount: 80,
          vignette: true,
          backgroundColor: "#0F172A",
          flip: arFlip ? true : false,
          zoom: zoomFactor
        });

        // Add caption overlay for this image
        if (sceneText && arEnableSub) {
          overlays.push({
            id: `caption-${index}`,
            type: 'stat_reveal',
            in_seconds: currentSeconds + 0.5,
            out_seconds: currentSeconds + durationPerImage - 0.5,
            text: `Cảnh ${sceneIdx}`,
            subtitle: sceneText,
            accentColor: "#34D399",
            position: "bottom-left"
          });
        }
        currentSeconds += durationPerImage;
      });
    } else {
      // Nếu không có ảnh nào, tạo 1 cut text cảnh báo
      cuts.push({
        id: `empty-scene`,
        type: 'text_card',
        in_seconds: currentSeconds,
        out_seconds: currentSeconds + 5,
        text: "Bạn chưa tạo ảnh nào cho chương này.",
        color: "#F8FAFC",
        backgroundColor: "#991B1B"
      });
      currentSeconds += 5;
    }

    const propsPayload = {
      theme: "flat-motion-graphics",
      cuts,
      overlays,
      captions: [],
      audio: {}
    };

    const payloadPath = path.join(composerDir, `props_${Date.now()}.json`);
    fs.writeFileSync(payloadPath, JSON.stringify(propsPayload, null, 2));

    const renderId = `render_chapter${chapterNum}_${Date.now()}`;
    const outputFilename = `${renderId}.mp4`;
    const outputPath = path.join(process.cwd(), 'public', 'renders', outputFilename);
    
    // Ensure public/renders directory exists
    if (!fs.existsSync(path.join(process.cwd(), 'public', 'renders'))) {
      fs.mkdirSync(path.join(process.cwd(), 'public', 'renders'), { recursive: true });
    }

    // Xác định Width và Height theo tỷ lệ
    let width = '1920';
    let height = '1080';
    if (arRatio === '9:16 (Dọc)') {
       width = '1080';
       height = '1920';
    } else if (arRatio === '1:1 (Vuông)') {
       width = '1080';
       height = '1080';
    }

    // Thiết lập mảng Command args
    const spawnArgs = [
      'remotion', 'render', 'src/index.tsx', 'Explainer',
      `"${outputPath}"`, '--props', `"${payloadPath}"`, '--codec', 'h264',
      '--width', width, '--height', height
    ];

    if (arGpu) {
       spawnArgs.push('--gl=angle');
    }

    // Trả về luồng dữ liệu (ReadableStream) để theo dõi real-time, tránh bị timeout (504)
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`[START] Bắt đầu gọi Remotion Engine...\n`));
        controller.enqueue(encoder.encode(`[INFO] Aspect Ratio: ${arRatio} (${width}x${height})\n`));
        controller.enqueue(encoder.encode(`[INFO] Flip: ${arFlip}, Zoom: ${arZoom}, Speed: ${arSpeed}\n`));
        controller.enqueue(encoder.encode(`[INFO] Subtitles: ${arEnableSub ? 'ON' : 'OFF'}, GPU: ${arGpu ? 'ON' : 'OFF'}\n\n`));

        const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', spawnArgs, {
          cwd: composerDir,
          env: { ...process.env },
          shell: true
        });

        child.stdout.on('data', (data) => {
          controller.enqueue(encoder.encode(data.toString()));
          console.log(`[Remotion] ${data.toString()}`);
        });

        child.stderr.on('data', (data) => {
          controller.enqueue(encoder.encode(data.toString()));
          console.error(`[Remotion ERR] ${data.toString()}`);
        });

        child.on('close', (code) => {
          if (code === 0) {
            controller.enqueue(encoder.encode(`\n\n[SUCCESS] /renders/${outputFilename}`));
          } else {
            controller.enqueue(encoder.encode(`\n\n[ERROR] Render failed with code ${code}`));
          }
          controller.close();
        });
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error: any) {
    console.error('Error in render-video:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
