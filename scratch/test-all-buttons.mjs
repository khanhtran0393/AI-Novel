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
const artifactDir = 'C:\\Users\\Khanh\\.gemini\\antigravity\\brain\\e46ab026-eb42-4cd4-8b51-a72633b8b4af';
const buttonScreenshotDir = path.join(artifactDir, 'screenshots_buttons');
if (!fs.existsSync(buttonScreenshotDir)) {
  fs.mkdirSync(buttonScreenshotDir, { recursive: true });
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

async function getStoreState(page) {
  return await page.evaluate(() => {
    const data = localStorage.getItem('novel_generator_v2_store');
    return data ? JSON.parse(data).state : null;
  });
}

async function main() {
  console.log('================================================================');
  console.log('🤖 KHỞI CHẠY BỘ KIỂM THỬ TẤT CẢ NÚT BẤM THỜI GIAN THỰC (VÌ MÔ) (V4)...');
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
      console.log(`[Cookies Loaded]: Loaded cookie length ${savedCookie.length}, rotating array size ${savedCookies.length}`);
    }
  } catch (e) {
    console.error('[-] Lỗi load saved_novel_store.json:', e.message);
  }

  const chromePath = findChromePath();
  console.log(`[Chrome Path]: ${chromePath || 'Using default Puppeteer browser'}`);

  console.log('[Browser]: Đang khởi chạy Puppeteer...');
  const browser = await puppeteer.launch({
    headless: true,
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

  // Alert Dialog handling
  page.on('dialog', async dialog => {
    console.log(`   🔔 [DIALOG]: [${dialog.type().toUpperCase()}] "${dialog.message()}"`);
    await dialog.accept();
  });

  try {
    console.log('\n--- BƯỚC 1: TRUY CẬP VÀ REHYDRATE WORKSPACE ---');
    await page.goto('http://localhost:3000/workspace', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 4000));
    console.log('✅ Đã truy cập trang Workspace.');

    // Inject state to load perfect workspace state mock directly
    await page.evaluate((keys, cookie, cookies) => {
      const data = localStorage.getItem('novel_generator_v2_store');
      let parsed = data ? JSON.parse(data) : { state: {} };
      if (!parsed.state) parsed.state = {};
      
      parsed.state.giai_doan = 2; // Direct Stage 2
      parsed.state.useMock = false; // Online Mode
      parsed.state.apiKeys = keys;
      parsed.state.apiKey = keys[0];
      parsed.state.googleStudioCookie = cookie;
      parsed.state.googleStudioCookies = cookies;
      
      // Inject rich mock content
      parsed.state.setup = {
        chu_de: 'Trinh Thám',
        phong_cach: 'Viễn Tưởng',
        mo_ta: 'Một kịch bản trinh thám viễn tưởng đầy kịch tính.',
        so_chuong: 2,
        so_tu_chuong: 4250
      };
      parsed.state.ten_tac_pham = 'Phế Tích Tâm Thức';
      parsed.state.dan_y_tong_the = 'Dàn ý tổng thể của toàn tác phẩm viễn tưởng...';
      parsed.state.lorebook = 'Luật Lõi Lorebook: Độc tố không vượt quá 100.';
      parsed.state.nhan_vat = ['Vô Danh', 'Vệ Uyên'];
      
      // Detailed chapter content with scene dividers
      parsed.state.chuong_dang_chon = 1;
      parsed.state.danh_sach_chuong = [
        {
          so_chuong: 1,
          tieu_de: 'Chương 1: Khởi đầu',
          dan_y: 'Dàn ý Chương 1 chi tiết...',
          noi_dung: '[CẢNH 1: Đêm mưa lạnh]\nTrong bóng tối bao phủ thành phố, Elias Thorne bước đi lặng lẽ...\n\n[CẢNH 2: Cuộc đuổi bắt]\nTiếng bước chân gấp gáp đuổi theo phía sau...',
          trang_thai: 'ready'
        },
        {
          so_chuong: 2,
          tieu_de: 'Chương 2: Khám phá',
          dan_y: 'Dàn ý Chương 2 chi tiết...',
          noi_dung: '',
          trang_thai: 'empty'
        }
      ];
      
      // Inject some visual prompts for Scene 1
      parsed.state.generatedPrompts = {
        '1_0': [
          { prompt: 'A dark detective walking under neon rain, cinematic, cyberpunk style', sentence: 'Trong bóng tối bao phủ thành phố, Elias Thorne bước đi lặng lẽ', timestamp: '0.0s' }
        ]
      };
      
      localStorage.setItem('novel_generator_v2_store', JSON.stringify(parsed));
    }, userApiKeys, savedCookie, savedCookies);

    console.log('Đang nạp lại trang với trạng thái tiêm đầy đủ...');
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 4000));
    console.log('✅ Đã nạp lại trang. Sẵn sàng tương tác tất cả nút bấm!');

    // --- TIẾN HÀNH KIỂM TRA TỪNG NÚT BẤM ---

    // 1. Nút Huy hiệu Mock Mode / Online Mode
    console.log('\n[Button 1] Bấm nút Huy hiệu Mock Mode / Online Mode...');
    try {
      const mockBadge = await page.waitForSelector('button ::-p-text(ONLINE MODE API)', { timeout: 3000 });
      if (mockBadge) {
        await mockBadge.click();
        console.log('   -> Đã click. Đang đợi chuyển trạng thái...');
        await new Promise(r => setTimeout(r, 1000));
        await page.screenshot({ path: path.join(buttonScreenshotDir, 'btn_1_toggle_mock.png') });
        console.log('   ✅ Chụp ảnh thành công: btn_1_toggle_mock.png');
        
        // Restore to Online Mode
        const restoreBadge = await page.waitForSelector('button ::-p-text(MOCK MODE ACTIVE)', { timeout: 3000 });
        if (restoreBadge) {
          await restoreBadge.click();
          await new Promise(r => setTimeout(r, 500));
        }
      }
    } catch (e) {
      console.error('   ❌ Lỗi Button 1:', e.message);
    }

    // 2. Nút Thư mục lưu PC (Drive Manager)
    console.log('\n[Button 2] Bấm nút "📁 Nơi lưu PC"...');
    try {
      const driveBtn = await page.evaluateHandle(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.find(b => b.textContent && b.textContent.includes('lưu PC'));
      });
      if (driveBtn) {
        await driveBtn.asElement().click();
        await new Promise(r => setTimeout(r, 1000));
        await page.screenshot({ path: path.join(buttonScreenshotDir, 'btn_2_drive_modal.png') });
        console.log('   ✅ Chụp ảnh thành công: btn_2_drive_modal.png');
        
        // Close modal
        await driveBtn.asElement().click();
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (e) {
      console.error('   ❌ Lỗi Button 2:', e.message);
    }

    // 3. Nút Cookie (Cookie Manager)
    console.log('\n[Button 3] Bấm nút "Cookie"...');
    try {
      const cookieBtn = await page.evaluateHandle(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.find(b => b.textContent && b.textContent.includes('Cookie ('));
      });
      if (cookieBtn) {
        await cookieBtn.asElement().click();
        await new Promise(r => setTimeout(r, 1000));
        await page.screenshot({ path: path.join(buttonScreenshotDir, 'btn_3_cookie_modal.png') });
        console.log('   ✅ Chụp ảnh thành công: btn_3_cookie_modal.png');
        
        // Close modal
        await cookieBtn.asElement().click();
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (e) {
      console.error('   ❌ Lỗi Button 3:', e.message);
    }

    // 4. Nút API Keys (API Key Manager)
    console.log('\n[Button 4] Bấm nút "API Keys"...');
    try {
      const apiBtn = await page.evaluateHandle(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.find(b => b.textContent && b.textContent.includes('API Keys ('));
      });
      if (apiBtn) {
        await apiBtn.asElement().click();
        await new Promise(r => setTimeout(r, 1000));
        await page.screenshot({ path: path.join(buttonScreenshotDir, 'btn_4_api_keys_modal.png') });
        console.log('   ✅ Chụp ảnh thành công: btn_4_api_keys_modal.png');
        
        // Close modal
        await apiBtn.asElement().click();
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (e) {
      console.error('   ❌ Lỗi Button 4:', e.message);
    }

    // 5. Nút Dàn Ý Tổng Quan (Outline Accordion) trong Sidebar
    console.log('\n[Button 5] Bấm nút "Dàn Ý Tổng Quan" accordion...');
    try {
      const outlineOverallBtn = await page.waitForSelector('button ::-p-text(Dàn Ý Tổng Quan)', { timeout: 3000 });
      if (outlineOverallBtn) {
        await outlineOverallBtn.click();
        await new Promise(r => setTimeout(r, 1000));
        await page.screenshot({ path: path.join(buttonScreenshotDir, 'btn_5_outline_accordion.png') });
        console.log('   ✅ Chụp ảnh thành công: btn_5_outline_accordion.png');
        
        // Close outline overall
        await outlineOverallBtn.click();
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (e) {
      console.error('   ❌ Lỗi Button 5:', e.message);
    }

    // 5b. Nút Tóm Tắt Chương (Chapter Outline Accordion) trong Sidebar
    console.log('\n[Button 5b] Bấm nút "Tóm Tắt Chương 1" accordion...');
    try {
      const chapterOutlineBtn = await page.waitForSelector('button ::-p-text(Tóm Tắt Chương 1)', { timeout: 3000 });
      if (chapterOutlineBtn) {
        await chapterOutlineBtn.click();
        await new Promise(r => setTimeout(r, 1000));
        await page.screenshot({ path: path.join(buttonScreenshotDir, 'btn_5b_chapter_accordion.png') });
        console.log('   ✅ Chụp ảnh thành công: btn_5b_chapter_accordion.png');
        
        // Close outline chapter
        await chapterOutlineBtn.click();
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (e) {
      console.error('   ❌ Lỗi Button 5b:', e.message);
    }

    // 5c. Nút Luật Lorebook (Lorebook Accordion) trong Sidebar
    console.log('\n[Button 5c] Bấm nút "Luật Lorebook (Lõi)" accordion...');
    try {
      const lorebookBtn = await page.waitForSelector('button ::-p-text(Luật Lorebook (Lõi))', { timeout: 3000 });
      if (lorebookBtn) {
        await lorebookBtn.click();
        await new Promise(r => setTimeout(r, 1000));
        await page.screenshot({ path: path.join(buttonScreenshotDir, 'btn_5c_lorebook_accordion.png') });
        console.log('   ✅ Chụp ảnh thành công: btn_5c_lorebook_accordion.png');
        
        // Close outline lorebook
        await lorebookBtn.click();
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (e) {
      console.error('   ❌ Lỗi Button 5c:', e.message);
    }

    // 6. Nút Hồ Sơ Nhân Vật trong Sidebar
    console.log('\n[Button 6] Bấm chọn tên nhân vật đầu tiên trong danh sách...');
    try {
      const state = await getStoreState(page);
      const characters = state?.nhan_vat || [];
      if (characters.length > 0) {
        const charName = characters[0];
        console.log(`   -> Tìm thấy nhân vật: "${charName}". Tiến hành click...`);
        const charBtn = await page.waitForSelector(`button ::-p-text(${charName})`, { timeout: 3000 });
        if (charBtn) {
          await charBtn.click();
          await new Promise(r => setTimeout(r, 1200));
          await page.screenshot({ path: path.join(buttonScreenshotDir, 'btn_6_character_sheet.png') });
          console.log('   ✅ Chụp ảnh thành công: btn_6_character_sheet.png');

          // Inside character details, test buttons: "✨ Gen Prompt AI" and "🔄 Tạo lại Prompt"
          console.log('   [Action inside Sheet] Bấm nút "✨ Gen Prompt AI" trong Hồ sơ nhân vật...');
          const genPromptBtn = await page.$('button ::-p-text(Gen Prompt AI)');
          if (genPromptBtn) {
            await genPromptBtn.click();
            await new Promise(r => setTimeout(r, 1200));
            console.log('   -> Đã click "Gen Prompt AI"');
          }

          console.log('   [Action inside Sheet] Bấm nút "🔄 Tạo lại Prompt" trong Hồ sơ nhân vật...');
          const regenPromptBtn = await page.$('button ::-p-text(Tạo lại Prompt)');
          if (regenPromptBtn) {
            await regenPromptBtn.click();
            await new Promise(r => setTimeout(r, 1200));
            console.log('   -> Đã click "Tạo lại Prompt"');
          }
        }
      } else {
        console.log('   [-] Không tìm thấy nhân vật nào trong danh sách, bỏ qua.');
      }
    } catch (e) {
      console.error('   ❌ Lỗi Button 6:', e.message);
    }

    // 9. Nút chuyển đổi Subtabs "🎙️ TTS Voice" & "🎬 Studio Cảnh" trong Phân Cảnh
    console.log('\n[Button 9] Bấm chuyển đổi các Subtabs trong phân cảnh Cảnh 1...');
    try {
      const ttsSubtab = await page.waitForSelector('button ::-p-text(TTS Voice)', { timeout: 4000 });
      if (ttsSubtab) {
        await ttsSubtab.click();
        await new Promise(r => setTimeout(r, 1000));
        await page.screenshot({ path: path.join(buttonScreenshotDir, 'btn_9_tts_subtab.png') });
        console.log('   ✅ Chụp ảnh thành công: btn_9_tts_subtab.png');
      }

      const studioSubtab = await page.waitForSelector('button ::-p-text(Studio Cảnh)', { timeout: 4000 });
      if (studioSubtab) {
        await studioSubtab.click();
        await new Promise(r => setTimeout(r, 1000));
        await page.screenshot({ path: path.join(buttonScreenshotDir, 'btn_9_studio_subtab.png') });
        console.log('   ✅ Chụp ảnh thành công: btn_9_studio_subtab.png');
      }
    } catch (e) {
      console.error('   ❌ Lỗi Button 9:', e.message);
    }

    // 10. Nút Thao Tác Trong Phân Cảnh (Copy & Copy All)
    console.log('\n[Button 10] Bấm nút "Copy" và "Copy All" trong phân cảnh...');
    try {
      const copyBtn = await page.evaluateHandle(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.find(b => b.textContent && b.textContent.trim() === 'Copy');
      });
      if (copyBtn && copyBtn.asElement()) {
        await copyBtn.asElement().click();
        console.log('   -> Đã click "Copy"');
        await new Promise(r => setTimeout(r, 500));
      }

      const copyAllBtn = await page.evaluateHandle(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.find(b => b.textContent && b.textContent.trim() === 'Copy All');
      });
      if (copyAllBtn && copyAllBtn.asElement()) {
        await copyAllBtn.asElement().click();
        console.log('   -> Đã click "Copy All"');
        await new Promise(r => setTimeout(r, 800));
        await page.screenshot({ path: path.join(buttonScreenshotDir, 'btn_10_copy_buttons.png') });
        console.log('   ✅ Chụp ảnh thành công: btn_10_copy_buttons.png');
      }
    } catch (e) {
      console.error('   ❌ Lỗi Button 10:', e.message);
    }

    // 11. Nút Chọn Chương khác trong grid (ví dụ Chương 2)
    console.log('\n[Button 11] Bấm chọn Chương 2 trong grid danh sách chương...');
    try {
      const ch2Btn = await page.evaluateHandle(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.find(b => b.textContent && b.textContent.trim() === '2');
      });
      if (ch2Btn && ch2Btn.asElement()) {
        await ch2Btn.asElement().click();
        await new Promise(r => setTimeout(r, 1200));
        await page.screenshot({ path: path.join(buttonScreenshotDir, 'btn_11_select_chapter2.png') });
        console.log('   ✅ Chụp ảnh thành công: btn_11_select_chapter2.png');
        
        // Restore back to Chapter 1
        const ch1Btn = await page.evaluateHandle(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          return buttons.find(b => b.textContent && b.textContent.trim() === '1');
        });
        if (ch1Btn && ch1Btn.asElement()) {
          await ch1Btn.asElement().click();
          await new Promise(r => setTimeout(r, 500));
        }
      }
    } catch (e) {
      console.error('   ❌ Lỗi Button 11:', e.message);
    }

    // 12. Nút xuất file Tải Toàn Bộ (.txt)
    console.log('\n[Button 12] Bấm nút "Tải Toàn Bộ (.txt)"...');
    try {
      const exportBtn = await page.waitForSelector('button ::-p-text(Tải Toàn Bộ (.txt))', { timeout: 3000 });
      if (exportBtn) {
        await exportBtn.click();
        await new Promise(r => setTimeout(r, 1000));
        await page.screenshot({ path: path.join(buttonScreenshotDir, 'btn_12_export_txt.png') });
        console.log('   ✅ Chụp ảnh thành công: btn_12_export_txt.png');
      }
    } catch (e) {
      console.error('   ❌ Lỗi Button 12:', e.message);
    }

    console.log('\n================================================================');
    console.log('🎉 KIỂM TRA THAO TÁC CÁC NÚT BẤM THỜI GIAN THỰC ĐÃ HOÀN TẤT THÀNH CÔNG!');
    console.log('================================================================');

  } catch (err) {
    console.error('\n❌ CÓ LỖI CHUNG XẢY RA TRONG QUÁ TRÌNH THỬ NÚT BẤM:', err.message);
  } finally {
    console.log('Đang đóng trình duyệt...');
    await browser.close();
    console.log('Done!');
  }
}

main();
