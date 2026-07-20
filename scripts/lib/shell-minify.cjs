/**
 * Safe shell friction minifier (no full JS parser).
 *
 * Only removes:
 * - full-line // comments (optional leading whitespace)
 * - full-line /* ... *\/ block comments
 * - trailing whitespace
 * - excess blank lines
 *
 * Never touches mid-line content (avoids breaking template literals / regex / URLs).
 * Prefer esbuild minify when installed (desktop-re-harden.cjs).
 */
'use strict';

/**
 * @param {string} source
 * @returns {string}
 */
function minifyJsConservative(source) {
  const lines = String(source).split(/\r?\n/);
  const out = [];
  let inBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (inBlock) {
      if (trimmed.includes('*/')) {
        inBlock = false;
      }
      continue;
    }

    // Full-line block comment start
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/') || trimmed === '/*' || !trimmed.endsWith('*/')) {
        // Multi-line or unclosed on same line heuristics
        if (trimmed.startsWith('/*') && trimmed.endsWith('*/') && trimmed.length >= 4) {
          // single-line /* ... */
          continue;
        }
        if (!trimmed.includes('*/')) {
          inBlock = true;
          continue;
        }
      } else {
        // /* ... */ on one line
        continue;
      }
    }

    // Full-line // comment only
    if (trimmed.startsWith('//')) {
      continue;
    }

    // Keep code lines; strip trailing ws only
    const cleaned = line.replace(/[ \t]+$/g, '');
    if (cleaned.trim() === '') {
      // at most one consecutive blank
      if (out.length && out[out.length - 1].trim() === '') continue;
      out.push('');
      continue;
    }
    out.push(cleaned);
  }

  return out.join('\n').trim() + '\n';
}

/**
 * @param {string} source
 * @param {{ fileLabel?: string }} [opts]
 */
function hardenShellSource(source, opts = {}) {
  const min = minifyJsConservative(source);
  const label = opts.fileLabel || 'shell';
  return `/* ainovel-re-harden phaseA/B ${label} */\n` + min;
}

module.exports = {
  minifyJsConservative,
  hardenShellSource,
};
