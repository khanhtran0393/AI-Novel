import fs from 'fs';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import path from 'path';

const key = 'AIzaSyAaSas8uU2gjkVhWmd1WJ8kp0lcRBRT0lM';

async function testModel(modelName) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateImages?key=${key}`;
  console.log(`\nTesting model: ${modelName}`);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'A cinematic wide shot of a futuristic cyberpunk bedroom with neon lights, highly detailed, 8k resolution',
        numberOfImages: 1,
        aspectRatio: '16:9',
        outputMimeType: 'image/png'
      })
    });

    console.log(`Status: ${res.status}`);
    const text = await res.text();
    console.log(`Raw Response (first 300 chars): ${text.substring(0, 300)}`);
    
    if (res.ok) {
      const data = JSON.parse(text);
      if (data.generatedImages && data.generatedImages.length > 0) {
        const imgBytes = data.generatedImages[0].image?.imageBytes;
        if (imgBytes) {
          console.log(`   Image bytes received! Length: ${imgBytes.length}`);
          const buffer = Buffer.from(imgBytes, 'base64');
          fs.writeFileSync(`scratch/test_${modelName}.png`, buffer);
          return true;
        }
      }
    }
  } catch (err) {
    console.log(`❌ Erored for ${modelName}:`, err.message);
  }
  return false;
}

async function run() {
  const models = [
    'imagen-3.0-generate-001',
    'imagen-3.0-generate-002',
    'imagen-4.0-generate-001'
  ];

  for (const model of models) {
    await testModel(model);
  }
}

run();
