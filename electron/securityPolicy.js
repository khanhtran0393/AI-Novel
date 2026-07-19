'use strict';

function isExactOriginUrl(rawUrl, expectedOrigin) {
  try {
    return new URL(String(rawUrl || '')).origin === expectedOrigin;
  } catch {
    return false;
  }
}

function isTrustedNavigationUrl(rawUrl, expectedOrigin, trustedDataUrls) {
  return (
    isExactOriginUrl(rawUrl, expectedOrigin) ||
    (trustedDataUrls instanceof Set && trustedDataUrls.has(rawUrl))
  );
}

module.exports = {
  isExactOriginUrl,
  isTrustedNavigationUrl,
};
