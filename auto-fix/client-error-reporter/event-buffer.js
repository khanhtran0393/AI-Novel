'use strict';

/**
 * Bounded in-memory event ring buffer.
 * Callers are responsible for sanitizing event parameters before recording.
 */
class EventBuffer {
  constructor(options = {}) {
    this.maxSize = Number.isInteger(options.maxSize) && options.maxSize > 0 ? options.maxSize : 200;
    this.sequenceId = options.sequenceId
      || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    this.events = [];
  }

  record(type, params = {}) {
    const event = {
      seq: this.events.length ? this.events[this.events.length - 1].seq + 1 : 1,
      ts: new Date().toISOString(),
      type: String(type || 'unknown'),
      params,
    };
    this.events.push(event);
    if (this.events.length > this.maxSize) {
      this.events.splice(0, this.events.length - this.maxSize);
    }
    return event;
  }

  snapshot() {
    return { sequence_id: this.sequenceId, events: this.events.slice() };
  }

  clear() {
    this.events = [];
  }

  get size() {
    return this.events.length;
  }
}

module.exports = { EventBuffer };