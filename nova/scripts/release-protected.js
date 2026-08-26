/**
 * Build + publish bản ĐÃ BẢO VỆ (javascript-obfuscator) rồi tự khôi phục mã nguồn.
 *   export GH_TOKEN=ghp_...
 *   node scripts/release-protected.js --win --mac          (build + publish)
 *   node scripts/release-protected.js --win --x64 --dir    (build thử, không publish — thêm --no-publish)
 *
 * Truyền cờ electron-builder sau tên script. Mặc định có --publish always;
 * thêm --no-publish để chỉ build thử (không đẩy lên GitHub).
 */
'use strict';
const { execSync } = require('child_process');
const path = require('path');
const root = path.join(__dirname, '..');

const argv = process.argv.slice(2);
const noPublish = argv.includes('--no-publish');
const ebArgs = argv.filter(a => a !== '--no-publish');
if (!ebArgs.some(a => a.startsWith('--win') || a.startsWith('--mac') || a.startsWith('--linux'))) ebArgs.push('--win', '--x64');
const publishFlag = noPublish ? '' : '--publish always';

function run(cmd, extraEnv) {
  console.log('\n$ ' + cmd);
  execSync(cmd, { cwd: root, stdio: 'inherit', env: { ...process.env, ...extraEnv } });
}

let protected_ = false;
try {
  console.log('▶ [1/3] Bảo vệ main-process (bytenode)…');
  run('npm run protect');
  protected_ = true;
  console.log('▶ [2/3] Build + đóng gói…');
  run(`npx electron-builder ${ebArgs.join(' ')} ${publishFlag}`, { CSC_IDENTITY_AUTO_DISCOVERY: 'false' });
  console.log('\n✅ XONG build bản đã bảo vệ.');
} catch (e) {
  console.error('\n❌ Lỗi build:', e.message);
  process.exitCode = 1;
} finally {
  if (protected_) {
    console.log('▶ [3/3] Khôi phục mã nguồn (cho dev)…');
    try { run('npm run unprotect'); } catch (e2) { console.error('⚠️ Khôi phục lỗi — chạy tay: npm run unprotect'); }
  }
}
