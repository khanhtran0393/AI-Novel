/**
 * Durable multi-path store core (Electron main process).
 * Survives Chromium localStorage wipe, origin changes, and partial LevelDB corruption.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const ZUSTAND_STORE_KEY = 'novel_generator_v2_store';
const MAX_HISTORY = 12;

const SECRET_KEYS = [
  'apiKey',
  'apiKeys',
  'openaiApiKey',
  'openaiApiKeys',
  'grokApiKey',
  'grokApiKeys',
  'lumaApiKey',
  'lumaApiKeys',
  'runwayApiKey',
  'runwayApiKeys',
  'falaiApiKey',
  'falaiApiKeys',
  'imageApiKey',
  'videoApiKey',
  'aiMasterApiKey',
  'googleStudioCookie',
  'googleStudioCookies',
  'ttsConfig',
];

function extractJsonObject(text, startIndex) {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIndex; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (char === '\\') escape = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(startIndex, i + 1);
    }
  }
  return '';
}

function scorePersistedStore(raw) {
  if (!raw || typeof raw !== 'string') {
    return { score: 0, chapterContentChars: 0, keyCount: 0, title: '' };
  }
  try {
    const parsed = JSON.parse(raw);
    const state = parsed?.state || parsed;
    const chapters = Array.isArray(state?.danh_sach_chuong) ? state.danh_sach_chuong : [];
    const chapterContentChars = chapters.reduce(
      (sum, chapter) => sum + String(chapter?.noi_dung || '').trim().length,
      0,
    );
    const readyChapters = chapters.filter(
      (chapter) => String(chapter?.noi_dung || '').trim().length > 0,
    ).length;
    const keyCount = [
      state?.apiKey,
      state?.openaiApiKey,
      state?.grokApiKey,
      state?.lumaApiKey,
      state?.runwayApiKey,
      state?.falaiApiKey,
      state?.imageApiKey,
      state?.videoApiKey,
      state?.aiMasterApiKey,
      state?.googleStudioCookie,
      ...(Array.isArray(state?.apiKeys) ? state.apiKeys : []),
      ...(Array.isArray(state?.openaiApiKeys) ? state.openaiApiKeys : []),
      ...(Array.isArray(state?.grokApiKeys) ? state.grokApiKeys : []),
      ...(Array.isArray(state?.lumaApiKeys) ? state.lumaApiKeys : []),
      ...(Array.isArray(state?.runwayApiKeys) ? state.runwayApiKeys : []),
      ...(Array.isArray(state?.falaiApiKeys) ? state.falaiApiKeys : []),
      ...(Array.isArray(state?.googleStudioCookies) ? state.googleStudioCookies : []),
    ].filter(Boolean).length;
    const generatedAssets =
      Object.keys(state?.generatedAudioPaths || {}).length +
      Object.keys(state?.generatedPrompts || {}).length +
      Object.keys(state?.generatedImages || {}).length +
      Object.keys(state?.generatedVideos || {}).length;
    const loreLen = String(state?.lorebook || '').trim().length;
    const outlineLen = String(state?.dan_y_tong_the || '').trim().length;
    const dnaLen = String(state?.visualDnaPrompt || '').trim().length;
    const styleLen = String(state?.mediaStylePreset || '').trim().length;
    const mediaFlags = [
      state?.imageProvider,
      state?.videoProvider,
      state?.imageAspectRatio,
      state?.videoAspectRatio,
      state?.ttsConfig,
    ].filter(Boolean).length;
    const settingsScore = Math.min(dnaLen, 3000) + Math.min(styleLen, 500) + mediaFlags * 40;

    return {
      score:
        chapterContentChars +
        readyChapters * 5000 +
        keyCount * 1000 +
        generatedAssets * 100 +
        (state?.giai_doan === 2 ? 2000 : 0) +
        (String(state?.ten_tac_pham || '').trim() ? 50 : 0) +
        Math.min(loreLen, 2000) +
        Math.min(outlineLen, 2000) +
        settingsScore,
      chapterContentChars,
      keyCount,
      title: String(state?.ten_tac_pham || ''),
    };
  } catch {
    return { score: 0, chapterContentChars: 0, keyCount: 0, title: '' };
  }
}

function getPaths(userData, appRoot) {
  const documents = (() => {
    try {
      return path.join(os.homedir(), 'Documents');
    } catch {
      return path.join(os.homedir());
    }
  })();

  return {
    primary: path.join(userData, 'novel_store_backup.json'),
    latest: path.join(userData, 'store', 'latest.json'),
    secrets: path.join(userData, 'store', 'secrets.json'),
    historyDir: path.join(userData, 'store', 'history'),
    documents: path.join(documents, 'AINovel', 'novel_store_backup.json'),
    scratch: path.join(appRoot || process.cwd(), 'scratch', 'novel_store_backup.json'),
  };
}

function atomicWrite(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  try {
    fs.renameSync(tmp, filePath);
  } catch {
    // Windows: target may be locked — overwrite fallback
    fs.writeFileSync(filePath, content, 'utf8');
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
  }
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) return null;
    JSON.parse(raw);
    return raw;
  } catch {
    return null;
  }
}

function extractSecretsFromRaw(raw) {
  try {
    const parsed = JSON.parse(raw);
    const state = parsed?.state || parsed;
    if (!state || typeof state !== 'object') return null;
    const secrets = {};
    for (const key of SECRET_KEYS) {
      if (state[key] !== undefined && state[key] !== null && state[key] !== '') {
        secrets[key] = state[key];
      }
    }
    return Object.keys(secrets).length ? secrets : null;
  } catch {
    return null;
  }
}

function mergeSecretsIntoRaw(raw, secrets) {
  if (!secrets || typeof secrets !== 'object') return raw;
  try {
    const parsed = JSON.parse(raw);
    const hasWrapper = parsed && typeof parsed === 'object' && parsed.state;
    const state = hasWrapper ? { ...parsed.state } : { ...parsed };
    let changed = false;
    for (const key of SECRET_KEYS) {
      const incoming = secrets[key];
      if (incoming === undefined || incoming === null || incoming === '') continue;
      const current = state[key];
      const currentEmpty =
        current === undefined ||
        current === null ||
        current === '' ||
        (Array.isArray(current) && current.length === 0);
      if (currentEmpty) {
        state[key] = incoming;
        changed = true;
      } else if (Array.isArray(current) && Array.isArray(incoming)) {
        const merged = Array.from(new Set([...current, ...incoming].filter(Boolean)));
        if (merged.length > current.length) {
          state[key] = merged;
          changed = true;
        }
      }
    }
    if (!changed) return raw;
    if (hasWrapper) return JSON.stringify({ ...parsed, state });
    return JSON.stringify(state);
  } catch {
    return raw;
  }
}

function isCatastrophicWipe(existingScore, newScore) {
  return existingScore > 500 && newScore < existingScore * 0.25 && newScore < 500;
}

function rotateHistory(historyDir, raw) {
  try {
    fs.mkdirSync(historyDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(historyDir, `store-${stamp}.json`);
    atomicWrite(file, raw);
    const files = fs
      .readdirSync(historyDir)
      .filter((f) => f.startsWith('store-') && f.endsWith('.json'))
      .map((f) => ({ f, p: path.join(historyDir, f), m: fs.statSync(path.join(historyDir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    for (const old of files.slice(MAX_HISTORY)) {
      try {
        fs.unlinkSync(old.p);
      } catch {
        // ignore
      }
    }
  } catch (err) {
    console.warn('[DurableStore] history rotate failed:', err?.message || err);
  }
}

function writeAll(paths, raw, { history = true } = {}) {
  const summary = scorePersistedStore(raw);
  if (summary.score <= 0) {
    return { ok: false, error: 'score_zero', summary };
  }

  const existingPrimary = readJsonFile(paths.primary);
  const existingScore = scorePersistedStore(existingPrimary).score;
  if (isCatastrophicWipe(existingScore, summary.score)) {
    return { ok: false, error: 'blocked_wipe', summary: scorePersistedStore(existingPrimary) };
  }

  const targets = [paths.primary, paths.latest, paths.documents, paths.scratch];
  const written = [];
  for (const target of targets) {
    try {
      atomicWrite(target, raw);
      written.push(target);
    } catch (err) {
      console.warn('[DurableStore] write failed:', target, err?.message || err);
    }
  }

  const secrets = extractSecretsFromRaw(raw);
  if (secrets) {
    try {
      atomicWrite(paths.secrets, JSON.stringify(secrets, null, 2));
    } catch (err) {
      console.warn('[DurableStore] secrets write failed:', err?.message || err);
    }
  }

  if (history) rotateHistory(paths.historyDir, raw);

  return {
    ok: written.length > 0,
    written,
    summary,
    primary: paths.primary,
  };
}

function readBest(paths) {
  const candidates = [];
  const files = [
    paths.primary,
    paths.latest,
    paths.documents,
    paths.scratch,
  ];

  // history snapshots
  try {
    if (fs.existsSync(paths.historyDir)) {
      const hist = fs
        .readdirSync(paths.historyDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => path.join(paths.historyDir, f));
      files.push(...hist);
    }
  } catch {
    // ignore
  }

  for (const file of files) {
    const raw = readJsonFile(file);
    if (!raw) continue;
    const summary = scorePersistedStore(raw);
    if (summary.score <= 0) continue;
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(file).mtimeMs;
    } catch {
      // ignore
    }
    candidates.push({ raw, summary, source: file, mtimeMs });
  }

  candidates.sort((a, b) => {
    if (b.summary.score !== a.summary.score) return b.summary.score - a.summary.score;
    return b.mtimeMs - a.mtimeMs;
  });

  let best = candidates[0] || null;
  if (!best) return null;

  // Merge secrets if full store lost API keys
  const secretsRaw = readJsonFile(paths.secrets);
  if (secretsRaw) {
    try {
      const secrets = JSON.parse(secretsRaw);
      const merged = mergeSecretsIntoRaw(best.raw, secrets);
      if (merged !== best.raw) {
        best = {
          ...best,
          raw: merged,
          summary: scorePersistedStore(merged),
          source: `${best.source}+secrets`,
        };
      }
    } catch {
      // ignore
    }
  }

  return best;
}

function listLevelDbDirs(userData) {
  const dirs = [];
  const primary = path.join(userData, 'Local Storage', 'leveldb');
  if (fs.existsSync(primary)) dirs.push(primary);

  // Named partitions (e.g. persist:ainovel-v1)
  const partitionsRoot = path.join(userData, 'Partitions');
  try {
    if (fs.existsSync(partitionsRoot)) {
      for (const name of fs.readdirSync(partitionsRoot)) {
        const p = path.join(partitionsRoot, name, 'Local Storage', 'leveldb');
        if (fs.existsSync(p)) dirs.push(p);
      }
    }
  } catch {
    // ignore
  }
  return dirs;
}

/**
 * Aggressive LevelDB recovery: scan binary as latin1 + utf8 to survive encoding quirks.
 * Scans default session + all named partitions.
 */
function recoverFromLevelDb(userData) {
  const candidates = [];
  const levelDbDirs = listLevelDbDirs(userData);
  if (!levelDbDirs.length) return null;

  const files = [];
  for (const levelDbDir of levelDbDirs) {
    try {
      for (const f of fs.readdirSync(levelDbDir)) {
        if (f.endsWith('.ldb') || f.endsWith('.log') || f.endsWith('.sst')) {
          files.push(path.join(levelDbDir, f));
        }
      }
    } catch {
      // ignore
    }
  }

  for (const file of files) {
    let buf;
    try {
      buf = fs.readFileSync(file);
    } catch {
      continue;
    }

    // latin1 preserves byte-for-byte; also try utf8 lossy
    const texts = [buf.toString('latin1'), buf.toString('utf8')];
    for (const text of texts) {
      let searchFrom = 0;
      while (searchFrom < text.length) {
        const keyIndex = text.indexOf(ZUSTAND_STORE_KEY, searchFrom);
        if (keyIndex === -1) break;

        // Prefer canonical zustand envelope
        let jsonStart = text.indexOf('{"state"', keyIndex);
        if (jsonStart === -1 || jsonStart - keyIndex > 20000) {
          jsonStart = text.indexOf('{"state":', keyIndex);
        }
        if (jsonStart !== -1 && jsonStart - keyIndex < 20000) {
          const raw = extractJsonObject(text, jsonStart);
          const summary = scorePersistedStore(raw);
          if (raw && summary.score > 0) {
            let mtimeMs = 0;
            try {
              mtimeMs = fs.statSync(file).mtimeMs;
            } catch {
              // ignore
            }
            candidates.push({ raw, summary, source: `leveldb:${path.basename(file)}`, mtimeMs });
          }
        }

        // Fallback: any JSON object near the key that contains danh_sach_chuong
        const brace = text.indexOf('{', keyIndex);
        if (brace !== -1 && brace - keyIndex < 5000) {
          const raw = extractJsonObject(text, brace);
          if (raw && raw.includes('danh_sach_chuong')) {
            // May be double-encoded string value — try unwrap
            let candidate = raw;
            if (raw.includes('\\"state\\"')) {
              try {
                const unescaped = JSON.parse(`"${raw.replace(/^"|"$/g, '')}"`);
                if (typeof unescaped === 'string' && unescaped.includes('"state"')) {
                  candidate = unescaped;
                }
              } catch {
                // keep raw
              }
            }
            const summary = scorePersistedStore(candidate);
            if (summary.score > 0) {
              let mtimeMs = 0;
              try {
                mtimeMs = fs.statSync(file).mtimeMs;
              } catch {
                // ignore
              }
              candidates.push({
                raw: candidate,
                summary,
                source: `leveldb-loose:${path.basename(file)}`,
                mtimeMs,
              });
            }
          }
        }

        searchFrom = keyIndex + ZUSTAND_STORE_KEY.length;
      }

      // Global scan for zustand envelopes even without key nearby
      let globalFrom = 0;
      while (globalFrom < text.length) {
        const idx = text.indexOf('{"state":', globalFrom);
        if (idx === -1) break;
        const raw = extractJsonObject(text, idx);
        if (raw && raw.includes(ZUSTAND_STORE_KEY.split('_')[0]) === false) {
          // still accept if it looks like our store
        }
        if (raw && (raw.includes('danh_sach_chuong') || raw.includes('apiKey') || raw.includes('ten_tac_pham'))) {
          const summary = scorePersistedStore(raw);
          if (summary.score > 100) {
            let mtimeMs = 0;
            try {
              mtimeMs = fs.statSync(file).mtimeMs;
            } catch {
              // ignore
            }
            candidates.push({
              raw,
              summary,
              source: `leveldb-global:${path.basename(file)}`,
              mtimeMs,
            });
          }
        }
        globalFrom = idx + 8;
      }
    }
  }

  candidates.sort((a, b) => {
    if (b.summary.score !== a.summary.score) return b.summary.score - a.summary.score;
    return b.mtimeMs - a.mtimeMs;
  });

  return candidates[0] || null;
}

function pickBestAmong(list) {
  const filtered = list.filter(Boolean);
  filtered.sort((a, b) => {
    const sa = a.summary?.score || 0;
    const sb = b.summary?.score || 0;
    if (sb !== sa) return sb - sa;
    return (b.mtimeMs || 0) - (a.mtimeMs || 0);
  });
  return filtered[0] || null;
}

module.exports = {
  ZUSTAND_STORE_KEY,
  SECRET_KEYS,
  scorePersistedStore,
  getPaths,
  writeAll,
  readBest,
  recoverFromLevelDb,
  mergeSecretsIntoRaw,
  extractSecretsFromRaw,
  isCatastrophicWipe,
  readJsonFile,
  pickBestAmong,
};
