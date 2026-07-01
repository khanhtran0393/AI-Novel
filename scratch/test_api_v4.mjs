// Test v4 - Thử ĐÚNG model hỗ trợ sinh ảnh
import fs from 'fs';

const key = 'AIzaSyCJFnjbF2aV0_gTZP_0IQY5TLndXg1CF74';

const imageModels = [
  'gemini-2.5-flash-image',
  'gemini-3-pro-image',
  'gemini-3.1-flash-image',
  'gemini-3-pro-image-preview',
  'gemini-3.1-flash-image-preview',
];

// Imagen 4 dùng phương thức predict
const imagenModels = [
  'imagen-4.0-generate-001',
  'imagen-4.0-fast-generate-001',
];

async function testGenerateContent(modelId) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${key}`;
  console.log(`\n[${modelId}] generateContent + IMAGE...`);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Generate an image of a cute orange cat sitting on a cozy armchair, digital art style, warm lighting" }] }],
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
          console.log(`  >>> ẢNH NHẬN ĐƯỢC! mimeType: ${p.inlineData.mimeType}, base64 size: ${p.inlineData.data?.length || 0}`);
          if (p.inlineData.data) {
            fs.writeFileSync(`scratch/test_${modelId.replace(/[^a-z0-9]/g,'_')}.${ext}`, Buffer.from(p.inlineData.data, 'base64'));
            console.log(`  >>> ĐÃ LƯU: scratch/test_${modelId.replace(/[^a-z0-9]/g,'_')}.${ext}`);
          }
          return true;
        }
        if (p.text) {
          console.log(`  Text: ${p.text.substring(0, 200)}`);
        }
      }
    } else {
      console.log(`  Body: ${text.substring(0, 400)}`);
    }
  } catch (e) {
    console.log(`  Error: ${e.message}`);
  }
  return false;
}

async function testPredict(modelId) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:predict?key=${key}`;
  console.log(`\n[${modelId}] predict endpoint...`);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt: "A cute orange cat sitting on a cozy armchair, digital art style" }],
        parameters: { sampleCount: 1, aspectRatio: "16:9" }
      }),
      signal: AbortSignal.timeout(60000)
    });
    const text = await r.text();
    console.log(`  Status: ${r.status}`);
    
    if (r.ok) {
      const json = JSON.parse(text);
      console.log(`  Response keys: ${Object.keys(json)}`);
      // Check predictions format
      if (json.predictions) {
        for (const pred of json.predictions) {
          if (pred.bytesBase64Encoded) {
            console.log(`  >>> ẢNH NHẬN ĐƯỢC! size: ${pred.bytesBase64Encoded.length}`);
            fs.writeFileSync(`scratch/test_${modelId.replace(/[^a-z0-9]/g,'_')}.png`, Buffer.from(pred.bytesBase64Encoded, 'base64'));
            return true;
          }
        }
      }
      console.log(`  Body: ${text.substring(0, 400)}`);
    } else {
      console.log(`  Body: ${text.substring(0, 400)}`);
    }
  } catch (e) {
    console.log(`  Error: ${e.message}`);
  }
  return false;
}

(async () => {
  console.log('====== TEST SINH ẢNH THỰC TẾ ======');
  
  // 1. Thử generateContent models
  for (const m of imageModels) {
    const ok = await testGenerateContent(m);
    if (ok) {
      console.log(`\n✅ MODEL THÀNH CÔNG: ${m} (dùng generateContent)`);
      return;
    }
  }
  
  // 2. Thử predict models (Imagen 4)
  for (const m of imagenModels) {
    const ok = await testPredict(m);
    if (ok) {
      console.log(`\n✅ MODEL THÀNH CÔNG: ${m} (dùng predict)`);
      return;
    }
  }
  
  console.log('\n❌ KHÔNG CÓ MODEL NÀO HOẠT ĐỘNG');
})();
