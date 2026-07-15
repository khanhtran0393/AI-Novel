import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { driveMediaFilename, localImageFilename } from '@/contracts';
import type {
  ImageSaveContext,
  SaveImageFn,
  SaveImageBuffersFn,
} from './imageTypes';

/** Owner: persist generated stills (local public/ + optional drive). */
export function createImageSavers(ctx: ImageSaveContext): {
  saveImage: SaveImageFn;
  saveImageBuffers: SaveImageBuffersFn;
} {
  const {
    chapterNum,
    sceneIndex,
    promptIndex,
    drivePath,
    ten_tac_pham,
    filename,
    localSavePath,
    publicImageDir,
    imageCount,
  } = ctx;

  const getVariantFilename = (variantIndex: number) => {
    if (variantIndex === 0) return filename || localImageFilename(chapterNum, sceneIndex, promptIndex);
    return localImageFilename(chapterNum, sceneIndex, promptIndex, variantIndex);
  };

  const saveImageBuffers: SaveImageBuffersFn = (imageBuffers, method, usedApiKey) => {
    const buffers = imageBuffers.filter(Boolean).slice(0, imageCount);
    if (buffers.length === 0) {
      return NextResponse.json(
        { error: `[Image API] ${method} không trả về ảnh hợp lệ.` },
        { status: 500 },
      );
    }

    const imagePaths: string[] = [];
    const driveFilePaths: string[] = [];
    let driveSaved = false;

    buffers.forEach((imageBuffer, variantIndex) => {
      const variantFilename = getVariantFilename(variantIndex);
      const variantLocalSavePath = path.join(publicImageDir, variantFilename);
      fs.writeFileSync(variantLocalSavePath, imageBuffer);
      imagePaths.push(`/api/serve-image?file=${encodeURIComponent(variantFilename)}`);
      console.log(
        `[Image API] Saved ${method} image ${variantIndex + 1}/${buffers.length}: ${variantLocalSavePath}`,
      );

      if (drivePath && drivePath.trim().length > 0) {
        try {
          const cleanedDrivePath = drivePath.trim();
          let driveFolder = cleanedDrivePath;
          if (chapterNum > 0) {
            driveFolder = path.join(cleanedDrivePath, `Chuong ${chapterNum}`);
          }
          if (!fs.existsSync(driveFolder)) {
            fs.mkdirSync(driveFolder, { recursive: true });
          }

          const scriptTitle = ten_tac_pham
            ? ten_tac_pham.replace(/[\/\\:\*\?"<>\|]/g, '_').trim()
            : 'Kich Ban';
          const suffix = buffers.length > 1 ? `_V${variantIndex + 1}` : '';
          const driveFilename =
            chapterNum === 0
              ? `${scriptTitle}_ConceptArt_NhanVat_${Date.now()}${suffix}.png`
              : `${driveMediaFilename(scriptTitle, chapterNum, sceneIndex, {
                  kind: 'image',
                  promptIndex,
                }).replace(/\.png$/i, '')}${suffix}.png`;
          const driveFilePath = path.join(driveFolder, driveFilename);
          fs.writeFileSync(driveFilePath, imageBuffer);
          driveFilePaths.push(driveFilePath);
          driveSaved = true;
          console.log(`[Image API] Copied generated image to save folder: ${driveFilePath}`);
        } catch (driveErr: unknown) {
          console.error(`[Image API] Save-folder warning: ${(driveErr as Error).message}`);
        }
      }
    });

    return NextResponse.json({
      success: true,
      imagePath: imagePaths[0],
      imagePaths,
      driveSaved,
      driveFilePath: driveFilePaths[0] || '',
      driveFilePaths,
      method,
      usedApiKey,
    });
  };

  const saveImage: SaveImageFn = (imageBuffer, method, usedApiKey) => {
    return saveImageBuffers([imageBuffer], method, usedApiKey);
  };

  return { saveImage, saveImageBuffers };
}
