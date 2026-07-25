/**
 * Smoke: chapter full SRT + output dir resolution (no network).
 * Run: npx tsx scripts/smoke-chapter-tts-export.mts
 */
import assert from 'node:assert/strict';
import {
  buildChapterSrt,
  resolveChapterTtsOutputDir,
  chapterFullAudioBasename,
} from '../src/lib/tts/chapterTtsExport.ts';

function ok(l: string) {
  console.log(`  OK  ${l}`);
}

assert.equal(
  resolveChapterTtsOutputDir({
    channelSavePathRoot: 'D:\\Channels\\MyShow',
    savePathTTS: 'D:\\TTS',
  }),
  'D:\\Channels\\MyShow',
);
assert.equal(
  resolveChapterTtsOutputDir({
    channelSavePathRoot: '',
    savePathTTS: 'D:\\TTS',
  }),
  'D:\\TTS',
);
assert.match(
  resolveChapterTtsOutputDir({
    channelSavePathRoot: '',
    savePathTTS: '',
    googleDrivePath: 'G:\\Drive',
  }),
  /Am Thanh TTS/,
);
ok('resolveChapterTtsOutputDir priority channel > TTS > Drive');

const names = chapterFullAudioBasename('Truyện Test', 3);
assert.equal(names.local, 'chapter_3_full.mp3');
assert.equal(names.srtLocal, 'chapter_3_full.srt');
assert.match(names.drive, /Chuong_3_Full\.mp3$/);
ok('basename full chapter');

const srt = buildChapterSrt({
  scenes: [
    {
      sceneIndex: 0,
      title: 'Cảnh 1',
      text: 'Hàn Dực: Xin chào.\nCô gái: Chào anh.',
      audioPath: '/audio/a.mp3',
      durationSec: 4,
    },
    {
      sceneIndex: 1,
      title: 'Cảnh 2',
      text: 'Họ bước vào rừng.',
      audioPath: '/audio/b.mp3',
      durationSec: 2,
    },
  ],
  characterNames: ['Hàn Dực', 'Cô gái'],
});
assert.match(srt, /1\n/);
assert.match(srt, /-->/);
assert.match(srt, /Hàn Dực|Xin chào/);
assert.match(srt, /Họ bước vào rừng/);
// cumulative: first scene ~4s → second starts at 4s
assert.match(srt, /00:00:0[0-4]/);
ok('buildChapterSrt cues + speaker split');

console.log('\n[smoke-chapter-tts-export] PASS');
