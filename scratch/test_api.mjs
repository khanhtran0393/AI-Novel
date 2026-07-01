// Test script: thử gọi Imagen 3 API bằng từng key
import fs from 'fs';

const keys = [
  'AIzaSyCJFnjbF2aV0_gTZP_0IQY5TLndXg1CF74',
  'AIzaSyB-Ls5p5bUmFabe3QA28QBDjX9xV9MoFaw',
  'AIzaSyABAMWFLgV3gj9wpiZ93gFMCJztiAGDBI0',
  'AIzaSyDXy_NIruFmSUBubWZhcfozaW-Ezpnb0iQ',
];

// Schema theo Google AI docs mới nhất
const bodyV1 = {
  instances: [{ prompt: "A cute cat sitting on a cozy armchair" }],
  parameters: { sampleCount: 1, aspectRatio: "16:9" }
};

// Schema cũ (cách code hiện tại đang dùng)
const bodyV2 = {
  prompt: "A cute cat sitting on a cozy armchair",
  numberOfImages: 1,
  aspectRatio: "16:9",
  outputMimeType: "image/png"
};

async function tryKey(key, bodyLabel, body) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:generateImages?key=${key}`;
  console.log(`\n--- Testing ${bodyLabel} with key ${key.substring(0, 15)}... ---`);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000)
    });
    const text = await resp.text();
    console.log(`Status: ${resp.status}`);
    // Chỉ in 500 ký tự đầu để tránh quá dài
    console.log(`Response: ${text.substring(0, 500)}`);
    if (resp.ok) {
      const data = JSON.parse(text);
      if (data.generatedImages && data.generatedImages[0]?.image?.imageBytes) {
        console.log(`>>> THÀNH CÔNG! Ảnh nhận được, kích thước base64: ${data.generatedImages[0].image.imageBytes.length}`);
        fs.writeFileSync('scratch/test_output.png', Buffer.from(data.generatedImages[0].image.imageBytes, 'base64'));
        console.log('>>> Ảnh đã lưu tại scratch/test_output.png');
      } else if (data.predictions && data.predictions[0]?.bytesBase64Encoded) {
        console.log(`>>> THÀNH CÔNG (schema predictions)! Kích thước base64: ${data.predictions[0].bytesBase64Encoded.length}`);
        fs.writeFileSync('scratch/test_output.png', Buffer.from(data.predictions[0].bytesBase64Encoded, 'base64'));
        console.log('>>> Ảnh đã lưu tại scratch/test_output.png');
      } else {
        console.log('>>> Phản hồi OK nhưng không tìm thấy ảnh trong response.');
      }
      return true;
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
  }
  return false;
}

(async () => {
  console.log('====== BẮT ĐẦU TEST IMAGEN 3 API ======\n');
  
  // Test schema V2 (đang dùng trong code) với key đầu tiên
  let success = await tryKey(keys[0], 'Schema V2 (hiện tại)', bodyV2);
  
  if (!success) {
    // Thử schema V1 (Google docs)
    success = await tryKey(keys[0], 'Schema V1 (Google docs)', bodyV1);
  }
  
  if (!success) {
    // Thử tất cả key còn lại với schema V1
    for (let i = 1; i < keys.length; i++) {
      success = await tryKey(keys[i], 'Schema V1', bodyV1);
      if (success) break;
    }
  }
  
  if (!success) {
    // Thử model imagen-3.0-generate-002
    console.log('\n\n====== THỬ MODEL imagen-3.0-generate-002 ======');
    const url002 = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:generateImages?key=${keys[0]}`;
    try {
      const resp = await fetch(url002, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyV1),
        signal: AbortSignal.timeout(30000)
      });
      console.log(`Status: ${resp.status}`);
      const text = await resp.text();
      console.log(`Response: ${text.substring(0, 500)}`);
    } catch (err) {
      console.error(`Error: ${err.message}`);
    }
  }
  
  console.log('\n====== TEST HOÀN TẤT ======');
})();
