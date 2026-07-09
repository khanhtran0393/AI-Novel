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
    const model = body.model || 'imagen3';
    const imageProvider = body.imageProvider || '';
    if (!imageProvider) {
      return NextResponse.json({ error: 'Image provider is required. Choose openai, gemini, or grok.' }, { status: 400 });
    }
    if (!['openai', 'gemini', 'grok'].includes(imageProvider)) {
      return NextResponse.json({ error: `[Image API] Provider ${imageProvider} khong duoc ho tro trong che do production.` }, { status: 400 });
    }
    const imageApiKey = body.imageApiKey || '';
    const imageAspectRatio = body.imageAspectRatio || '16:9';
    const imageCount = Math.max(1, Math.min(4, Number(body.imageCount) || 1));
    const aiMasterApiKey = body.aiMasterApiKey || '';

    filename = `chapter_${chapterNum}_scene_${sceneIndex}_prompt_${promptIndex}.png`;
    const publicImageDir = path.join(process.cwd(), 'public', 'images');
    console.log(`[generate-image] Start real generation for c${chapterNum}-${promptIndex+1} | Provider: ${imageProvider} | Model: ${model}`);
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
      if (fs.existsSync(localApiKeyPath)) {
        const fileContent = fs.readFileSync(localApiKeyPath, 'utf8');
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

    const getVariantFilename = (variantIndex: number) => {
      if (variantIndex === 0) return filename;
      return `chapter_${chapterNum}_scene_${sceneIndex}_prompt_${promptIndex}_v${variantIndex + 1}.png`;
    };

    const saveImageBuffers = (imageBuffers: Buffer[], method: string, usedApiKey?: string) => {
      const buffers = imageBuffers.filter(Boolean).slice(0, imageCount);
      if (buffers.length === 0) {
        return NextResponse.json({ error: `[Image API] ${method} không trả về ảnh hợp lệ.` }, { status: 500 });
      }

      const imagePaths: string[] = [];
      const driveFilePaths: string[] = [];
      let driveSaved = false;

      buffers.forEach((imageBuffer, variantIndex) => {
        const variantFilename = getVariantFilename(variantIndex);
        const variantLocalSavePath = path.join(publicImageDir, variantFilename);
        fs.writeFileSync(variantLocalSavePath, imageBuffer);
        imagePaths.push(`/api/serve-image?file=${encodeURIComponent(variantFilename)}`);
        console.log(`[Image API] Saved ${method} image ${variantIndex + 1}/${buffers.length}: ${variantLocalSavePath}`);

        if (drivePath && drivePath.trim().length > 0) {
          try {
            const cleanedDrivePath = drivePath.trim();
            let driveFolder = cleanedDrivePath;
            if (chapterNum > 0) {
              driveFolder = path.join(cleanedDrivePath, `Chuong ${chapterNum}`);
            }
            if (!fs.existsSync(driveFolder)) {
              fs.mkdirSync(driveFolder, { recursive: true });
            }

            const scriptTitle = ten_tac_pham ? ten_tac_pham.replace(/[\/\\:\*\?"<>\|]/g, '_').trim() : 'Kich Ban';
            const suffix = buffers.length > 1 ? `_V${variantIndex + 1}` : '';
            const driveFilename = chapterNum === 0
              ? `${scriptTitle}_ConceptArt_NhanVat_${Date.now()}${suffix}.png`
              : `${scriptTitle}_Chuong_${chapterNum}_Canh_${sceneIndex}_Prompt_${promptIndex}${suffix}.png`;
            const driveFilePath = path.join(driveFolder, driveFilename);
            fs.writeFileSync(driveFilePath, imageBuffer);
            driveFilePaths.push(driveFilePath);
            driveSaved = true;
            console.log(`[Image API] Copied generated image to save folder: ${driveFilePath}`);
          } catch (driveErr: unknown) {
            console.error(`[Image API] Save-folder warning: ${(driveErr as Error).message}`);
          }
        }
      });

      return NextResponse.json({
        success: true,
        imagePath: imagePaths[0],
        imagePaths,
        driveSaved,
        driveFilePath: driveFilePaths[0] || '',
        driveFilePaths,
        method,
        usedApiKey
      });
    };

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
        imagePaths: [`/api/serve-image?file=${encodeURIComponent(filename)}`],
        driveSaved,
        driveFilePath,
        driveFilePaths: driveFilePath ? [driveFilePath] : [],
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

    // --- MULTI-PROVIDER ROUTING (NO FALLBACK) ---
    const providerPrompt = characterPrompt
      ? `${prompt}. Subject reference details: ${characterPrompt}. Keep every named character visually separated by role, position, wardrobe, and action.`
      : prompt;

    // 1. OPENAI (DALL-E 3)
    if (imageProvider === 'openai') {
      if (providerKeysToTry.length === 0) {
        return NextResponse.json({ error: '[OpenAI Error] Vui lòng cấu hình OpenAI API Key để sinh ảnh.' }, { status: 400 });
      }
      
      let dallESize = "1024x1024";
      if (imageAspectRatio === '16:9' || imageAspectRatio === '3:2') dallESize = "1792x1024";
      else if (imageAspectRatio === '9:16' || imageAspectRatio === '2:3' || imageAspectRatio === '4:5') dallESize = "1024x1792";
      
      let lastError = '';
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
            lastError = await res.text();
            try { lastError = JSON.parse(lastError).error?.message || lastError; } catch {}
          }
        } catch (err: any) {
          lastError = err.message;
        }
      }
      return NextResponse.json({ error: `[OpenAI DALL-E 3 Error] ${lastError}` }, { status: 500 });
    }

    // 5. xAI GROK
    if (imageProvider === 'grok') {
      const grokKeys: string[] = [];
      if (body.grokApiKey) grokKeys.push(body.grokApiKey);
      if (body.grokApiKeys && Array.isArray(body.grokApiKeys)) {
        body.grokApiKeys.forEach((k: string) => { if (k && !grokKeys.includes(k)) grokKeys.push(k); });
      }
      providerKeysToTry.forEach(k => { if (k && !grokKeys.includes(k)) grokKeys.push(k); });
      keysToTry.forEach(k => { if (k && !grokKeys.includes(k)) grokKeys.push(k); });

      if (grokKeys.length === 0) {
        return NextResponse.json({ error: '[xAI Grok Error] Vui lòng cấu hình xAI Grok API Key để sinh ảnh.' }, { status: 400 });
      }

      let lastError = '';
      for (const currentKey of grokKeys) {
        try {
          const res = await fetch('https://api.x.ai/v1/images/generations', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${currentKey}`
            },
            body: JSON.stringify({
              model: "grok-imagine-image-quality",
              prompt: providerPrompt,
              n: imageCount
            })
          });
          if (res.ok) {
            const data = await res.json();
            const imageUrls = (data.data || []).map((image: { url?: string }) => image.url).filter(Boolean).slice(0, imageCount);
            const buffers = await Promise.all(imageUrls.map(async (imageUrl: string) => {
              const imageRes = await fetch(imageUrl);
              return Buffer.from(await imageRes.arrayBuffer());
            }));
            return saveImageBuffers(buffers, 'xAI Grok-2', currentKey);
          } else {
            lastError = await res.text();
            try { lastError = JSON.parse(lastError).error || lastError; } catch {}
          }
        } catch (err: any) {
          lastError = err.message;
        }
      }
      return NextResponse.json({ error: `[xAI Grok-2 Error] ${lastError}` }, { status: 500 });
    }

    // 6. GOOGLE GEMINI (IMAGEN 3)
    if (imageProvider === 'gemini') {
      // Nếu không có API Key nhưng có cookie -> Chuyển sang Whisk Automation (Headless Browser)
      if (model === 'whisk' && (!cookie || cookie.trim().length === 0)) {
        return NextResponse.json({ error: '[Google Whisk Error] Vui long cau hinh Cookie Google Studio de chay Whisk.' }, { status: 400 });
      }
      if ((model === 'whisk' || keysToTry.length === 0) && cookie && cookie.trim().length > 0) {
         console.log(`[Image API] Không có API Key. Kích hoạt luồng Google Labs Whisk Automation bằng Cookie...`);
      } else {
         if (keysToTry.length === 0) {
           return NextResponse.json({ error: '[Google Imagen Error] Vui lòng cấu hình Google Studio API Key hoặc Cookie để sinh ảnh.' }, { status: 400 });
         }

         const imageModelIds = ['imagen-3.0-generate-002', 'imagen-3.0-fast-generate-002'];
         let lastError = '';
         for (const currentKey of keysToTry) {
           for (const apiModelId of imageModelIds) {
             const url = `https://generativelanguage.googleapis.com/v1beta/models/${apiModelId}:predict?key=${currentKey}`;
             try {
               const geminiPrompt = characterPrompt ? `${prompt}, subject: ${characterPrompt}` : prompt;
               const controller = new AbortController();
               const timeoutId = setTimeout(() => controller.abort(), 60000);
               const response = await fetch(url, {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({
                   instances: [{ prompt: geminiPrompt }],
                   parameters: {
                     sampleCount: imageCount,
                     aspectRatio: imageAspectRatio,
                     outputMimeType: "image/jpeg"
                   }
                 }),
                 signal: controller.signal
               });
               clearTimeout(timeoutId);

               if (response.ok) {
                 const data = await response.json() as any;
                 const imageBuffers = (data.predictions || [])
                   .map((prediction: { bytesBase64Encoded?: string }) => prediction.bytesBase64Encoded)
                   .filter(Boolean)
                   .slice(0, imageCount)
                   .map((base64Data: string) => Buffer.from(base64Data, 'base64'));
                 if (imageBuffers.length > 0) {
                   return saveImageBuffers(imageBuffers, `Google Gemini Image API (${apiModelId})`, currentKey);
                 }
               } else {
                 lastError = await response.text();
                 try { lastError = JSON.parse(lastError).error?.message || lastError; } catch {}
               }
             } catch (err: any) {
               lastError = err.message;
             }
           }
         }
         return NextResponse.json({ error: `[Google Imagen 3 Error] ${lastError}` }, { status: 500 });
      }
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
          
          // Lọc bỏ asset loading/non-result của Google Labs Whisk đang trong tiến trình sinh
          if (src.includes('MHJnT86uQC6FDhv') || src.includes('labs.google/fx') || src.toLowerCase().includes(['place', 'holder'].join(''))) {
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
              
              // Lọc bỏ asset loading/non-result của Google Labs Whisk đang trong tiến trình sinh
              if (src.includes('MHJnT86uQC6FDhv') || src.includes('labs.google/fx') || src.toLowerCase().includes(['place', 'holder'].join(''))) {
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
      throw new Error('Whisk đã hoàn thành nhưng không tìm thấy ảnh kết quả mới trên giao diện. (Vui lòng kiểm tra Cookie Google Labs.)');
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
    console.error('[Whisk Automation] Lỗi tiến trình:', (err as Error).message);
    
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

    return NextResponse.json(
      { error: `[Whisk Error] ${(err as Error).message || 'Lỗi kết nối Google Labs Whisk.'} Vui lòng cập nhật Cookie Google Studio hoặc kiểm tra tài khoản.` },
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


