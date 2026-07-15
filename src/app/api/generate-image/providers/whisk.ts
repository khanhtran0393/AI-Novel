import { NextResponse } from 'next/server';
import { addExtra } from 'puppeteer-extra';
import puppeteerCore from 'puppeteer';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { driveMediaFilename } from '@/contracts';
import { BrowserAgent } from '@/lib/agents/BrowserAgent';
import { findChromePath } from '../chromePath';
import type { ImageProviderCtx } from '../imageTypes';

/**
 * Owner: Google Labs Whisk headless automation ONLY.
 * Does not call OpenAI/Grok/Imagen REST.
 */
export async function runWhiskAutomation(
  ctx: ImageProviderCtx,
): Promise<NextResponse> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let browser: any;
  let userDataDirPath = '';

  const {
    body,
    providerPrompt,
    providerKeysToTry,
    keysToTry,
    imageAspectRatio,
    imageCount,
    referenceImageB64,
    referenceMime,
    saveImage,
    saveImageBuffers,
    model,
    cookie,
    prompt,
    characterPrompt,
    chapterNum,
    sceneIndex,
    promptIndex,
    drivePath,
    ten_tac_pham,
    filename,
    localSavePath,
    publicImageDir,
  } = ctx;

  const aiMasterApiKey =
    typeof body.aiMasterApiKey === 'string' ? body.aiMasterApiKey : '';

  try {
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
          driveFilename = driveMediaFilename(scriptTitle, chapterNum, sceneIndex, {
            kind: 'image',
            promptIndex,
          });
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

    if (browser) {
      try {
        const pages = await browser.pages();
        if (pages.length > 0) {
          const currentPage = pages[0];
          const currentUrl = currentPage.url();
          console.log(`[Whisk Diagnostics] URL tại thời điểm lỗi: "${currentUrl}"`);
          try {
            const bodyText = await currentPage.evaluate(() =>
              document.body ? document.body.innerText : 'Empty Body',
            );
            console.log(
              `[Whisk Diagnostics] Nội dung trang lỗi (500 ký tự đầu): "${bodyText.substring(0, 500).replace(/\n/g, ' ')}"`,
            );
          } catch {
            /* ignore */
          }

          const publicImgDir = path.join(process.cwd(), 'public', 'images');
          if (!fs.existsSync(publicImgDir)) {
            fs.mkdirSync(publicImgDir, { recursive: true });
          }
          const diagPath = path.join(publicImgDir, 'whisk_error_screenshot.png');
          await currentPage.screenshot({ path: diagPath });
          console.log(`[Whisk Diagnostics] Đã chụp màn hình lỗi tại: ${diagPath}`);
        }
      } catch {
        /* ignore */
      }
    }

    return NextResponse.json(
      {
        error: `[Whisk Error] ${(err as Error).message || 'Lỗi kết nối Google Labs Whisk.'} Vui lòng cập nhật Cookie Google Studio hoặc kiểm tra tài khoản.`,
      },
      { status: 500 },
    );
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
    }
    if (userDataDirPath && fs.existsSync(userDataDirPath)) {
      try {
        fs.rmSync(userDataDirPath, { recursive: true, force: true });
        console.log(
          `[Whisk Thread Cleanup] Đã dọn dẹp thư mục sandbox đa luồng: ${userDataDirPath}`,
        );
      } catch (cleanErr: unknown) {
        console.warn(
          `[Whisk Thread Cleanup] Cảnh báo - không thể dọn dẹp thư mục sandbox: ${(cleanErr as Error).message}`,
        );
      }
    }
  }

  return NextResponse.json(
    { error: '[Whisk] Không tạo được ảnh.' },
    { status: 500 },
  );
}
