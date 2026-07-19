/**
 * Final human UX/integration checklist for the production reviewer.
 *
 * The signed workflow already performs package audit, Authenticode checks,
 * install/launch/uninstall, Free/Trial/tamper gates, and a real HTTPS updater
 * download/install. These remaining checks require seller accounts, a clean
 * physical Windows machine, or human UI judgment before approving production.
 */
const steps = [
  {
    id: 'artifact',
    title: 'Tải signed NSIS candidate từ GitHub Actions artifact',
    expect: 'Không dùng portable/unsigned QA; tag khớp package.version',
  },
  {
    id: 'publisher',
    title: 'Kiểm tra Authenticode/SmartScreen publisher',
    expect: 'Publisher và SHA-1 thumbprint khớp release config',
  },
  {
    id: 'customer-config',
    title: 'Kiểm tra customer config chỉ chứa URL/cấu hình public',
    expect: 'Không có private key, admin key, webhook secret hoặc service-role',
  },
  {
    id: 'free-ui',
    title: 'Badge FREE và thông báo chặn tính năng Pro',
    expect: 'Viết/TTS cơ bản chạy; video/CapCut/ship báo quyền rõ ràng',
  },
  {
    id: 'trial-ui',
    title: 'Kích hoạt Trial từ license API',
    expect: 'Badge TRIAL, thời hạn đúng, không hiển thị như Pro trả phí',
  },
  {
    id: 'pro-ui',
    title: 'Kích hoạt một license Pro QA gắn HWID rồi thu hồi sau kiểm tra',
    expect: 'Badge PRO; sai HWID/token sửa đổi bị từ chối',
    cmd: 'npm run license:issue -- --token --hwid <QA_HWID> --plan pro --expDays 1',
  },
  {
    id: 'credentials',
    title: 'Nhập API key/cookie, restart và export project',
    expect: 'Credential còn hoạt động nhưng không lộ trong localStorage/export/backup plaintext',
  },
  {
    id: 'integrations',
    title: 'Chạy Flow, CapCut và TTS bằng tài khoản/binary production thật',
    expect: 'Không fallback ngầm; lỗi bên thứ ba có hướng xử lý rõ',
    cmd: 'npm run smoke:capcut-live',
  },
  {
    id: 'support-legal',
    title: 'Mở support, điều khoản, riêng tư và third-party notice',
    expect: 'Link/nội dung đúng bản phát hành',
  },
  {
    id: 'approve',
    title: 'Reviewer phê duyệt GitHub environment production',
    expect: 'Sau phê duyệt, workflow vẫn phải pass updater QA tự động trước bước publish',
  },
];

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ steps, count: steps.length }, null, 2));
} else {
  console.log('===================================================');
  console.log(' WHITE-MACHINE CHECKLIST — AI Novel commercial');
  console.log('===================================================\n');
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    console.log(`[ ] ${i + 1}. ${step.title}`);
    console.log(`     → ${step.expect}`);
    if (step.cmd) console.log(`     $ ${step.cmd}`);
    console.log('');
  }
  console.log('Tick all → approve environment production. Chi tiết: docs/SHIP_GUIDE.md');
}
