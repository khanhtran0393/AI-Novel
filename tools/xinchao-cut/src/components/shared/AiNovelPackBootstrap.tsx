import { useEffect, useRef } from 'react'

import { isTauri } from '@engine/media'
import { useDesktopPathMediaImport } from '@hooks/useMediaImport'
import { planAiNovelPackClips, type AiNovelPackPayload } from '@lib/ainovel-pack'
import { createAndOpenProject, saveCurrentProject } from '@lib/project-session'
import { ASPECT_RATIOS, useProjectStore } from '@store/project-store'
import { useTimelineStore } from '@store/timeline-store'
import { useToastStore } from '@store/toast-store'

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).at(-1) || filePath
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

      await createAndOpenProject(payload.name.normalize('NFC'), aspect)
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

      for (const clip of clipPlan) {
        useTimelineStore.getState().insertClip({
          trackId: clip.trackKind === 'audio' ? audioTrack.id : videoTrack.id,
          assetId: clip.assetId,
          startSec: clip.startSec,
          durationSec: clip.durationSec,
        })
      }
      await saveCurrentProject()
      const projectId = useProjectStore.getState().id
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke<string>('report_ainovel_pack_import', {
        report: {
          packRoot: payload.packRoot,
          projectId,
          mediaCount: imported.length,
          clipCount: clipPlan.length,
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
