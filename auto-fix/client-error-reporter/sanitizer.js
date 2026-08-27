'use strict';

const path = require('path');
const { redact, redactString } = require('../redaction');

// Additional secret patterns not covered by the control-plane redaction module.
const EXTRA_SECRET_PATTERNS = [
  /(eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/g, // JWT
  /(AKIA[0-9A-Z]{16})/g, // AWS access key id
  /(\b[0-9a-f]{32,}\b)/gi, // long hex-looking keys/tokens
  /(gh[pousr]_[A-Za-z0-9]{20,})/g, // GitHub tokens
  /(xox[baprs]-[A-Za-z0-9-]{10,})/g, // Slack tokens
];

function normalizePath(value, home) {
  const base = path.resolve(
    home || process.env.USERPROFILE || process.env.HOME || path.join('C:', 'Users', 'user'),
  );
  return String(value).split(base).join('[HOME]');
}

function sanitizeString(input, options = {}) {
  // Redact full bearer/basic credential strings first so no residual token
  // value survives redactString's key=value pass.
  let value = String(input).replace(/(Bearer|Basic)\s+[A-Za-z0-9+/=._-]+/gi, '$1 [REDACTED]');
  value = redactString(value, options);
  for (const pattern of EXTRA_SECRET_PATTERNS) {
    value = value.replace(pattern, '[REDACTED_SECRET]');
  }
  value = normalizePath(value);
  return value;
}

// Sanitize a full structured report while preserving the stable technical
// fields (fingerprint, error_type, stack_trace, message) needed server-side.
function sanitizeCrashReport(report) {
  const sanitized = redact(report, { maxStringLength: 2048, maxDepth: 6, maxItems: 64 });
  if (sanitized && typeof sanitized === 'object') {
    if (sanitized.stack_trace) sanitized.stack_trace = sanitizeString(String(sanitized.stack_trace), { maxStringLength: 8192 });
    if (sanitized.message) sanitized.message = sanitizeString(String(sanitized.message), { maxStringLength: 2048 });
  }
  return sanitized;
}

module.exports = { sanitizeString, sanitizeCrashReport, normalizePath };