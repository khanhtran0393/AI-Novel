import fs from 'fs';

const key = 'AIzaSyAaSas8uU2gjkVhWmd1WJ8kp0lcRBRT0lM';

async function testPredict(modelName) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:predict?key=${key}`;
  console.log(`\nTesting model: ${modelName}`);
  console.log(`URL: ${url}`);

  try {
    const payload = {
      instances: [
        {
          prompt: 'A cinematic wide shot of a futuristic cyberpunk bedroom with neon lights, highly detailed, 8k resolution'
        }
      ],
      parameters: {
        sampleCount: 1,
        aspectRatio: '16:9',
        outputMimeType: 'image/png'
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    console.log(`Status: ${res.status}`);
    const text = await res.text();
    console.log(`Raw Response (first 1000 chars): ${text.substring(0, 1000)}`);
    
    if (res.ok) {
      const data = JSON.parse(text);
      if (data.predictions && data.predictions.length > 0) {
        const prediction = data.predictions[0];
        console.log(`Keys in prediction:`, Object.keys(prediction));
        
        // Find base64 bytes
        const b64Bytes = prediction.bytesBase64Encoded || prediction.imageBytes || prediction.image?.imageBytes;
        if (b64Bytes) {
          console.log(`Success! Found image bytes. Length: ${b64Bytes.length}`);
          const buffer = Buffer.from(b64Bytes, 'base64');
          fs.writeFileSync(`scratch/test_${modelName}_predict.png`, buffer);
          console.log(`Saved image to scratch/test_${modelName}_predict.png`);
          return true;
        } else {
          console.log(`⚠️ b64Bytes not found. Full prediction keys:`, Object.keys(prediction));
        }
      }
    }
  } catch (err) {
    console.log('Error:', err.message);
  }
  return false;
}

async function run() {
  await testPredict('imagen-4.0-generate-001');
}

run();
