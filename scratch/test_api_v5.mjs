// Test v5 - Thử tất cả 4 key với model hoạt động
import fs from 'fs';

const keys = [
  'AIzaSyCJFnjbF2aV0_gTZP_0IQY5TLndXg1CF74',
  'AIzaSyB-Ls5p5bUmFabe3QA28QBDjX9xV9MoFaw',
  'AIzaSyABAMWFLgV3gj9wpiZ93gFMCJztiAGDBI0',
  'AIzaSyDXy_NIruFmSUBubWZhcfozaW-Ezpnb0iQ',
];

// Model đã xác nhận hỗ trợ sinh ảnh qua generateContent
const model = 'gemini-2.5-flash-image';

async function testKey(key, idx) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  console.log(`\n[Key ${idx+1}] ${key.substring(0,15)}... => ${model}`);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Generate an image: A cute orange cat sitting on a cozy armchair, digital art, warm lighting" }] }],
        generationConfig: { responseModalities: ["IMAGE", "TEXT"] }
      }),
      signal: AbortSignal.timeout(60000)
    });
    const text = await r.text();
    console.log(`  Status: ${r.status}`);
    
    if (r.ok) {
      const json = JSON.parse(text);
      const parts = json.candidates?.[0]?.content?.parts || [];
      for (const p of parts) {
        if (p.inlineData) {
          const ext = p.inlineData.mimeType?.includes('png') ? 'png' : 'jpg';
          console.log(`  >>> ✅ ẢNH NHẬN ĐƯỢC! mime: ${p.inlineData.mimeType}, size: ${p.inlineData.data?.length}`);
          fs.writeFileSync(`scratch/test_key${idx+1}.${ext}`, Buffer.from(p.inlineData.data, 'base64'));
          console.log(`  >>> Đã lưu: scratch/test_key${idx+1}.${ext}`);
          return true;
        }
        if (p.text) console.log(`  Text: ${p.text.substring(0, 100)}`);
      }
    } else {
      // Chỉ in phần message
      try {
        const err = JSON.parse(text);
        console.log(`  ❌ ${err.error?.message?.substring(0, 150)}`);
      } catch { console.log(`  Body: ${text.substring(0, 200)}`); }
    }
  } catch (e) {
    console.log(`  Error: ${e.message}`);
  }
  return false;
}

(async () => {
  console.log('====== TEST TẤT CẢ API KEYS ======');
  for (let i = 0; i < keys.length; i++) {
    const ok = await testKey(keys[i], i);
    if (ok) {
      console.log(`\n🎉 KEY ${i+1} HOẠT ĐỘNG! Model: ${model}`);
      return;
    }
  }
  console.log('\n⚠️ TẤT CẢ KEYS ĐỀU HẾT QUOTA HOẶC LỖI. Cần key mới hoặc chờ reset quota.');
})();
