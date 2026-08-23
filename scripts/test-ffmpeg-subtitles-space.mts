/**
 * Empirical test: import muxVideoWithTts (audio-only) + srtToCaptions parser.
 * Verification logic for Sub → CapCut Text Track migration.
 */
import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';

let ffmpeg = 'ffmpeg';
const binPath = path.resolve('bin/ffmpeg.exe');
if (fs.existsSync(binPath)) ffmpeg = binPath;

const testDir = path.resolve('scripts/_test_ffmpeg');
fs.mkdirSync(testDir, { recursive: true });

const testVideo = path.join(testDir, 'input_no_audio.mp4');
const testVideoWithAudio = path.join(testDir, 'input_with_audio.mp4');
const testAudio = path.join(testDir, 'tts_voice.wav');
const testBgm = path.join(testDir, 'bgm.wav');
const testSrt = path.join(testDir, 'test_sub_capcut.srt');

// Create SRT test asset
fs.writeFileSync(
  testSrt,
  `1\r\n00:00:00,000 --> 00:00:02,500\r\nXin Chào CapCut Subtitle!\r\n\r\n2\r\n00:00:02,500 --> 00:00:05,000\r\nĐây là phụ đề Text Track chỉnh sửa được.\r\n`,
);

console.log('=== Creating test assets ===');

if (!fs.existsSync(testVideo)) {
  spawnSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:d=5:r=25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', testVideo], { encoding: 'utf8' });
}

if (!fs.existsSync(testVideoWithAudio)) {
  spawnSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=640x360:d=5:r=25', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', testVideoWithAudio], { encoding: 'utf8' });
}

if (!fs.existsSync(testAudio)) {
  spawnSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-c:a', 'pcm_s16le', testAudio], { encoding: 'utf8' });
}

if (!fs.existsSync(testBgm)) {
  spawnSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=5', '-c:a', 'pcm_s16le', testBgm], { encoding: 'utf8' });
}

console.log('Assets ready.\n');

// ===== TEST 1: SRT to CapCut Text Track Parser =====
console.log('🧪 TEST 1: SRT → CapCut Caption Clip Spec Parser');
const { srtFileToCaptionClips } = await import('../src/lib/integrations/srtToCaptions');
const captionClips = srtFileToCaptionClips(testSrt, 'tiktok', 'bottom');
console.log('  Parsed Caption Clips:', JSON.stringify(captionClips, null, 2));

if (captionClips.length === 2 && captionClips[0].text === 'Xin Chào CapCut Subtitle!') {
  console.log('  ✅ TEST 1 PASS: Parsed 2 subtitle entries correctly into cutsdk format.\n');
} else {
  console.error('  ❌ TEST 1 FAIL: Unexpected caption format.');
  process.exit(1);
}

// ===== TEST 2: Audio-Only Video Mux (No FFmpeg Burn Sub) =====
console.log('🧪 TEST 2: Audio-Only Video Mux (TTS + BGM + Ducking)');
const { muxVideoWithTts } = await import('../src/lib/ttsBatchSrt/muxFinalVideo');

try {
  const result = muxVideoWithTts({
    videoPath: testVideo,
    ttsAudioPath: testAudio,
    outPath: path.join(testDir, 'out_audio_dubbed.mp4'),
    bgmPath: testBgm,
    musicVolume: 30,
    ttsVolume: 100,
    autoDucking: true,
  });
  const size = fs.statSync(result.outPath).size;
  console.log(`  ✅ TEST 2 PASS — Output: ${result.outPath} (${(size / 1024).toFixed(0)} KB)\n`);
} catch (err: any) {
  console.error(`  ❌ TEST 2 FAIL — ${err.message}`);
  process.exit(1);
}

console.log('========================================');
console.log('🎉 ALL INTEGRATION TESTS PASSED 100%!');
