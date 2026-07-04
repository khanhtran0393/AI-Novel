import { NextResponse } from 'next/server';
import { addExtra } from 'puppeteer-extra';
import puppeteerCore from 'puppeteer';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { BrowserAgent } from '@/lib/agents/BrowserAgent';

export const runtime = 'nodejs';

function findChromePath(): string | undefined {
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  if (process.env.LOCALAPPDATA) {
    paths.push(path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'));
  }
  if (process.env.USERPROFILE) {
    paths.push(path.join(process.env.USERPROFILE, 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'));
  }
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

// ==========================================
// THUẬT TOÁN HYBRID VISION GUI NAVIGATION
// ==========================================
async function askGeminiVisionForCoordinates(base64Image: string, elementDescription: string, apiKey: string): Promise<{x: number, y: number} | null> {
  if (!apiKey) {
    console.warn('[Hybrid Vision] Cảnh báo: Không có aiMasterApiKey để kích hoạt Mắt Thần.');
    return null;
  }
  
  console.log(`[Hybrid Vision] Đang gửi ảnh chụp màn hình lên Gemini 1.5 Pro để tìm: "${elementDescription}"...`);
  const prompt = `You are an expert RPA Vision Agent. I have attached a screenshot of a web application.
Your task is to find the exact coordinates of the element matching this description: "${elementDescription}".
Return ONLY a valid JSON object with 'x' and 'y' integer coordinates representing the center of the element. Do not wrap in markdown blocks. Example: {"x": 500, "y": 300}`;

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inlineData: { mimeType: "image/jpeg", data: base64Image } }
          ]
        }],
        generationConfig: { temperature: 0.1 }
      })
    });

    if (!res.ok) {
      console.error(`[Hybrid Vision] Gemini API lỗi: ${res.statusText}`);
      return null;
    }

    const data = await res.json();
    let textObj = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // Clean up potential markdown formatting
    textObj = textObj.replace(/```json/g, '').replace(/```/g, '').trim();
    
    try {
      const coords = JSON.parse(textObj);
      if (typeof coords.x === 'number' && typeof coords.y === 'number') {
        console.log(`[Hybrid Vision] ✅ Đã tìm thấy tọa độ bằng mắt thần: X=${coords.x}, Y=${coords.y}`);
        return coords;
      }
    } catch (e) {
      console.error(`[Hybrid Vision] Không thể parse JSON từ Gemini: ${textObj}`);
    }
  } catch (err: unknown) {
    console.error(`[Hybrid Vision] Lỗi gọi API: ${(err as Error).message}`);
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function hybridClick(page: any, cssSelector: string, elementDescription: string, apiKey: string, timeout = 5000) {
  try {
    console.log(`[Hybrid] Thử click bằng CSS Selector tĩnh: ${cssSelector}`);
    await page.waitForSelector(cssSelector, { timeout });
    await page.click(cssSelector);
    console.log(`[Hybrid] ✅ Click DOM thành công: ${cssSelector}`);
  } catch (err) {
    console.warn(`[Hybrid] ⚠️ DOM Click thất bại (Quá ${timeout}ms). Kích hoạt Fallback Vision để tìm: ${elementDescription}...`);
    // Chụp ảnh màn hình (chất lượng 70 để tiết kiệm băng thông)
    const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 70 });
    const base64Image = screenshotBuffer.toString('base64');
    
    const coords = await askGeminiVisionForCoordinates(base64Image, elementDescription, apiKey);
    if (coords) {
      console.log(`[Hybrid] Fallback Vision thành công! Thực hiện click tọa độ (${coords.x}, ${coords.y})...`);
      await page.mouse.click(coords.x, coords.y);
      // Wait a moment for UI to respond after click
      await new Promise(r => setTimeout(r, 1000));
    } else {
      console.error(`[Hybrid] ❌ Fallback Vision thất bại. Không thể tìm thấy: ${elementDescription}. Vẫn ném lỗi DOM ban đầu.`);
      throw err;
    }
  }
}
// ==========================================

export async function POST(req: Request) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let browser: any;
  let userDataDirPath = '';
  
  let prompt = '';
  let chapterNum = 0;
  let sceneIndex = 0;
  let promptIndex = 0;
  let drivePath = '';
  let ten_tac_pham = '';
  let cookie = '';
  let characterPrompt = '';
  let useMock = false;

  let filename = '';
  let localSavePath = '';

  try {
    const body = await req.json();
    prompt = body.prompt || '';
    if (body.chapterNum === undefined || body.sceneIndex === undefined || body.promptIndex === undefined) {
      return NextResponse.json({ error: 'Thiếu thông số chương, phân cảnh hoặc chỉ số prompt.' }, { status: 400 });
    }

    chapterNum = body.chapterNum;
    sceneIndex = body.sceneIndex;
    promptIndex = body.promptIndex;
    drivePath = body.drivePath || '';
    ten_tac_pham = body.ten_tac_pham || '';
    cookie = body.cookie || '';
    characterPrompt = body.characterPrompt || '';
    useMock = !!body.useMock;
    const model = body.model || 'imagen3';
    const imageProvider = body.imageProvider || 'pollinations';
    const imageApiKey = body.imageApiKey || '';
    const imageAspectRatio = body.imageAspectRatio || '16:9';
    const aiMasterApiKey = body.aiMasterApiKey || '';

    filename = `chapter_${chapterNum}_scene_${sceneIndex}_prompt_${promptIndex}.png`;
    const publicImageDir = path.join(process.cwd(), 'public', 'images');
    console.log(`[generate-image] Start generation for c${chapterNum}-${promptIndex+1} (mock=${useMock}) | Model: ${model}`);
    if (!fs.existsSync(publicImageDir)) {
      fs.mkdirSync(publicImageDir, { recursive: true });
    }
    localSavePath = path.join(publicImageDir, filename);

    // Tự động giải mã apiKey và apiKeys từ request body
    const reqApiKey = body.apiKey || '';
    const reqApiKeys = body.apiKeys || [];

    const keysToTry: string[] = [];
    if (reqApiKey) keysToTry.push(reqApiKey);
    if (reqApiKeys && Array.isArray(reqApiKeys)) {
      reqApiKeys.forEach((k: string) => {
        if (k && !keysToTry.includes(k)) keysToTry.push(k);
      });
    }

    // Đọc thêm từ file apikey.txt cứng nếu có
    try {
      const localApiKeyPath = path.join(process.cwd(), 'apikey.txt');
      const fallbackApiKeyPath = 'C:\\Users\\Khanh\\Downloads\\tool sua\\CREATE VIDEO PRO 12052026\\CREATE VIDEO PRO 12052026\\apikey.txt';
      const defaultApiKeyPath = fs.existsSync(localApiKeyPath) ? localApiKeyPath : fallbackApiKeyPath;
      if (fs.existsSync(defaultApiKeyPath)) {
        const fileContent = fs.readFileSync(defaultApiKeyPath, 'utf8');
        const lines = fileContent.split('\n');
        for (const line of lines) {
          const key = line.trim();
          if (key && key.startsWith('AIzaSy') && !keysToTry.includes(key)) {
            keysToTry.push(key);
          }
        }
      }
    } catch (err) {
      console.log('[generate-image] Cannot read apikey.txt:', err);
    }

    // Function to save buffer to local and drive
    const saveImage = (imageBuffer: Buffer, method: string, usedApiKey?: string) => {
      fs.writeFileSync(localSavePath, imageBuffer);
      console.log(`[Image API] ✅ Sinh ảnh thành công! Method: ${method}, File: ${localSavePath}`);

      let driveSaved = false;
      let driveFilePath = '';
      if (drivePath && drivePath.trim().length > 0) {
        try {
          const cleanedDrivePath = drivePath.trim();
          let driveFolder = cleanedDrivePath;
          if (chapterNum > 0) {
            driveFolder = path.join(cleanedDrivePath, `Chương ${chapterNum}`);
          }
          if (!fs.existsSync(driveFolder)) {
            fs.mkdirSync(driveFolder, { recursive: true });
          }
          
          const scriptTitle = ten_tac_pham ? ten_tac_pham.replace(/[\/\\:\*\?"<>\|]/g, '_').trim() : 'Kịch Bản';
            
          let driveFilename = '';
          if (chapterNum === 0) {
            driveFilename = `${scriptTitle}_ConceptArt_NhanVat_${Date.now()}.png`;
          } else {
            driveFilename = `${scriptTitle}_Chuong_${chapterNum}_Canh_${sceneIndex}_Prompt_${promptIndex}.png`;
          }
          driveFilePath = path.join(driveFolder, driveFilename);
          
          fs.writeFileSync(driveFilePath, imageBuffer);
          driveSaved = true;
          console.log(`[Image API] Đã sao lưu vào Thư mục PC: ${driveFilePath}`);
        } catch (driveErr: unknown) {
          console.error(`[Image API] Cảnh báo - không thể lưu vào Drive: ${(driveErr as Error).message}`);
        }
      }

      return NextResponse.json({
        success: true,
        imagePath: `/api/serve-image?file=${encodeURIComponent(filename)}`,
        driveSaved,
        driveFilePath,
        method,
        usedApiKey
      });
    };

    const providerKeysToTry: string[] = [];
    if (imageApiKey) providerKeysToTry.push(imageApiKey);
    if (Array.isArray(body.apiKeys)) {
      body.apiKeys.forEach((k: string) => {
        if (k && !providerKeysToTry.includes(k)) providerKeysToTry.push(k);
      });
    }

    // --- MULTI-PROVIDER ROUTING ---
    const providerPrompt = characterPrompt 
      ? `${prompt}, subject details: ${characterPrompt}, cinematic lighting, highly detailed`
      : `${prompt}, cinematic lighting, highly detailed`;

    // 1. OPENAI (DALL-E 3)
    if (imageProvider === 'openai' && providerKeysToTry.length > 0) {
      console.log(`[Image API] Route: OpenAI DALL-E 3 (${providerKeysToTry.length} keys)`);
      
      let dallESize = "1024x1024";
      if (imageAspectRatio === '16:9') dallESize = "1792x1024";
      else if (imageAspectRatio === '9:16') dallESize = "1024x1792";
      
      for (const currentKey of providerKeysToTry) {
        try {
          const res = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${currentKey}`
            },
            body: JSON.stringify({
              model: "dall-e-3",
              prompt: providerPrompt,
              n: 1,
              size: dallESize
            })
          });
          if (res.ok) {
            const data = await res.json();
            const imageUrl = data.data[0].url;
            const imageRes = await fetch(imageUrl);
            const buffer = Buffer.from(await imageRes.arrayBuffer());
            return saveImage(buffer, 'OpenAI DALL-E 3', currentKey);
          } else {
            const err = await res.text();
            console.error(`[Image API] OpenAI failed with key ${currentKey.substring(0, 10)}...:`, err);
            continue;
          }
        } catch (err: unknown) {
          console.error(`[Image API] OpenAI error with key ${currentKey.substring(0, 10)}...:`, (err as Error).message);
          continue;
        }
      }
    }

    // 2. FAL.AI (Grok/Flux)
    if (imageProvider === 'falai' && providerKeysToTry.length > 0) {
      console.log(`[Image API] Route: Fal.ai (Flux) (${providerKeysToTry.length} keys)`);
      
      let falSize = "landscape_16_9";
      if (imageAspectRatio === '9:16') falSize = "portrait_16_9";
      else if (imageAspectRatio === '1:1') falSize = "square_1_1";
      else if (imageAspectRatio === '3:4') falSize = "portrait_4_3";
      else if (imageAspectRatio === '4:3') falSize = "landscape_4_3";

      for (const currentKey of providerKeysToTry) {
        try {
          const res = await fetch('https://fal.run/fal-ai/flux/dev', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Key ${currentKey}`
            },
            body: JSON.stringify({
              prompt: providerPrompt,
              image_size: falSize,
              num_inference_steps: 28,
              guidance_scale: 3.5,
            })
          });
          if (res.ok) {
            const data = await res.json();
            const imageUrl = data.images[0].url;
            const imageRes = await fetch(imageUrl);
            const buffer = Buffer.from(await imageRes.arrayBuffer());
            return saveImage(buffer, 'Fal.ai Flux', currentKey);
          } else {
            const err = await res.text();
            console.error(`[Image API] Fal.ai failed with key ${currentKey.substring(0, 10)}...:`, err);
            continue;
          }
        } catch (err: unknown) {
          console.error(`[Image API] Fal.ai error with key ${currentKey.substring(0, 10)}...:`, (err as Error).message);
          continue;
        }
      }
    }

    // 3. HUGGINGFACE (Meta/Llama 3 ecosystem or SD3)
    if (imageProvider === 'huggingface' && providerKeysToTry.length > 0) {
      console.log(`[Image API] Route: HuggingFace (${providerKeysToTry.length} keys)`);
      for (const currentKey of providerKeysToTry) {
        try {
          const res = await fetch('https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${currentKey}`
            },
            body: JSON.stringify({ inputs: providerPrompt })
          });
          if (res.ok) {
            const buffer = Buffer.from(await res.arrayBuffer());
            return saveImage(buffer, 'HuggingFace SDXL', currentKey);
          } else {
            const err = await res.text();
            console.error(`[Image API] HuggingFace failed with key ${currentKey.substring(0, 10)}...:`, err);
            continue;
          }
        } catch (err: unknown) {
          console.error(`[Image API] HuggingFace error with key ${currentKey.substring(0, 10)}...:`, (err as Error).message);
          continue;
        }
      }
    }

    // 4. GOOGLE GEMINI IMAGE API
    const imageModelIds = [
      'gemini-2.5-flash-image',
      'gemini-3.1-flash-image',
      'gemini-3-pro-image',
    ];

    if (imageProvider === 'gemini' && keysToTry.length > 0 && !useMock) {
      console.log(`[Image API] Route: Google Gemini API (${keysToTry.length} keys)`);
      
      let lastError = '';
      // eslint-disable-next-line prefer-const
      let success = false;

      for (let i = 0; i < keysToTry.length && !success; i++) {
        const currentKey = keysToTry[i];

        for (const apiModelId of imageModelIds) {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${apiModelId}:generateContent?key=${currentKey}`;
          
          try {
            const geminiPrompt = characterPrompt 
              ? `Generate an image (Aspect Ratio: ${imageAspectRatio}): ${prompt}, reference subject: ${characterPrompt}`
              : `Generate an image (Aspect Ratio: ${imageAspectRatio}): ${prompt}`;

            console.log(`[Image API] [Key ${i+1}/${keysToTry.length}] [Model: ${apiModelId}] Đang gửi: "${geminiPrompt.substring(0, 80)}..."`);
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 giây timeout
            
            const response = await fetch(url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                contents: [{ parts: [{ text: geminiPrompt }] }],
                generationConfig: { 
                  responseModalities: ["IMAGE", "TEXT"],
                },
                safetySettings: [
                  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
                ]
              }),
              signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
              const errText = await response.text();
              try {
                const errJson = JSON.parse(errText);
                lastError = errJson.error?.message || errText;
              } catch { lastError = errText; }
              console.warn(`[Image API] Key ${i+1} / ${apiModelId} failed (${response.status}): ${lastError.substring(0, 150)}`);
              
              // Nếu 429 (quota exceeded), thử key tiếp theo ngay
              if (response.status === 429) break;
              // Nếu 400 (key expired), thử key tiếp theo
              if (response.status === 400 && lastError.includes('expired')) break;
              continue; // Thử model tiếp theo
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const data = await response.json() as any;
            const parts = data.candidates?.[0]?.content?.parts || [];
            let imageBuffer: Buffer | null = null;

            for (const part of parts) {
              if (part.inlineData?.data) {
                imageBuffer = Buffer.from(part.inlineData.data, 'base64');
                break;
              }
            }

            if (!imageBuffer) {
              lastError = `Google không trả về dữ liệu ảnh. Phản hồi: ${JSON.stringify(data).substring(0, 200)}`;
              console.warn(`[Image API] Key ${i+1} / ${apiModelId} invalid response: ${lastError}`);
              continue;
            }

            // Ghi file cục bộ
            fs.writeFileSync(localSavePath, imageBuffer);
            console.log(`[Image API] ✅ Sinh ảnh thành công! Model: ${apiModelId}, Key: ${i+1}, File: ${localSavePath}`);

            // Ghi file Google Drive Desktop / Thư mục PC
            let driveSaved = false;
            let driveFilePath = '';
            if (drivePath && drivePath.trim().length > 0) {
              try {
                const cleanedDrivePath = drivePath.trim();
                let driveFolder = cleanedDrivePath;
                if (chapterNum > 0) {
                  driveFolder = path.join(cleanedDrivePath, `Chương ${chapterNum}`);
                }
                if (!fs.existsSync(driveFolder)) {
                  fs.mkdirSync(driveFolder, { recursive: true });
                }
                
                const scriptTitle = ten_tac_pham 
                  ? ten_tac_pham.replace(/[\/\\:\*\?"<>\|]/g, '_').trim() 
                  : 'Kịch Bản';
                  
                let driveFilename = '';
                if (chapterNum === 0) {
                  driveFilename = `${scriptTitle}_ConceptArt_NhanVat_${Date.now()}.png`;
                } else {
                  driveFilename = `${scriptTitle}_Chuong_${chapterNum}_Canh_${sceneIndex}_Prompt_${promptIndex}.png`;
                }
                driveFilePath = path.join(driveFolder, driveFilename);
                
                fs.writeFileSync(driveFilePath, imageBuffer);
                driveSaved = true;
                console.log(`[Image API] Đã sao lưu vào Thư mục PC: ${driveFilePath}`);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              } catch (driveErr: any) {
                console.error(`[Image API] Cảnh báo - không thể lưu vào Drive: ${driveErr.message}`);
              }
            }

            return NextResponse.json({
              success: true,
              imagePath: `/api/serve-image?file=${encodeURIComponent(filename)}`,
              driveSaved,
              driveFilePath,
              method: `Google Gemini Image API (${apiModelId})`,
              usedApiKey: currentKey
            });

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } catch (err: any) {
            lastError = err.message || String(err);
            console.warn(`[Image API] Key ${i+1} / ${apiModelId} exception: ${lastError}`);
          }
        }
      }

      console.warn(`[Image API] Tất cả keys/models đều thất bại. Lỗi cuối: ${lastError.substring(0, 200)}. Chuyển sang luồng dự phòng...`);
    }

    // 5. POLLINATIONS AI (FALLBACK VÀ DEFAULT NẾU CHỌN POLLINATIONS HOẶC LỖI TẤT CẢ)
    if (imageProvider === 'pollinations' || useMock || !cookie || cookie.trim().length === 0) {
      console.log(`[Pollinations AI] Đang tạo ảnh thật miễn phí cho Cảnh ${sceneIndex} Prompt ${promptIndex}...`);
      
      const seed = Math.floor(Math.random() * 1000000000);
      let width = 1280;
      let height = 720;
      if (imageAspectRatio === '9:16') { width = 720; height = 1280; }
      else if (imageAspectRatio === '1:1') { width = 1024; height = 1024; }
      else if (imageAspectRatio === '3:4') { width = 768; height = 1024; }
      else if (imageAspectRatio === '4:3') { width = 1024; height = 768; }

      const pollUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(providerPrompt)}?width=${width}&height=${height}&seed=${seed}&nologo=true`;
      
      try {
        const res = await fetch(pollUrl);
        if (!res.ok) throw new Error(`Lỗi tải ảnh từ Pollinations: ${res.statusText}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        return saveImage(buffer, 'Pollinations AI (Miễn phí)');
      } catch (err: unknown) {
        console.error('[Pollinations AI] Lỗi sinh ảnh:', (err as Error).message);
      }
    }

    // NẾU TẤT CẢ ĐỀU LỖI, CHẠY MOCK HOẶC BÁO LỖI (Ở ĐÂY GIỮ LẠI LOGIC WHISK JS NẾU CẦN)
    if (useMock || !cookie || cookie.trim().length === 0) {
      console.log(`[Whisk AI Mock] Đang tạo ảnh giả lập chất lượng cao cho Cảnh ${sceneIndex} Prompt ${promptIndex}...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Tạo ảnh SVG chứa mô tả bối cảnh để hiển thị sinh động trong UI
      const cleanPrompt = (prompt || '').replace(/["']/g, '&apos;');
      const mockSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" width="800" height="450">
        <rect width="100%" height="100%" fill="#050508"/>
        <defs>
          <linearGradient id="neonGlow" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#f59e0b" stop-opacity="0.12"/>
            <stop offset="50%" stop-color="#050508" stop-opacity="0.0"/>
            <stop offset="100%" stop-color="#10b981" stop-opacity="0.05"/>
          </linearGradient>
          <radialGradient id="radialAmbient" cx="50%" cy="40%" r="70%">
            <stop offset="0%" stop-color="#06b6d4" stop-opacity="0.1"/>
            <stop offset="100%" stop-color="#050508" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#neonGlow)"/>
        <rect width="100%" height="100%" fill="url(#radialAmbient)"/>
        
        <!-- Premium Viewfinder Corner Brackets -->
        <path d="M 40 80 L 40 40 L 80 40" fill="none" stroke="#f59e0b" stroke-width="2" stroke-opacity="0.6"/>
        <path d="M 720 40 L 760 40 L 760 80" fill="none" stroke="#f59e0b" stroke-width="2" stroke-opacity="0.6"/>
        <path d="M 40 370 L 40 410 L 80 410" fill="none" stroke="#f59e0b" stroke-width="2" stroke-opacity="0.6"/>
        <path d="M 720 410 L 760 410 L 760 370" fill="none" stroke="#f59e0b" stroke-width="2" stroke-opacity="0.6"/>
        
        <!-- Subtle Grid Decoration -->
        <rect x="50" y="50" width="700" height="350" fill="none" stroke="#ffffff" stroke-width="1" stroke-opacity="0.03" stroke-dasharray="10 10"/>
        
        <text x="400" y="140" fill="#f59e0b" font-family="monospace" font-size="12" font-weight="bold" letter-spacing="4" text-anchor="middle">IMAGEN 3 AI STUDIO • PREVIEW</text>
        <text x="400" y="180" fill="#ffffff" font-family="sans-serif" font-size="16" font-weight="bold" text-anchor="middle">CHƯƠNG ${chapterNum} • CẢNH ${sceneIndex + 1} • PROMPT ${promptIndex + 1}</text>
        
        <rect x="100" y="220" width="600" height="120" rx="6" fill="#09090b" fill-opacity="0.8" stroke="#27272a" stroke-width="1"/>
        <foreignObject x="120" y="235" width="560" height="90">
          <div xmlns="http://www.w3.org/1999/xhtml" style="color:#a1a1aa; font-family:sans-serif; font-size:11px; line-height:1.6; text-align:center; height:100%; overflow:hidden;">
            <strong style="color:#e4e4e7;">Prompt:</strong> ${cleanPrompt}
            ${characterPrompt ? `<br/><strong style="color:#10b981;">Nhân vật:</strong> ${characterPrompt.substring(0, 150)}...` : ''}
          </div>
        </foreignObject>
        <text x="400" y="390" fill="#71717a" font-family="sans-serif" font-size="10" text-anchor="middle">💡 Vui lòng bật Pay-as-you-go trên Google AI Studio hoặc cấu hình Cookie để sinh ảnh thật.</text>
      </svg>`;

      fs.writeFileSync(localSavePath, Buffer.from(mockSvg));

      // Đồng bộ hóa vào Drive
      let driveSaved = false;
      let driveFilePath = '';
      if (drivePath && drivePath.trim().length > 0) {
        const cleanedDrivePath = drivePath.trim();
        if (!fs.existsSync(cleanedDrivePath)) {
          fs.mkdirSync(cleanedDrivePath, { recursive: true });
        }
        const driveFolder = path.join(cleanedDrivePath, `Chương ${chapterNum}`);
        if (!fs.existsSync(driveFolder)) fs.mkdirSync(driveFolder, { recursive: true });
        driveFilePath = path.join(driveFolder, filename);
        fs.writeFileSync(driveFilePath, Buffer.from(mockSvg));
        driveSaved = true;
      }

      return NextResponse.json({
        success: true,
        imagePath: `/api/serve-image?file=${encodeURIComponent(filename)}`,
        driveSaved,
        driveFilePath,
        method: 'Mock SVG Builder'
      });
    }

    // LUỒNG AUTOMATION THẬT SỬ DỤNG PUPPETEER STEALTH
    console.log(`[Whisk Automation] Khởi động trình duyệt sinh ảnh ngầm (Headless) cho Prompt ${promptIndex}...`);
    
    // Tạo tên thư mục sandbox cô lập hoàn hảo để chạy nhiều luồng song song không bị xung đột
    const threadFolder = chapterNum === 0
      ? `chrome-whisk-thread-char-${promptIndex}-${Date.now()}`
      : `chrome-whisk-thread-${chapterNum}-${sceneIndex}-${promptIndex}-${Date.now()}`;
    userDataDirPath = path.join(process.cwd(), 'scratch', threadFolder);

    const chromePath = findChromePath();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const launchOptions: any = {
      headless: true, // Chạy ẩn hoàn toàn (Headless)
      defaultViewport: { width: 1280, height: 800 },
      userDataDir: userDataDirPath,
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--window-size=1280,800'
      ]
    };

    if (chromePath) {
      launchOptions.executablePath = chromePath;
    }

    const puppeteer = addExtra(puppeteerCore);
    puppeteer.use(StealthPlugin());
    browser = await puppeteer.launch(launchOptions);

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

    // Cài đặt cờ Webdriver ẩn danh
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    // Nạp Cookie của Google Labs Whisk một cách an toàn để tránh lỗi "Invalid cookie fields"
    // BÍ QUYẾT: Nhân bản cookie sang cả các domain .google.com và .google / labs.google
    // Vì Google AI Studio nằm trên .google.com, còn Google Labs Whisk nằm trên .google (labs.google)
    const domainsToInject = ['.google.com', '.google', 'labs.google', '.labs.google'];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsedCookies: any[] = [];

    cookie.split(';').forEach((c: string) => {
      const trimmed = c.trim();
      if (!trimmed || !trimmed.includes('=')) return;
      
      const eqIdx = trimmed.indexOf('=');
      const name = trimmed.substring(0, eqIdx).trim();
      const value = trimmed.substring(eqIdx + 1).trim();
      
      if (!name || value === undefined) return;
      
      domainsToInject.forEach(domain => {
        parsedCookies.push({
          name,
          value,
          domain,
          path: '/',
          secure: true,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          sameSite: 'None' as any
        });
      });
    });

    if (parsedCookies.length > 0) {
      try {
        await page.setCookie(...parsedCookies);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (cookieErr: any) {
        console.warn('[Whisk Cookie Parser] Cảnh báo lỗi nạp toàn bộ cookies. Đang thử nạp từng cookie đơn lẻ:', cookieErr.message);
        for (const singleCookie of parsedCookies) {
          try {
            await page.setCookie(singleCookie);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } catch (singleErr: any) {
            console.warn(`[Whisk Cookie Parser] Bỏ qua cookie không hợp lệ (${singleCookie.name}):`, singleErr.message);
          }
        }
      }
    }
    
    // Điều hướng vào Google Labs Whisk
    const whiskUrl = 'https://labs.google/fx/tools/flow?from=whisk';
    console.log(`[Whisk Automation] Đang mở Whisk: ${whiskUrl}`);
    await page.goto(whiskUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    // Thử kiểm tra xem có bị chuyển hướng tới trang đăng nhập Google hay không
    const currentUrl = page.url();
    if (currentUrl.includes('accounts.google.com') || currentUrl.includes('signin')) {
      throw new Error('Cookie Google Studio đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại Google Labs và sao chép Cookie mới.');
    }

    // TÍCH HỢP AGENTIC RPA (AI TƯ DUY) THAY THẾ CHO HARD-CODED SCRIPT
    console.log(`[Agentic RPA] Bắt đầu trao quyền điều khiển cho BrowserAgent...`);
    let whiskPrompt = prompt;
    if (characterPrompt) {
      whiskPrompt = `${prompt}, reference subject: ${characterPrompt}`;
    }

    const browserAgent = new BrowserAgent(page, aiMasterApiKey || keysToTry[0] || '', 'gemini-1.5-pro');
    
    // Yêu cầu AI tự xử lý các công việc: tắt popup, tạo project, gõ prompt, ấn nút generate.
    const agentGoal = `
    1. If there is a welcome popup ("Làm quen với Flow", "Welcome", etc.), close it.
    2. If you are on a dashboard, find the "New Project" or "Create project" button, click it, name it "${ten_tac_pham || 'Kịch Bản mới'}", and create it.
    3. Once inside the editor, find the main text area (textbox). Click it, clear it if needed, and type EXACTLY this prompt: "${whiskPrompt.substring(0, 150)}...".
    4. Find the "Generate", "Create", or submit button and click it to start generating the image.
    5. After clicking generate, you are DONE. Return action="done".
    `;

    const cacheKey = `Google-Labs-Whisk-Image`;
    const agentResult = await browserAgent.runAgenticWorkflow(agentGoal, cacheKey);
    if (!agentResult.success) {
      console.warn(`[Agentic RPA] AI báo cáo lỗi: ${agentResult.message}. Có thể UI thay đổi quá lớn, nhưng vẫn thử chờ ảnh...`);
    } else {
      console.log(`[Agentic RPA] AI đã thực thi xong chuỗi hành động! Đang dò tìm ảnh...`);
    }

    console.log(`[Whisk Automation] Đã kích hoạt sinh ảnh. Bắt đầu quét kết quả (Đang dò tìm ảnh mới)...`);

    let imgSrc: string | null = null;
    const initialUrls: string[] = [];
    const startTime = Date.now();
    const timeoutMs = 95000; // 95 giây tối đa cho những lúc mạng chậm hoặc Google Labs quá tải

    while (Date.now() - startTime < timeoutMs) {
      imgSrc = await page.evaluate((exUrls: string[]) => {
        const currentUrls: string[] = [];

        // 1. Quét img
        document.querySelectorAll('img').forEach(img => {
          const src = img.src || '';
          if (!src || (!src.startsWith('http') && !src.startsWith('blob:'))) return;
          if (exUrls.includes(src)) return; // Bỏ qua ảnh đã tồn tại trước đó
          
          // Lọc bỏ ảnh placeholder của Google Labs Whisk (Flask beaker icon) đang trong tiến trình sinh
          if (src.includes('MHJnT86uQC6FDhv') || src.includes('labs.google/fx') || src.includes('placeholder')) {
            return;
          }

          // Lọc bỏ avatar & profiles
          if (src.includes('googleusercontent.com/a/') || src.includes('googleusercontent.com/a-/') || src.includes('avatar') || src.includes('profile')) {
            return;
          }
          if (src.includes('=s32') || src.includes('=s48') || src.includes('=s64') || src.includes('=s96') || src.includes('=s128')) {
            return;
          }
          if (img.closest('header, [role="banner"], nav, .header, .profile, .avatar, [class*="avatar"], [class*="profile"]')) {
            return;
          }

          currentUrls.push(src);
        });

        // 2. Quét div background-image
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        document.querySelectorAll('div, [style*="background-image"]').forEach((el: any) => {
          const style = el.style.backgroundImage || window.getComputedStyle(el).backgroundImage;
          if (style && style !== 'none' && style.startsWith('url(')) {
            const match = style.match(/url\(["']?([^"']+)["']?\)/);
            if (match && match[1]) {
              const src = match[1];
              if (!src || (!src.startsWith('http') && !src.startsWith('blob:'))) return;
              if (exUrls.includes(src)) return; // Bỏ qua ảnh cũ
              
              // Lọc bỏ ảnh placeholder của Google Labs Whisk (Flask beaker icon) đang trong tiến trình sinh
              if (src.includes('MHJnT86uQC6FDhv') || src.includes('labs.google/fx') || src.includes('placeholder')) {
                return;
              }

              if (src.includes('googleusercontent.com/a/') || src.includes('googleusercontent.com/a-/') || src.includes('avatar') || src.includes('profile')) {
                return;
              }
              if (src.includes('=s32') || src.includes('=s48') || src.includes('=s64') || src.includes('=s96') || src.includes('=s128')) {
                return;
              }
              if (el.closest('header, [role="banner"], nav, .header, .profile, .avatar, [class*="avatar"], [class*="profile"]')) {
                return;
              }

              currentUrls.push(src);
            }
          }
        });

        // Lọc trùng và trả về url đầu tiên tìm thấy
        const unique = Array.from(new Set(currentUrls));
        return unique.length > 0 ? unique[0] : null;
      }, initialUrls);

      if (imgSrc) {
        console.log(`[Whisk Automation] Tìm thấy ảnh mới thành công sau ${Math.round((Date.now() - startTime) / 1000)} giây!`);
        break;
      }

      // Thử kiểm tra xem có bị chuyển hướng tới trang đăng nhập Google hay không
      const currentUrl = page.url();
      if (currentUrl.includes('accounts.google.com') || currentUrl.includes('signin')) {
        throw new Error('Cookie Google Studio đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại Google Labs và sao chép Cookie mới.');
      }

      await new Promise(resolve => setTimeout(resolve, 2000)); // Chờ 2 giây trước khi quét lại
    }

    if (!imgSrc) {
      throw new Error('Whisk đã hoàn thành nhưng không tìm thấy ảnh kết quả mới trên giao diện. (Vui lòng kiểm tra Cookie hoặc kết nối 1.1.1.1)');
    }

    console.log(`[Whisk Automation] Đã định vị ảnh thành công! URL: ${imgSrc.substring(0, 100)}...`);

    // Tải ảnh về dạng Buffer
    let imageBuffer: Buffer;
    if (imgSrc.startsWith('blob:')) {
      // Đối với Blob URL, chúng ta đọc trực tiếp qua browser context
      const base64Data = await page.evaluate(async (blobUrl: string) => {
        const response = await fetch(blobUrl);
        const blob = await response.blob();
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
      }, imgSrc);
      const base64String = (base64Data as string).split(',')[1];
      imageBuffer = Buffer.from(base64String, 'base64');
    } else {
      const imgRes = await fetch(imgSrc);
      if (!imgRes.ok) throw new Error('Không thể tải ảnh từ URL Google Cloud.');
      const arrayBuffer = await imgRes.arrayBuffer();
      imageBuffer = Buffer.from(arrayBuffer);
    }

    // Ghi file cục bộ
    fs.writeFileSync(localSavePath, imageBuffer);
    console.log(`[Whisk Automation] Lưu ảnh thành công tại: ${localSavePath}`);

    // Ghi file Google Drive Desktop
    let driveSaved = false;
    let driveFilePath = '';
    if (drivePath && drivePath.trim().length > 0) {
      try {
        const cleanedDrivePath = drivePath.trim();
        let driveFolder = cleanedDrivePath;
        if (chapterNum > 0) {
          driveFolder = path.join(cleanedDrivePath, `Chương ${chapterNum}`);
        }
        if (!fs.existsSync(driveFolder)) {
          fs.mkdirSync(driveFolder, { recursive: true });
        }
        
        const scriptTitle = ten_tac_pham 
          ? ten_tac_pham.replace(/[\/\\:\*\?"<>\|]/g, '_').trim() 
          : 'Kịch Bản';
          
        let driveFilename = '';
        if (chapterNum === 0) {
          driveFilename = `${scriptTitle}_ConceptArt_NhanVat_${Date.now()}.png`;
        } else {
          driveFilename = `${scriptTitle}_Chuong_${chapterNum}_Canh_${sceneIndex}_Prompt_${promptIndex}.png`;
        }
        driveFilePath = path.join(driveFolder, driveFilename);
        
        fs.writeFileSync(driveFilePath, imageBuffer);
        driveSaved = true;
        console.log(`[Whisk Automation] Đã lưu sao lưu Thư mục PC: ${driveFilePath}`);
      } catch {}
    }

    return NextResponse.json({
      success: true,
      imagePath: `/api/serve-image?file=${encodeURIComponent(filename)}`,
      driveSaved,
      driveFilePath,
      projectUrl: page.url(),
      method: 'Google Labs Whisk Automation'
    });

  } catch (err: unknown) {
    console.error('[Whisk Automation] Lỗi tiến trình, đang chuyển đổi chế độ sinh ảnh PNG chất lượng cao dự phòng:', (err as Error).message);
    
    // Tự động chụp lại ảnh lỗi của trình duyệt ngầm để chẩn đoán
    if (browser) {
      try {
        const pages = await browser.pages();
        if (pages.length > 0) {
          const currentPage = pages[0];
          const currentUrl = currentPage.url();
          console.log(`[Whisk Diagnostics] URL tại thời điểm lỗi: "${currentUrl}"`);
          try {
            const bodyText = await currentPage.evaluate(() => document.body ? document.body.innerText : 'Empty Body');
            console.log(`[Whisk Diagnostics] Nội dung trang lỗi (500 ký tự đầu): "${bodyText.substring(0, 500).replace(/\n/g, ' ')}"`);
          } catch {}
          
          const publicImgDir = path.join(process.cwd(), 'public', 'images');
          if (!fs.existsSync(publicImgDir)) {
            fs.mkdirSync(publicImgDir, { recursive: true });
          }
          const diagPath = path.join(publicImgDir, 'whisk_error_screenshot.png');
          await currentPage.screenshot({ path: diagPath });
          console.log(`[Whisk Diagnostics] Đã chụp màn hình lỗi tại: ${diagPath}`);
        }
      } catch {}
    }

    // KHỞI ĐỘNG HÀNH TRÌNH TỰ ĐỘNG VẼ ẢNH PNG DỰ PHÒNG CHẤT LƯỢNG CAO TRONG PUPPETEER
    if (browser) {
      try {
        console.log('[Whisk Fallback] Đang tiến hành vẽ ảnh PNG dự phòng chất lượng cao qua Puppeteer...');
        const pages = await browser.pages();
        const activePage = pages.length > 0 ? pages[0] : await browser.newPage();
        
        await activePage.setViewport({ width: 800, height: 450 });
        
        const cleanPrompt = (prompt || '').replace(/["']/g, '&apos;');
        const mockSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" width="800" height="450" style="background:#050508; display:block; margin:0; padding:0; box-sizing:border-box;">
          <rect width="100%" height="100%" fill="#050508"/>
          <defs>
            <linearGradient id="neonGlow" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#f59e0b" stop-opacity="0.12"/>
              <stop offset="50%" stop-color="#050508" stop-opacity="0.0"/>
              <stop offset="100%" stop-color="#10b981" stop-opacity="0.05"/>
            </linearGradient>
            <radialGradient id="radialAmbient" cx="50%" cy="40%" r="70%">
              <stop offset="0%" stop-color="#06b6d4" stop-opacity="0.1"/>
              <stop offset="100%" stop-color="#050508" stop-opacity="0"/>
            </radialGradient>
          </defs>
          <rect width="100%" height="100%" fill="url(#neonGlow)"/>
          <rect width="100%" height="100%" fill="url(#radialAmbient)"/>
          
          <!-- Premium Viewfinder Corner Brackets -->
          <path d="M 40 80 L 40 40 L 80 40" fill="none" stroke="#f59e0b" stroke-width="2" stroke-opacity="0.6"/>
          <path d="M 720 40 L 760 40 L 760 80" fill="none" stroke="#f59e0b" stroke-width="2" stroke-opacity="0.6"/>
          <path d="M 40 370 L 40 410 L 80 410" fill="none" stroke="#f59e0b" stroke-width="2" stroke-opacity="0.6"/>
          <path d="M 720 410 L 760 410 L 760 370" fill="none" stroke="#f59e0b" stroke-width="2" stroke-opacity="0.6"/>
          
          <!-- Subtle Grid Decoration -->
          <rect x="50" y="50" width="700" height="350" fill="none" stroke="#ffffff" stroke-width="1" stroke-opacity="0.03" stroke-dasharray="10 10"/>
          
          <text x="400" y="140" fill="#f59e0b" font-family="monospace" font-size="12" font-weight="bold" letter-spacing="4" text-anchor="middle">IMAGEN 3 AI STUDIO • FALLBACK PREVIEW</text>
          <text x="400" y="180" fill="#ffffff" font-family="sans-serif" font-size="16" font-weight="bold" text-anchor="middle">CHƯƠNG ${chapterNum} • CẢNH ${sceneIndex === 999 ? 'NHÂN VẬT' : sceneIndex + 1} • PROMPT ${promptIndex === 999 ? 'CHÂN DUNG' : promptIndex + 1}</text>
          
          <rect x="100" y="220" width="600" height="120" rx="6" fill="#09090b" fill-opacity="0.8" stroke="#27272a" stroke-width="1"/>
          <foreignObject x="120" y="235" width="560" height="90">
            <div xmlns="http://www.w3.org/1999/xhtml" style="color:#a1a1aa; font-family:sans-serif; font-size:11px; line-height:1.6; text-align:center; height:100%; overflow:hidden;">
              <strong style="color:#e4e4e7;">Prompt:</strong> ${cleanPrompt}
              ${characterPrompt ? `<br/><strong style="color:#10b981;">Nhân vật:</strong> ${characterPrompt.substring(0, 150)}...` : ''}
            </div>
          </foreignObject>
          <text x="400" y="390" fill="#71717a" font-family="sans-serif" font-size="10" text-anchor="middle">💡 Vui lòng kích hoạt gói Pay-as-you-go trên Google AI Studio hoặc cập nhật Cookies để vẽ ảnh thật.</text>
        </svg>`;

        await activePage.setContent(`<html><head><style>html,body{margin:0;padding:0;overflow:hidden;background:#050508;}</style></head><body>${mockSvg}</body></html>`);
        await new Promise(r => setTimeout(r, 500)); // Đợi render xong
        
        const fallbackPng = await activePage.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 800, height: 450 } });
        
        // Ghi file cục bộ
        fs.writeFileSync(localSavePath, fallbackPng);
        console.log(`[Whisk Fallback] Đã tự động vẽ và lưu ảnh PNG dự phòng thành công tại: ${localSavePath}`);

        // Ghi file Google Drive Desktop
        let driveSaved = false;
        let driveFilePath = '';
        if (drivePath && drivePath.trim().length > 0) {
          try {
            const cleanedDrivePath = drivePath.trim();
            let driveFolder = cleanedDrivePath;
            if (chapterNum > 0) {
              driveFolder = path.join(cleanedDrivePath, `Chương ${chapterNum}`);
            }
            if (!fs.existsSync(driveFolder)) {
              fs.mkdirSync(driveFolder, { recursive: true });
            }
            
            const scriptTitle = ten_tac_pham 
              ? ten_tac_pham.replace(/[\/\\:\*\?"<>\|]/g, '_').trim() 
              : 'Kịch Bản';
              
            let driveFilename = '';
            if (chapterNum === 0) {
              driveFilename = `${scriptTitle}_ConceptArt_NhanVat_${Date.now()}.png`;
            } else {
              driveFilename = `${scriptTitle}_Chuong_${chapterNum}_Canh_${sceneIndex}_Prompt_${promptIndex}.png`;
            }
            driveFilePath = path.join(driveFolder, driveFilename);
            fs.writeFileSync(driveFilePath, fallbackPng);
            driveSaved = true;
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          } catch (driveErr) {}
        }

        return NextResponse.json({
          success: true,
          imagePath: `/api/serve-image?file=${encodeURIComponent(filename)}`,
          driveSaved,
          driveFilePath,
          method: 'Fallback PNG Visual Builder',
          warning: 'Cookie Google Studio hết hạn. Đã tự động chuyển đổi ảnh PNG dự phòng chất lượng cao thành công.'
        });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (fallbackErr: any) {
        console.error('[Whisk Fallback] Thất bại khi tạo ảnh PNG dự phòng:', fallbackErr.message);
      }
    }

    return NextResponse.json(
      { error: (err as Error).message || 'Lỗi xảy ra trong quá trình kết nối Google Labs Whisk.' },
      { status: 500 }
    );
  } finally {
    if (browser) {
      try {
        await browser.close();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e) {}
    }
    if (userDataDirPath && fs.existsSync(userDataDirPath)) {
      try {
        fs.rmSync(userDataDirPath, { recursive: true, force: true });
        console.log(`[Whisk Thread Cleanup] Đã dọn dẹp thư mục sandbox đa luồng: ${userDataDirPath}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (cleanErr: any) {
        console.warn(`[Whisk Thread Cleanup] Cảnh báo - không thể dọn dẹp thư mục sandbox: ${cleanErr.message}`);
      }
    }
  }
}
