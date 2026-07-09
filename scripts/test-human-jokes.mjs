import {
  injectHumanJokeAsides,
  countHumanJokeAsides,
  isHumanJokeAsideInner,
  buildHumanizeScriptBlock,
} from '../src/lib/youtubeSafe.ts';

const sample =
  'Tòa nhà này có muốn bay lên trời không Kiến?" Kiến cau mày. "Không. Không phải. Mình... mình hơi mệt." "Mệt hả? Mấy ngày nay cậu cứ như người mất hồn ấy." Khánh Ân khoanh tay. "Lẩm bẩm tiếng gì đó, rồi vẽ mấy thứ quái dị này." Cô chỉ vào một góc màn hình, nơi Kiến vừa vẽ một bức phù điêu hình người thợ khổ sai đang cúi mình vác đá…';

console.log('before jokes', countHumanJokeAsides(sample));
const out = injectHumanJokeAsides(sample, { minCount: 1 });
console.log('after jokes', countHumanJokeAsides(out));
console.log('---OUT---');
console.log(out);
console.log('---');
console.log('sfx is joke?', isHumanJokeAsideInner('Cười'));
console.log(
  'user joke is joke?',
  isHumanJokeAsideInner('Đề nghị mọi người đi vệ sinh nhớ chùi đít'),
);
const already =
  'A. "Hi." (Đề nghị mọi người đi vệ sinh nhớ chùi đít) "Bye."';
const noDup = injectHumanJokeAsides(already, { minCount: 1 });
console.log('no dup same?', already === noDup);
console.log('humanize block has joke?', buildHumanizeScriptBlock(true).includes('CÂU ĐÙA'));
if (countHumanJokeAsides(out) < 1) {
  console.error('FAIL: inject did not add joke');
  process.exit(1);
}
// Must sit BETWEEN closing quote and next opening quote
if (!/\."\s*\([^)]+\)\s*"/u.test(out) && !/"\s*\([^)]+\)\s*"/u.test(out)) {
  console.error('FAIL: joke not placed between dialogue turns');
  console.error(out);
  process.exit(1);
}
// Must NOT sit inside quotes like:  ấy. (joke)"
if (/\.\s*\([^)]+\)"/u.test(out) && !/\."\s*\([^)]+\)/u.test(out)) {
  console.error('FAIL: joke appears trapped before closing quote');
  process.exit(1);
}
if (isHumanJokeAsideInner('Cười')) {
  console.error('FAIL: SFX counted as joke');
  process.exit(1);
}
if (!isHumanJokeAsideInner('Đề nghị mọi người đi vệ sinh nhớ chùi đít')) {
  console.error('FAIL: user joke not recognized');
  process.exit(1);
}
if (already !== noDup) {
  console.error('FAIL: duplicated joke on already-present');
  process.exit(1);
}
console.log('PASS');
