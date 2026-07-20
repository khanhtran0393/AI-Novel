import assert from 'node:assert/strict';

import {
  buildPublicFeedUrl,
  extractManifestArtifacts,
  normalizeReleaseChannel,
  validateArtifactEvidence,
  validatePublisherIdentity,
} from './lib/desktopUpdateRelease.mjs';

assert.equal(normalizeReleaseChannel('stable'), 'latest');
assert.equal(normalizeReleaseChannel('beta'), 'beta');
assert.equal(normalizeReleaseChannel('DEV'), 'dev');
assert.throws(() => normalizeReleaseChannel('nightly'), /Unsupported release channel/);

assert.equal(
  buildPublicFeedUrl('https://project.supabase.co/', 'desktop-updates', 'stable'),
  'https://project.supabase.co/storage/v1/object/public/desktop-updates/latest',
);
assert.throws(
  () => buildPublicFeedUrl('http://project.supabase.co', 'desktop-updates', 'stable'),
  /HTTPS Supabase URL/,
);
assert.throws(
  () => buildPublicFeedUrl('https://project.supabase.co', '../updates', 'stable'),
  /Invalid Storage bucket/,
);

const artifacts = extractManifestArtifacts({
  version: '1.2.3',
  files: [
    {
      url: 'AI-Novel-1.2.3-x64.exe',
      sha512: 'abc=',
      size: 123,
    },
    {
      url: 'AI-Novel-1.2.3-x64.exe.blockmap',
      sha512: 'def=',
      size: 45,
    },
  ],
  path: 'AI-Novel-1.2.3-x64.exe',
  sha512: 'abc=',
});

assert.deepEqual(artifacts, [
  {
    name: 'AI-Novel-1.2.3-x64.exe',
    sha512: 'abc=',
    size: 123,
    executable: true,
  },
  {
    name: 'AI-Novel-1.2.3-x64.exe.blockmap',
    sha512: 'def=',
    size: 45,
    executable: false,
  },
]);

assert.throws(
  () =>
    extractManifestArtifacts({
      version: '1.2.3',
      files: [{ url: '../unsigned.exe', sha512: 'x', size: 1 }],
    }),
  /Unsafe update artifact name/,
);
assert.throws(
  () =>
    extractManifestArtifacts({
      version: '1.2.3',
      files: [{ url: 'https://evil.example/app.exe', sha512: 'x', size: 1 }],
    }),
  /Unsafe update artifact name/,
);
assert.throws(
  () => extractManifestArtifacts({ version: '1.2.3', files: [] }),
  /no downloadable artifacts/,
);
assert.throws(
  () =>
    extractManifestArtifacts({
      version: '1.2.3',
      files: [{ url: 'app.exe', size: 1 }],
    }),
  /missing sha512/,
);

assert.doesNotThrow(() =>
  validatePublisherIdentity(
    {
      status: 'Valid',
      signerName: 'AI Novel Studio',
      thumbprint: 'AA BB CC',
      timestamped: true,
    },
    'AI Novel Studio',
    'aabbcc',
  ),
);
assert.throws(
  () =>
    validatePublisherIdentity(
      {
        status: 'Valid',
        signerName: 'Unexpected Publisher',
        thumbprint: 'AABBCC',
        timestamped: true,
      },
      'AI Novel Studio',
      'AABBCC',
    ),
  /publisher mismatch/,
);
assert.throws(
  () =>
    validatePublisherIdentity(
      { status: 'NotSigned', signerName: null },
      'AI Novel Studio',
      'AABBCC',
    ),
  /signature is not valid/,
);
assert.throws(
  () =>
    validatePublisherIdentity(
      {
        status: 'Valid',
        signerName: 'AI Novel Studio',
        thumbprint: 'AABBCC',
        timestamped: false,
      },
      'AI Novel Studio',
      'AABBCC',
    ),
  /not timestamped/,
);
assert.throws(
  () =>
    validatePublisherIdentity(
      {
        status: 'Valid',
        signerName: 'AI Novel Studio',
        thumbprint: 'DDEEFF',
        timestamped: true,
      },
      'AI Novel Studio',
      'AABBCC',
    ),
  /thumbprint mismatch/,
);

assert.doesNotThrow(() =>
  validateArtifactEvidence(
    { name: 'app.exe', size: 100, sha512: 'abc=' },
    { size: 100, sha512: 'abc=' },
  ),
);
assert.throws(
  () =>
    validateArtifactEvidence(
      { name: 'app.exe', size: 100, sha512: 'abc=' },
      { size: 99, sha512: 'abc=' },
    ),
  /remote size mismatch/,
);
assert.throws(
  () =>
    validateArtifactEvidence(
      { name: 'app.exe', size: 100, sha512: 'abc=' },
      { size: 100, sha512: 'def=' },
    ),
  /remote SHA-512 mismatch/,
);

console.log('PASS test-desktop-update-release');
