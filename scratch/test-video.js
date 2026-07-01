async function testGenerateVideo() {
  console.log('Testing /api/generate-video...');
  try {
    const payload = {
      chapterNum: 1,
      sceneIndex: 0,
      promptIndex: 1,
      prompt: 'Test prompt',
      duration: 5,
      startImage: 'http://localhost:3000/public/image_0.png',
      endImage: 'http://localhost:3000/public/image_1.png'
    };
    
    const response = await fetch('http://localhost:3000/api/generate-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const data = await response.json();
    if (!response.ok) {
      console.error('API Error:', data.error);
    } else {
      console.log('API Success:', data);
    }
  } catch (err) {
    console.error('Fetch Failed:', err.message);
  }
}

testGenerateVideo();
