import type { MediaAsset } from '@engine/media'

export interface AiNovelPackMedia {
  key: string
  slotId?: string
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
  slotId: string
  assetId: string
  trackKind: 'video' | 'audio'
  startSec: number
  durationSec: number
  sourceDurationSec: number
}

export interface ExistingAiNovelSlotClip {
  clipId: string
  slotId: string
  trackKind: 'video' | 'audio'
}

export interface AiNovelPackClipUpserts {
  replace: Array<{ clipId: string; clip: AiNovelPackClipPlan }>
  insert: AiNovelPackClipPlan[]
  remove: string[]
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

    const sourceDuration = Number(asset.durationSec)
    if (
      asset.kind !== 'image' &&
      (!Number.isFinite(sourceDuration) || sourceDuration <= 0)
    ) {
      throw new Error(`Không đọc được duration media thật: ${item.key}`)
    }
    if (
      asset.kind !== 'image' &&
      sourceDuration < item.durationSec * 0.1
    ) {
      throw new Error(
        `Media ${item.key} không thể phủ kín slot ${item.durationSec}s trong giới hạn tốc độ editor`,
      )
    }
    const sourceDurationSec =
      asset.kind === 'image'
        ? item.durationSec
        : Math.min(sourceDuration, item.durationSec * 4)

    return {
      key: item.key,
      slotId: item.slotId || item.key,
      assetId: asset.id,
      trackKind: asset.kind === 'audio' ? 'audio' : 'video',
      startSec: item.startSec,
      // The reserved timeline footprint is authoritative. Import code fits the
      // real source span into this duration instead of shrinking/reflowing it.
      durationSec: item.durationSec,
      sourceDurationSec,
    }
  })
}

/** Match incoming media to the stable reservation key, independent of kind. */
export function planAiNovelPackClipUpserts(
  incoming: readonly AiNovelPackClipPlan[],
  existing: readonly ExistingAiNovelSlotClip[],
): AiNovelPackClipUpserts {
  const incomingSlotKeys = new Set(
    incoming.map((clip) => `${clip.trackKind}:${clip.slotId}`),
  )
  const existingBySlot = new Map<string, ExistingAiNovelSlotClip>()
  const remove: string[] = []
  for (const clip of existing) {
    const key = `${clip.trackKind}:${clip.slotId}`
    if (!incomingSlotKeys.has(key) || existingBySlot.has(key)) {
      remove.push(clip.clipId)
    } else {
      existingBySlot.set(key, clip)
    }
  }
  const replace: AiNovelPackClipUpserts['replace'] = []
  const insert: AiNovelPackClipPlan[] = []
  for (const clip of incoming) {
    const current = existingBySlot.get(`${clip.trackKind}:${clip.slotId}`)
    if (current) replace.push({ clipId: current.clipId, clip })
    else insert.push(clip)
  }
  return { replace, insert, remove }
}
