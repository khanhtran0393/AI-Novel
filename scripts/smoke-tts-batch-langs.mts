import {
  normalizeSubtitleInput,
  parseSrt,
} from '../src/lib/ttsBatchSrt/parseSrt.ts';
import {
  normalizeBatchLang,
  SOURCE_LANG_OPTIONS,
  TARGET_LANG_OPTIONS,
} from '../src/lib/ttsBatchSrt/languages.ts';

const txt = 'Cau mot day.\n\nCau hai day.\n\nHan Duc: Cau ba.';
const n = normalizeSubtitleInput(txt, 'script.txt');
console.log('kind', n.kind, 'cues', parseSrt(n.srtText).length);
const srt = '1\n00:00:00,000 --> 00:00:02,000\nHello\n';
console.log('srt kind', normalizeSubtitleInput(srt, 'a.srt').kind);
console.log('langs src', SOURCE_LANG_OPTIONS.length, 'tgt', TARGET_LANG_OPTIONS.length);
console.log('ja', normalizeBatchLang('japanese'), 'ko', normalizeBatchLang('han'));
console.log('PASS');
