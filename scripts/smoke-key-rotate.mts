/**
 * Smoke: round-robin advances every call; limited keys deprioritized.
 */
import {
  orderKeysRoundRobin,
  markKeyLimited,
  markKeySuccess,
  getKeyRotateSnapshot,
  keyFingerprint,
} from '../src/lib/apiKeyRotate.ts';

const keys = ['key_aaa_1111', 'key_bbb_2222', 'key_ccc_3333'];

const orders: string[][] = [];
for (let i = 0; i < 6; i++) {
  orders.push(orderKeysRoundRobin(keys).map(keyFingerprint));
}

// First keys of successive calls should rotate (not always same sticky)
const firsts = orders.map((o) => o[0]);
const uniqueFirsts = new Set(firsts);
console.log('first picks:', firsts.join(' → '));
if (uniqueFirsts.size < 2) {
  console.error('FAIL: RR did not rotate first key across calls');
  process.exit(1);
}

// Mark middle key RPD-limited → should sort later
markKeyLimited(keys[1], 'GenerateRequestsPerDay quota exceeded');
const afterLimit = orderKeysRoundRobin(keys);
if (afterLimit[0] === keys[1]) {
  // Might still be first if all equal — but cooldown should push it back
  console.error('FAIL: limited key still first', afterLimit.map(keyFingerprint));
  process.exit(1);
}
console.log(
  'after RPD limit on bbb, order:',
  afterLimit.map(keyFingerprint).join(' → '),
);

markKeySuccess(keys[0]);
const snap = getKeyRotateSnapshot(keys);
console.log('snapshot', JSON.stringify(snap, null, 2));
console.log('PASS key rotate smoke');
