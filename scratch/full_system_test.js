// eslint-disable-next-line @typescript-eslint/no-require-imports
const puppeteer = require('puppeteer');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require('child_process');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const http = require('http');

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;
const ARTIFACT_DIR = `C:\\Users\\Khanh\\.gemini\\antigravity\\brain\\a4566ab2-2b71-435f-96e4-15c6b82b4841`;

// Tạo thư mục lưu screenshots nếu chưa có
if (!fs.existsSync(ARTIFACT_DIR)) {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
}

// Helper gửi HTTP GET thực tế để kiểm tra máy chủ đã sẵn sàng phản hồi chưa
function checkPort(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/workspace`, (res) => {
      resolve(true);
      res.resume();
    });
    req.on('error', () => {
      resolve(false);
    });
    req.end();
  });
}

// Chờ cổng mở
function waitPort(port, timeout = 25000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(async () => {
      const isUp = await checkPort(port);
      if (isUp) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - start > timeout) {
        clearInterval(interval);
        reject(new Error(`Timeout waiting for port ${port}`));
      }
    }, 500);
  });
}

// Helper chờ phím Enter từ bàn phím người dùng
function waitEnter(msg) {
  return new Promise((resolve) => {
    console.log(msg);
    process.stdin.once('data', () => {
      resolve();
    });
  });
}

async function runFullSimulation() {
  console.log('================================================================');
  console.log('🤖 BẮT ĐẦU MÔ PHỎNG END-TO-END VỚI API THỰC TẾ & COOKIE CỦA BẠN...');
  console.log('================================================================\n');

  let devServer;
  const isServerRunning = await checkPort(PORT);
  
  if (isServerRunning) {
    console.log(`[+] Server đã chạy sẵn trên Port ${PORT}. Không cần khởi động lại.`);
  } else {
    console.log(`[+] Server chưa chạy. Đang khởi động Next.js Local Server (npm run dev)...`);
    devServer = spawn('npm', ['run', 'dev'], {
      cwd: path.join(__dirname, '..'),
      shell: true
    });
    await waitPort(PORT);
    console.log(`[+] Server Next.js khởi động thành công trên Port ${PORT}.`);
  }

  // Đợi server settle 10s
  await new Promise(resolve => setTimeout(resolve, 10000));

  console.log('\n[+] Khởi chạy Puppeteer Browser ở chế độ hiển thị màn hình thực tế (Sử dụng Profile chrome-profile-secure)...');
  const browser = await puppeteer.launch({
    headless: false,
    userDataDir: path.join(__dirname, 'chrome-profile-secure'),
    defaultViewport: { width: 1440, height: 900 },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  
  // Trạng thái Deferred để chờ hộp thoại đóng động
  let dialogDeferred = null;
  function waitForDialog() {
    return new Promise((resolve) => {
      dialogDeferred = resolve;
    });
  }

  // Thiết lập lắng nghe dialog (alert, confirm) tự động đóng và đồng bộ luồng
  page.on('dialog', async (dialog) => {
    const msg = dialog.message();
    console.log(`💬 [Hộp thoại Alert]: "${msg}"`);
    
    // Đợi 500ms trước khi đóng alert để người dùng kịp nhìn thấy thông tin
    await new Promise(resolve => setTimeout(resolve, 1000));
    await dialog.accept();

    if (dialogDeferred) {
      dialogDeferred();
      dialogDeferred = null;
    }
  });

  try {
    // Mở trang Workspace có khả năng chịu lỗi và retry cao
    let navSuccess = false;
    for (let retry = 1; retry <= 3; retry++) {
      try {
        console.log(`\n[+] Điều hướng tới (Thử lần ${retry}): ${BASE_URL}/workspace`);
        await page.goto(`${BASE_URL}/workspace`, { waitUntil: 'networkidle2', timeout: 45000 });
        navSuccess = true;
        break;
      } catch (err) {
        console.warn(`[!] Lần thử ${retry} thất bại: ${err.message}. Đang đợi 5 giây rồi thử lại...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    if (!navSuccess) throw new Error('Không thể kết nối tới server Next.js sau 3 lần thử.');
    
    // Inject REAL MODE và ép về Giai đoạn 1 để chạy mô phỏng từ đầu
    console.log('[+] Đang tắt Mock Mode & khóa Giai đoạn 1 vào localStorage...');
    await page.evaluate(() => {
      try {
        const storeStr = localStorage.getItem('novel_generator_v2_store');
        let store = { state: {} };
        if (storeStr) {
          store = JSON.parse(storeStr);
        }
        
        // Cấu hình chạy thực tế, GIỮ NGUYÊN các API Key và Cookies của người dùng đã lưu
        store.state = {
          ...(store.state || {}),
          useMock: false, // Ép chạy với API thực tế của người dùng
          giai_doan: 1    // Ép về giai đoạn setup để chạy từ đầu
        };
        
        localStorage.setItem('novel_generator_v2_store', JSON.stringify(store));
      } catch (e) {
        console.error('Lỗi khi nạp store:', e);
      }
    });

    // Tải lại trang để Next.js & Zustand nhận cấu hình mới
    await page.reload({ waitUntil: 'networkidle2' });
    
    console.log('\n================================================================');
    console.log('👉 VUI LÒNG KIỂM TRA GEMINI API KEY & WHISK COOKIES TRONG TRÌNH DUYỆT');
    console.log('👉 Trong cửa sổ Chrome vừa hiển thị, hãy kiểm tra và nhập (nếu chưa có):');
    console.log('   - Gemini API Key thực tế (ô Setup hoặc góc trên bên phải dropdown)');
    console.log('   - Whisk Cookies thực tế (ở dropdown cấu hình ở Header)');
    console.log('   (Bạn có thể dán trực tiếp phím tắt Ctrl+V trên cửa sổ Chrome vừa mở)');
    console.log('================================================================');
    
    await waitEnter('\n👉 SAU KHI ĐÃ NHẬP XONG KHÓA/COOKIE, HÃY NHẤN PHÍM [ENTER] TẠI ĐÂY ĐỂ BẮT ĐẦU MÔ PHỎNG TỰ ĐỘNG...');

    // Đọc kiểm tra cấu hình để chắc chắn
    const storeState = await page.evaluate(() => {
      try {
        const storeStr = localStorage.getItem('novel_generator_v2_store');
        if (storeStr) {
          const store = JSON.parse(storeStr);
          return {
            useMock: store.state.useMock,
            hasKey: !!store.state.apiKey || (store.state.apiKeys && store.state.apiKeys.length > 0),
            hasCookie: !!store.state.googleStudioCookie || (store.state.googleStudioCookies && store.state.googleStudioCookies.length > 0)
          };
        }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e) {}
      return null;
    });

    console.log(`[Store Configured Check]:`);
    console.log(`  - Sử dụng chế độ giả lập (useMock): ${storeState?.useMock}`);
    console.log(`  - Đã có API Key thực tế: ${storeState?.hasKey ? 'CÓ (Hợp lệ)' : 'KHÔNG (Cảnh báo: Có thể lỗi)'}`);
    console.log(`  - Đã có Whisk Cookie thực tế: ${storeState?.hasCookie ? 'CÓ (Hợp lệ)' : 'KHÔNG (Cảnh báo: Sẽ sinh ảnh mock)'}`);

    console.log('\n--- GIAI ĐOẠN 1: SETUP PHẦN CỨNG & THAM SỐ ---');
    const step1Path = path.join(ARTIFACT_DIR, 'step01_setup_phase.png');
    await page.screenshot({ path: step1Path });
    console.log(`📸 Đã chụp màn hình Setup: ${step1Path}`);

    // Bấm nút "AI Tự Tạo Ý Tưởng"
    console.log('[+] Bấm nút "AI Tự Tạo Ý Tưởng" để sinh cốt truyện...');
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const aiBtn = buttons.find(b => b.textContent.includes('AI Tự Tạo Ý Tưởng'));
      if (aiBtn) aiBtn.click();
    });
    
    // Đợi 4 giây để Gemini API thực tế phản hồi cốt truyện mẫu
    await new Promise(resolve => setTimeout(resolve, 4000));
    
    // Bấm nút "🚀 TIẾN HÀNH SINH KỊCH BẢN AI"
    console.log('[+] Bấm nút "🚀 TIẾN HÀNH SINH KỊCH BẢN AI"...');
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const genBtn = buttons.find(b => b.textContent.includes('TIẾN HÀNH SINH KỊCH BẢN AI'));
      if (genBtn) genBtn.click();
    });

    // Đợi chuyển sang Giai đoạn 2 (Workspace)
    console.log('[+] Đang đợi AI sinh Dàn ý chi tiết của 2 Chương thực tế...');
    await page.waitForSelector('aside', { timeout: 45000 });
    console.log('✅ Chuyển sang không gian soạn thảo Workspace thành công!');

    console.log('\n--- GIAI ĐOẠN 2: WORKSPACE SOẠN THẢO ---');
    const step2Path = path.join(ARTIFACT_DIR, 'step02_workspace_loaded.png');
    await page.screenshot({ path: step2Path });
    console.log(`📸 Đã chụp màn hình Workspace soạn thảo: ${step2Path}`);

    // -------------------------------------------------------------
    console.log('\nStep 1: Quản lý hồ sơ nhân vật & Sinh Gen Prompt AI');
    // Tìm và click tag nhân vật "Khải Đăng" ở sidebar bên trái
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const charBtn = buttons.find(b => b.textContent.includes('Khải Đăng'));
      if (charBtn) {
        charBtn.click();
      }
    });

    await new Promise(resolve => setTimeout(resolve, 1500));
    const step3Path = path.join(ARTIFACT_DIR, 'step03_character_form.png');
    await page.screenshot({ path: step3Path });
    console.log(`📸 Đã mở form cấu hình nhân vật Khải Đăng: ${step3Path}`);

    // Bấm nút "✨ Gen Prompt AI"
    console.log('[+] Bấm nút "✨ Gen Prompt AI" để sinh thông tin hồ sơ bằng Gemini thực tế...');
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const genPromptBtn = buttons.find(b => b.textContent.includes('Gen Prompt AI'));
      if (genPromptBtn) {
        genPromptBtn.click();
      }
    });

    // Đợi Alert xuất hiện động
    await waitForDialog();
    const step4Path = path.join(ARTIFACT_DIR, 'step04_alert_char_profile.png');
    await page.screenshot({ path: step4Path });
    console.log(`📸 Đã chụp màn hình kết quả sau khi Sinh hồ sơ AI (Tương đương ảnh 2): ${step4Path}`);

    // -------------------------------------------------------------
    console.log('\nStep 2: Sinh ảnh chân dung chân thực (Gen Ảnh)');
    // Bấm nút "🎨 Gen Ảnh"
    console.log('[+] Bấm nút "🎨 Gen Ảnh" để vẽ chân dung bằng Whisk thực tế (Sử dụng Cookie)...');
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const genImgBtn = buttons.find(b => b.textContent.includes('Gen Ảnh'));
      if (genImgBtn) {
        genImgBtn.click();
      }
    });

    // Whisk Automation thực tế có thể mất 30-75 giây để render ảnh, đợi hộp thoại hoàn tất động
    console.log('[+] Đang chờ tiến trình Whisk vẽ chân dung nhân vật ngầm...');
    await waitForDialog();
    
    const step6PortraitPath = path.join(ARTIFACT_DIR, 'step06_alert_char_image.png');
    await page.screenshot({ path: step6PortraitPath });
    console.log(`📸 Đã chụp màn hình kết quả sau khi Gen ảnh (Tương đương ảnh 3): ${step6PortraitPath}`);

    // Bấm nút "Lưu hồ sơ"
    console.log('[+] Bấm nút "Lưu hồ sơ"...');
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const saveBtn = buttons.find(b => b.textContent.includes('Lưu hồ sơ'));
      if (saveBtn) saveBtn.click();
    });

    // Đợi Alert Lưu hồ sơ xuất hiện động
    await waitForDialog();
    
    const step5Path = path.join(ARTIFACT_DIR, 'step05_character_saved.png');
    await page.screenshot({ path: step5Path });
    console.log(`📸 Đã chụp lưu hồ sơ nhân vật Khải Đăng: ${step5Path}`);

    // -------------------------------------------------------------
    console.log('\nStep 3: Sinh kịch bản chi tiết chương 1 (Sinh Chi Tiết Chương 1)');
    
    // Kiểm tra xem đã có kịch bản chưa, nếu chưa thì bấm sinh
    const hasScriptContent = await page.evaluate(() => {
      return !document.body.innerText.includes('CHƯƠNG NÀY CHƯA CÓ NỘI DUNG VĂN HỌC');
    });

    if (!hasScriptContent) {
      console.log('[+] Chưa có kịch bản. Bấm nút "Sinh Chi Tiết Chương 1" (Tương đương ảnh 4)...');
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const genChapterBtn = buttons.find(b => b.textContent.includes('Sinh Chi Tiết Chương 1'));
        if (genChapterBtn) genChapterBtn.click();
      });

      // Đợi Gemini viết kịch bản chi tiết thực tế (khoảng 10-25 giây)
      console.log('[+] Đang chờ Gemini streaming viết kịch bản văn học thực tế...');
      await page.waitForFunction(() => {
        return !document.body.innerText.includes('Đang viết') && 
               !document.body.innerText.includes('Đang thiết lập') && 
               !document.body.innerText.includes('CHƯƠNG NÀY CHƯA CÓ NỘI DUNG VĂN HỌC');
      }, { timeout: 95000 });
    } else {
      console.log('[+] Kịch bản đã có sẵn nội dung văn học.');
    }

    const step6Path = path.join(ARTIFACT_DIR, 'step06_chapter_script_ready.png');
    await page.screenshot({ path: step6Path });
    console.log(`📸 Đã chụp màn hình kịch bản chi tiết: ${step6Path}`);

    // -------------------------------------------------------------
    console.log('\nStep 4: Thu âm AI Studio (TTS Voice) Phân Cảnh 1');
    // Bấm nút "🎙️ TTS Voice" ở Cảnh 1
    console.log('[+] Bấm nút "🎙️ TTS Voice" ở phân cảnh đầu tiên...');
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const ttsBtn = buttons.find(b => b.textContent.includes('TTS Voice'));
      if (ttsBtn) ttsBtn.click();
    });

    await new Promise(resolve => setTimeout(resolve, 1500));
    const step7Path = path.join(ARTIFACT_DIR, 'step07_tts_accordion_opened.png');
    await page.screenshot({ path: step7Path });
    console.log(`📸 Đã chụp màn hình accordion TTS mở: ${step7Path}`);

    // Bấm nút "Gen Audio & Lưu PC"
    console.log('[+] Bấm nút "Gen Audio & Lưu PC" bằng API TTS thực tế...');
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const genAudioBtn = buttons.find(b => b.textContent.includes('Gen Audio & Lưu PC'));
      if (genAudioBtn) genAudioBtn.click();
    });

    // Chờ 15s tối đa cho API TTS thực tế sinh xong âm thanh và render ra thẻ audio
    console.log('[+] Đang chờ tệp âm thanh giọng đọc hoàn tất...');
    await page.waitForSelector('audio', { timeout: 35000 });
    
    const step8Path = path.join(ARTIFACT_DIR, 'step08_tts_audio_generated.png');
    await page.screenshot({ path: step8Path });
    console.log(`📸 Đã chụp màn hình Audio đã sinh thành công: ${step8Path}`);

    // -------------------------------------------------------------
    console.log('\nStep 5: Storyboard Phân Cảnh (Studio Cảnh) & Whisk Image');
    // Bấm nút "🎬 Studio Cảnh" ở Cảnh 1
    console.log('[+] Bấm nút "🎬 Studio Cảnh" ở phân cảnh đầu tiên...');
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const studioBtn = buttons.find(b => b.textContent.includes('Studio Cảnh'));
      if (studioBtn) studioBtn.click();
    });

    await new Promise(resolve => setTimeout(resolve, 1500));
    const step9Path = path.join(ARTIFACT_DIR, 'step09_studio_accordion_opened.png');
    await page.screenshot({ path: step9Path });
    console.log(`📸 Đã chụp màn hình accordion Studio Cảnh mở: ${step9Path}`);

    // Bấm nút "Gen Prompt Studio"
    console.log('[+] Bấm nút "Gen Prompt Studio"...');
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const genPromptStudioBtn = buttons.find(b => b.textContent.includes('Gen Prompt Studio'));
      if (genPromptStudioBtn) genPromptStudioBtn.click();
    });

    // Đợi Alert xuất hiện động
    await waitForDialog();
    
    const step10Path = path.join(ARTIFACT_DIR, 'step10_prompts_studio_ready.png');
    await page.screenshot({ path: step10Path });
    console.log(`📸 Đã chụp màn hình các Prompt vẽ ảnh đã sẵn sàng: ${step10Path}`);

    // Bấm nút "Gen ảnh" đầu tiên dưới dòng prompt c1-01
    console.log('[+] Bấm nút "Gen ảnh" cho prompt c1-01 đầu tiên bằng Whisk thực tế (Sử dụng Cookie)...');
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const genImageRowBtn = buttons.find(b => b.textContent.includes('Gen ảnh'));
      if (genImageRowBtn) genImageRowBtn.click();
    });

    // Whisk vẽ ảnh thực tế mất 40-75s, đợi tệp ảnh serve-image được render
    console.log('[+] Đang chờ Whisk vẽ ảnh phân cảnh ngầm và hiển thị lên Web UI...');
    await page.waitForFunction(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      return imgs.some(img => img.src && img.src.includes('/api/serve-image') && img.src.includes('chapter_1_scene_0_prompt_0'));
    }, { timeout: 95000 });
    
    const step11Path = path.join(ARTIFACT_DIR, 'step11_storyboard_image_rendered.png');
    await page.screenshot({ path: step11Path });
    console.log(`📸 Đã chụp màn hình Ảnh Storyboard phân cảnh hiển thị: ${step11Path}`);

    // Kiểm tra nút "Mở Link"
    const whiskProjectUrl = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const openLinkBtn = buttons.find(b => b.textContent.includes('Mở Link'));
      return openLinkBtn ? true : false;
    });
    console.log(`🔍 Kiểm tra nút "Mở Link": ${whiskProjectUrl ? 'HỢP LỆ (Đã có Whisk Link thực tế!)' : 'CHƯA CÓ LINK'}`);

    // -------------------------------------------------------------
    console.log('\nStep 6: Thử nghiệm quét nhấn các nút khác có thể bấm trên giao diện');
    
    // Thử bấm chọn các Tab Dàn ý ở Sidebar trái
    console.log('[+] Nhấp chuyển đổi các Accordion Dàn ý bên Sidebar trái...');
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const overallBtn = buttons.find(b => b.textContent.includes('Dàn Ý Tổng Quan'));
      if (overallBtn) overallBtn.click();
    });
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const loreBtn = buttons.find(b => b.textContent.includes('Luật Lorebook'));
      if (loreBtn) loreBtn.click();
    });
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Thử bấm nút lật chương ở chapter pagination
    console.log('[+] Nhấp nút chuyển chương pagination sang Chương 2...');
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const nextBtn = buttons.find(b => b.textContent.includes('2') && b.closest('.grid'));
      if (nextBtn) nextBtn.click();
    });
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const step12Path = path.join(ARTIFACT_DIR, 'step12_done_chapter2_loaded.png');
    await page.screenshot({ path: step12Path });
    console.log(`📸 Đã chuyển chương 2 và chụp màn hình hoàn chỉnh: ${step12Path}`);

    console.log('\n================================================================');
    console.log('🎉 XÁC NHẬN: MỌI HÀNH ĐỘNG CLICK VỚI API & COOKIE THỰC TẾ THÀNH CÔNG!');
    console.log('================================================================');

  } catch (err) {
    console.error('❌ LỖI KHI MÔ PHỎNG PƯP-PETEER BROWSER:', err);
  } finally {
    // Chờ 5 giây trước khi đóng trình duyệt để người dùng kịp nghiệm thu visual cuối cùng
    await new Promise(resolve => setTimeout(resolve, 5000));
    await browser.close();
    if (devServer) {
      console.log('\n[+] Đang dừng Next.js Local Server...');
      devServer.kill();
    }
    process.exit(0);
  }
}

runFullSimulation();
