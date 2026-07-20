import { NextResponse } from 'next/server';
import { addExtra } from 'puppeteer-extra';
import puppeteerCore from 'puppeteer';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { requireToolboxAccess } from '@/lib/commercial/apiGate';

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
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return undefined;
}

export async function POST(req: Request) {
  let browser;
  try {
    const body = await req.json().catch(() => ({}));
    const denied = await requireToolboxAccess(req, body);
    if (denied) return denied;
    const srtText = body.srtText || '';
    const profileId = body.profileId || 'chrome-profile-secure';
    const ruleId = body.ruleId || 'modern';

    if (!srtText || srtText.trim() === '') {
      return NextResponse.json({ error: 'Nội dung SRT trống.' }, { status: 400 });
    }

    const ruleMap: Record<string, string> = {
      'xianxia': 'Mô tả: Sử dụng từ ngữ Hán Việt cổ kính, trang trọng, khí thế hào hùng. Giữ nguyên các thuật ngữ tu tiên, pháp bảo.',
      'romance': 'Mô tả: Lãng mạn, nhẹ nhàng, sử dụng xưng hô huynh - muội, chàng - thiếp, vương gia, nương nương.',
      'wuxia': 'Mô tả: Võ thuật, ân oán giang hồ. Xưng hô tại hạ, các hạ, huynh đài, tiền bối.',
      'palace': 'Mô tả: Tranh quyền đoạt vị, nội chiến gia tộc. Giọng điệu cung đình trang trọng, cung kính.',
      'rich': 'Mô tả: Giới siêu giàu, tổng tài bá đạo, ngôn từ hiện đại pha chút kiêu ngạo, thương trường.',
      'school': 'Mô tả: Tươi trẻ, hồn nhiên, thuật ngữ học đường, xưng hô cậu - tớ, mày - tao thân thiết.',
      'comedy': 'Mô tả: Vui tươi, hài hước, ngôn từ hiện đại thoải mái, có thể dùng từ lóng mạng mẻ.',
      'horror': 'Mô tả: Kịch tính, logic, lạnh lùng, thuật ngữ phá án/tâm lý/kinh dị. Giọng điệu hồi hộp, nghiêm túc.',
      'action': 'Mô tả: Gọn gàng, mạnh mẽ, dứt khoát. Nhịp độ nhanh, tập trung vào hành động.',
      'scifi': 'Mô tả: Sinh tồn, tương lai, công nghệ khoa học viễn tưởng. Thuật ngữ máy móc, không gian, AI.',
      'history': 'Mô tả: Hào hùng, bi tráng, thời kỳ dân quốc/chiến tranh. Ngôn từ thời chiến lược, tư lệnh, quan chức.',
      'modern': 'Mô tả: Tone chân thực, thực tế, đời sống thường ngày kết hợp thuật ngữ công sở và gia đình. Ngôn từ gần gũi.',
      'strict': 'Mô tả: Dịch 1-1 sát nghĩa gốc, bám sát cấu trúc ngữ pháp nguyên bản, không phóng tác, cực kỳ chuẩn xác, phù hợp Light Novel.',
      'auto': 'Mô tả: AI tự động quét toàn bộ văn bản để phán đoán bối cảnh, từ đó linh hoạt điều chỉnh văn phong và đại từ nhân xưng cho phù hợp nhất.'
    };

    let ruleDesc = ruleMap[ruleId] || ruleMap['modern'];

    const prompt = `Bạn là một tiểu thuyết gia xuất chúng, một bậc thầy ngôn ngữ và chuyên gia dịch thuật.
Nhiệm vụ: Dịch file phụ đề (SRT) sang Tiếng Việt sao cho văn phong mềm mại, tự nhiên, đậm chất văn học nghệ thuật. KHÔNG ĐƯỢC khô cứng như dịch máy.
Quy tắc đặc biệt: ${ruleDesc}

YÊU CẦU BẮT BUỘC:
1. Bạn BẮT BUỘC phải giữ nguyên CẤU TRÚC SRT gốc. Mỗi khối phụ đề luôn có 3 dòng:
   - Dòng 1: ID số thứ tự (1, 2, 3...)
   - Dòng 2: Thời gian (00:00:00,000 --> 00:00:00,000)
   - Dòng 3: Văn bản gốc đã được dịch sang tiếng Việt.
   - Dòng 4: Một dòng trống (blank line).
2. TUYỆT ĐỐI KHÔNG gộp câu, KHÔNG gộp ID. Tổng số khối SRT đầu ra phải KHỚP 100% đầu vào.
3. Chỉ trả về văn bản SRT thuần túy. KHÔNG giải thích gì thêm.

--- FILE SRT GỐC ---
${srtText}`;

    console.log('[RPA Translate] Đang khởi chạy Chrome (Thử nghiệm chế độ Ngầm/Headless)...');
    
    const chromePath = findChromePath();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const baseOptions: any = {
      defaultViewport: null,
      userDataDir: path.join(process.cwd(), 'scratch', profileId),
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--window-size=1200,900',
        '--no-first-run',
        '--no-default-browser-check',
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars'
      ]
    };

    if (chromePath) {
      baseOptions.executablePath = chromePath;
    }

    const puppeteer = addExtra(puppeteerCore);
    puppeteer.use(StealthPlugin());

    // --- BƯỚC 1: THỬ CHẠY NGẦM (HEADLESS: NEW) ---
    browser = await puppeteer.launch({ ...baseOptions, headless: 'new' });
    let pages = await browser.pages();
    let page = pages[0] || await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36');
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    console.log('[RPA Translate] Điều hướng đến Google AI Studio ngầm...');
    await page.goto('https://aistudio.google.com/app/prompts/new_chat', { waitUntil: 'domcontentloaded', timeout: 60000 });

    let needInteraction = false;
    let textareaFound = false;

    // Kiểm tra đăng nhập hoặc Captcha trong 10 giây
    console.log('[RPA Translate] Đang quét giao diện để tìm khung nhập liệu...');
    for (let i = 0; i < 10; i++) {
      const currentUrl = page.url();
      if (currentUrl.includes('accounts.google.com') || currentUrl.includes('ServiceLogin')) {
        needInteraction = true;
        break;
      }
      
      textareaFound = await page.evaluate(() => {
        return document.querySelectorAll('textarea').length > 0;
      });

      if (textareaFound) break;
      await new Promise(r => setTimeout(r, 1000));
    }

    if (!textareaFound) needInteraction = true;

    // --- BƯỚC 2: NẾU BỊ CHẶN CAPTCHA HOẶC BẮT ĐĂNG NHẬP, BẬT TRÌNH DUYỆT HIỆN HÌNH ---
    if (needInteraction) {
      console.log('🚨 [RPA Translate] Phát hiện yêu cầu Đăng nhập hoặc Captcha! Đang chuyển sang chế độ HIỆN HÌNH cho người dùng thao tác...');
      await browser.close();
      
      browser = await puppeteer.launch({ ...baseOptions, headless: false });
      pages = await browser.pages();
      page = pages[0] || await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36');
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      });
      
      await page.goto('https://aistudio.google.com/app/prompts/new_chat', { waitUntil: 'domcontentloaded', timeout: 60000 });
      
      console.log('[RPA Translate] Đang chờ người dùng giải quyết (Tối đa 120s)...');
      let attempts = 0;
      textareaFound = false;
      while (attempts < 120) {
        textareaFound = await page.evaluate(() => document.querySelectorAll('textarea').length > 0);
        if (textareaFound && !page.url().includes('accounts.google.com')) {
          break;
        }
        await new Promise(r => setTimeout(r, 1000));
        attempts++;
      }

      if (!textareaFound) {
        throw new Error('Quá thời gian chờ (120s) mà người dùng chưa hoàn tất thao tác. Vui lòng thử lại.');
      }
      
      console.log('✅ [RPA Translate] Đã vượt ải thành công, tiếp tục dịch tự động!');
    }

    console.log('[RPA Translate] Đang tự động nhập Prompt...');
    // Cố gắng dán prompt thay vì gõ từng chữ để tránh bị chậm hoặc đứt gãy
    await page.evaluate(async (text) => {
      // Tìm textarea chính (thường là cái hiển thị rõ nhất)
      const textareas = Array.from(document.querySelectorAll('textarea'));
      let target: HTMLTextAreaElement | null = null;
      for (const t of textareas) {
        if (t.offsetParent !== null) {
          target = t;
          break;
        }
      }
      if (!target) {
        throw new Error('No visible input textarea was found.');
      }
      
      target.focus();
      target.value = text;
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
    }, prompt);

    await new Promise(r => setTimeout(r, 1000));

    // Bấm phím Ctrl + Enter để Submit
    console.log('[RPA Translate] Đang gửi yêu cầu (Ctrl+Enter)...');
    await page.keyboard.down('Control');
    await page.keyboard.press('Enter');
    await page.keyboard.up('Control');

    console.log('[RPA Translate] Đang chờ AI sinh kết quả...');
    // Đợi để nút Stop mất đi hoặc nội dung được sinh xong
    // Chúng ta sẽ kiểm tra sự gia tăng của độ dài text trong các elements kết quả
    let lastLength = -1;
    let sameLengthCount = 0;
    let finalSrt = '';
    
    // Thăm dò mỗi 2 giây, chờ tối đa 3 phút
    const maxWaitTime = 180000;
    const startTime = Date.now();
    
    // Chờ 5 giây đầu tiên để AI bắt đầu phản hồi
    await new Promise(r => setTimeout(r, 5000));

    while (Date.now() - startTime < maxWaitTime) {
      await new Promise(r => setTimeout(r, 2000));
      
      const currentText = await page.evaluate(() => {
        // AI Studio thường đặt phản hồi của bot trong các thẻ chứa markdown
        // Cách quét thô bạo: Tìm thẻ markdown-view hoặc .model-response
        const modelBlocks = Array.from(document.querySelectorAll('markdown-view, [class*="model"], [class*="response"]'));
        if (modelBlocks.length === 0) {
          return '';
        }
        // Lấy nội dung của block model cuối cùng
        return modelBlocks[modelBlocks.length - 1].textContent || '';
      });

      const cleanText = currentText.trim();
      
      if (cleanText.length > 50) {
        if (cleanText.length === lastLength) {
          sameLengthCount++;
          // Nếu nội dung không thay đổi trong 5 lần kiểm tra (10 giây) -> Coi như đã xong
          if (sameLengthCount >= 5) {
            finalSrt = cleanText;
            console.log('[RPA Translate] Đã sinh xong!');
            break;
          }
        } else {
          lastLength = cleanText.length;
          sameLengthCount = 0;
          console.log(`[RPA Translate] Đang sinh... (${lastLength} ký tự)`);
        }
      }
    }

    if (!finalSrt) {
      throw new Error('Hết thời gian chờ nhưng không thu thập được văn bản sinh ra từ AI Studio. Vui lòng tự lấy tay copy từ cửa sổ Chrome đang bật.');
    }

    // Tự động đóng trình duyệt
    await browser.close();

    // Dọn dẹp markdown
    if (finalSrt.startsWith('\`\`\`srt')) {
      finalSrt = finalSrt.replace(/^\`\`\`srt[\r\n]*/, '');
      finalSrt = finalSrt.replace(/[\r\n]*\`\`\`$/, '');
    } else if (finalSrt.startsWith('\`\`\`')) {
      finalSrt = finalSrt.replace(/^\`\`\`[\r\n]*/, '');
      finalSrt = finalSrt.replace(/[\r\n]*\`\`\`$/, '');
    }

    return NextResponse.json({ 
      translatedSrt: finalSrt.trim(),
      usedApiKey: 'RPA_BROWSER_AUTOMATION' 
    });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if (browser) {
      try {
        // Không đóng browser ngay nếu lỗi để user có thể nhìn thấy chuyện gì đang xảy ra
        // Nhưng cũng có thể đóng. Ta chọn không đóng ngay lập tức.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e) {}
    }
    console.error('Lỗi khi chạy RPA Translate:', err);
    return NextResponse.json(
      { error: err.message || 'Lỗi không xác định khi RPA.', stack: err.stack },
      { status: 500 }
    );
  }
}

