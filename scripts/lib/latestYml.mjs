/**
 * Canonical electron-updater channel manifest (latest.yml / beta.yml / …).
 *
 * Single schema — never ship builder-random / partial YAML:
 *
 *   version: X.Y.Z
 *   files:
 *     - url: AI-Novel-X.Y.Z-x64.exe
 *       sha512: <base64>
 *       size: <bytes>
 *   path: AI-Novel-X.Y.Z-x64.exe
 *   sha512: <base64>
 *   releaseDate: 'ISO-8601'
 *
 * Version is ALWAYS set (package.json / --version / exe name). Fail-closed if missing.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';

const EXE_RE = /^AI-Novel-(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)-x64\.exe$/i;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export function normalizeSemver(raw) {
  const s = String(raw || '')
    .trim()
    .replace(/^v/i, '');
  if (!s || !SEMVER_RE.test(s)) return null;
  return s;
}

/** Extract X.Y.Z from AI-Novel-X.Y.Z-x64.exe */
export function versionFromExeName(name) {
  const m = String(name || '').trim().match(EXE_RE);
  return m ? normalizeSemver(m[1]) : null;
}

export function expectedExeName(version) {
  const v = normalizeSemver(version);
  if (!v) throw new Error(`Invalid version for exe name: ${version}`);
  return `AI-Novel-${v}-x64.exe`;
}

/**
 * Resolve release version: explicit > package.json > first matching exe name.
 * @returns {{ version: string, source: string }}
 */
export function resolveReleaseVersion({
  explicit,
  packageVersion,
  releaseDir,
} = {}) {
  const fromArg = normalizeSemver(explicit);
  if (fromArg) return { version: fromArg, source: 'arg' };

  const fromPkg = normalizeSemver(packageVersion);
  if (fromPkg) return { version: fromPkg, source: 'package.json' };

  if (releaseDir && fs.existsSync(releaseDir)) {
    const found = fs
      .readdirSync(releaseDir)
      .filter((n) => EXE_RE.test(n) && !n.endsWith('.blockmap'));
    const versions = found
      .map((n) => versionFromExeName(n))
      .filter(Boolean)
      .sort((a, b) => {
        // pick highest semver-ish
        const pa = a.split(/[-+]/)[0].split('.').map(Number);
        const pb = b.split(/[-+]/)[0].split('.').map(Number);
        for (let i = 0; i < 3; i++) {
          if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
        }
        return 0;
      });
    if (versions[0]) return { version: versions[0], source: 'exe-filename' };
  }

  throw new Error(
    'Cannot resolve release version: pass --version, set package.json version, or place AI-Novel-X.Y.Z-x64.exe in --dir',
  );
}

export function findReleaseExe(releaseDir, version) {
  if (!fs.existsSync(releaseDir)) {
    throw new Error(`Release dir missing: ${releaseDir}`);
  }
  const preferred = expectedExeName(version);
  const preferredPath = path.join(releaseDir, preferred);
  if (fs.existsSync(preferredPath)) {
    return { exeName: preferred, exePath: preferredPath };
  }

  // Fail-closed: do not silently pick a different version exe
  const found = fs
    .readdirSync(releaseDir)
    .filter((n) => EXE_RE.test(n) && !n.endsWith('.blockmap'));
  if (!found.length) {
    throw new Error(
      `No AI-Novel-*-x64.exe in ${releaseDir} (expected ${preferred})`,
    );
  }
  const mismatch = found
    .map((n) => `${n}→${versionFromExeName(n) || '?'}`)
    .join(', ');
  throw new Error(
    `Missing ${preferred}. Found: ${mismatch}. ` +
      `Bump package.json / --version to match the built exe, or rebuild.`,
  );
}

export async function hashFileSha512Base64(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha512');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('base64')));
  });
}

export function hashFileSha512Base64Sync(filePath) {
  const hash = crypto.createHash('sha512');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('base64');
}

/**
 * Build canonical YAML string (always same field order + required keys).
 */
export function buildLatestYmlText({
  version,
  exeName,
  sha512,
  size,
  releaseDate = new Date().toISOString(),
}) {
  const v = normalizeSemver(version);
  if (!v) throw new Error(`latest.yml version missing/invalid: ${version}`);
  if (!exeName || !String(exeName).trim()) {
    throw new Error('latest.yml path/url (exeName) missing');
  }
  const fromName = versionFromExeName(exeName);
  if (fromName && fromName !== v) {
    throw new Error(
      `Version mismatch: version=${v} but exe name implies ${fromName} (${exeName})`,
    );
  }
  if (!fromName && !/^AI-Novel-.+-x64\.exe$/i.test(exeName)) {
    throw new Error(`Unexpected exe name (want AI-Novel-*-x64.exe): ${exeName}`);
  }
  const sha = String(sha512 || '').trim();
  if (sha.length < 40) throw new Error('latest.yml sha512 missing/invalid');
  const n = Number(size);
  if (!Number.isFinite(n) || n < 1_000_000) {
    throw new Error(`latest.yml size suspicious: ${size}`);
  }
  const date = String(releaseDate || new Date().toISOString()).trim();

  // Fixed template — electron-updater compatible; no optional drift
  return [
    `version: ${v}`,
    `files:`,
    `  - url: ${exeName}`,
    `    sha512: ${sha}`,
    `    size: ${n}`,
    `path: ${exeName}`,
    `sha512: ${sha}`,
    `releaseDate: '${date}'`,
    '',
  ].join('\n');
}

/**
 * Parse + validate latest.yml text. Accepts minor builder variance but requires version.
 */
export function parseAndValidateLatestYml(text, { expectVersion } = {}) {
  const raw = String(text || '');
  if (!raw.trim()) throw new Error('latest.yml is empty');

  const version =
    normalizeSemver((raw.match(/^version:\s*['"]?([^\s'"#]+)/m) || [])[1]) ||
    null;
  if (!version) {
    throw new Error(
      'latest.yml missing version field (builder output incomplete — regenerate with generate-update-manifest)',
    );
  }
  if (expectVersion) {
    const exp = normalizeSemver(expectVersion);
    if (exp && exp !== version) {
      throw new Error(
        `latest.yml version ${version} !== expected ${exp}`,
      );
    }
  }

  const pathName =
    (raw.match(/^path:\s*['"]?([^\s'"#]+)/m) || [])[1] ||
    (raw.match(/^\s+-\s+url:\s*['"]?([^\s'"#]+)/m) || [])[1] ||
    null;
  if (!pathName) throw new Error('latest.yml missing path/url');

  const sha512 =
    (raw.match(/^sha512:\s*['"]?([^\s'"#]+)/m) ||
      raw.match(/^\s+sha512:\s*['"]?([^\s'"#]+)/m) ||
      [])[1] || null;
  if (!sha512 || sha512.length < 40) {
    throw new Error('latest.yml missing/invalid sha512');
  }

  const sizeRaw =
    (raw.match(/^size:\s*(\d+)/m) ||
      raw.match(/^\s+size:\s*(\d+)/m) ||
      [])[1] || null;
  const size = sizeRaw ? Number(sizeRaw) : null;
  if (!size || size < 1_000_000) {
    throw new Error(`latest.yml size missing/suspicious: ${sizeRaw}`);
  }

  const fromName = versionFromExeName(pathName);
  if (fromName && fromName !== version) {
    throw new Error(
      `latest.yml version ${version} does not match artifact ${pathName}`,
    );
  }

  return {
    version,
    path: pathName,
    sha512,
    size,
    text: buildLatestYmlText({
      version,
      exeName: pathName,
      sha512,
      size,
      releaseDate:
        (raw.match(/^releaseDate:\s*['"]?([^'"\n]+)/m) || [])[1] ||
        new Date().toISOString(),
    }),
  };
}

/**
 * Write canonical latest.yml (or beta.yml) for a release dir. Always overwrites.
 */
export async function writeCanonicalLatestYml({
  releaseDir,
  version,
  packageVersion,
  channel = 'latest',
  explicitVersion,
}) {
  const resolved = resolveReleaseVersion({
    explicit: explicitVersion || version,
    packageVersion,
    releaseDir,
  });
  const { exeName, exePath } = findReleaseExe(releaseDir, resolved.version);
  const size = fs.statSync(exePath).size;
  const sha512 = await hashFileSha512Base64(exePath);
  const text = buildLatestYmlText({
    version: resolved.version,
    exeName,
    sha512,
    size,
  });
  // Round-trip validate
  parseAndValidateLatestYml(text, { expectVersion: resolved.version });

  const outName = channel === 'latest' ? 'latest.yml' : `${channel}.yml`;
  const outPath = path.join(releaseDir, outName);
  fs.writeFileSync(outPath, text, 'utf8');

  return {
    ok: true,
    outPath,
    outName,
    version: resolved.version,
    versionSource: resolved.source,
    exeName,
    size,
    sha512,
    sha512Prefix: sha512.slice(0, 24) + '…',
    channel,
  };
}
