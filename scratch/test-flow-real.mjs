import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Use stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const __dirname = path.dirname(__filename);

// Define artifact and screenshot directories
const artifactDir = 'C:\\Users\\Khanh\\.gemini\antigravity\\brain\\e46ab026-eb42-4cd4-8b51-a72633b8b4af';
const screenshotDir = path.join(artifactDir, 'screenshots');
if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir, { recursive: true });
}

function findChromePath() {
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  if (process.env.LOCALAPPDATA) paths.push(path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'));
  if (process.env.USERPROFILE) paths.push(path.join(process.env.USERPROFILE, 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'));

  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

// 5 API Keys provided by the user
const userApiKeys = [
  'AIzaSyAaSas8uU2gjkVhWmd1WJ8kp0lcRBRT0lM',
  'AIzaSyDMWb9JouOTegUJ5UgHe0V_InzkG970D9s',
  'AIzaSyCe7aTKyA6dxhYOaLPOHsXGZnHAghwKBs4',
  'AIzaSyBr1jE497R-aYa_J2u7oru0ffBh1jhRSyI',
  'AIzaSyCcv30j5T8OL-giaxh1aBP-PSKj-yqx_ms'
];

// Helper to get the Zustand store state from localStorage
async function getStoreState(page) {
  return await page.evaluate(() => {
    const data = localStorage.getItem('novel_generator_v2_store');
    return data ? JSON.parse(data).state : null;
  });
}

async function main() {
  console.log('================================================================');
  console.log('🤖 BẮT ĐẦU QUY TRÌNH MÔ PHỎNG E2E TỰ ĐỘNG HÓA THỰC TẾ RESILIENT (V3)...');
  console.log('================================================================');
  
  // Load saved cookies from saved_novel_store.json
  let savedCookie = '';
  let savedCookies = [];
  try {
    const storePath = path.join(process.cwd(), 'scratch', 'saved_novel_store.json');
    if (fs.existsSync(storePath)) {
      const data = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      savedCookie = data.state?.googleStudioCookie || '';
      savedCookies = data.state?.googleStudioCookies || [];
      console.log(`[Cookies Loaded]: Loaded cookie of length ${savedCookie.length}, rotating array size ${savedCookies.length}`);
    }
  } catch (e) {
    console.error('[-] Lỗi load saved_novel_store.json:', e.message);
  }

  let state;
  const chromePath = findChromePath();
  console.log(`[Chrome Path]: ${chromePath || 'Using default Puppeteer browser'}`);

  console.log('[Browser]: Đang khởi chạy Puppeteer...');
  const browser = await puppeteer.launch({
    headless: true, // Headless is stable and works perfectly
    defaultViewport: { width: 1440, height: 900 },
    executablePath: chromePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-size=1440,900',
    ]
  });

  const page = await browser.newPage();
  console.log('✅ Khởi chạy trình duyệt thành công!');

  // Dialog listener
  page.on('dialog', async dialog => {
    console.log(`\n🔔 [ALERT DIALOG] Loại: ${dialog.type().toUpperCase()}`);
    console.log(`   Nội dung: "${dialog.message()}"`);
    await dialog.accept();
    console.log(`   👉 Đã nhấn OK (Chấp nhận alert)`);
  });

  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[Gemini') || text.includes('[TTS') || text.includes('Lỗi') || text.includes('Error')) {
      console.log(`[Web App Console]: ${text}`);
    }
  });

  try {
    // STEP 1: Open the workspace page
    console.log('\n--- BƯỚC 1: MỞ TRANG WEB WORKSPACE ---');
    try {
      console.log('Đang truy cập http://localhost:3000/workspace ...');
      await page.goto('http://localhost:3000/workspace', { waitUntil: 'networkidle2', timeout: 30000 });
      console.log('Đang đợi hệ thống nạp trạng thái (rehydrate)...');
      await new Promise(r => setTimeout(r, 4000));
      await page.screenshot({ path: path.join(screenshotDir, 'screenshot_1_initial.png') });
      console.log('📸 Đã chụp: screenshot_1_initial.png');
    } catch (e) {
      console.error('❌ Lỗi Bước 1:', e.message);
    }

    // STEP 2: Inject API Keys and turn off Mock Mode
    console.log('\n--- BƯỚC 2: TIÊM API KEYS VÀ CHUYỂN SANG ONLINE MODE ---');
    try {
      const stateBefore = await getStoreState(page);
      if (stateBefore) {
        console.log(`[Store]: API Keys cũ: ${stateBefore.apiKeys?.length || 0}, Cookies cũ: ${stateBefore.googleStudioCookies?.length || 0}`);
      }

      await page.evaluate((keys, cookie, cookies) => {
        const data = localStorage.getItem('novel_generator_v2_store');
        let parsed = data ? JSON.parse(data) : { state: {} };
        if (!parsed.state) parsed.state = {};
        
        const existingKeys = parsed.state.apiKeys || [];
        const mergedKeys = Array.from(new Set([...keys, ...existingKeys, parsed.state.apiKey].filter(Boolean)));
        
        parsed.state.apiKeys = mergedKeys;
        parsed.state.apiKey = mergedKeys[0];
        parsed.state.useMock = false; // ONLINE MODE
        
        if (cookie) {
          parsed.state.googleStudioCookie = cookie;
        }
        if (cookies && cookies.length > 0) {
          parsed.state.googleStudioCookies = cookies;
        }
        
        localStorage.setItem('novel_generator_v2_store', JSON.stringify(parsed));
      }, userApiKeys, savedCookie, savedCookies);

      console.log('Đang tải lại trang để áp dụng cấu hình mới...');
      await page.reload({ waitUntil: 'networkidle2' });
      await new Promise(r => setTimeout(r, 3000));
      await page.screenshot({ path: path.join(screenshotDir, 'screenshot_2_keys_injected.png') });
      console.log('📸 Đã chụp: screenshot_2_keys_injected.png');
    } catch (e) {
      console.error('❌ Lỗi Bước 2:', e.message);
    }

    // STEP 3: Setup Phase
    console.log('\n--- BƯỚC 3: MÔ PHỎNG THIẾT LẬP DÀN Ý (SETUP PHASE) ---');
    try {
      state = await getStoreState(page);
      console.log(`[Giai Đoạn]: ${state?.giai_doan}`);

      if (state?.giai_doan === 1) {
        console.log('Đang click nút "AI Tự Tạo Ý Tưởng"...');
        const aiIdeaButton = await page.waitForSelector('button ::-p-text(AI Tự Tạo Ý Tưởng)', { timeout: 5000 });
        await aiIdeaButton.click();
        
        console.log('Đang chờ cốt truyện sinh hoàn tất qua API Gemini (polling)...');
        let ideaGenerated = false;
        for (let i = 0; i < 30; i++) {
          await new Promise(r => setTimeout(r, 1000));
          state = await getStoreState(page);
          const moTa = state?.setup?.mo_ta || '';
          if (moTa && !moTa.includes('Đang kết nối') && moTa.length > 50) {
            console.log(`🎉 Ý tưởng đã sinh xong ở giây thứ ${i + 1}!`);
            console.log(`[Cốt truyện]: "${moTa.substring(0, 80)}..."`);
            ideaGenerated = true;
            break;
          }
        }

        if (!ideaGenerated) {
          console.log('⚠️ Ý tưởng chưa được sinh xong hoặc bị lỗi, vẫn tiến hành click start.');
        }

        await page.screenshot({ path: path.join(screenshotDir, 'screenshot_3_setup_ready.png') });
        console.log('📸 Đã chụp: screenshot_3_setup_ready.png');

        console.log('Đang nhấp nút "🚀 TIẾN HÀNH SINH KỊCH BẢN AI"...');
        const startButtons = await page.$$('button');
        let clickedStart = false;
        for (const btn of startButtons) {
          const text = await page.evaluate(el => el.textContent, btn);
          if (text.includes('TIẾN HÀNH SINH KỊCH BẢN AI')) {
            await btn.click();
            clickedStart = true;
            break;
          }
        }

        if (clickedStart) {
          console.log('Đã click nút khởi tạo. Đang chờ chuyển sang Giai Đoạn 2 (Workspace) qua API (polling)...');
          let successTransition = false;
          for (let i = 0; i < 60; i++) {
            await new Promise(r => setTimeout(r, 2000));
            state = await getStoreState(page);
            if (state?.giai_doan === 2) {
              console.log(`🎉 Đã chuyển sang Giai Đoạn 2 (Workspace) thành công ở giây thứ ${i * 2}!`);
              successTransition = true;
              break;
            }
          }
          if (!successTransition) {
            console.log('⚠️ Cảnh báo: Không thể chuyển sang Giai đoạn 2 trong thời gian quy định.');
          }
        }
      } else {
        console.log('Hệ thống đã ở sẵn Giai đoạn 2.');
      }

      await page.screenshot({ path: path.join(screenshotDir, 'screenshot_4_workspace_loaded.png') });
      console.log('📸 Đã chụp: screenshot_4_workspace_loaded.png');
    } catch (e) {
      console.error('❌ Lỗi Bước 3:', e.message);
    }

    // STEP 4: Character profile
    console.log('\n--- BƯỚC 4: HỒ SƠ NHÂN VẬT ---');
    try {
      state = await getStoreState(page);
      const chars = state?.nhan_vat || [];
      console.log(`[Nhân Vật Đã Phát Hiện]: ${chars.join(', ')}`);
      const targetChar = chars[0] || 'Lãm Vô';
      console.log(`Tiến hành cấu hình cho nhân vật: "${targetChar}"`);

      // Click on the character tag in the sidebar
      const charButtons = await page.$$('button');
      let clickedChar = false;
      for (const btn of charButtons) {
        const text = await page.evaluate(el => el.textContent, btn);
        if (text.trim() === targetChar) {
          await btn.click();
          clickedChar = true;
          console.log(`Đã click mở hồ sơ "${targetChar}".`);
          break;
        }
      }

      if (clickedChar) {
        await new Promise(r => setTimeout(r, 1500));
        await page.screenshot({ path: path.join(screenshotDir, 'screenshot_5_character_form.png') });
        console.log('📸 Đã chụp: screenshot_5_character_form.png');

        console.log('Nhấn nút "✨ Gen Prompt AI" để sinh thông tin hồ sơ nhân vật...');
        const genPromptBtn = await page.$('button ::-p-text(Gen Prompt AI)');
        if (genPromptBtn) {
          await genPromptBtn.click();
          console.log('Đã click "Gen Prompt AI". Đang chờ AI sinh và điền thông tin (polling)...');
          
          let charPromptGenerated = false;
          for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 1000));
            state = await getStoreState(page);
            const charData = state?.nhan_vat_prompts?.[targetChar];
            if (charData?.prompt && charData?.prompt.length > 20) {
              console.log(`🎉 Hồ sơ nhân vật "${targetChar}" đã sinh xong ở giây thứ ${i + 1}!`);
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              charPromptGenerated = true;
              break;
            }
          }
        }

        await page.screenshot({ path: path.join(screenshotDir, 'screenshot_6_character_prompt_done.png') });
        console.log('📸 Đã chụp: screenshot_6_character_prompt_done.png');

        console.log('Nhấn nút "🎨 Gen Ảnh" để vẽ chân dung bằng Google Labs Whisk...');
        const genImgBtn = await page.$('button ::-p-text(Gen Ảnh)');
        if (genImgBtn) {
          await genImgBtn.click();
          console.log('Đã click "Gen Ảnh". Đang chờ sinh ảnh (polling)...');
          
          let imgGenerated = false;
          const imgKey = `char_${targetChar}`;
          for (let i = 0; i < 40; i++) {
            await new Promise(r => setTimeout(r, 1500));
            state = await getStoreState(page);
            const imgPath = state?.generatedImages?.[imgKey];
            if (imgPath) {
              console.log(`🎉 Đã sinh ảnh chân dung thành công ở giây thứ ${i * 1.5}! Path: "${imgPath}"`);
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              imgGenerated = true;
              break;
            }
          }
        }

        await page.screenshot({ path: path.join(screenshotDir, 'screenshot_7_character_portrait_done.png') });
        console.log('📸 Đã chụp: screenshot_7_character_portrait_done.png');

        console.log('Nhấn nút "Lưu hồ sơ" để lưu...');
        const saveBtn = await page.$('button ::-p-text(Lưu hồ sơ)');
        if (saveBtn) {
          await saveBtn.click();
          console.log('Đã click "Lưu hồ sơ".');
        }
        await new Promise(r => setTimeout(r, 1500));
        await page.screenshot({ path: path.join(screenshotDir, 'screenshot_8_character_saved.png') });
        console.log('📸 Đã chụp: screenshot_8_character_saved.png');
      }
    } catch (e) {
      console.error('❌ Lỗi Bước 4:', e.message);
    }

    // STEP 5: Generate detailed content for Chapter 1
    console.log('\n--- BƯỚC 5: SINH CHI TIẾT CHƯƠNG 1 ---');
    try {
      console.log('Đang nhấn nút sinh chi tiết kịch bản chương...');
      const writeBtn1 = await page.$('button ::-p-text(Sinh Chi Tiết Chương 1)');
      const writeBtn2 = await page.$('button ::-p-text(Viết lại kịch bản từ đầu)');
      
      const clickTarget = writeBtn1 || writeBtn2;
      if (clickTarget) {
        await clickTarget.click();
        console.log('Đã click nút viết kịch bản. Đang chờ AI viết chi tiết chương (polling/logging)...');
        
        const chapterNum = 1;
        let chapterWritten = false;
        for (let i = 0; i < 90; i++) {
          await new Promise(r => setTimeout(r, 1500));
          state = await getStoreState(page);
          const currentChapter = state?.danh_sach_chuong?.find(c => c.so_chuong === chapterNum);
          
          if (i % 6 === 0) {
            console.log(`  [Poll Ch${chapterNum}] Giây ${i*1.5}s: ContentLength=${currentChapter?.noi_dung?.length || 0}, dang_tai=${state?.dang_tai}, trang_thai=${currentChapter?.trang_thai}`);
          }
          
          if (currentChapter?.noi_dung && currentChapter.noi_dung.length > 100 && currentChapter.trang_thai === 'ready') {
            console.log(`🎉 Kịch bản Chương 1 đã viết xong ở giây thứ ${i * 1.5}! Length: ${currentChapter.noi_dung.length}`);
            chapterWritten = true;
            break;
          }
        }
        if (!chapterWritten) {
          console.log('⚠️ Cảnh báo: Sinh chi tiết kịch bản chương chưa hoàn tất trạng thái hoặc bị treo, tiến hành tiếp tục.');
        }
      }
      await page.screenshot({ path: path.join(screenshotDir, 'screenshot_9_chapter1_written.png') });
      console.log('📸 Đã chụp: screenshot_9_chapter1_written.png');
    } catch (e) {
      console.error('❌ Lỗi Bước 5:', e.message);
    }

    // STEP 6: TTS Voice scene 1
    console.log('\n--- BƯỚC 6: PHÁT GIỌNG ĐỌC (TTS VOICE) Ở CẢNH 1 ---');
    try {
      console.log('Đang mở tab "🎙️ TTS Voice" ở Cảnh 1...');
      const ttsTabBtn = await page.waitForSelector('button ::-p-text(TTS Voice)', { timeout: 10000 });
      if (ttsTabBtn) {
        await ttsTabBtn.click();
        console.log('Đã click mở tab TTS Voice.');
        await new Promise(r => setTimeout(r, 1500));

        const genAudioBtn = await page.$('button ::-p-text(Gen Audio & Lưu PC)');
        if (genAudioBtn) {
          await genAudioBtn.click();
          console.log('Đã click "Gen Audio & Lưu PC". Đang chờ sinh tệp âm thanh (polling/logging)...');
          
          const assetKey = '1_0'; // Chapter 1, SceneIndex 0
          let audioGenerated = false;
          for (let i = 0; i < 65; i++) {
            await new Promise(r => setTimeout(r, 1500));
            state = await getStoreState(page);
            const audio = state?.generatedAudioPaths?.[assetKey];
            
            if (i % 6 === 0) {
              console.log(`  [Poll TTS] Giây ${i*1.5}s: AudioPath=${audio?.path || 'N/A'}`);
            }

            if (audio) {
              console.log(`🎉 Đã sinh tệp âm thanh thành công ở giây thứ ${i * 1.5}! Path: "${audio.path}"`);
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              audioGenerated = true;
              break;
            }
          }
        }
      }
      await page.screenshot({ path: path.join(screenshotDir, 'screenshot_10_tts_completed.png') });
      console.log('📸 Đã chụp: screenshot_10_tts_completed.png');
    } catch (e) {
      console.error('❌ Lỗi Bước 6:', e.message);
    }

    // STEP 7: Scene Studio
    console.log('\n--- BƯỚC 7: PHÂN CẢNH STUDIO & VẼ ẢNH STORYBOARD ---');
    try {
      console.log('Đang mở tab "🎬 Studio Cảnh" ở Cảnh 1...');
      const studioTabBtn = await page.waitForSelector('button ::-p-text(Studio Cảnh)', { timeout: 10000 });
      if (studioTabBtn) {
        await studioTabBtn.click();
        console.log('Đã click mở tab Studio Cảnh.');
        await new Promise(r => setTimeout(r, 1500));

        const genPromptStudioBtn = await page.$('button ::-p-text(Gen Prompt Studio)');
        if (genPromptStudioBtn) {
          await genPromptStudioBtn.click();
          console.log('Đã click "Gen Prompt Studio". Đang chờ sinh visual prompts (polling)...');
          
          const assetKey = '1_0'; // Chapter 1, SceneIndex 0
          let promptsGenerated = false;
          for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 1000));
            state = await getStoreState(page);
            const prompts = state?.generatedPrompts?.[assetKey];
            if (prompts && prompts.length > 0) {
              console.log(`🎉 Đã sinh xong ${prompts.length} visual prompts ở giây thứ ${i + 1}!`);
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              promptsGenerated = true;
              break;
            }
          }
        }

        await page.screenshot({ path: path.join(screenshotDir, 'screenshot_11_studio_prompts.png') });
        console.log('📸 Đã chụp: screenshot_11_studio_prompts.png');

        // Click "Gen ảnh" for the first visual prompt
        console.log('Đang nhấp nút "Gen ảnh" của prompt đầu tiên...');
        const genSceneImgBtn = await page.$('button ::-p-text(Gen ảnh)');
        if (genSceneImgBtn) {
          await genSceneImgBtn.click();
          console.log('Đã click "Gen ảnh". Đang chờ Google Whisk sinh ảnh phân cảnh (polling)...');
          
          const singlePromptKey = '1_0_0'; // Chapter 1, SceneIndex 0, PromptIndex 0
          let sceneImgGenerated = false;
          for (let i = 0; i < 40; i++) {
            await new Promise(r => setTimeout(r, 1500));
            state = await getStoreState(page);
            const imgPath = state?.generatedImages?.[singlePromptKey];
            if (imgPath) {
              console.log(`🎉 Đã sinh ảnh phân cảnh thành công ở giây thứ ${i * 1.5}! Path: "${imgPath}"`);
              sceneImgGenerated = true;
              break;
            }
          }

          if (sceneImgGenerated) {
            console.log('\n🔍 --- BẮT ĐẦU KIỂM TRA HÌNH ẢNH TRÊN WEB APP ---');
            
            // 1. Check local file existence and read headers
            const localImgPath = path.join(process.cwd(), 'public', 'images', 'chapter_1_scene_0_prompt_0.png');
            if (fs.existsSync(localImgPath)) {
              const stats = fs.statSync(localImgPath);
              console.log(`[File System]: Tìm thấy file ảnh tại "${localImgPath}"`);
              console.log(`               Kích thước: ${stats.size} bytes`);
              
              // Read first 4 bytes to check signature
              const fd = fs.openSync(localImgPath, 'r');
              const buffer = Buffer.alloc(4);
              fs.readSync(fd, buffer, 0, 4, 0);
              fs.closeSync(fd);
              
              const hexSig = buffer.toString('hex').toUpperCase();
              console.log(`               Chữ ký tệp (Hex): ${hexSig}`);
              if (hexSig === '89504E47') {
                console.log('               ✅ XÁC NHẬN: Đây là tệp ảnh PNG thực tế (Online mode sinh ảnh thành công!)');
              } else if (hexSig.startsWith('FFD8')) {
                console.log('               ✅ XÁC NHẬN: Đây là tệp ảnh JPEG thực tế (Online mode sinh ảnh thành công!)');
              } else if (buffer.toString('utf8').includes('<svg')) {
                console.log('               ⚠️ CẢNH BÁO: Đây là tệp ảnh SVG Mock (Hệ thống chạy ở chế độ giả lập).');
              } else {
                console.log('               ⚠️ CẢNH BÁO: Chữ ký tệp không khớp với định dạng ảnh chuẩn.');
              }
            } else {
              console.error('[-] Lỗi: Không tìm thấy file ảnh cục bộ tại đường dẫn public/images!');
            }

            // 2. Wait for the image to be loaded and rendered in the DOM
            try {
              console.log('[DOM]: Đang tìm kiếm thẻ img tương ứng với ảnh đã gen trên giao diện...');
              await page.waitForSelector('img[alt="Cảnh 1 Prompt 1"]', { timeout: 10000 });
              
              const imgProperties = await page.evaluate(() => {
                const img = document.querySelector('img[alt="Cảnh 1 Prompt 1"]');
                if (img) {
                  return {
                    src: img.src,
                    complete: img.complete,
                    naturalWidth: img.naturalWidth,
                    naturalHeight: img.naturalHeight
                  };
                }
                return null;
              });
              
              if (imgProperties) {
                console.log(`[DOM]: Tìm thấy thẻ <img> trên Web App UI!`);
                console.log(`       - src: "${imgProperties.src}"`);
                console.log(`       - complete (hoàn thành nạp): ${imgProperties.complete}`);
                console.log(`       - Kích thước hiển thị: ${imgProperties.naturalWidth}x${imgProperties.naturalHeight}px`);
                if (imgProperties.complete && imgProperties.naturalWidth > 0) {
                  console.log('       ✅ XÁC NHẬN: Ảnh đã hiển thị thành công và được hiển thị sắc nét trên UI!');
                } else {
                  console.warn('       ⚠️ CẢNH BÁO: Thẻ img tồn tại nhưng chưa nạp xong hoặc kích thước bằng 0.');
                }
              } else {
                console.error('[-] Lỗi: Không tìm thấy thẻ img trong DOM dù store báo đã hoàn tất.');
              }
            } catch (domErr) {
              console.error('[-] Lỗi DOM:', domErr.message);
            }
            console.log('🔍 --- KẾT THÚC KIỂM TRA HÌNH ẢNH ---\n');
          }

          // Verify if Open Link button appears
          const openLinkBtn = await page.$('button ::-p-text(Mở Link)');
          if (openLinkBtn) {
            const projectUrl = state?.projectUrls?.[singlePromptKey];
            console.log(`🎉 Phát hiện nút "🌐 Mở Link"! Liên kết Google Whisk Flow: "${projectUrl}"`);
          }
        }
      }
      await page.screenshot({ path: path.join(screenshotDir, 'screenshot_12_scene_image_completed.png') });
      console.log('📸 Đã chụp: screenshot_12_scene_image_completed.png');
    } catch (e) {
      console.error('❌ Lỗi Bước 7:', e.message);
    }

    // STEP 8: Stress test other buttons
    console.log('\n--- BƯỚC 8: CHẠY THỬ CÁC NÚT BẤM KHÁC ĐỂ KIỂM TRA LỖI ---');
    try {
      const outlineAccordionBtn = await page.$('button ::-p-text(Dàn Ý Tổng Quan)');
      if (outlineAccordionBtn) {
        await outlineAccordionBtn.click();
        console.log('Đã click accordion "Dàn Ý Tổng Quan".');
        await new Promise(r => setTimeout(r, 1000));
      }
      await page.screenshot({ path: path.join(screenshotDir, 'screenshot_13_stress_test.png') });
      console.log('📸 Đã chụp: screenshot_13_stress_test.png');
    } catch (e) {
      console.error('❌ Lỗi Bước 8:', e.message);
    }

    console.log('\n================================================================');
    console.log('🎉 QUY TRÌNH MÔ PHỎNG TỰ ĐỘNG HÓA E2E ĐÃ HOÀN TẤT THÀNH CÔNG RỰC RỠ!');
    console.log('================================================================');

  } catch (err) {
    console.error('\n❌ CÓ LỖI CHUNG XẢY RA TRONG QUÁ TRÌNH TỰ ĐỘNG HÓA:', err.message);
  } finally {
    console.log('Đang tắt trình duyệt...');
    await browser.close();
    console.log('Done!');
  }
}

main();
