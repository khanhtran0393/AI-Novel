import { describe, expect, it } from 'vitest'

import type { MediaAsset } from '@engine/media'

import {
  planAiNovelPackClipUpserts,
  planAiNovelPackClips,
  type AiNovelPackPayload,
} from './ainovel-pack'

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
      slotId: '725_1_0',
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
  it('keeps the reserved slot footprint and exposes real source duration', () => {
    const plan = planAiNovelPackClips(payload, [
      asset('video-real', 'video', 'd:/exports/real-pack/media/v.mp4', 8),
      asset('audio-real', 'audio', 'D:\\exports\\real-pack\\media\\a.wav', 10.605),
    ])

    expect(plan).toEqual([
      {
        key: '725_1_0_video',
        slotId: '725_1_0',
        assetId: 'video-real',
        trackKind: 'video',
        startSec: 0,
        durationSec: 12,
        sourceDurationSec: 8,
      },
      {
        key: '725_1',
        slotId: '725_1',
        assetId: 'audio-real',
        trackKind: 'audio',
        startSec: 0,
        durationSec: 10.6,
        sourceDurationSec: 10.605,
      },
    ])
  })

  it('fails loudly when a manifest path was not imported', () => {
    expect(() => planAiNovelPackClips(payload, [])).toThrow(
      'Không nhập được media thật: 725_1_0_video',
    )
  })

  it('fits source spans within the editor speed range and rejects impossible slow-downs', () => {
    const videoOnly = {
      ...payload,
      media: [payload.media[0]!],
    }
    expect(
      planAiNovelPackClips(videoOnly, [
        asset('video-long', 'video', 'D:\\exports\\real-pack\\media\\v.mp4', 100),
      ])[0]!.sourceDurationSec,
    ).toBe(48)

    expect(() =>
      planAiNovelPackClips(videoOnly, [
        asset('video-too-short', 'video', 'D:\\exports\\real-pack\\media\\v.mp4', 1),
      ]),
    ).toThrow('không thể phủ kín slot')
  })
})

describe('planAiNovelPackClipUpserts', () => {
  it('replaces a late video inside its existing reserved slot and inserts only new slots', () => {
    const incoming = [
      {
        key: '1_0_0_video',
        slotId: '1_0_0',
        assetId: 'video-late',
        trackKind: 'video' as const,
        startSec: 2,
        durationSec: 4,
        sourceDurationSec: 4,
      },
      {
        key: '1_0_1',
        slotId: '1_0_1',
        assetId: 'image-next',
        trackKind: 'video' as const,
        startSec: 6,
        durationSec: 6,
        sourceDurationSec: 6,
      },
    ]

    expect(
      planAiNovelPackClipUpserts(incoming, [
        { clipId: 'clip-old-image', slotId: '1_0_0', trackKind: 'video' },
        { clipId: 'clip-duplicate', slotId: '1_0_0', trackKind: 'video' },
        { clipId: 'clip-stale', slotId: '1_9_9', trackKind: 'video' },
      ]),
    ).toEqual({
      replace: [
        {
          clipId: 'clip-old-image',
          clip: incoming[0],
        },
      ],
      insert: [incoming[1]],
      remove: ['clip-duplicate', 'clip-stale'],
    })
  })
})
