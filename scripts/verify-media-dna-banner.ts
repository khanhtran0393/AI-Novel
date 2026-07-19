import assert from 'node:assert/strict';
import {
  evaluateMediaDnaMatch,
  summarizeMediaDnaMismatches,
  type LiveMediaDnaTarget,
  type MediaAssetDnaStamp,
} from '../src/lib/mediaDnaMatch';

const audioKeys = ['1_990', '1_0', '1_3', '1_4', '1_1', '1_2'];
const stamps = Object.fromEntries(
  audioKeys.map((key) => [
    key,
    {
      kind: 'audio' as const,
      at: '2026-07-19T00:00:00.000Z',
      ttsPlatform: 'piper',
      ttsVoice: 'ngochuyen.onnx',
      ttsSpeed: 1,
      ttsPitch: 0,
    },
  ]),
) satisfies Record<string, MediaAssetDnaStamp>;

function rowsFor(live: LiveMediaDnaTarget) {
  const report = evaluateMediaDnaMatch({
    chapterNum: 1,
    audioKeys,
    stamps,
    live,
  });
  assert.equal(report.mismatches.length, 12);
  return summarizeMediaDnaMismatches(report.mismatches);
}

const edgeRows = rowsFor({
  ttsPlatform: 'edge_tts',
  ttsVoice: 'vi-VN-HoaiMyNeural',
  ttsSpeed: 1,
  ttsPitch: 0,
});
assert.equal(edgeRows.length, 2);
assert.deepEqual(
  edgeRows.map((row) => [row.field, row.count]),
  [
    ['ttsPlatform', 6],
    ['ttsVoice', 6],
  ],
);
assert.equal(new Set(edgeRows.map((row) => row.key)).size, edgeRows.length);

const vinaRows = rowsFor({
  ttsPlatform: 'vina_voice',
  ttsVoice: 'long_tieng_phim_nu_tre_1',
  ttsSpeed: 1,
  ttsPitch: 0,
});
assert.equal(vinaRows.length, 2);
assert.equal(new Set(vinaRows.map((row) => row.key)).size, vinaRows.length);
assert.ok(
  vinaRows.every(
    (row) => !edgeRows.some((previousRow) => previousRow.key === row.key),
  ),
  'Changing the live TTS target must replace old React rows',
);

console.log(
  `PASS media DNA banner: ${audioKeys.length} assets -> ${edgeRows.length} unique rows; keys rotate with live TTS target`,
);
