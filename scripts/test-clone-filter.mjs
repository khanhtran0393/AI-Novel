import { filterCloneProfilesByFields } from '../src/lib/vinaVoice/profileFilter.ts';
import { loadVinaProfiles } from '../src/lib/vinaVoice/profiles.ts';

const all = loadVinaProfiles().map((p) => ({ name: p.name }));
const f1 = filterCloneProfilesByFields(all, {
  gender: 'female',
  group: 'dubbing',
  emotion: 'neutral',
});
const f2 = filterCloneProfilesByFields(all, {
  gender: 'male',
  group: 'news',
  emotion: 'neutral',
});
const f3 = filterCloneProfilesByFields(all, {
  gender: 'male',
  group: 'story',
  emotion: 'angry',
});
console.log('all', all.length);
console.log('female dubbing', f1.length, f1.slice(0, 3).map((x) => x.name));
console.log('male news', f2.length, f2.slice(0, 3).map((x) => x.name));
console.log('male story angry', f3.length, f3.slice(0, 5).map((x) => x.name));
if (f1.length >= all.length || f2.length >= all.length) {
  console.error('FAIL filter not shrinking');
  process.exit(1);
}
console.log('PASS');
