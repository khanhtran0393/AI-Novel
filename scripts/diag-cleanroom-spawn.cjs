// Diagnostic: spawn packaged exe in clean-room env, capture stdout/stderr to files.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const exe = 'd:/AI Novel/dist-qa-unsigned/win-unpacked/Ai Novel.exe';
const base = 'C:/Users/Khanh/AppData/Local/Temp/ainovel-clean-room';
const logDir = 'd:/AI Novel/.diag-logs';
fs.mkdirSync(logDir, { recursive: true });
const outFile = path.join(logDir, 'spawn-out.txt');
const errFile = path.join(logDir, 'spawn-err.txt');
fs.writeFileSync(outFile, '');
fs.writeFileSync(errFile, '');

const env = {
  ...process.env,
  PATH: 'C:\\Windows;C:\\Windows\\System32;C:\\Windows\\System32\\Wbem;C:\\Windows\\System32\\WindowsPowerShell\\v1.0;C:\\Program Files\\node-v24.15.0-win-x64;d:\\AI Novel\\bin',
  APPDATA: base,
  LOCALAPPDATA: base,
  USERPROFILE: base,
  TEMP: base + '/Temp',
  TMP: base + '/Temp',
  AI_NOVEL_PORT: '3000',
  AINOVEL_ENTITLEMENT_MODE: 'open',
  NODE_ENV: 'production',
  ELECTRON_ENABLE_LOGGING: '1',
  ELECTRON_ENABLE_STACK_DUMPING: '1',
  AINOVEL_SPLASH_MS: '0',
};

const child = spawn(exe, [], { env, cwd: path.dirname(exe), stdio: ['ignore', 'pipe', 'pipe'] });

const append = (f, d) => fs.appendFileSync(f, d);

child.stdout.on('data', (d) => append(outFile, d));
child.stderr.on('data', (d) => append(errFile, d));

const timeout = setTimeout(() => {
  console.log('TIMEOUT 45s — still running, pid=' + child.pid);
  fs.writeFileSync(path.join(logDir, 'still-running.txt'), 'pid=' + child.pid + '\n');
  // don't kill; app may be booting fine
}, 45000);

child.on('error', (e) => {
  console.log('SPAWN ERROR: ' + e.message);
  fs.writeFileSync(path.join(logDir, 'spawn-error.txt'), e.message);
});

child.on('exit', (code, signal) => {
  clearTimeout(timeout);
  console.log('EXIT code=' + code + ' signal=' + signal);
  fs.writeFileSync(path.join(logDir, 'exit.txt'), 'code=' + code + ' signal=' + signal + '\n');
});

// After 45s, print status
setTimeout(() => {
  const alive = child.exitCode === null && !child.killed;
  console.log('ALIVE at +45s: ' + alive + ' pid=' + child.pid);
  console.log('OUT bytes: ' + fs.statSync(outFile).size);
  console.log('ERR bytes: ' + fs.statSync(errFile).size);
  process.exit(0);
}, 50000);
