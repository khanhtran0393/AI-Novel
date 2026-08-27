'use strict';

const assert = require('assert');
const { EventBuffer } = require('../event-buffer');

const buffer = new EventBuffer({ maxSize: 3, sequenceId: 'seq-1' });
assert.strictEqual(buffer.size, 0);

buffer.record('app_start', { feature: 'editor' });
buffer.record('open_project');
buffer.record('load_file', { path: 'clip.mp4' });
assert.strictEqual(buffer.size, 3);
assert.strictEqual(buffer.snapshot().sequence_id, 'seq-1');
assert.strictEqual(buffer.snapshot().events[0].type, 'app_start');
assert.strictEqual(buffer.snapshot().events[0].seq, 1);

// Ring buffer evicts the oldest event once it exceeds maxSize.
buffer.record('exception', { code: 'E1' });
assert.strictEqual(buffer.size, 3);
assert.strictEqual(buffer.snapshot().events[0].type, 'open_project');
assert.strictEqual(buffer.snapshot().events[2].type, 'exception');
// Sequence numbers keep incrementing across eviction.
assert.strictEqual(buffer.snapshot().events[2].seq, 4);

buffer.clear();
assert.strictEqual(buffer.size, 0);

// Snapshot is a copy, not a live reference.
const snap = buffer.snapshot();
snap.events.push({ seq: 99, type: 'injected' });
assert.strictEqual(buffer.size, 0);

console.log('event-buffer tests: passed');