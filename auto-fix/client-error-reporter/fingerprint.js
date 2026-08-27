'use strict';

const crypto = require('crypto');

// Normalize volatile tokens so identical failures collapse to one fingerprint.
function normalizeMessage(message) {
  return String(message || '')
    .replace(/0x[0-9a-f]+/gi, '<HEX>')
    .replace(/\b\d+\b/g, '<N>')
    .replace(/[A-Za-z]:[\\/][^\s'"]+/g, '<PATH>')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<EMAIL>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 512);
}

function normalizeFrame(frame) {
  if (!frame) return '';
  const file = String(frame.file || frame.fileName || '')
    .replace(/^[A-Za-z]:[\\/]/, '')
    .replace(/[\\/]/g, '/');
  const fn = String(frame.function || frame.functionName || frame.methodName || '<anonymous>')
    .replace(/[0-9a-f]{8,}/gi, '<HEX>');
  return `${fn}@${file}:${frame.lineNumber || frame.line || ''}:${frame.columnNumber || frame.column || ''}`;
}

function extractFrames(error) {
  if (!error || !error.stack) return [];
  const lines = String(error.stack).split(/\r?\n/).slice(1);
  const frames = [];
  for (const line of lines) {
    const match = line.match(/at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/);
    if (match) {
      frames.push({
        function: match[1] || '',
        file: match[2],
        lineNumber: Number(match[3]),
        columnNumber: Number(match[4]),
      });
    }
  }
  return frames.slice(0, 8);
}

/**
 * Stable technical fingerprint: exception type + normalized message +
 * normalized stack frames + originating module. Volatile data is excluded so
 * many reports collapse to a single fingerprint (one BugCase, one AI run).
 */
function fingerprintException(error) {
  const frames = extractFrames(error);
  const normalizedMessage = normalizeMessage(error && error.message);
  const normalizedFrames = frames.map(normalizeFrame).join('|');
  const moduleName = (frames[0] && frames[0].file)
    ? String(frames[0].file).split('/').pop().split('?')[0]
    : '';
  const errorType = String(
    (error && error.name)
    || (error && error.constructor && error.constructor.name)
    || 'Error',
  );
  const basis = [errorType, normalizedMessage, normalizedFrames, moduleName].join('\n');
  const hash = crypto.createHash('sha256').update(basis, 'utf8').digest('hex');
  return {
    fingerprint: hash.slice(0, 32),
    errorType,
    normalizedMessage,
    frames: frames.map(normalizeFrame),
    module: moduleName,
  };
}

module.exports = { fingerprintException, normalizeMessage, normalizeFrame, extractFrames };