import type { ImageProviderCtx } from '../imageTypes';

function hashText(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapWords(input: string, maxChars: number, maxLines: number): string[] {
  const words = input.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.length ? lines : ['AI Novel storyboard frame'];
}

function dimensionsFromRatio(ratio: string): { width: number; height: number } {
  const normalized = ratio.trim();
  if (normalized === '9:16') return { width: 720, height: 1280 };
  if (normalized === '1:1') return { width: 1024, height: 1024 };
  if (normalized === '4:5') return { width: 1024, height: 1280 };
  if (normalized === '3:4') return { width: 960, height: 1280 };
  if (normalized === '2:3') return { width: 853, height: 1280 };
  if (normalized === '3:2') return { width: 1280, height: 853 };
  if (normalized === '4:3') return { width: 1280, height: 960 };
  return { width: 1280, height: 720 };
}

function palette(seed: number): {
  a: string;
  b: string;
  c: string;
  accent: string;
} {
  const hue = seed % 360;
  const hue2 = (hue + 82) % 360;
  const hue3 = (hue + 176) % 360;
  return {
    a: `hsl(${hue} 42% 13%)`,
    b: `hsl(${hue2} 52% 22%)`,
    c: `hsl(${hue3} 40% 18%)`,
    accent: `hsl(${(hue + 32) % 360} 88% 67%)`,
  };
}

function buildSvg(ctx: ImageProviderCtx, variantIndex: number): string {
  const seed = hashText(`${ctx.prompt}|${ctx.sceneIndex}|${ctx.promptIndex}|${variantIndex}`);
  const colors = palette(seed);
  const { width, height } = dimensionsFromRatio(ctx.imageAspectRatio || '16:9');
  const title = `Chapter ${ctx.chapterNum} - Scene ${ctx.sceneIndex + 1}.${ctx.promptIndex + 1}`;
  const promptLines = wrapWords(
    ctx.providerPrompt || ctx.prompt,
    width > height ? 62 : 38,
    width > height ? 7 : 10,
  );
  const sentenceLines = wrapWords(ctx.characterPrompt || ctx.prompt, width > height ? 70 : 42, 3);
  const safePrompt = promptLines.map(escapeXml);
  const safeSentence = sentenceLines.map(escapeXml);
  const bigRadius = Math.round(Math.min(width, height) * 0.34);
  const smallRadius = Math.round(Math.min(width, height) * 0.18);
  const horizonY = Math.round(height * 0.68);
  const textX = Math.round(width * 0.08);
  const textY = Math.round(height * 0.16);
  const fontScale = Math.max(0.78, Math.min(1.2, width / 1280));
  const promptFont = Math.round(31 * fontScale);
  const metaFont = Math.round(18 * fontScale);
  const lineGap = Math.round(promptFont * 1.35);
  const sentenceY = textY + lineGap * (promptLines.length + 1);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="${colors.a}"/>
      <stop offset="52%" stop-color="${colors.b}"/>
      <stop offset="100%" stop-color="${colors.c}"/>
    </linearGradient>
    <radialGradient id="flare" cx="78%" cy="21%" r="62%">
      <stop offset="0%" stop-color="${colors.accent}" stop-opacity="0.48"/>
      <stop offset="100%" stop-color="#020617" stop-opacity="0"/>
    </radialGradient>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#020617" flood-opacity="0.48"/>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <rect width="${width}" height="${height}" fill="url(#flare)"/>
  <path d="M0 ${horizonY} C ${Math.round(width * 0.2)} ${horizonY - 70}, ${Math.round(width * 0.42)} ${horizonY + 50}, ${Math.round(width * 0.62)} ${horizonY - 20} S ${Math.round(width * 0.86)} ${horizonY + 25}, ${width} ${horizonY - 40} L ${width} ${height} L 0 ${height} Z" fill="#020617" opacity="0.58"/>
  <circle cx="${Math.round(width * 0.78)}" cy="${Math.round(height * 0.28)}" r="${bigRadius}" fill="${colors.accent}" opacity="0.16"/>
  <circle cx="${Math.round(width * 0.28)}" cy="${Math.round(height * 0.82)}" r="${smallRadius}" fill="#ffffff" opacity="0.08"/>
  <g filter="url(#softShadow)">
    <rect x="${Math.round(width * 0.055)}" y="${Math.round(height * 0.085)}" width="${Math.round(width * 0.64)}" height="${Math.round(height * 0.68)}" rx="18" fill="#020617" opacity="0.34"/>
  </g>
  <text x="${textX}" y="${textY}" fill="${colors.accent}" font-family="Arial, Helvetica, sans-serif" font-size="${metaFont}" font-weight="700" letter-spacing="1.4">${escapeXml(title)}</text>
  ${safePrompt
    .map((line, index) => `<text x="${textX}" y="${textY + lineGap * (index + 1)}" fill="#f8fafc" font-family="Arial, Helvetica, sans-serif" font-size="${promptFont}" font-weight="800">${line}</text>`)
    .join('\n  ')}
  ${safeSentence
    .map((line, index) => `<text x="${textX}" y="${sentenceY + Math.round(metaFont * 1.35) * index}" fill="#cbd5e1" font-family="Arial, Helvetica, sans-serif" font-size="${metaFont}" font-weight="500">${line}</text>`)
    .join('\n  ')}
  <text x="${Math.round(width * 0.08)}" y="${Math.round(height * 0.91)}" fill="#e2e8f0" opacity="0.62" font-family="Arial, Helvetica, sans-serif" font-size="${metaFont}" font-weight="700">Local Storyboard Render ${variantIndex + 1}</text>
</svg>`;
}

export async function generateWithLocalStoryboard(ctx: ImageProviderCtx): Promise<Response> {
  const sharp = (await import('sharp')).default;
  const count = Math.max(1, Math.min(4, Number(ctx.imageCount) || 1));
  const buffers: Buffer[] = [];
  for (let index = 0; index < count; index += 1) {
    const svg = buildSvg(ctx, index);
    const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
    buffers.push(png);
  }
  return ctx.saveImageBuffers(buffers, 'Local Storyboard Renderer', 'local');
}
