'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { redact } = require('./redaction');

function bounded(value, policy) {
  const limits = policy.limits || {};
  return redact(value, {
    maxItems: limits.maxEvidenceItems || 32,
    maxStringLength: limits.maxEvidenceStringLength || 1024,
  });
}

function createAuditRecord({ event, actor = 'control-plane', repository = null, evidence = {}, policy }) {
  if (!policy || policy.audit?.appendOnly !== true || policy.audit?.redactSecrets !== true) {
    throw new Error('audit policy must enforce append-only redacted records');
  }
  const record = {
    schemaVersion: 1,
    event: String(event || 'unspecified').slice(0, 128),
    actor: String(actor).slice(0, 128),
    timestamp: new Date().toISOString(),
    repository: bounded(repository, policy),
    evidence: bounded(evidence, policy),
  };
  const serialized = JSON.stringify(record);
  const maxBytes = policy.limits?.maxAuditRecordBytes || 16384;
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) throw new Error('audit record exceeds configured byte limit');
  record.recordHash = crypto.createHash('sha256').update(serialized).digest('hex');
  return record;
}

function appendAuditRecord(file, record) {
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const line = `${JSON.stringify(record)}\n`;
  const descriptor = fs.openSync(target, 'a');
  try { fs.writeSync(descriptor, line, null, 'utf8'); } finally { fs.closeSync(descriptor); }
  return target;
}

module.exports = { appendAuditRecord, createAuditRecord };
