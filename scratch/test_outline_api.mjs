
const keys = [
  'AIzaSyAaSas8uU2gjkVhWmd1WJ8kp0lcRBRT0lM',
  'AIzaSyDMWb9JouOTegUJ5UgHe0V_InzkG970D9s',
  'AIzaSyCe7aTKyA6dxhYOaLPOHsXGZnHAghwKBs4',
  'AIzaSyBr1jE497R-aYa_J2u7oru0ffBh1jhRSyI',
  'AIzaSyCcv30j5T8OL-giaxh1aBP-PSKj-yqx_ms'
];

async function testOutline() {
  console.log('Sending GENERATE_OUTLINE to localhost...');
  try {
    const res = await fetch('http://localhost:3000/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestType: 'GENERATE_OUTLINE',
        apiKeys: keys,
        payload: {
          chu_de: 'Trinh Thám',
          phong_cach: 'Viễn Tưởng',
          mo_ta: 'Trong một tương lai nơi ý thức con người có thể được số hóa và chuyển giao giữa các thể xác...',
          so_chuong: 2
        }
      })
    });

    console.log('Response status:', res.status);
    const text = await res.text();
    console.log('Response raw text length:', text.length);
    try {
      const data = JSON.parse(text);
      console.log('Parsed successfully! Keys:', Object.keys(data));
      console.log('Title:', data.tieu_de);
      console.log('Chapters:', JSON.stringify(data.danh_sach_chuong, null, 2));
    } catch (parseErr) {
      console.log('Failed to parse response JSON:', parseErr.message);
      console.log('Truncated response text:', text.substring(0, 1000));
    }
  } catch (err) {
    console.error('Fetch error:', err.message);
  }
}

testOutline();
