/**
 * Khôi phục main-process về mã nguồn .js gốc (cho dev/sửa code).
 *   node scripts/unprotect.js
 * Lấy lại *.plain.js → *.js, xoá *.jsc và *.plain.js.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const TARGETS = ['main.js', 'flow-native.js', 'flow-bridge.js', 'flow-cft.js', 'native-tools.js', 'cli-bridge-native.js', 'voice-native.js'];
let n = 0;
for (const f of TARGETS) {
  const js = path.join(root, f);
  const plain = js.replace(/\.js$/, '.plain.js');
  const jsc = js.replace(/\.js$/, '.jsc');
  if (fs.existsSync(plain)) { fs.copyFileSync(plain, js); fs.unlinkSync(plain); n++; }
  if (fs.existsSync(jsc)) fs.unlinkSync(jsc);
}
console.log('DONE unprotect:', n, 'file khôi phục về mã gốc.');
