'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Persistent local queue for offline reporting. Writes each report as a JSON
 * array file, deduplicates repeated local reports by fingerprint within a
 * time window, and rate-limits sends per fingerprint.
 */
class LocalQueue {
  constructor(file, options = {}) {
    this.file = path.resolve(file);
    this.maxSize = options.maxSize != null ? options.maxSize : 50;
    this.dedupWindowMs = options.dedupWindowMs != null ? options.dedupWindowMs : 60 * 60 * 1000;
    this.minIntervalMs = options.minIntervalMs != null ? options.minIntervalMs : 1000;
    this._lastSent = new Map();
  }

  read() {
    try {
      const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return Array.isArray(value) ? value : [];
    } catch (_) {
      return [];
    }
  }

  write(items) {
    const directory = path.dirname(this.file);
    const temporary = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(temporary, JSON.stringify(items, null, 2), 'utf8');
      fs.renameSync(temporary, this.file);
      return items;
    } catch (error) {
      try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch (_) {}
      throw error;
    }
  }

  enqueue(report) {
    const items = this.read();
    const fingerprint = report && report.fingerprint;
    const now = Date.now();
    const duplicate = items.some(
      (item) => item.fingerprint === fingerprint && (now - (item.queued_at || 0)) < this.dedupWindowMs,
    );
    if (duplicate) return { queued: false, reason: 'duplicate', count: items.length };
    const entry = { ...report, queued_at: now, id: `${now}-${Math.random().toString(36).slice(2, 8)}` };
    items.push(entry);
    const trimmed = items.slice(-this.maxSize);
    this.write(trimmed);
    return { queued: true, count: trimmed.length, id: entry.id };
  }

  peek() {
    return this.read();
  }

  remove(id) {
    const items = this.read().filter((item) => item.id !== id);
    this.write(items);
    return items.length;
  }

  allowSend(fingerprint) {
    const now = Date.now();
    const last = this._lastSent.get(fingerprint) || 0;
    if (now - last < this.minIntervalMs) return false;
    this._lastSent.set(fingerprint, now);
    return true;
  }
}

module.exports = { LocalQueue };