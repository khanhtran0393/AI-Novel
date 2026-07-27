import assert from 'node:assert/strict';

import { buildChapterTimelineReservation } from '../src/lib/integrations/timelineReservation';

const empty = buildChapterTimelineReservation({
  chapterNum: 1,
  projectName: 'Xuyên Không - Viễn Tưởng',
  prompts: {
    '1_0': [
      { timestamp: '0-4s', image_prompt: 'shot 1' },
      { timestamp: '4-10s', image_prompt: 'shot 2' },
    ],
    '1_1': [
      { timestamp: '0-6s', image_prompt: 'shot 3' },
      { timestamp: '6-18s', image_prompt: 'shot 4' },
    ],
  },
  audio: [
    { key: '1_990', path: 'hook.mp3', durationSec: 2 },
    { key: '1_0', path: 'scene-0.mp3', durationSec: 10 },
    { key: '1_1', path: 'scene-1.mp3', durationSec: 18 },
    { key: '1_full', path: 'chapter-full.mp3', durationSec: 30 },
  ],
  images: [],
  videos: [],
});

assert.equal(empty.durationSec, 30);
assert.deepEqual(
  empty.slots.map((slot) => ({
    slotId: slot.slotId,
    startSec: slot.startSec,
    endSec: slot.endSec,
    state: slot.state,
  })),
  [
    { slotId: '1_0_0', startSec: 2, endSec: 6, state: 'reserved' },
    { slotId: '1_0_1', startSec: 6, endSec: 12, state: 'reserved' },
    { slotId: '1_1_0', startSec: 12, endSec: 18, state: 'reserved' },
    { slotId: '1_1_1', startSec: 18, endSec: 30, state: 'reserved' },
  ],
  'TTS must reserve absolute chapter slots before any visual exists',
);

const filled = buildChapterTimelineReservation({
  chapterNum: 1,
  projectName: 'Xuyên Không - Viễn Tưởng',
  prompts: {
    '1_0': [
      { timestamp: '0-4s', image_prompt: 'shot 1' },
      { timestamp: '4-10s', image_prompt: 'shot 2' },
    ],
    '1_1': [
      { timestamp: '0-6s', image_prompt: 'shot 3' },
      { timestamp: '6-18s', image_prompt: 'shot 4' },
    ],
  },
  audio: [
    { key: '1_990', path: 'hook.mp3', durationSec: 2 },
    { key: '1_0', path: 'scene-0.mp3', durationSec: 10 },
    { key: '1_1', path: 'scene-1.mp3', durationSec: 18 },
    { key: '1_full', path: 'chapter-full.mp3', durationSec: 30 },
  ],
  images: [
    { key: '1_0_0', path: 'first.png' },
    { key: '1_0_1', path: 'second.png' },
  ],
  videos: [{ key: '1_0_1_video', path: 'second.mp4' }],
  previous: empty,
});

assert.deepEqual(
  filled.slots.map((slot) => [slot.slotId, slot.startSec, slot.endSec]),
  empty.slots.map((slot) => [slot.slotId, slot.startSec, slot.endSec]),
  'late media binding must not reflow any reserved slot',
);
assert.equal(filled.slots[0].state, 'image');
assert.equal(filled.slots[0].mediaPath, 'first.png');
assert.equal(filled.slots[1].state, 'video');
assert.equal(
  filled.slots[1].mediaPath,
  'second.mp4',
  'video must replace the image inside the same reserved slot',
);
assert.equal(filled.filledSlots, 2);

assert.throws(
  () =>
    buildChapterTimelineReservation({
      chapterNum: 1,
      projectName: 'Incomplete audio must fail',
      prompts: {
        '1_0': [{ timestamp: '0-10s', image_prompt: 'shot' }],
      },
      audio: [
        { key: '1_0', path: 'scene-0.mp3', durationSec: 10 },
        { key: '1_full', path: 'chapter-full.mp3', durationSec: 30 },
      ],
      images: [],
      videos: [],
    }),
  /không kéo giãn slot/,
  'missing scene audio must fail instead of stretching known scenes over full TTS',
);

console.log(
  `CAPCUT_RESERVATION_RED_GREEN_OK slots=${empty.slots.length} filled=${filled.filledSlots} duration=${empty.durationSec}`,
);
