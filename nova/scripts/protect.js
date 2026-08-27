/**
 * Bảo vệ main process bằng OBFUSCATE (javascript-obfuscator).
 * Khác bytenode: ra JS thường → CHẠY ĐƯỢC MỌI OS/CPU (build từ Mac cho Windows OK).
 *   node scripts/protect.js
 * Backup bản gốc vào *.plain.js. Sau build chạy scripts/unprotect.js để khôi phục.
 */
'use strict';
const JO = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
// Main-process files cần giấu (KHÔNG gồm preload.js — để thô cho an toàn ngữ cảnh contextBridge)
const TARGETS = ['main.js', 'flow-native.js', 'flow-bridge.js', 'flow-cft.js', 'native-tools.js', 'cli-bridge-native.js', 'voice-native.js'];

// Cấu hình "vừa đủ" — rối tên biến + mã hoá chuỗi, TẮT các thứ dễ vỡ (controlFlow/selfDefending)
const OPTS = {
  compact: true,
  target: 'node',
  renameGlobals: false,               // GIỮ require/module/__dirname… không đổi tên
  identifierNamesGenerator: 'hexadecimal',
  stringArray: true,
  stringArrayThreshold: 0.8,
  stringArrayEncoding: ['base64'],
  splitStrings: false,
  controlFlowFlattening: false,        // tắt: giảm rủi ro vỡ + không làm chậm
  deadCodeInjection: false,
  numbersToExpressions: false,
  selfDefending: false,                // tắt: selfDefending hay vỡ trong Electron
  disableConsoleOutput: false,
  unicodeEscapeSequence: false,
};

let n = 0;
for (const f of TARGETS) {
  const js = path.join(root, f);
  if (!fs.existsSync(js)) { console.log('  skip (không có):', f); continue; }
  const plain = js.replace(/\.js$/, '.plain.js');
  const cur = fs.readFileSync(js, 'utf8');
  if (/_0x[0-9a-f]{4,}/.test(cur) && fs.existsSync(plain)) { console.log('  (đã obfuscate) bỏ qua:', f); n++; continue; }
  if (!fs.existsSync(plain)) fs.copyFileSync(js, plain);   // backup gốc 1 lần
  const src = fs.readFileSync(plain, 'utf8');
  const out = JO.obfuscate(src, OPTS).getObfuscatedCode();
  fs.writeFileSync(js, out);
  console.log('  ✓ obfuscated:', f, '(' + src.length + ' → ' + out.length + ' bytes)');
  n++;
}
console.log('DONE obfuscate:', n, 'file. NHỚ build ngay, xong chạy: node scripts/unprotect.js');
