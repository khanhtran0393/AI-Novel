import { NextResponse } from 'next/server';
import type { ImageProviderCtx } from '../imageTypes';

/** Owner: image provider openai only — no other providers. */
export async function generateWithOpenAI(
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

    if (providerKeysToTry.length === 0) {
      return NextResponse.json({ error: '[OpenAI Error] Vui lòng cấu hình OpenAI API Key để sinh ảnh.' }, { status: 400 });
    }
    
    let dallESize = "1024x1024";
    if (imageAspectRatio === '16:9' || imageAspectRatio === '3:2') dallESize = "1792x1024";
    else if (imageAspectRatio === '9:16' || imageAspectRatio === '2:3' || imageAspectRatio === '4:5') dallESize = "1024x1792";
    
    let lastError = '';
    for (const currentKey of providerKeysToTry) {
      try {
        // Prefer identity-preserving edit when concept sheet binary is present
        if (referenceImageB64) {
          try {
            const form = new FormData();
            const bytes = Buffer.from(referenceImageB64, 'base64');
            const blob = new Blob([new Uint8Array(bytes)], { type: referenceMime });
            form.append('image', blob, 'face_ref.png');
            form.append('prompt', providerPrompt.slice(0, 1000));
            form.append('n', '1');
            form.append('size', '1024x1024');
            form.append('model', 'dall-e-2');
            const editRes = await fetch('https://api.openai.com/v1/images/edits', {
              method: 'POST',
              headers: { Authorization: `Bearer ${currentKey}` },
              body: form,
            });
            if (editRes.ok) {
              const data = await editRes.json();
              const b64 = data.data?.[0]?.b64_json;
              const imageUrl = data.data?.[0]?.url;
              if (b64) {
                return saveImage(Buffer.from(b64, 'base64'), 'OpenAI DALL-E 2 edit (face-ref)', currentKey);
              }
              if (imageUrl) {
                const imageRes = await fetch(imageUrl);
                const buffer = Buffer.from(await imageRes.arrayBuffer());
                return saveImage(buffer, 'OpenAI DALL-E 2 edit (face-ref)', currentKey);
              }
            } else {
              const t = await editRes.text();
              // IRON B10: face-ref bắt buộc edit — không fallback generations (mất identity)
              lastError = t.slice(0, 300);
              throw new Error(
                `OpenAI face-ref edit fail HTTP ${editRes.status}: ${lastError.slice(0, 160)}. Không fallback DALL-E 3 generations (mất face-lock).`,
              );
            }
          } catch (editErr: unknown) {
            if (editErr instanceof Error && /face-ref|Không fallback/i.test(editErr.message)) {
              throw editErr;
            }
            throw new Error(
              `OpenAI face-ref edit exception: ${editErr instanceof Error ? editErr.message : String(editErr)}. Không fallback generations.`,
            );
          }
        }
  
        const res = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentKey}`
          },
          body: JSON.stringify({
            model: "dall-e-3",
            prompt: providerPrompt,
            n: 1,
            size: dallESize
          })
        });
        if (res.ok) {
          const data = await res.json();
          const imageUrl = data.data[0].url;
          const imageRes = await fetch(imageUrl);
          const buffer = Buffer.from(await imageRes.arrayBuffer());
          return saveImage(buffer, 'OpenAI DALL-E 3', currentKey);
        } else {
          lastError = await res.text();
          try { lastError = JSON.parse(lastError).error?.message || lastError; } catch {}
        }
      } catch (err: any) {
        lastError = err.message;
      }
    }
    return NextResponse.json({ error: `[OpenAI DALL-E 3 Error] ${lastError}` }, { status: 500 });
}
