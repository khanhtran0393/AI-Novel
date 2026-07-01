import fs from 'fs';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import path from 'path';

const apiKey = 'AIzaSyDMWb9JouOTegUJ5UgHe0V_InzkG970D9s'; // Valid Key 2
const model = 'gemini-2.5-flash';

const prompt = `Bạn là một Trợ lý Biên kịch Sản xuất tiểu thuyết mạt thế, sinh tồn, huyền huyễn xuất sắc bậc nhất.
Dựa trên các tham số cấu hình sau:
- Chủ đề: Trinh Thám
- Phong cách: Viễn Tưởng
- Ý tưởng cốt truyện gốc: Trong một đô thị tương lai mang tên Neo-Veridia, nơi những tòa nhà chọc trời vươn tới mây và ánh đèn neon lấp lánh không ngừng, cuộc sống được định nghĩa bởi "Mạng Lưới Thấu Cảm".
- Số lượng chương cần phân bổ: 2 chương (BẮT BUỘC: chỉ được phép lên dàn ý đúng chính xác 2 chương, không thừa không thiếu)

Nhiệm vụ của bạn là:
1. Đề xuất một tên tác phẩm tiếng Việt kịch tính, đậm chất mạt thế, sinh tồn.
2. Thiết lập Dàn ý Tổng thể (World-building & Plot Outline) thật chi tiết dưới dạng Markdown.
3. Bóc tách ra khoảng 2-4 tên nhân vật chính yếu (bắt buộc phải là tên Hán Việt độc đáo mới mẻ, ví dụ: Tiêu Hàn, Thạch Dã, Diệp Dao... tuyệt đối không sử dụng Lâm Khuyết hay các tên quá phổ biến).
4. Phác thảo dàn ý chi tiết cho từng chương (từ Chương 1 đến Chương 2) để người dùng chốt chặn trước khi viết. (BẮT BUỘC: danh sách "danh_sach_chuong" bên dưới phải có đúng chính xác 2 phần tử chương, không được phép tự tiện thêm bớt bất kỳ chương nào ngoài số lượng này).
5. Xây dựng Bản Đồ Lưu Trữ Lõi Bất Biến (Lorebook) bao gồm các quy luật sinh tồn, hệ sinh thái, bối cảnh lịch sử, hoặc nguyên tắc cốt lõi của thế giới này. Trình bày dưới dạng Markdown.

Hạn chế/Yêu cầu:
- Trả về định dạng JSON duy nhất và TUYỆT ĐỐI không bao bọc bởi tag markdown \`\`\`json hay text thừa. Khối JSON phải khớp chính xác cấu trúc sau:
{
  "tieu_de": "Tên truyện đề xuất",
  "dan_y_tong_the": "# DÀN Ý TỔNG THỂ\\n\\n## 1. Bối cảnh thế giới...\\n\\n## 2. Diễn biến cốt truyện chính...",
  "lorebook": "# LOREBOOK\\n\\n## 1. Quy luật thế giới...",
  "nhan_vat": ["Nhân vật chính 1", "Nhân vật chính 2"],
  "danh_sach_chuong": [
    {
      "so_chuong": 1,
      "tieu_de": "Tiêu đề Chương 1",
      "dan_y": "Tóm tắt sự kiện, bối cảnh xảy ra trong Chương 1..."
    },
    {
      "so_chuong": 2,
      "tieu_de": "Tiêu đề Chương 2",
      "dan_y": "Tóm tắt sự kiện, bối cảnh xảy ra trong Chương 2..."
    }
  ]
}

Hãy viết cực kỳ hấp dẫn, logic, áp đặt các quy luật sinh tồn khắc nghiệt. Trả về đúng cấu trúc JSON nêu trên.`;

async function debugCall() {
  const url = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`;
  
  console.log(`Sending request to ${model}...`);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.85, maxOutputTokens: 8192 },
      }),
    });

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!text) {
      console.error('API Error:', data.error || data);
      return;
    }

    fs.writeFileSync('scratch/raw_response.txt', text);
    console.log('✅ Saved raw response to scratch/raw_response.txt');
    console.log(`Response length: ${text.length} chars`);

    // Let's test different parsing methods
    console.log('\n--- TESTING PARSING METHODS ---');
    
    // Method 1: JSON.parse directly
    try {
      JSON.parse(text);
      console.log('✅ Method 1 (Direct parse): SUCCESS!');
      return;
    } catch (e) {
      console.log('❌ Method 1 (Direct parse): FAILED -', e.message);
    }

    // Method 2: Strip markdown only
    let cleaned = text.trim();
    cleaned = cleaned.replace(/^```[a-zA-Z]*[\s\n]*/, '');
    cleaned = cleaned.replace(/```$/, '').trim();
    try {
      JSON.parse(cleaned);
      console.log('✅ Method 2 (Strip markdown): SUCCESS!');
      return;
    } catch (e) {
      console.log('❌ Method 2 (Strip markdown): FAILED -', e.message);
    }

    // Method 3: JSON candidate extraction (Curly brackets)
    const startCurly = cleaned.indexOf('{');
    const endCurly = cleaned.lastIndexOf('}');
    if (startCurly !== -1 && endCurly !== -1 && endCurly > startCurly) {
      const jsonCandidate = cleaned.substring(startCurly, endCurly + 1);
      try {
        JSON.parse(jsonCandidate);
        console.log('✅ Method 3 (Curly extraction): SUCCESS!');
        return;
      } catch (e) {
        console.log('❌ Method 3 (Curly extraction): FAILED -', e.message);
        
        // Let's find exactly where it failed in the candidate!
        console.log('\nScanning candidate characters to find JSON syntax errors...');
        try {
          // Find first syntax error
          for (let i = 1; i <= jsonCandidate.length; i++) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const sub = jsonCandidate.substring(0, i);
            try {
              // We try to repair and parse the sub to see where it breaks
              // Or parse it directly
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            } catch (err) {}
          }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (scanErr) {}
      }
    }
    
  } catch (err) {
    console.error('Network Exception:', err.message);
  }
}

debugCall();
