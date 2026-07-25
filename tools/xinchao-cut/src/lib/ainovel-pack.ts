import type { MediaAsset } from '@engine/media'

export interface AiNovelPackMedia {
  key: string
  kind: MediaAsset['kind']
  path: string
  startSec: number
  durationSec: number
}

export interface AiNovelPackPayload {
  packRoot: string
  manifestPath: string
  name: string
  aspect: string
  media: AiNovelPackMedia[]
}

export interface AiNovelPackClipPlan {
  key: string
  assetId: string
  trackKind: 'video' | 'audio'
  startSec: number
  durationSec: number
}

function comparablePath(value: string): string {
  return value.replace(/\//g, '\\').toLocaleLowerCase('en-US')
}

/**
 * Bind the canonical manifest entries returned by the Rust shell to the real
 * path-backed media assets created by XinChao-Cut's normal import pipeline.
 */
export function planAiNovelPackClips(
  payload: AiNovelPackPayload,
  imported: readonly MediaAsset[],
): AiNovelPackClipPlan[] {
  const assetByPath = new Map(
    imported
      .filter((asset): asset is MediaAsset & { sourcePath: string } => !!asset.sourcePath)
      .map((asset) => [comparablePath(asset.sourcePath), asset]),
  )

  return payload.media.map((item) => {
    const asset = assetByPath.get(comparablePath(item.path))
    if (!asset) throw new Error(`Không nhập được media thật: ${item.key}`)
    if (asset.kind !== item.kind) {
      throw new Error(`Loại media không khớp manifest: ${item.key}`)
    }
    if (!Number.isFinite(item.startSec) || item.startSec < 0) {
      throw new Error(`Mốc timeline không hợp lệ: ${item.key}`)
    }
    if (!Number.isFinite(item.durationSec) || item.durationSec <= 0) {
      throw new Error(`Thời lượng timeline không hợp lệ: ${item.key}`)
    }

    // Still images may intentionally stay on screen longer than their probe's
    // conventional 5-second duration. Audio/video must not run beyond the real
    // source and create a silent/black tail.
    const sourceDuration = Number(asset.durationSec)
    const durationSec =
      asset.kind !== 'image' && Number.isFinite(sourceDuration) && sourceDuration > 0
        ? Math.min(item.durationSec, sourceDuration)
        : item.durationSec

    return {
      key: item.key,
      assetId: asset.id,
      trackKind: asset.kind === 'audio' ? 'audio' : 'video',
      startSec: item.startSec,
      durationSec,
    }
  })
}
