/**
 * Build canonical electron-updater latest.yml (or beta.yml / dev.yml).
 *
 * Always overwrites builder output with a fixed schema (version required).
 *
 *   node scripts/generate-update-manifest.mjs --dir dist-qa-unsigned
 *   node scripts/generate-update-manifest.mjs --dir dist --channel latest --version 1.0.6
 *   node scripts/generate-update-manifest.mjs --dir dist-qa-unsigned --strict
 *
 * --strict: version must equal package.json; fail if builder left a bad yml
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  writeCanonicalLatestYml,
  parseAndValidateLatestYml,
  normalizeSemver,
} from './lib/latestYml.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
);

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] || fallback : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const releaseDir = path.resolve(root, arg('dir', 'dist'));
  const channel = String(arg('channel', 'latest')).trim() || 'latest';
  const explicitVersion = String(arg('version', '')).trim();
  const strict = hasFlag('strict');
  const pkgVer = normalizeSemver(packageJson.version);

  if (strict && !pkgVer) {
    throw new Error('package.json version missing/invalid (--strict)');
  }

  const result = await writeCanonicalLatestYml({
    releaseDir,
    packageVersion: packageJson.version,
    channel,
    explicitVersion: explicitVersion || undefined,
  });

  if (strict && pkgVer && result.version !== pkgVer) {
    throw new Error(
      `strict: latest.yml version ${result.version} !== package.json ${pkgVer}`,
    );
  }

  // Validate on-disk text
  const onDisk = fs.readFileSync(result.outPath, 'utf8');
  const parsed = parseAndValidateLatestYml(onDisk, {
    expectVersion: result.version,
  });
  if (!parsed.version) throw new Error('post-write validation lost version');

  console.log(
    JSON.stringify(
      {
        ok: true,
        schema: 'ainovel.latest.yml.v1',
        outPath: result.outPath,
        version: result.version,
        versionSource: result.versionSource,
        exeName: result.exeName,
        size: result.size,
        sha512Prefix: result.sha512Prefix,
        channel,
        strict,
        // Always include version line for operators grepping logs
        versionLine: `version: ${result.version}`,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error('[generate-update-manifest] FAIL:', e instanceof Error ? e.message : e);
  process.exit(1);
});
