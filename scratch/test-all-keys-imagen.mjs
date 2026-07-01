// eslint-disable-next-line @typescript-eslint/no-unused-vars
import fs from 'fs';

const keys = [
  'AIzaSyAaSas8uU2gjkVhWmd1WJ8kp0lcRBRT0lM',
  'AIzaSyDMWb9JouOTegUJ5UgHe0V_InzkG970D9s',
  'AIzaSyCe7aTKyA6dxhYOaLPOHsXGZnHAghwKBs4',
  'AIzaSyBr1jE497R-aYa_J2u7oru0ffBh1jhRSyI',
  'AIzaSyCcv30j5T8OL-giaxh1aBP-PSKj-yqx_ms'
];

async function testKey(key, index) {
  const modelName = 'imagen-4.0-generate-001';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:predict?key=${key}`;
  
  try {
    const payload = {
      instances: [
        {
          prompt: 'A futuristic cybernetic device'
        }
      ],
      parameters: {
        sampleCount: 1,
        aspectRatio: '1:1'
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    const text = await res.text();
    if (res.ok) {
      console.log(`✅ KEY ${index + 1} SUCCESS! Response length: ${text.length}`);
      return true;
    } else {
      console.log(`❌ KEY ${index + 1} FAILED. Status: ${res.status}. Error: ${text.substring(0, 150).replace(/\n/g, ' ')}`);
    }
  } catch (err) {
    console.log(`❌ KEY ${index + 1} ERRORED:`, err.message);
  }
  return false;
}

async function run() {
  console.log('Testing all 5 keys for Imagen 4.0 predict...');
  for (let i = 0; i < keys.length; i++) {
    await testKey(keys[i], i);
  }
}

run();
