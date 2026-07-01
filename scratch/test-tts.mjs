const key = 'AIzaSyAaSas8uU2gjkVhWmd1WJ8kp0lcRBRT0lM';
const model = 'gemini-2.5-flash-preview-tts';
const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

async function test() {
  console.log('Testing Gemini TTS API...');
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text: `Hello` }]
        }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' }
            }
          }
        }
      })
    });
    const duration = (Date.now() - start) / 1000;
    console.log(`Status: ${res.status} (took ${duration}s)`);
    const data = await res.json();
    console.log('Response:', JSON.stringify(data).substring(0, 300));
  } catch (err) {
    console.log('Error:', err.message);
  }
}

test();
