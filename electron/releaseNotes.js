/**
 * Electron-side release notes (CommonJS — main process).
 * Mirrors src/lib/commercial/releaseNotes.ts logic without TS.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function parseSemverParts(v) {
  const core = String(v || '')
    .trim()
    .replace(/^v/i, '')
    .split(/[-+]/)[0];
  return core.split('.').map((p) => {
    const n = parseInt(String(p).replace(/\D/g, ''), 10);
    return Number.isFinite(n) ? n : 0;
  });
}

function compareSemver(a, b) {
  const pa = parseSemverParts(a);
  const pb = parseSemverParts(b);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

function loadReleaseNotesDoc() {
  const roots = [];
  try {
    if (process.resourcesPath) roots.push(process.resourcesPath);
  } catch {
    /* ignore */
  }
  try {
    roots.push(path.dirname(app.getAppPath()));
  } catch {
    /* ignore */
  }
  roots.push(process.cwd());
  for (const r of roots) {
    for (const rel of [
      path.join('commercial', 'release-notes.json'),
      path.join('resources', 'commercial', 'release-notes.json'),
    ]) {
      const p = path.join(r, rel);
      try {
        if (!fs.existsSync(p)) continue;
        const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (raw && raw.versions && typeof raw.versions === 'object') return raw;
      } catch {
        /* next */
      }
    }
  }
  return { versions: {} };
}

function normalizeFeedReleaseNotes(notes) {
  if (!notes) return [];
  if (typeof notes === 'string') {
    return notes
      .split(/\r?\n/)
      .map((l) => l.replace(/^[-*•]\s*/, '').trim())
      .filter((l) => l.length > 2);
  }
  if (Array.isArray(notes)) {
    const out = [];
    for (const n of notes) {
      if (typeof n === 'string') out.push(...normalizeFeedReleaseNotes(n));
      else if (n && typeof n === 'object' && n.note) {
        out.push(...normalizeFeedReleaseNotes(n.note));
      }
    }
    return out;
  }
  return [];
}

/**
 * Collect changelog for (from, to] sorted oldest → newest.
 */
function collectChangelogBetween(fromVersion, toVersion, doc) {
  const from = String(fromVersion || '').trim() || '0.0.0';
  const to = String(toVersion || '').trim();
  const versions = (doc && doc.versions) || {};
  const keys = Object.keys(versions).sort(compareSemver);
  const blocks = [];
  for (const ver of keys) {
    if (compareSemver(ver, from) <= 0) continue;
    if (to && compareSemver(ver, to) > 0) continue;
    const row = versions[ver] || {};
    const items = Array.isArray(row.items)
      ? row.items.map((s) => String(s || '').trim()).filter(Boolean)
      : [];
    if (!items.length) continue;
    blocks.push({
      version: ver,
      date: row.date || undefined,
      title: row.title || undefined,
      items,
    });
  }
  const items = blocks.flatMap((b) =>
    b.items.map((line) => `[${b.version}] ${line}`),
  );
  return {
    fromVersion: from,
    toVersion: to || from,
    blocks,
    items,
  };
}

function statePath() {
  return path.join(app.getPath('userData'), 'ainovel-update-state.json');
}

function readUpdateState() {
  try {
    const p = statePath();
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, 'utf8')) || {};
  } catch {
    return {};
  }
}

function writeUpdateState(partial) {
  const prev = readUpdateState();
  const next = { ...prev, ...partial, updatedAt: new Date().toISOString() };
  try {
    fs.writeFileSync(statePath(), JSON.stringify(next, null, 2), 'utf8');
  } catch (e) {
    console.warn('[updater] write state fail', e?.message || e);
  }
  return next;
}

/**
 * Detect first boot after version change → justUpdated payload.
 * Does not mark acknowledged (UI/ack does that).
 */
function detectJustUpdated(currentVersion) {
  const cur = String(currentVersion || app.getVersion()).trim();
  const state = readUpdateState();
  const lastSeen = String(state.lastSeenVersion || '').trim();
  const pendingFrom = String(state.pendingFromVersion || '').trim();
  const pendingTo = String(state.pendingToVersion || '').trim();

  // Already acknowledged this version
  if (lastSeen && lastSeen === cur && !state.forceShowChangelog) {
    return null;
  }

  // First install ever — seed lastSeen, no "updated" toast
  if (!lastSeen && !pendingFrom) {
    writeUpdateState({ lastSeenVersion: cur });
    return null;
  }

  const from =
    pendingFrom ||
    (lastSeen && lastSeen !== cur ? lastSeen : '') ||
    '';
  if (!from || from === cur) {
    // Same version re-open after ack path
    if (!lastSeen) writeUpdateState({ lastSeenVersion: cur });
    return null;
  }

  // Only show if we actually moved forward (or pending install completed)
  if (compareSemver(cur, from) <= 0 && pendingTo !== cur) {
    writeUpdateState({ lastSeenVersion: cur });
    return null;
  }

  const doc = loadReleaseNotesDoc();
  const collected = collectChangelogBetween(from, cur, doc);
  const feedLines = normalizeFeedReleaseNotes(
    state.pendingReleaseNotes || null,
  );
  // Prefer curated blocks; append feed lines not already covered
  const flatSet = new Set(collected.items.map((s) => s.toLowerCase()));
  for (const line of feedLines) {
    const key = line.toLowerCase();
    if (!flatSet.has(key)) {
      collected.items.push(line);
      flatSet.add(key);
    }
  }
  if (
    !collected.blocks.length &&
    !collected.items.length &&
    feedLines.length
  ) {
    collected.items = feedLines.map((l) => l);
    collected.blocks = [
      {
        version: cur,
        title: 'Ghi chú từ máy chủ cập nhật',
        items: feedLines,
      },
    ];
  }

  // Fallback if no notes file at all
  if (!collected.items.length) {
    collected.items = [
      `Đã nâng cấp từ ${from} lên ${cur}.`,
      'Xem chi tiết trên kênh phát hành / thông báo nhà phát triển.',
    ];
    collected.blocks = [
      {
        version: cur,
        title: 'Cập nhật ứng dụng',
        items: collected.items,
      },
    ];
  }

  return {
    fromVersion: from,
    toVersion: cur,
    blocks: collected.blocks,
    items: collected.items,
    releaseNotes:
      typeof state.pendingReleaseNotes === 'string'
        ? state.pendingReleaseNotes
        : null,
  };
}

function acknowledgeJustUpdated(currentVersion) {
  const cur = String(currentVersion || app.getVersion()).trim();
  return writeUpdateState({
    lastSeenVersion: cur,
    pendingFromVersion: null,
    pendingToVersion: null,
    pendingReleaseNotes: null,
    forceShowChangelog: false,
    acknowledgedAt: new Date().toISOString(),
  });
}

/** Call before quitAndInstall so next boot knows from→to */
function markPendingUpdate(fromVersion, toVersion, releaseNotes) {
  return writeUpdateState({
    pendingFromVersion: String(fromVersion || '').trim() || app.getVersion(),
    pendingToVersion: String(toVersion || '').trim() || null,
    pendingReleaseNotes: releaseNotes ?? null,
  });
}

module.exports = {
  compareSemver,
  collectChangelogBetween,
  loadReleaseNotesDoc,
  normalizeFeedReleaseNotes,
  detectJustUpdated,
  acknowledgeJustUpdated,
  markPendingUpdate,
  readUpdateState,
  writeUpdateState,
};
