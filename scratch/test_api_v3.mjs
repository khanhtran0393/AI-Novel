// Test v3 - Tìm model hỗ trợ sinh ảnh trong danh sách models
const key = 'AIzaSyCJFnjbF2aV0_gTZP_0IQY5TLndXg1CF74';

async function run() {
  // Lấy danh sách toàn bộ models
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=100`);
  const data = await r.json();
  
  console.log('=== CÁC MODELS HỖ TRỢ IMAGE GENERATION ===\n');
  const imageModels = [];
  for (const m of data.models) {
    const methods = m.supportedGenerationMethods || [];
    const name = m.name || '';
    const desc = (m.description || '').toLowerCase();
    // Tìm models có khả năng sinh ảnh
    if (desc.includes('image') || name.includes('imagen') || name.includes('image')) {
      console.log(`Model: ${m.name}`);
      console.log(`  Display: ${m.displayName}`);
      console.log(`  Methods: ${methods.join(', ')}`);
      console.log(`  Desc: ${(m.description || '').substring(0, 150)}`);
      console.log('');
      imageModels.push(m);
    }
  }
  
  if (imageModels.length === 0) {
    console.log('Không tìm thấy model nào liên quan đến image.');
    console.log('\n=== TẤT CẢ MODELS ===');
    for (const m of data.models) {
      console.log(`${m.name} | ${(m.supportedGenerationMethods||[]).join(',')} | ${(m.description||'').substring(0,80)}`);
    }
  }

  // Thử generateContent với Gemini 2.0 flash (hỗ trợ multimodal output)
  console.log('\n=== THỬ GEMINI 2.0 FLASH - generateContent với IMAGE modality ===');
  const geminiModels = [
    'gemini-2.0-flash',
    'gemini-2.0-flash-001',
    'gemini-2.5-flash',
    'gemini-2.5-flash-preview-04-17',
  ];
  
  for (const gm of geminiModels) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${gm}:generateContent?key=${key}`;
    console.log(`\nTesting ${gm}...`);
    try {
      const r2 = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Generate an image of a cute orange cat sitting on a cozy armchair, digital art style" }] }],
          generationConfig: { responseModalities: ["IMAGE", "TEXT"] }
        }),
        signal: AbortSignal.timeout(60000)
      });
      const text = await r2.text();
      console.log(`  Status: ${r2.status}`);
      
      if (r2.ok) {
        const json = JSON.parse(text);
        const parts = json.candidates?.[0]?.content?.parts || [];
        for (const p of parts) {
          if (p.inlineData) {
            console.log(`  >>> ẢNH NHẬN ĐƯỢC! mimeType: ${p.inlineData.mimeType}, size: ${p.inlineData.data?.length || 0}`);
            if (p.inlineData.data) {
              const fs = await import('fs');
              const ext = p.inlineData.mimeType?.includes('png') ? 'png' : 'jpg';
              fs.writeFileSync(`scratch/test_${gm.replace(/[^a-z0-9]/g,'_')}.${ext}`, Buffer.from(p.inlineData.data, 'base64'));
              console.log(`  >>> ĐÃ LƯU ẢNH: scratch/test_${gm.replace(/[^a-z0-9]/g,'_')}.${ext}`);
              return gm; // Trả về model thành công
            }
          }
          if (p.text) {
            console.log(`  Text: ${p.text.substring(0, 200)}`);
          }
        }
      } else {
        console.log(`  Body: ${text.substring(0, 300)}`);
      }
    } catch (e) {
      console.log(`  Error: ${e.message}`);
    }
  }
}

run().then(model => {
  if (model) console.log(`\n====== MODEL HOẠT ĐỘNG: ${model} ======`);
  else console.log('\n====== KHÔNG TÌM THẤY MODEL NÀO HOẠT ĐỘNG ======');
});
