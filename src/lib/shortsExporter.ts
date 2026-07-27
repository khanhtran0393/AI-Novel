/**
 * Shorts/TikTok Converter & Animated Karaoke Subtitles Exporter.
 * Formats scripts into vertical 9:16 layout specs and generates animated Karaoke ASS/SRT subtitles.
 */

export interface ShortsSceneSpec {
  sceneId: number;
  aspectRatio: '9:16';
  scriptPrompt: string;
  karaokeAssSubtitle: string;
  formattedSrtSubtitle: string;
}

export interface ShortsPackageResult {
  chapterTitle: string;
  totalDurationEstimatedSeconds: number;
  scenes: ShortsSceneSpec[];
}

export function generateAnimatedKaraokeAssSubtitle(
  text: string,
  startTimeSeconds = 0,
  durationSeconds = 5,
): string {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';

  const perWordDurationMs = Math.round((durationSeconds * 1000) / words.length);
  const karaokeText = words.map((w) => `{\\k${Math.round(perWordDurationMs / 10)}}${w}`).join(' ');

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 100);
    return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  const start = formatTime(startTimeSeconds);
  const end = formatTime(startTimeSeconds + durationSeconds);

  return `Dialogue: 0,${start},${end},Default,,0,0,0,,{\\an8\\fs28\\1c&H00FFFF&\\3c&H000000&\\b1}${karaokeText}`;
}

export function generateShortsPackage(
  chapterTitle: string,
  scenes: Array<{ id?: number; script_prompt?: string; duration?: number }>,
): ShortsPackageResult {
  const title = String(chapterTitle || 'TikTok Shorts').trim();
  let currentTime = 0;

  const shortsScenes: ShortsSceneSpec[] = scenes.map((sc, idx) => {
    const prompt = String(sc.script_prompt || '').trim();
    const dur = sc.duration && sc.duration > 0 ? sc.duration : 6;
    const ass = generateAnimatedKaraokeAssSubtitle(prompt, currentTime, dur);

    const srt = `${idx + 1}\n00:00:${Math.floor(currentTime).toString().padStart(2, '0')},000 --> 00:00:${Math.floor(currentTime + dur).toString().padStart(2, '0')},000\n${prompt}\n`;

    currentTime += dur;

    return {
      sceneId: sc.id || idx + 1,
      aspectRatio: '9:16',
      scriptPrompt: prompt,
      karaokeAssSubtitle: ass,
      formattedSrtSubtitle: srt,
    };
  });

  return {
    chapterTitle: title,
    totalDurationEstimatedSeconds: currentTime,
    scenes: shortsScenes,
  };
}
