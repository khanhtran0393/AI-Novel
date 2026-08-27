'use strict';

const fs = require('fs');
const path = require('path');

function cloneDefault(value) {
  const resolved = typeof value === 'function' ? value() : value;
  if (resolved === undefined) return {};
  if (resolved === null || typeof resolved !== 'object') return resolved;
  return JSON.parse(JSON.stringify(resolved));
}

class JsonStore {
  constructor(file, defaultValue = {}) {
    this.file = path.resolve(file);
    this.defaultValue = defaultValue;
  }

  read() {
    try {
      const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return value === null || value === undefined ? cloneDefault(this.defaultValue) : value;
    } catch (_) { return cloneDefault(this.defaultValue); }
  }

  write(value) {
    const directory = path.dirname(this.file);
    const temporary = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
      fs.renameSync(temporary, this.file);
      return value;
    } catch (error) {
      try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch (_) {}
      throw error;
    }
  }

  update(mutator) {
    const current = this.read();
    const next = mutator(current);
    return this.write(next === undefined ? current : next);
  }
}

module.exports = { JsonStore };
