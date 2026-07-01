// Test gọi API qua localhost:3000
(async () => {
  console.log('Gọi API sinh ảnh tại localhost:3000...');
  try {
    const r = await fetch('http://localhost:3000/api/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'A cute orange cat sitting on a cozy armchair, digital art style',
        chapterNum: 1,
        sceneIndex: 0,
        promptIndex: 0,
        drivePath: '',
        ten_tac_pham: 'Test',
        cookie: '',
        characterPrompt: '',
        useMock: false,
        apiKey: '',
        apiKeys: [],
        model: 'imagen3'
      }),
      signal: AbortSignal.timeout(120000)
    });
    const text = await r.text();
    console.log(`Status: ${r.status}`);
    console.log(`Response: ${text.substring(0, 500)}`);
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }
})();
