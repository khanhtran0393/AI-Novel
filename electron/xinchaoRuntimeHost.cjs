'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const SOURCE_MARKERS = [
  'package.json',
  'LICENSE',
  'backend/app/main.py',
  'src/app/App.tsx',
  'src-tauri/src/lib.rs',
];

const SOURCE_SKIP_DIRS = new Set([
  '.git',
  '.venv',
  'coverage',
  'dist',
  'node_modules',
  'target',
  'venv',
]);

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.mp3', 'audio/mpeg'],
  ['.mp4', 'video/mp4'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.ttf', 'font/ttf'],
  ['.wasm', 'application/wasm'],
  ['.wav', 'audio/wav'],
  ['.webm', 'video/webm'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

let activeHost = null;

function normalizedRoot(value) {
  if (!value) return '';
  try {
    return path.resolve(String(value));
  } catch {
    return '';
  }
}

function countSourceFiles(root) {
  let count = 0;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (SOURCE_SKIP_DIRS.has(entry.name)) continue;
        if (
          path.relative(root, absolute).replace(/\\/g, '/') ===
          'src-tauri/backend-bundle'
        ) {
          continue;
        }
        stack.push(absolute);
      } else if (entry.isFile() && !entry.name.endsWith('.tsbuildinfo')) {
        count += 1;
      }
    }
  }
  return count;
}

function inspectXinChaoRuntime(rootInput) {
  const root = normalizedRoot(rootInput);
  const missingMarkers = root
    ? SOURCE_MARKERS.filter((relative) => !fs.existsSync(path.join(root, relative)))
    : [...SOURCE_MARKERS];
  const distIndex = root ? path.join(root, 'dist', 'index.html') : '';
  const distPresent = Boolean(distIndex && fs.existsSync(distIndex));
  const nodeModulesPresent = Boolean(
    root && fs.existsSync(path.join(root, 'node_modules')),
  );
  const sourcePresent = missingMarkers.length === 0;

  return {
    root,
    sourcePresent,
    missingMarkers,
    sourceFiles: sourcePresent ? countSourceFiles(root) : 0,
    distIndex,
    distPresent,
    nodeModulesPresent,
    runnable: sourcePresent && (distPresent || nodeModulesPresent),
    mode: distPresent ? 'dist-http' : nodeModulesPresent ? 'vite' : 'missing',
  };
}

function resolveXinChaoRoot(options = {}) {
  const candidates = [
    options.isPackaged && options.resourcesPath
      ? path.join(options.resourcesPath, 'tools', 'xinchao-cut')
      : '',
    options.appDir ? path.join(options.appDir, 'tools', 'xinchao-cut') : '',
    options.cwd ? path.join(options.cwd, 'tools', 'xinchao-cut') : '',
  ]
    .map(normalizedRoot)
    .filter(Boolean);

  const seen = new Set();
  const unique = candidates.filter((candidate) => {
    const key = candidate.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  for (const candidate of unique) {
    if (inspectXinChaoRuntime(candidate).runnable) return candidate;
  }
  for (const candidate of unique) {
    if (inspectXinChaoRuntime(candidate).sourcePresent) return candidate;
  }
  return unique[0] || '';
}

function setRuntimeHeaders(res, absolutePath) {
  const ext = path.extname(absolutePath).toLowerCase();
  res.setHeader('Content-Type', MIME_TYPES.get(ext) || 'application/octet-stream');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (absolutePath.includes(`${path.sep}assets${path.sep}`)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else {
    res.setHeader('Cache-Control', 'no-cache');
  }
}

function resolveRequestFile(distRoot, requestUrl) {
  let pathname = '/';
  try {
    pathname = decodeURIComponent(new URL(requestUrl || '/', 'http://localhost').pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) return null;
  const relative = pathname.replace(/^\/+/, '') || 'index.html';
  const candidate = path.resolve(distRoot, relative);
  const prefix = `${path.resolve(distRoot)}${path.sep}`;
  if (candidate !== path.resolve(distRoot) && !candidate.startsWith(prefix)) return null;

  try {
    if (fs.statSync(candidate).isFile()) return candidate;
  } catch {
    // SPA navigation falls through to index.html.
  }
  if (!path.extname(relative)) {
    const index = path.join(distRoot, 'index.html');
    if (fs.existsSync(index)) return index;
  }
  return candidate;
}

function createStaticHandler(distRoot) {
  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }

    const absolutePath = resolveRequestFile(distRoot, req.url);
    if (!absolutePath) {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }

    let stat;
    try {
      stat = fs.statSync(absolutePath);
      if (!stat.isFile()) throw new Error('not a file');
    } catch {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    setRuntimeHeaders(res, absolutePath);
    res.setHeader('Content-Length', String(stat.size));
    res.statusCode = 200;
    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    const stream = fs.createReadStream(absolutePath);
    stream.on('error', () => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
    stream.pipe(res);
  };
}

async function stopXinChaoRuntimeHost() {
  const state = activeHost;
  activeHost = null;
  if (!state?.server) return;
  await new Promise((resolve) => {
    try {
      state.server.close(() => resolve());
      if (typeof state.server.closeAllConnections === 'function') {
        state.server.closeAllConnections();
      }
    } catch {
      resolve();
    }
  });
}

async function startXinChaoRuntimeHost(rootInput) {
  const runtime = inspectXinChaoRuntime(rootInput);
  if (!runtime.sourcePresent) {
    throw new Error(
      `XinChao-Cut source is incomplete: ${runtime.missingMarkers.join(', ')}`,
    );
  }
  if (!runtime.distPresent) {
    throw new Error(
      `XinChao-Cut production runtime is missing: ${runtime.distIndex}`,
    );
  }
  if (activeHost?.root === runtime.root && activeHost.server?.listening) {
    return {
      url: activeHost.url,
      root: activeHost.root,
      mode: 'dist-http',
    };
  }

  await stopXinChaoRuntimeHost();
  const distRoot = path.join(runtime.root, 'dist');
  const server = http.createServer(createStaticHandler(distRoot));
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('XinChao-Cut runtime host did not expose a TCP port');
  }
  const url = `http://127.0.0.1:${address.port}/`;
  activeHost = { root: runtime.root, server, url };
  return { url, root: runtime.root, mode: 'dist-http' };
}

module.exports = {
  inspectXinChaoRuntime,
  resolveXinChaoRoot,
  startXinChaoRuntimeHost,
  stopXinChaoRuntimeHost,
};
