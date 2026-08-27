'use strict';

const MAX_DEPTH = 6;
const SECRET_KEY = /(pass(word)?|secret|token|api.?key|access.?key|private.?key|credential|cookie|authorization|client.?secret)/i;
const SECRET_VALUE = /(bearer\s+|basic\s+|sk-[A-Za-z0-9]|gh[pousr]_[A-Za-z0-9]|xox[baprs]-[A-Za-z0-9]|-----BEGIN [A-Z ]+ PRIVATE KEY-----)/i;
const SENSITIVE_PATH = /(?:[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^\s"']+|\/(?:Users|home|private\/var|tmp)\/[^\s"']+)/i;
const KEY_VALUE = /((?:password|passwd|secret|token|api[_-]?key|access[_-]?token|cookie|authorization|private[_-]?key)\s*[=:]\s*)([^,;\s]+)/gi;

function redactString(input, options = {}) {
  let value = String(input);
  value = value.replace(/-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----/gi, '[REDACTED_PRIVATE_KEY]');
  value = value.replace(KEY_VALUE, '$1[REDACTED]');
  value = value.replace(/(Bearer|Basic)\s+[A-Za-z0-9+/=._-]+/gi, '$1 [REDACTED]');
  value = value.replace(SENSITIVE_PATH, '[REDACTED_LOCAL_PATH]');
  if (SECRET_VALUE.test(value)) value = '[REDACTED_SECRET]';
  const maxLength = Number.isInteger(options.maxStringLength) ? options.maxStringLength : 1024;
  return value.length > maxLength ? `${value.slice(0, maxLength)}…[TRUNCATED]` : value;
}

function redact(value, options = {}, depth = 0) {
  if (depth > (options.maxDepth || MAX_DEPTH)) return '[REDACTED_DEPTH]';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return typeof value === 'string' ? redactString(value, options) : value;
  }
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, options.maxItems || 32).map((item) => redact(item, options, depth + 1));
  if (typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value).slice(0, options.maxItems || 32)) {
      output[key] = SECRET_KEY.test(key) ? '[REDACTED]' : redact(item, options, depth + 1);
    }
    return output;
  }
  return '[REDACTED_UNSUPPORTED]';
}

module.exports = { redact, redactString };
