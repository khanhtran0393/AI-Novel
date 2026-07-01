// Test gọi get-cookie API - mở Chrome cho người dùng đăng nhập
(async () => {
  console.log('🔐 Đang gọi API get-cookie để mở Chrome...');
  console.log('⏳ Bạn hãy đăng nhập Google trên cửa sổ Chrome sắp mở...');
  console.log('(Tối đa 5 phút)\n');
  
  try {
    const r = await fetch('http://localhost:3000/api/get-cookie', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(330000) // 5.5 phút
    });
    const data = await r.json();
    console.log(`Status: ${r.status}`);
    
    if (data.cookie) {
      console.log(`\n✅ THÀNH CÔNG! Cookie đã được bắt.`);
      console.log(`Cookie (50 ký tự đầu): ${data.cookie.substring(0, 50)}...`);
      console.log(`Cookie cũng đã được tự động lưu vào headers_veo.txt!`);
    } else if (data.error) {
      console.log(`\n❌ Lỗi: ${data.error}`);
    }
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }
})();
