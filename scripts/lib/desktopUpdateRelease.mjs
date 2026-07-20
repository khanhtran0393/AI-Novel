import path from 'node:path';

const VALID_BUCKET = /^[a-z0-9][a-z0-9._-]{2,62}$/;
const VALID_CHANNELS = new Map([
  ['stable', 'latest'],
  ['latest', 'latest'],
  ['beta', 'beta'],
  ['dev', 'dev'],
]);

export function normalizeReleaseChannel(value = 'stable') {
  const normalized = String(value || 'stable').trim().toLowerCase();
  const channel = VALID_CHANNELS.get(normalized);
  if (!channel) {
    throw new Error(`Unsupported release channel: ${value}`);
  }
  return channel;
}

export function validateStorageBucket(value) {
  const bucket = String(value || '').trim();
  if (!VALID_BUCKET.test(bucket)) {
    throw new Error(`Invalid Storage bucket: ${value}`);
  }
  return bucket;
}

export function buildPublicFeedUrl(supabaseUrl, bucketValue, channelValue) {
  let url;
  try {
    url = new URL(String(supabaseUrl || '').trim());
  } catch {
    throw new Error('A valid HTTPS Supabase URL is required');
  }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co')) {
    throw new Error('A valid HTTPS Supabase URL is required');
  }
  const bucket = validateStorageBucket(bucketValue);
  const channel = normalizeReleaseChannel(channelValue);
  return `${url.origin}/storage/v1/object/public/${bucket}/${channel}`;
}

export function safeArtifactName(value) {
  const raw = String(value || '').trim().replace(/^['"]|['"]$/g, '');
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw new Error(`Unsafe update artifact name: ${value}`);
  }
  if (
    !decoded ||
    decoded !== path.basename(decoded) ||
    decoded.includes('/') ||
    decoded.includes('\\') ||
    decoded === '.' ||
    decoded === '..' ||
    /^[a-z][a-z0-9+.-]*:/i.test(decoded)
  ) {
    throw new Error(`Unsafe update artifact name: ${value}`);
  }
  return decoded;
}

export function extractManifestArtifacts(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('latest.yml must contain an object');
  }
  if (!String(manifest.version || '').trim()) {
    throw new Error('latest.yml is missing version');
  }
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  if (files.length === 0 && manifest.path) {
    files.push({
      url: manifest.path,
      sha512: manifest.sha512,
      size: manifest.size,
    });
  }
  if (files.length === 0) {
    throw new Error('latest.yml has no downloadable artifacts');
  }

  const seen = new Set();
  const artifacts = [];
  for (const entry of files) {
    const name = safeArtifactName(entry?.url || entry?.path);
    if (seen.has(name)) continue;
    const sha512 = String(entry?.sha512 || '').trim();
    if (!sha512) throw new Error(`${name} is missing sha512`);
    const size = Number(entry?.size);
    if (!Number.isFinite(size) || size <= 0) {
      throw new Error(`${name} has an invalid size`);
    }
    seen.add(name);
    artifacts.push({
      name,
      sha512,
      size,
      executable: name.toLowerCase().endsWith('.exe'),
    });
  }
  return artifacts;
}

function normalizeThumbprint(value) {
  return String(value || '').replace(/[^a-f0-9]/gi, '').toUpperCase();
}

export function validatePublisherIdentity(
  signature,
  expectedPublisher,
  expectedThumbprint,
) {
  const expected = String(expectedPublisher || '').trim();
  if (!expected) throw new Error('WIN_CSC_PUBLISHER_NAME is required');
  const pinnedThumbprint = normalizeThumbprint(expectedThumbprint);
  if (!pinnedThumbprint) throw new Error('WIN_CSC_CERTIFICATE_SHA1 is required');
  if (signature?.status !== 'Valid') {
    throw new Error(`Artifact signature is not valid: ${signature?.status || 'unknown'}`);
  }
  const actual = String(signature?.signerName || '').trim();
  if (actual !== expected) {
    throw new Error(`Artifact publisher mismatch: expected "${expected}", got "${actual || 'none'}"`);
  }
  const actualThumbprint = normalizeThumbprint(signature?.thumbprint);
  if (actualThumbprint !== pinnedThumbprint) {
    throw new Error(
      `Artifact certificate thumbprint mismatch: expected ${pinnedThumbprint}, got ${actualThumbprint || 'none'}`,
    );
  }
  if (signature?.timestamped !== true) {
    throw new Error('Artifact signature is not timestamped');
  }
}

export function validateArtifactEvidence(expected, actual) {
  if (Number(actual?.size) !== Number(expected?.size)) {
    throw new Error(
      `${expected?.name || 'artifact'} remote size mismatch: expected ${expected?.size}, got ${actual?.size}`,
    );
  }
  if (String(actual?.sha512 || '') !== String(expected?.sha512 || '')) {
    throw new Error(`${expected?.name || 'artifact'} remote SHA-512 mismatch`);
  }
}

export function contentTypeFor(name) {
  const lower = String(name || '').toLowerCase();
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'application/yaml';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.exe')) return 'application/vnd.microsoft.portable-executable';
  return 'application/octet-stream';
}
