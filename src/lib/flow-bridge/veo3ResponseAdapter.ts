/**
 * Veo 3.1 Response Shape Adapter for AI Novel.
 * Exact reference implementation from SuperAutoTools.
 *
 * Google Veo 3.1 recently updated its response structure to return
 * `{ remainingCredits, workflows, media }` instead of `{ operations }`.
 * This adapter converts the new `media[]` shape back into legacy `operations[]`
 * format dynamically, preventing upstream queue engines from crashing with
 * `Cannot read properties of undefined (reading 'operations')`.
 */

export interface OperationItem {
  name: string;
  done?: boolean;
  metadata?: Record<string, unknown>;
  response?: Record<string, unknown>;
  error?: Record<string, unknown>;
}

export function convertVeo3ResponseToOperations(responseData: any, sceneId?: string): OperationItem[] {
  if (!responseData || typeof responseData !== 'object') return [];

  // Shape 1: Legacy operations[]
  if (Array.isArray(responseData.operations) && responseData.operations.length > 0) {
    return responseData.operations;
  }

  // Shape 2: Veo 3.1 media[] shape
  if (Array.isArray(responseData.media) && responseData.media.length > 0) {
    const ops: OperationItem[] = [];
    for (const item of responseData.media) {
      const mediaId = item.mediaId || item.id || item.name || '';
      const isDone = item.state === 'COMPLETED' || item.state === 'MEDIA_GENERATION_STATUS_SUCCESS' || Boolean(item.videoUrl);
      ops.push({
        name: mediaId.startsWith('operations/') ? mediaId : `operations/${mediaId}`,
        done: isDone,
        metadata: {
          sceneId: sceneId || '',
          state: item.state,
          progress: item.progress ?? (isDone ? 100 : 50),
        },
        response: isDone
          ? {
              videoUrl: item.videoUrl || item.downloadUrl,
              mediaId,
            }
          : undefined,
        error: item.error || (item.state === 'FAILED' ? { message: item.errorMessage || 'Generation failed' } : undefined),
      });
    }
    return ops;
  }

  return [];
}
