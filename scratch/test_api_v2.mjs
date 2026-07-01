// Test script v2 - debug chi tiết hơn
const keys = [
  'AIzaSyCJFnjbF2aV0_gTZP_0IQY5TLndXg1CF74',
  'AIzaSyB-Ls5p5bUmFabe3QA28QBDjX9xV9MoFaw',
];

const models = [
  'imagen-3.0-generate-001',
  'imagen-3.0-generate-002', 
  'imagen-3.0-fast-generate-001',
  'gemini-2.0-flash-preview-image-generation',
];

async function test(modelId, key) {
  // Thử generateImages endpoint
  const url1 = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateImages?key=${key}`;
  console.log(`\n[${modelId}] generateImages endpoint...`);
  try {
    const r = await fetch(url1, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt: "A cute orange cat" }],
        parameters: { sampleCount: 1 }
      }),
      signal: AbortSignal.timeout(30000)
    });
    const text = await r.text();
    console.log(`  Status: ${r.status} | Headers: ${JSON.stringify(Object.fromEntries(r.headers))}`);
    console.log(`  Body: ${text.substring(0, 300)}`);
    if (r.ok) return true;
  } catch (e) {
    console.log(`  Error: ${e.message}`);
  }

  // Thử generateContent endpoint (Gemini cách)
  const url2 = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${key}`;
  console.log(`[${modelId}] generateContent endpoint...`);
  try {
    const r = await fetch(url2, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Generate an image of: A cute orange cat" }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
      }),
      signal: AbortSignal.timeout(30000)
    });
    const text = await r.text();
    console.log(`  Status: ${r.status}`);
    console.log(`  Body: ${text.substring(0, 300)}`);
    if (r.ok) return true;
  } catch (e) {
    console.log(`  Error: ${e.message}`);
  }

  return false;
}

(async () => {
  console.log('====== TEST API v2 ======');
  
  // Kiểm tra DNS / network trước
  console.log('\n--- Network check ---');
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${keys[0]}`, {
      signal: AbortSignal.timeout(10000)
    });
    const text = await r.text();
    console.log(`List models: Status ${r.status}, Body length: ${text.length}`);
    console.log(`Body snippet: ${text.substring(0, 300)}`);
  } catch (e) {
    console.log(`Network error: ${e.message}`);
  }

  for (const model of models) {
    const ok = await test(model, keys[0]);
    if (ok) {
      console.log(`\n>>> Model ${model} THÀNH CÔNG!`);
      break;
    }
  }
  
  console.log('\n====== DONE ======');
})();
