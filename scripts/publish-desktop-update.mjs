/**
 * Provision and publish the signed Electron generic update feed to Supabase Storage.
 *
 * Provision once:
 *   node scripts/publish-desktop-update.mjs --provision
 *
 * Verify the public feed marker:
 *   node scripts/publish-desktop-update.mjs --verify-feed
 *
 * Verify signed release outputs without uploading:
 *   node scripts/publish-desktop-update.mjs --verify-release --dir dist
 *
 * Publish a signed build (uploads latest.yml last):
 *   node scripts/publish-desktop-update.mjs --publish --dir dist
 *
 * Delete a disposable updater-QA bucket:
 *   node scripts/publish-desktop-update.mjs --cleanup-bucket --bucket desktop-updates-qa-123
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';
import * as tus from 'tus-js-client';
import { parse as parseYaml } from 'yaml';

import {
  buildPublicFeedUrl,
  contentTypeFor,
  extractManifestArtifacts,
  normalizeReleaseChannel,
  validateArtifactEvidence,
  validatePublisherIdentity,
  validateStorageBucket,
} from './lib/desktopUpdateRelease.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function arg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

function releaseEnvironment() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const sellerPath =
    process.env.AINOVEL_SELLER_ENV_FILE ||
    path.join(localAppData, 'AI Novel Seller', '.env.seller');
  return {
    ...loadEnvFile(path.join(root, '.env')),
    ...loadEnvFile(path.join(root, '.env.local')),
    ...loadEnvFile(sellerPath),
    ...loadEnvFile(path.join(root, 'resources', 'commercial', 'public.env')),
    ...process.env,
  };
}

function releaseConfig({ requireServiceKey }) {
  const env = releaseEnvironment();
  let supabaseUrl = String(
    env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || '',
  ).trim();
  if (!supabaseUrl && env.AINOVEL_UPDATE_FEED_URL) {
    try {
      supabaseUrl = new URL(env.AINOVEL_UPDATE_FEED_URL).origin;
    } catch {
      // The normal validation below reports the actionable configuration error.
    }
  }
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseUrl || (requireServiceKey && !serviceKey)) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
    );
  }
  const bucket = validateStorageBucket(
    arg('bucket', env.AINOVEL_UPDATE_BUCKET || 'desktop-updates'),
  );
  const channel = normalizeReleaseChannel(
    arg('channel', env.AINOVEL_UPDATE_CHANNEL || 'stable'),
  );
  const feedUrl = buildPublicFeedUrl(supabaseUrl, bucket, channel);
  return { env, supabaseUrl, serviceKey, bucket, channel, feedUrl };
}

function storageClient(config) {
  return createClient(config.supabaseUrl, config.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function publicObjectUrl(feedUrl, name) {
  return `${feedUrl}/${encodeURIComponent(name)}`;
}

async function ensurePublicBucket(config) {
  const client = storageClient(config);
  const { data: buckets, error: listError } = await client.storage.listBuckets();
  if (listError) throw listError;
  const existing = buckets.find((entry) => entry.id === config.bucket);
  if (existing && !existing.public) {
    throw new Error(`Storage bucket ${config.bucket} exists but is private`);
  }
  if (!existing) {
    const { error } = await client.storage.createBucket(config.bucket, {
      public: true,
      allowedMimeTypes: [
        'application/yaml',
        'application/json',
        'application/octet-stream',
        'application/vnd.microsoft.portable-executable',
      ],
    });
    if (error) throw error;
  }

  const marker = {
    schema: 1,
    appId: packageJson.build?.appId || packageJson.name,
    bucket: config.bucket,
    channel: config.channel,
    feedUrl: config.feedUrl,
    provisionedAt: new Date().toISOString(),
  };
  const markerPath = `${config.channel}/feed-ready.json`;
  const { error: uploadError } = await client.storage
    .from(config.bucket)
    .upload(markerPath, Buffer.from(`${JSON.stringify(marker, null, 2)}\n`), {
      contentType: 'application/json',
      cacheControl: '60',
      upsert: true,
    });
  if (uploadError) throw uploadError;
  return verifyFeed(config);
}

async function cleanupQaBucket(config) {
  if (!/^desktop-updates-qa-[a-z0-9-]+$/.test(config.bucket)) {
    throw new Error('Cleanup is restricted to desktop-updates-qa-* buckets');
  }
  const client = storageClient(config);
  const { error: emptyError } = await client.storage.emptyBucket(config.bucket);
  if (emptyError) throw emptyError;
  const { error: deleteError } = await client.storage.deleteBucket(config.bucket);
  if (deleteError) throw deleteError;
  return { ok: true, deletedBucket: config.bucket };
}

async function verifyFeed(config, options = {}) {
  const markerUrl = publicObjectUrl(config.feedUrl, 'feed-ready.json');
  const response = await fetch(`${markerUrl}?check=${Date.now()}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Update feed marker returned HTTP ${response.status}`);
  }
  const marker = await response.json();
  if (
    marker?.schema !== 1 ||
    marker?.appId !== packageJson.build?.appId ||
    marker?.bucket !== config.bucket ||
    marker?.channel !== config.channel ||
    marker?.feedUrl !== config.feedUrl
  ) {
    throw new Error('Update feed marker does not match this application');
  }
  let manifest = null;
  if (options.requireManifest === true) {
    const manifestName =
      config.channel === 'latest' ? 'latest.yml' : `${config.channel}.yml`;
    const manifestUrl = publicObjectUrl(config.feedUrl, manifestName);
    const manifestResponse = await fetch(
      `${manifestUrl}?check=${Date.now()}`,
      {
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!manifestResponse.ok) {
      throw new Error(
        `Update manifest ${manifestName} returned HTTP ${manifestResponse.status}`,
      );
    }
    const parsed = parseYaml(await manifestResponse.text());
    const version = String(parsed?.version || '').trim();
    const artifactPath = String(
      parsed?.path || parsed?.files?.[0]?.url || '',
    ).trim();
    if (!version || !artifactPath) {
      throw new Error(`${manifestName} thiếu version/path`);
    }
    if (version !== String(packageJson.version)) {
      throw new Error(
        `${manifestName} version ${version} không khớp package.json ${packageJson.version}`,
      );
    }
    const artifactUrl = publicObjectUrl(config.feedUrl, artifactPath);
    const artifactResponse = await fetch(artifactUrl, {
      method: 'HEAD',
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    if (!artifactResponse.ok) {
      throw new Error(
        `Update artifact ${artifactPath} returned HTTP ${artifactResponse.status}`,
      );
    }
    manifest = {
      manifestUrl,
      version,
      artifactPath,
      artifactUrl,
    };
  }
  return {
    ok: true,
    feedUrl: config.feedUrl,
    markerUrl,
    marker,
    manifest,
  };
}

function signatureFor(filePath) {
  if (process.platform !== 'win32') {
    throw new Error('Authenticode verification must run on Windows');
  }
  const powershell = [
    "$sig = Get-AuthenticodeSignature -LiteralPath $env:AINOVEL_SIGNATURE_TARGET",
    "if ($null -eq $sig) { throw 'No signature result' }",
    '$signerName = if ($sig.SignerCertificate) { $sig.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) } else { $null }',
    '[pscustomobject]@{ status=[string]$sig.Status; signerName=$signerName; subject=$sig.SignerCertificate.Subject; thumbprint=$sig.SignerCertificate.Thumbprint; timestamped=($null -ne $sig.TimeStamperCertificate); statusMessage=$sig.StatusMessage } | ConvertTo-Json -Compress',
  ].join('; ');
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', powershell],
    {
      cwd: root,
      env: { ...process.env, AINOVEL_SIGNATURE_TARGET: filePath },
      encoding: 'utf8',
      windowsHide: true,
    },
  );
  if (result.status !== 0) {
    throw new Error(`Authenticode probe failed: ${String(result.stderr || '').trim()}`);
  }
  return JSON.parse(String(result.stdout || '').trim());
}

async function hashFileBase64(filePath, algorithm) {
  const hash = crypto.createHash(algorithm);
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', resolve);
  });
  return hash.digest('base64');
}

async function inspectRelease(config) {
  const releaseDir = path.resolve(root, arg('dir', 'dist'));
  const allowUnsigned = hasFlag('allow-unsigned');
  const manifestName = `${config.channel}.yml`;
  let manifestPath = path.join(releaseDir, manifestName);
  // Always rewrite canonical latest.yml (builder/portable formats drift; version must exist)
  {
    const gen = spawnSync(
      process.execPath,
      [
        path.join(root, 'scripts', 'generate-update-manifest.mjs'),
        '--dir',
        releaseDir,
        '--channel',
        config.channel,
        '--version',
        packageJson.version,
        '--strict',
      ],
      { cwd: root, encoding: 'utf8', windowsHide: true },
    );
    if (gen.status !== 0) {
      throw new Error(
        `generate-update-manifest failed: ${String(gen.stderr || gen.stdout || '').trim()}`,
      );
    }
    manifestPath = path.join(releaseDir, manifestName);
  }
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing update manifest: ${manifestPath}`);
  }
  const manifestText = fs.readFileSync(manifestPath, 'utf8');
  const manifest = parseYaml(manifestText);
  if (String(manifest?.version || '') !== String(packageJson.version)) {
    throw new Error(
      `Manifest version ${manifest?.version || 'missing'} does not match package ${packageJson.version}`,
    );
  }
  const artifacts = extractManifestArtifacts(manifest);
  const expectedPublisher = String(config.env.WIN_CSC_PUBLISHER_NAME || '').trim();
  const expectedThumbprint = String(
    config.env.WIN_CSC_CERTIFICATE_SHA1 || '',
  ).trim();

  for (const artifact of artifacts) {
    const filePath = path.join(releaseDir, artifact.name);
    if (!fs.existsSync(filePath)) throw new Error(`Missing release artifact: ${artifact.name}`);
    const stat = fs.statSync(filePath);
    if (stat.size !== artifact.size) {
      throw new Error(`${artifact.name} size mismatch: manifest=${artifact.size}, disk=${stat.size}`);
    }
    const digest = await hashFileBase64(filePath, 'sha512');
    if (digest !== artifact.sha512) {
      throw new Error(`${artifact.name} SHA-512 mismatch`);
    }
    if (artifact.executable && !allowUnsigned) {
      validatePublisherIdentity(
        signatureFor(filePath),
        expectedPublisher,
        expectedThumbprint,
      );
    }
    artifact.filePath = filePath;
  }

  const unpackedExecutable = path.join(
    releaseDir,
    'win-unpacked',
    `${packageJson.build?.productName}.exe`,
  );
  if (!fs.existsSync(unpackedExecutable)) {
    throw new Error(`Missing packaged application executable: ${unpackedExecutable}`);
  }
  if (!allowUnsigned) {
    validatePublisherIdentity(
      signatureFor(unpackedExecutable),
      expectedPublisher,
      expectedThumbprint,
    );
  } else {
    console.warn(
      '[publish] --allow-unsigned: skipping Authenticode (QA / no cert yet)',
    );
  }

  const uploadFiles = [...artifacts];
  for (const artifact of artifacts) {
    const blockmapName = `${artifact.name}.blockmap`;
    const blockmapPath = path.join(releaseDir, blockmapName);
    if (fs.existsSync(blockmapPath)) {
      const blockmapSize = fs.statSync(blockmapPath).size;
      const blockmapSha512 = await hashFileBase64(blockmapPath, 'sha512');
      uploadFiles.push({
        name: blockmapName,
        filePath: blockmapPath,
        size: blockmapSize,
        sha512: blockmapSha512,
        executable: false,
      });
    }
  }

  return {
    releaseDir,
    manifest,
    manifestName,
    manifestPath,
    manifestText,
    uploadFiles,
    expectedPublisher,
    expectedThumbprint,
    allowUnsigned,
  };
}

async function uploadSmall(client, config, file, { upsert = false } = {}) {
  const objectName = `${config.channel}/${file.name}`;
  const { error } = await client.storage
    .from(config.bucket)
    .upload(objectName, fs.readFileSync(file.filePath), {
      contentType: contentTypeFor(file.name),
      cacheControl: file.name.endsWith('.yml') ? '60' : '31536000',
      upsert,
    });
  if (error) throw error;
}

async function uploadLarge(config, file) {
  const projectRef = new URL(config.supabaseUrl).hostname.split('.')[0];
  const endpoint = `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`;
  try {
    await new Promise((resolve, reject) => {
      const upload = new tus.Upload(fs.createReadStream(file.filePath), {
        endpoint,
        uploadSize: file.size,
        retryDelays: [0, 3_000, 5_000, 10_000, 20_000],
        headers: {
          authorization: `Bearer ${config.serviceKey}`,
          apikey: config.serviceKey,
        },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        storeFingerprintForResuming: false,
        metadata: {
          bucketName: config.bucket,
          objectName: `${config.channel}/${file.name}`,
          contentType: contentTypeFor(file.name),
          cacheControl: '31536000',
        },
        onError: reject,
        onProgress(bytesUploaded, bytesTotal) {
          const percent =
            bytesTotal > 0 ? Math.floor((bytesUploaded / bytesTotal) * 100) : 0;
          process.stdout.write(`\r[upload] ${file.name} ${percent}%`);
        },
        onSuccess() {
          process.stdout.write(`\r[upload] ${file.name} 100%\n`);
          resolve();
        },
      });
      upload.start();
    });
    return;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Free-tier / project max often 50MB — TUS returns 413 Maximum size exceeded
    if (/413|maximum size|Payload too large|too large/i.test(msg)) {
      throw new Error(
        `Upload ${file.name} (${Math.round(file.size / 1024 / 1024)}MB) bị chặn bởi giới hạn dung lượng Supabase Storage (HTTP 413).\n` +
          `Cách sửa (bắt buộc cho installer ~100–200MB):\n` +
          `  1) Supabase Dashboard → Project Settings → Storage → Global file size limit → đặt ≥ 500 MB (hoặc 524288000 bytes)\n` +
          `  2) Storage → bucket desktop-updates → (tuỳ chọn) File size limit ≥ 500MB\n` +
          `  3) Chạy lại: npm run release:publish:unsigned\n` +
          `Chi tiết gốc: ${msg}`,
      );
    }
    throw err;
  }
}

async function readPublishedEvidence(config, file, { allowMissing = false } = {}) {
  const url = publicObjectUrl(config.feedUrl, file.name);
  const response = await fetch(`${url}?release=${encodeURIComponent(packageJson.version)}-${Date.now()}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(10 * 60_000),
  });
  // Supabase public Storage may return 400 for missing objects (not only 404)
  if (allowMissing && (response.status === 404 || response.status === 400)) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`${file.name} public verification returned HTTP ${response.status}`);
  }
  if (!response.body) throw new Error(`${file.name} public response has no body`);
  const hash = crypto.createHash('sha512');
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    hash.update(chunk);
  }
  const evidence = { size, sha512: hash.digest('base64') };
  validateArtifactEvidence(file, evidence);
  return { url, ...evidence };
}

async function publishImmutableArtifact(client, config, file) {
  const existing = await readPublishedEvidence(config, file, { allowMissing: true });
  if (existing) {
    console.log(`[upload] ${file.name} already published with identical bytes`);
    return existing.url;
  }
  if (file.size > 6 * 1024 * 1024) await uploadLarge(config, file);
  else await uploadSmall(client, config, file, { upsert: false });
  return (await readPublishedEvidence(config, file)).url;
}

async function publishRelease(config) {
  await verifyFeed(config);
  const release = await inspectRelease(config);
  const client = storageClient(config);
  const published = [];

  // Publish immutable/versioned artifacts before the mutable channel manifest.
  for (const file of release.uploadFiles) {
    published.push(await publishImmutableArtifact(client, config, file));
  }

  // latest.yml/beta.yml/dev.yml is the commit point clients observe.
  const manifestFile = {
    name: release.manifestName,
    filePath: release.manifestPath,
    size: fs.statSync(release.manifestPath).size,
    sha512: await hashFileBase64(release.manifestPath, 'sha512'),
  };
  await uploadSmall(client, config, manifestFile, { upsert: true });
  const manifestUrl = (await readPublishedEvidence(config, manifestFile)).url;
  published.push(manifestUrl);

  return {
    ok: true,
    version: packageJson.version,
    publisher: release.expectedPublisher,
    feedUrl: config.feedUrl,
    manifestUrl,
    published,
  };
}

async function verifyRelease(config) {
  await verifyFeed(config);
  const release = await inspectRelease(config);
  return {
    ok: true,
    version: packageJson.version,
    publisher: release.expectedPublisher,
    certificateSha1: release.expectedThumbprint.replace(/\s/g, '').toUpperCase(),
    feedUrl: config.feedUrl,
    artifacts: release.uploadFiles.map((file) => ({
      name: file.name,
      size: file.size,
      sha512: file.sha512,
    })),
  };
}

async function main() {
  const modes = [
    'provision',
    'verify-feed',
    'verify-release',
    'publish',
    'cleanup-bucket',
  ].filter(hasFlag);
  if (modes.length !== 1) {
    throw new Error(
      'Choose exactly one: --provision, --verify-feed, --verify-release, --publish, or --cleanup-bucket',
    );
  }
  const config = releaseConfig({
    requireServiceKey:
      modes[0] === 'provision' ||
      modes[0] === 'publish' ||
      modes[0] === 'cleanup-bucket',
  });
  let result;
  if (modes[0] === 'provision') result = await ensurePublicBucket(config);
  else if (modes[0] === 'verify-feed') {
    result = await verifyFeed(config, { requireManifest: true });
  }
  else if (modes[0] === 'verify-release') result = await verifyRelease(config);
  else if (modes[0] === 'cleanup-bucket') result = await cleanupQaBucket(config);
  else result = await publishRelease(config);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(`[desktop-update] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
