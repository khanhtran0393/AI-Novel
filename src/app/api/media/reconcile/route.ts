import { NextResponse } from 'next/server';
import {
  mediaReconcileSummary,
  reconcileMediaMapsAgainstDisk,
  type MediaReconcileInput,
} from '@/lib/mediaDiskReconcile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Filesystem reconciliation must stay on the Node.js side. The workspace store
 * calls this route after hydration and immediately before export.
 */
export async function POST(request: Request) {
  try {
    const input = (await request.json()) as MediaReconcileInput;
    const result = reconcileMediaMapsAgainstDisk({
      generatedAudioPaths: input?.generatedAudioPaths,
      generatedImages: input?.generatedImages,
      generatedVideos: input?.generatedVideos,
      generatedImageVariants: input?.generatedImageVariants,
      generatedAssetDna: input?.generatedAssetDna,
      discoverChapterNum: input?.discoverChapterNum,
      discoverSceneIndices: input?.discoverSceneIndices,
    });
    return NextResponse.json({
      success: true,
      result,
      summary: mediaReconcileSummary(result),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'MEDIA_RECONCILE_FAILED',
      },
      { status: 500 },
    );
  }
}
