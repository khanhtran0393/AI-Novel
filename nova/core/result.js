'use strict';

/**
 * Result contract shared by main-process services.
 * Legacy handlers may still return their historical shape; adapters can use
 * these helpers at the boundary without changing renderer-facing channels.
 */
function ok(data, extra) {
  return { ok: true, data, ...(extra && typeof extra === 'object' ? extra : {}) };
}

function fail(error, extra) {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  return { ok: false, error: message, ...(extra && typeof extra === 'object' ? extra : {}) };
}

function canceled(data, extra) {
  return { ok: false, canceled: true, data, ...(extra && typeof extra === 'object' ? extra : {}) };
}

async function capture(task) {
  try { return ok(await task()); }
  catch (error) { return fail(error); }
}

module.exports = { ok, fail, canceled, capture };

if (require.main === module) {
  const assert = require('assert');
  assert.deepStrictEqual(ok(1), { ok: true, data: 1 });
  assert.strictEqual(fail(new Error('x')).error, 'x');
  assert.strictEqual(canceled().canceled, true);
  console.log('result contract: ok');
}
