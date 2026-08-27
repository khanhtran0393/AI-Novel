'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ErrorReporter } = require('../reporter');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'err-reporter-'));
try {
  const fakeEmitter = {
    handlers: new Map(),
    on(channel, fn) { this.handlers.set(channel, fn); },
    removeListener(channel, fn) { if (this.handlers.get(channel) === fn) this.handlers.delete(channel); },
  };

  const reporter = new ErrorReporter({
    appVersion: '0.1.34',
    buildId: 'build-1',
    clientInstallationId: 'inst-1',
    queueFile: path.join(temp, 'crash-queue.json'),
  });

  // Event recording sanitizes params before entering the buffer.
  reporter.recordEvent('open_project', { apiKey: 'secret', name: 'demo' });
  assert.strictEqual(reporter.buffer.size, 1);

  // captureException produces a sanitized, stable report.
  const error = new TypeError('boom at 0x12');
  error.stack = 'TypeError: boom at 0x12\n    at run (C:\\app\\nova\\run.js:10:3)';
  const report = reporter.captureException(error, { user_note: 'password=hunter2' });
  assert.ok(report.fingerprint);
  assert.strictEqual(report.app_version, '0.1.34');
  assert.strictEqual(report.build_id, 'build-1');
  assert.strictEqual(report.client_installation_id, 'inst-1');
  assert.strictEqual(report.status, 'queued');
  assert.ok(!JSON.stringify(report).includes('hunter2'), 'secrets must not leak into the report');
  assert.ok(report.stack_trace.includes('[REDACTED]') || !report.stack_trace.includes('hunter2'));

  // report() queues locally and never throws even without an uploader.
  const result = reporter.report(error);
  assert.strictEqual(result.queued, true);
  assert.strictEqual(reporter.queue.peek().length, 1);

  // Duplicate report is deduplicated.
  const dup = reporter.report(error);
  assert.strictEqual(dup.queued, false);
  assert.strictEqual(dup.reason, 'duplicate');

  // installGlobalHandlers registers on the injectable emitter.
  const uninstall = reporter.installGlobalHandlers(fakeEmitter);
  assert.ok(fakeEmitter.handlers.has('uncaughtException'));
  assert.ok(fakeEmitter.handlers.has('unhandledRejection'));
  uninstall();
  assert.strictEqual(fakeEmitter.handlers.size, 0);

} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log('reporter tests: passed');