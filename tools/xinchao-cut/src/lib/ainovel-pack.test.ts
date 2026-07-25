import { describe, expect, it } from 'vitest'

import type { MediaAsset } from '@engine/media'

import { planAiNovelPackClips, type AiNovelPackPayload } from './ainovel-pack'

function asset(
  id: string,
  kind: MediaAsset['kind'],
  sourcePath: string,
  durationSec: number,
): MediaAsset {
  return {
    id,
    projectId: 'project-real',
    kind,
    name: sourcePath.split(/[\\/]/).at(-1) ?? id,
    mimeType: kind === 'audio' ? 'audio/mpeg' : `${kind}/test`,
    sizeBytes: 1024,
    durationSec,
    storageKey: '',
    sourcePath,
    createdAt: 1,
  }
}

const payload: AiNovelPackPayload = {
  packRoot: 'D:\\exports\\real-pack',
  manifestPath: 'D:\\exports\\real-pack\\ainovel-xinchao-pack.json',
  name: 'Media thật',
  aspect: '16:9',
  media: [
    {
      key: '725_1_0_video',
      kind: 'video',
      path: 'D:\\exports\\real-pack\\media\\v.mp4',
      startSec: 0,
      durationSec: 12,
    },
    {
      key: '725_1',
      kind: 'audio',
      path: 'D:\\exports\\real-pack\\media\\a.wav',
      startSec: 0,
      durationSec: 10.6,
    },
  ],
}

describe('planAiNovelPackClips', () => {
  it('maps canonical disk paths and clamps video to its real duration', () => {
    const plan = planAiNovelPackClips(payload, [
      asset('video-real', 'video', 'd:/exports/real-pack/media/v.mp4', 8),
      asset('audio-real', 'audio', 'D:\\exports\\real-pack\\media\\a.wav', 10.605),
    ])

    expect(plan).toEqual([
      {
        key: '725_1_0_video',
        assetId: 'video-real',
        trackKind: 'video',
        startSec: 0,
        durationSec: 8,
      },
      {
        key: '725_1',
        assetId: 'audio-real',
        trackKind: 'audio',
        startSec: 0,
        durationSec: 10.6,
      },
    ])
  })

  it('fails loudly when a manifest path was not imported', () => {
    expect(() => planAiNovelPackClips(payload, [])).toThrow(
      'Không nhập được media thật: 725_1_0_video',
    )
  })
})
