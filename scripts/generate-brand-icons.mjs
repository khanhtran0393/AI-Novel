/**
 * Generate build/icon.png + build/icon.ico (+ electron copies) from brand logo.
 * Source: build/icon-source-logo.jpg (Ai Novel mark).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'build', 'icon-source-logo.jpg');
const sizes = [16, 24, 32, 48, 64, 128, 256];

if (!fs.existsSync(src)) {
  console.error('Missing', src);
  process.exit(1);
}

const pngPath = path.join(root, 'build', 'icon.png');
await sharp(src).resize(512, 512, { fit: 'cover' }).png().toFile(pngPath);

const bufs = [];
for (const s of sizes) {
  bufs.push(await sharp(src).resize(s, s, { fit: 'cover' }).png().toBuffer());
}

let pngToIco;
try {
  pngToIco = (await import('png-to-ico')).default;
} catch {
  console.error('Install png-to-ico: npm install png-to-ico --save-dev');
  process.exit(1);
}

const icoPath = path.join(root, 'build', 'icon.ico');
fs.writeFileSync(icoPath, await pngToIco(bufs));

const electronDir = path.join(root, 'electron');
fs.copyFileSync(pngPath, path.join(electronDir, 'icon.png'));
fs.copyFileSync(icoPath, path.join(electronDir, 'icon.ico'));
fs.copyFileSync(src, path.join(electronDir, 'splash-logo.jpg'));
fs.copyFileSync(src, path.join(root, 'build', 'app-logo.jpg'));

console.log(
  JSON.stringify(
    {
      ok: true,
      source: src,
      png: pngPath,
      ico: icoPath,
      splash: path.join(electronDir, 'splash-logo.jpg'),
      appName: 'Ai Novel',
    },
    null,
    2,
  ),
);
