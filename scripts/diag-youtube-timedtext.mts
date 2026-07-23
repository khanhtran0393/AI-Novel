/**
 * Debug player captionTracks + timedtext fetch for a video.
 */
import { extractYoutubeVideoId } from '../src/lib/youtubeSourceId.ts';

const videoId = extractYoutubeVideoId(
  process.argv[2] || 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
)!;
const url = `https://www.youtube.com/watch?v=${videoId}`;
console.log('videoId', videoId);

const html = await (
  await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  })
).text();
console.log('html len', html.length);

const m = html.match(/ytInitialPlayerResponse\s*=\s*(\{)/);
if (!m || m.index == null) {
  console.error('no player response');
  process.exit(1);
}
// crude brace extract
const start = m.index + m[0].length - 1;
let depth = 0;
let end = start;
let inStr = false;
let esc = false;
for (let i = start; i < html.length; i++) {
  const c = html[i];
  if (inStr) {
    if (esc) esc = false;
    else if (c === '\\') esc = true;
    else if (c === '"') inStr = false;
    continue;
  }
  if (c === '"') {
    inStr = true;
    continue;
  }
  if (c === '{') depth++;
  else if (c === '}') {
    depth--;
    if (depth === 0) {
      end = i + 1;
      break;
    }
  }
}
const player = JSON.parse(html.slice(start, end)) as {
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: Array<{
        baseUrl?: string;
        languageCode?: string;
        kind?: string;
      }>;
    };
  };
};
const tracks =
  player.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
console.log(
  'tracks',
  tracks.map((t) => ({
    lang: t.languageCode,
    kind: t.kind,
    urlHead: (t.baseUrl || '').slice(0, 80),
  })),
);

if (!tracks[0]?.baseUrl) {
  console.error('no tracks');
  process.exit(2);
}

const base = tracks[0].baseUrl;
const candidates = [
  base,
  base.includes('fmt=') ? base : `${base}&fmt=json3`,
  base.includes('fmt=') ? base : `${base}&fmt=srv3`,
];

for (const u of candidates) {
  try {
    const res = await fetch(u, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Referer: 'https://www.youtube.com/',
        Accept: '*/*',
      },
    });
    const body = await res.text();
    console.log(
      'timedtext',
      res.status,
      'len',
      body.length,
      'head',
      body.slice(0, 120).replace(/\s+/g, ' '),
    );
  } catch (e) {
    console.log('timedtext err', e instanceof Error ? e.message : e);
  }
}
