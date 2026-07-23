/**
 * Generate build/icon.png + build/icon.ico (+ electron copies) from brand logo.
 * Source: build/icon-source-logo.jpg (Ai Novel mark — gold orb on black).
 *
 * Windows taskbar / desktop / .exe need real alpha with no black square or dark halo.
 * Pipeline:
 *  1) Flood-fill near-black from edges → alpha 0
 *  2) Tight circular soft-mask around the gold orb (kills residual black glow)
 *  3) Zero RGB on fully transparent pixels (premultiplied-safe)
 *  4) ICO with PNG-compressed frames (Vista+ alpha — more reliable than BMP XOR)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'build', 'icon-source-logo.jpg');
/** Standard Windows icon sizes (include 256 for Explorer). */
const sizes = [16, 24, 32, 48, 64, 128, 256];

/** Near-black hard threshold (per channel) for background flood-fill. */
const BG_HARD = 28;
/** Soft ramp for neutral dark halo after flood-fill. */
const BG_SOFT = 55;

if (!fs.existsSync(src)) {
  console.error('Missing', src);
  process.exit(1);
}

function isWarmGold(r, g, b) {
  // Gold / amber orb + white plane glyph
  if (r >= 200 && g >= 200 && b >= 200) return true; // white mark
  if (r >= 40 && r >= g && g >= b - 4 && r - b >= 8) return true;
  if (r >= 80 && g >= 40 && b <= g && r + g > 140) return true; // mid gold
  return false;
}

/**
 * @param {Buffer} rgba
 * @param {number} w
 * @param {number} h
 */
function punchBlackBackground(rgba, w, h) {
  const n = w * h;
  const isNearBlack = (p) => {
    const o = p * 4;
    return rgba[o] <= BG_HARD && rgba[o + 1] <= BG_HARD && rgba[o + 2] <= BG_HARD;
  };

  const visited = new Uint8Array(n);
  const stack = [];
  const push = (p) => {
    if (p < 0 || p >= n || visited[p]) return;
    visited[p] = 1;
    stack.push(p);
  };

  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + (w - 1));
  }

  while (stack.length) {
    const p = stack.pop();
    if (!isNearBlack(p)) continue;
    const o = p * 4;
    rgba[o] = 0;
    rgba[o + 1] = 0;
    rgba[o + 2] = 0;
    rgba[o + 3] = 0;
    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }

  // Soft neutral-dark halo next to punched bg
  for (let p = 0; p < n; p++) {
    const o = p * 4;
    if (rgba[o + 3] === 0) continue;
    const r = rgba[o];
    const g = rgba[o + 1];
    const b = rgba[o + 2];
    if (isWarmGold(r, g, b)) continue;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const chroma = mx - mn;
    const avg = (r + g + b) / 3;
    if (mx >= BG_SOFT || chroma >= 22 || avg >= BG_SOFT) continue;

    const x = p % w;
    const y = (p / w) | 0;
    let nextToClear = false;
    if (x > 0 && rgba[(p - 1) * 4 + 3] === 0) nextToClear = true;
    if (!nextToClear && x < w - 1 && rgba[(p + 1) * 4 + 3] === 0) nextToClear = true;
    if (!nextToClear && y > 0 && rgba[(p - w) * 4 + 3] === 0) nextToClear = true;
    if (!nextToClear && y < h - 1 && rgba[(p + w) * 4 + 3] === 0) nextToClear = true;
    if (!nextToClear && mx > BG_HARD + 6) continue;

    const t = Math.max(0, Math.min(1, (mx - BG_HARD) / (BG_SOFT - BG_HARD)));
    const a = Math.round(255 * t * t);
    if (a < 8) {
      rgba[o] = 0;
      rgba[o + 1] = 0;
      rgba[o + 2] = 0;
      rgba[o + 3] = 0;
    } else {
      rgba[o + 3] = Math.min(rgba[o + 3], a);
    }
  }
}

/**
 * Tight circular mask on the gold orb — removes leftover black square / outer glow.
 * @param {Buffer} rgba
 * @param {number} w
 * @param {number} h
 */
function applyCircularSoftMask(rgba, w, h) {
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const radii = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (rgba[o + 3] < 40) continue;
      const r = rgba[o];
      const g = rgba[o + 1];
      const b = rgba[o + 2];
      // Solid logo body only (skip faint glow)
      if (Math.max(r, g, b) < 48 && !isWarmGold(r, g, b)) continue;
      if (!isWarmGold(r, g, b) && Math.max(r, g, b) < 90) continue;
      radii.push(Math.hypot(x - cx, y - cy));
    }
  }

  if (!radii.length) return { radius: 0 };

  radii.sort((a, b) => a - b);
  // 99.2nd percentile — tight to orb, ignore outliers
  const idx = Math.min(radii.length - 1, Math.floor(radii.length * 0.992));
  const contentR = radii[idx];
  // Slight inset so dark outer rim of the 3D button softens cleanly
  const hardR = contentR * 0.995;
  const softR = contentR * 1.012 + 1.25;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (rgba[o + 3] === 0) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d >= softR) {
        rgba[o] = 0;
        rgba[o + 1] = 0;
        rgba[o + 2] = 0;
        rgba[o + 3] = 0;
      } else if (d > hardR) {
        const t = 1 - (d - hardR) / (softR - hardR);
        const a = Math.round(rgba[o + 3] * t * t);
        if (a < 10) {
          rgba[o] = 0;
          rgba[o + 1] = 0;
          rgba[o + 2] = 0;
          rgba[o + 3] = 0;
        } else {
          rgba[o + 3] = a;
        }
      }
    }
  }

  // Final pass: any remaining dark non-gold near edge → kill (taskbar fringe)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (rgba[o + 3] === 0) continue;
      const r = rgba[o];
      const g = rgba[o + 1];
      const b = rgba[o + 2];
      const d = Math.hypot(x - cx, y - cy);
      if (d < hardR * 0.88) continue;
      if (isWarmGold(r, g, b)) continue;
      if (Math.max(r, g, b) <= 70) {
        rgba[o] = 0;
        rgba[o + 1] = 0;
        rgba[o + 2] = 0;
        rgba[o + 3] = 0;
      }
    }
  }

  return { radius: contentR, hardR, softR };
}

/**
 * Build PNG-compressed multi-size .ico (alpha-safe on modern Windows).
 * @param {Buffer[]} pngBuffers full PNG files
 * @param {number[]} dims width(=height) per buffer
 */
function pngsToIco(pngBuffers, dims) {
  const count = pngBuffers.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // ICO
  header.writeUInt16LE(count, 4);

  let offset = 6 + 16 * count;
  const dirs = [];
  for (let i = 0; i < count; i++) {
    const dir = Buffer.alloc(16);
    const d = dims[i];
    dir.writeUInt8(d >= 256 ? 0 : d, 0);
    dir.writeUInt8(d >= 256 ? 0 : d, 1);
    dir.writeUInt8(0, 2);
    dir.writeUInt8(0, 3);
    dir.writeUInt16LE(1, 4);
    dir.writeUInt16LE(32, 6);
    dir.writeUInt32LE(pngBuffers[i].length, 8);
    dir.writeUInt32LE(offset, 12);
    offset += pngBuffers[i].length;
    dirs.push(dir);
  }
  return Buffer.concat([header, ...dirs, ...pngBuffers]);
}

/**
 * @param {string} inputPath
 * @param {number} size
 */
async function makeTransparentPngBuffer(inputPath, size) {
  const { data, info } = await sharp(inputPath)
    .resize(size, size, { fit: 'cover', position: 'centre' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  punchBlackBackground(data, info.width, info.height);
  applyCircularSoftMask(data, info.width, info.height);

  // Premultiply-ish safety: force RGB 0 when fully transparent
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 8) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 0;
    }
  }

  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png({ compressionLevel: 9, force: true })
    .toBuffer();
}

const masterSize = 512;
const masterPng = await makeTransparentPngBuffer(src, masterSize);
const pngPath = path.join(root, 'build', 'icon.png');
fs.writeFileSync(pngPath, masterPng);

const bufs = [];
const dims = [];
for (const s of sizes) {
  const buf = await makeTransparentPngBuffer(src, s);
  bufs.push(buf);
  dims.push(s);
  fs.writeFileSync(path.join(root, 'build', `icon-${s}.png`), buf);
}

const icoPath = path.join(root, 'build', 'icon.ico');
fs.writeFileSync(icoPath, pngsToIco(bufs, dims));

const electronDir = path.join(root, 'electron');
fs.mkdirSync(electronDir, { recursive: true });
fs.copyFileSync(pngPath, path.join(electronDir, 'icon.png'));
fs.copyFileSync(icoPath, path.join(electronDir, 'icon.ico'));
// Transparent splash only (do NOT leave black JPG as primary splash art)
fs.writeFileSync(path.join(electronDir, 'splash-logo.png'), masterPng);
// Keep jpg copy of source for audit/docs, but not as transparent splash
fs.copyFileSync(src, path.join(electronDir, 'splash-logo.jpg'));
fs.copyFileSync(src, path.join(root, 'build', 'app-logo.jpg'));

// Favicon — small PNG-in-ICO
const favSizes = [16, 24, 32, 48];
const favBufs = [];
const favDims = [];
for (const s of favSizes) {
  const i = sizes.indexOf(s);
  favBufs.push(i >= 0 ? bufs[i] : await makeTransparentPngBuffer(src, s));
  favDims.push(s);
}
fs.writeFileSync(path.join(root, 'public', 'favicon.ico'), pngsToIco(favBufs, favDims));

const publicBrand = path.join(root, 'public', 'brand');
fs.mkdirSync(publicBrand, { recursive: true });
const logo256 = await makeTransparentPngBuffer(src, 256);
fs.writeFileSync(path.join(publicBrand, 'logo-256.png'), logo256);
fs.writeFileSync(path.join(publicBrand, 'logo.png'), masterPng);
// Also replace root logo.png (often used by tools) with transparent master
fs.writeFileSync(path.join(root, 'logo.png'), masterPng);

// Stats
const meta = await sharp(pngPath).metadata();
const { data: check, info: cinfo } = await sharp(pngPath).ensureAlpha().raw().toBuffer({
  resolveWithObject: true,
});
let transparent = 0;
let blackishOpaque = 0;
const total = cinfo.width * cinfo.height;
const cx = (cinfo.width - 1) / 2;
const cy = (cinfo.height - 1) / 2;
let maxOpaqueR = 0;
for (let y = 0; y < cinfo.height; y++) {
  for (let x = 0; x < cinfo.width; x++) {
    const i = (y * cinfo.width + x) * 4;
    const a = check[i + 3];
    if (a < 16) {
      transparent++;
      continue;
    }
    maxOpaqueR = Math.max(maxOpaqueR, Math.hypot(x - cx, y - cy));
    if (check[i] <= 40 && check[i + 1] <= 40 && check[i + 2] <= 40) blackishOpaque++;
  }
}

// ICO must embed PNG signatures
const icoBuf = fs.readFileSync(icoPath);
let pngChunks = 0;
for (let i = 0; i < icoBuf.length - 4; i++) {
  if (icoBuf[i] === 0x89 && icoBuf[i + 1] === 0x50 && icoBuf[i + 2] === 0x4e && icoBuf[i + 3] === 0x47) {
    pngChunks++;
  }
}

// Dev taskbar: embed brand ICO into node_modules electron.exe (Windows only).
// Packaged builds still rely on afterPack rcedit → AI Novel.exe.
let devIconPatch = { skipped: true, reason: 'not-attempted' };
try {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { patchElectronDevIcon } = require('./lib/patch-electron-dev-icon.cjs');
  devIconPatch = patchElectronDevIcon(root);
} catch (e) {
  devIconPatch = { ok: false, reason: 'import-or-patch-error', detail: String(e?.message || e) };
}

const report = {
  ok: true,
  source: src,
  png: pngPath,
  ico: icoPath,
  splashPng: path.join(electronDir, 'splash-logo.png'),
  appName: 'Ai Novel',
  hasAlpha: Boolean(meta.hasAlpha),
  transparentPct: Number(((transparent / total) * 100).toFixed(1)),
  blackishOpaque,
  maxOpaqueRadius: Number(maxOpaqueR.toFixed(1)),
  icoPngFrames: pngChunks,
  devIconPatch,
  note: 'circular mask + PNG-in-ICO; patch electron.exe for dev taskbar on Windows',
};

console.log(JSON.stringify(report, null, 2));

if (!meta.hasAlpha || transparent / total < 0.25) {
  console.error('FAIL: expected strong transparent alpha on icon.png');
  process.exit(1);
}
if (blackishOpaque > total * 0.01) {
  console.error('FAIL: too many opaque near-black pixels left', blackishOpaque);
  process.exit(1);
}
if (pngChunks < sizes.length) {
  console.error('FAIL: ICO must embed PNG frames for reliable alpha', pngChunks);
  process.exit(1);
}
