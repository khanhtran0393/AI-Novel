import { NextResponse } from 'next/server';
import type { ImageProviderCtx } from '../imageTypes';

/** Owner: image provider grok only — no other providers. */
export async function generateWithGrok(
  ctx: ImageProviderCtx,
): Promise<NextResponse> {
  const {
    body,
    providerPrompt,
    providerKeysToTry,
    keysToTry,
    imageAspectRatio,
    imageCount,
    referenceImageB64,
    referenceMime,
    saveImage,
    saveImageBuffers,
    model,
    cookie,
    prompt,
    characterPrompt,
    chapterNum,
    sceneIndex,
    promptIndex,
    drivePath,
    ten_tac_pham,
    filename,
    localSavePath,
    publicImageDir,
  } = ctx;

    const grokKeys: string[] = [];
    const bodyGrokKey = typeof body.grokApiKey === 'string' ? body.grokApiKey : '';
    if (bodyGrokKey) grokKeys.push(bodyGrokKey);
    if (Array.isArray(body.grokApiKeys)) {
      body.grokApiKeys.forEach((k: unknown) => {
        if (typeof k === 'string' && k && !grokKeys.includes(k)) grokKeys.push(k);
      });
    }
    providerKeysToTry.forEach(k => { if (k && !grokKeys.includes(k)) grokKeys.push(k); });
    keysToTry.forEach(k => { if (k && !grokKeys.includes(k)) grokKeys.push(k); });
  
    if (grokKeys.length === 0) {
      return NextResponse.json({ error: '[xAI Grok Error] Vui lòng cấu hình xAI Grok API Key để sinh ảnh.' }, { status: 400 });
    }
  
    let lastError = '';
    for (const currentKey of grokKeys) {
      try {
        const res = await fetch('https://api.x.ai/v1/images/generations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentKey}`
          },
          body: JSON.stringify({
            model: "grok-imagine-image-quality",
            prompt: providerPrompt,
            n: imageCount
          })
        });
        if (res.ok) {
          const data = await res.json();
          const imageUrls = (data.data || []).map((image: { url?: string }) => image.url).filter(Boolean).slice(0, imageCount);
          const buffers = await Promise.all(imageUrls.map(async (imageUrl: string) => {
            const imageRes = await fetch(imageUrl);
            return Buffer.from(await imageRes.arrayBuffer());
          }));
          return saveImageBuffers(buffers, 'xAI Grok-2', currentKey);
        } else {
          lastError = await res.text();
          try { lastError = JSON.parse(lastError).error || lastError; } catch {}
        }
      } catch (err: any) {
        lastError = err.message;
      }
    }
    return NextResponse.json({ error: `[xAI Grok-2 Error] ${lastError}` }, { status: 500 });
}
