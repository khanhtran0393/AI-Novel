const path = require('path');
const { bundle } = require('@remotion/bundler');
(async () => {
  const out = await bundle({
    entryPoint: path.join(__dirname, 'src', 'index.js'),
    outDir: path.join(__dirname, 'bundle'),
    onProgress: (p) => { if (p % 25 === 0) console.log('  bundling ' + p + '%'); },
    webpackOverride: (c) => c,
  });
  console.log('BUNDLE OK →', out);
})().catch(e => { console.error('BUNDLE FAIL:', e && e.message); process.exit(1); });
