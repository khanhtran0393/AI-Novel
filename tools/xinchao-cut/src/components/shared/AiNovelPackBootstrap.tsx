import { useEffect, useRef } from 'react'

import { isTauri } from '@engine/media'
import { getProject, listProjects } from '@engine/persistence'
import { useDesktopPathMediaImport } from '@hooks/useMediaImport'
import {
  planAiNovelPackClipUpserts,
  planAiNovelPackClips,
  type AiNovelPackPayload,
} from '@lib/ainovel-pack'
import {
  createAndOpenProject,
  openProject,
  saveCurrentProject,
} from '@lib/project-session'
import { ASPECT_RATIOS, useProjectStore } from '@store/project-store'
import { useTimelineStore } from '@store/timeline-store'
import { useToastStore } from '@store/toast-store'

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).at(-1) || filePath
}

async function openOrCreateReservationProject(
  name: string,
  aspect: (typeof ASPECT_RATIOS)[number],
): Promise<void> {
  const normalizedName = name.normalize('NFC')
  const current = useProjectStore.getState()
  if (current.id && current.name === normalizedName && current.aspect.label === aspect.label) {
    const clips = useTimelineStore.getState().timeline.clips
    if (clips.length === 0 || clips.some((clip) => clip.aiNovelSlotKey)) return
  }

  const candidates = (await listProjects()).filter(
    (project) => project.name === normalizedName,
  )
  for (const candidate of candidates) {
    const snapshot = await getProject(candidate.id)
    if (!snapshot || snapshot.aspect !== aspect.label) continue
    const clips = (snapshot.clips || []) as Array<{ aiNovelSlotKey?: string }>
    if (clips.length > 0 && !clips.some((clip) => clip.aiNovelSlotKey)) continue
    await openProject(candidate.id)
    return
  }
  await createAndOpenProject(normalizedName, aspect)
}

function assertExactReservationClips(
  plans: ReturnType<typeof planAiNovelPackClips>,
  snapshot: {
    clips: readonly unknown[]
    tracks: readonly unknown[]
  },
): number {
  const clips = snapshot.clips as Array<{
      aiNovelSlotKey?: string
      assetId: string | null
      trackId: string
      startSec: number
      inPointSec: number
      outPointSec: number
      speed: number
    }>
  const tracks = snapshot.tracks as Array<{ id: string; kind: string }>
  const trackKindById = new Map(
    tracks.map((track) => [track.id, track.kind]),
  )
  for (const plan of plans) {
    const matches = clips.filter(
      (clip) =>
        clip.aiNovelSlotKey === plan.slotId &&
        (trackKindById.get(clip.trackId) === 'audio' ? 'audio' : 'video') ===
          plan.trackKind,
    )
    if (matches.length !== 1) {
      throw new Error(
        `Slot ${plan.trackKind}:${plan.slotId} phải có đúng 1 clip, nhận ${matches.length}`,
      )
    }
    const clip = matches[0]!
    const effectiveDuration =
      (clip.outPointSec - clip.inPointSec) / Math.max(clip.speed, 0.01)
    if (
      clip.assetId !== plan.assetId ||
      Math.abs(clip.startSec - plan.startSec) > 0.001 ||
      Math.abs(effectiveDuration - plan.durationSec) > 0.001
    ) {
      throw new Error(
        `Slot ${plan.slotId} lệch reservation: start=${clip.startSec}, duration=${effectiveDuration}`,
      )
    }
  }
  const managedClips = clips.filter((clip) => Boolean(clip.aiNovelSlotKey))
  if (managedClips.length !== plans.length) {
    throw new Error(
      `Project còn ${managedClips.length - plans.length} clip reservation cũ`,
    )
  }
  return plans.length
}

/**
 * Install-owned AI Novel bridge. The Rust shell validates and canonicalizes
 * the pack first; this component then uses XinChao-Cut's real project, media,
 * timeline and persistence paths instead of a demo dataset or alternate UI.
 */
export function AiNovelPackBootstrap() {
  const importDesktopPaths = useDesktopPathMediaImport()
  const busyRef = useRef(false)
  const rerunRef = useRef(false)

  useEffect(() => {
    if (!isTauri()) return undefined
    let disposed = false
    let unlisten: (() => void) | undefined

    const importPack = async (payload: AiNovelPackPayload) => {
      const aspect = ASPECT_RATIOS.find((candidate) => candidate.label === payload.aspect)
      if (!aspect) throw new Error(`Tỷ lệ project không được hỗ trợ: ${payload.aspect}`)

      await openOrCreateReservationProject(payload.name, aspect)
      const uniquePaths = Array.from(
        new Map(
          payload.media.map((item) => [
            item.path.toLocaleLowerCase('en-US'),
            { path: item.path, name: basename(item.path) },
          ]),
        ).values(),
      )
      const imported = await importDesktopPaths(uniquePaths)
      const clipPlan = planAiNovelPackClips(payload, imported)
      const timeline = useTimelineStore.getState().timeline
      const videoTrack = timeline.tracks.find((track) => track.kind === 'video')
      const audioTrack = timeline.tracks.find((track) => track.kind === 'audio')
      if (!videoTrack || !audioTrack) {
        throw new Error('Project XinChao-Cut thiếu track video/audio mặc định')
      }

      const trackKindById = new Map(
        timeline.tracks.map((track) => [track.id, track.kind]),
      )
      const existing = timeline.clips
        .filter((clip): clip is typeof clip & { aiNovelSlotKey: string } =>
          Boolean(clip.aiNovelSlotKey),
        )
        .map((clip) => ({
          clipId: clip.id,
          slotId: clip.aiNovelSlotKey,
          trackKind:
            trackKindById.get(clip.trackId) === 'audio'
              ? ('audio' as const)
              : ('video' as const),
        }))
      const upserts = planAiNovelPackClipUpserts(clipPlan, existing)
      if (upserts.remove.length > 0) {
        useTimelineStore.getState().removeAiNovelClips(upserts.remove)
      }

      for (const item of upserts.replace) {
        const store = useTimelineStore.getState()
        store.replaceClipSource(item.clipId, item.clip.assetId, 0, true)
        store.setAiNovelClipSlot(
          item.clipId,
          item.clip.startSec,
          item.clip.durationSec,
          item.clip.sourceDurationSec,
        )
      }
      for (const clip of upserts.insert) {
        const store = useTimelineStore.getState()
        const clipId = store.insertClip({
          trackId: clip.trackKind === 'audio' ? audioTrack.id : videoTrack.id,
          assetId: clip.assetId,
          startSec: clip.startSec,
          durationSec: clip.sourceDurationSec,
          aiNovelSlotKey: clip.slotId,
        })
        store.setAiNovelClipSlot(
          clipId,
          clip.startSec,
          clip.durationSec,
          clip.sourceDurationSec,
        )
      }
      assertExactReservationClips(clipPlan, useTimelineStore.getState().timeline)
      await saveCurrentProject()
      const projectId = useProjectStore.getState().id
      const saved = await getProject(projectId)
      if (!saved) throw new Error(`Không đọc lại được project đã lưu: ${projectId}`)
      const verifiedSlotCount = assertExactReservationClips(clipPlan, saved)
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke<string>('report_ainovel_pack_import', {
        report: {
          packRoot: payload.packRoot,
          projectId,
          mediaCount: imported.length,
          clipCount: clipPlan.length,
          replacedCount: upserts.replace.length,
          insertedCount: upserts.insert.length,
          verifiedSlotCount,
        },
      })
      useToastStore
        .getState()
        .push(
          `Đã nạp ${imported.length} media thật và ${clipPlan.length} clip từ AI Novel`,
          'success',
        )
    }

    const consume = async () => {
      if (busyRef.current) {
        rerunRef.current = true
        return
      }
      busyRef.current = true
      try {
        do {
          rerunRef.current = false
          const { invoke } = await import('@tauri-apps/api/core')
          const payload = await invoke<AiNovelPackPayload | null>('take_ainovel_pack')
          if (payload && !disposed) await importPack(payload)
        } while (rerunRef.current && !disposed)
      } catch (error) {
        if (!disposed) {
          useToastStore
            .getState()
            .push(error instanceof Error ? error.message : String(error), 'error')
        }
      } finally {
        busyRef.current = false
      }
    }

    void (async () => {
      const { listen } = await import('@tauri-apps/api/event')
      unlisten = await listen('ainovel-pack-available', () => {
        void consume()
      })
      await consume()
    })()

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [importDesktopPaths])

  return null
}
