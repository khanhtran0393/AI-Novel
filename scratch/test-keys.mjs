

const keys = [
  'AIzaSyAaSas8uU2gjkVhWmd1WJ8kp0lcRBRT0lM',
  'AIzaSyDMWb9JouOTegUJ5UgHe0V_InzkG970D9s',
  'AIzaSyCe7aTKyA6dxhYOaLPOHsXGZnHAghwKBs4',
  'AIzaSyBr1jE497R-aYa_J2u7oru0ffBh1jhRSyI',
  'AIzaSyCcv30j5T8OL-giaxh1aBP-PSKj-yqx_ms'
];

async function testKey(key, index) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const model = 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
  
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (res.ok) {
      console.log(`✅ Key ${index + 1} is VALID! Available models: ${data.models?.map(m => m.name.split('/').pop()).join(', ')}`);
      return true;
    } else {
      console.log(`❌ Key ${index + 1} INVALID. Status: ${res.status}. Message: "${data.error?.message}"`);
      return false;
    }
  } catch (err) {
    console.log(`❌ Key ${index + 1} ERRORED:`, err.message);
    return false;
  }
}

async function run() {
  console.log('Testing 5 Gemini API Keys...');
  for (let i = 0; i < keys.length; i++) {
    await testKey(keys[i], i);
  }
}

run();
