'use strict';

const { setTimeout: sleep } = require('timers/promises');

class CdpClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect(timeoutMs = 10000) {
    if (typeof WebSocket !== 'function') throw new Error('Node runtime does not provide the built-in WebSocket client.');
    const ws = new WebSocket(this.url);
    this.ws = ws;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out connecting to CDP WebSocket.')), timeoutMs);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP WebSocket connection failed.')); }, { once: true });
    });
    ws.addEventListener('message', (event) => this._message(String(event.data)));
    ws.addEventListener('close', () => {
      for (const { reject } of this.pending.values()) reject(new Error('CDP WebSocket closed.'));
      this.pending.clear();
    });
  }

  _message(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch (_) { return; }
    if (msg.id) {
      const waiter = this.pending.get(msg.id);
      if (!waiter) return;
      this.pending.delete(msg.id);
      clearTimeout(waiter.timer);
      if (msg.error) waiter.reject(new Error(`CDP ${msg.error.code}: ${msg.error.message}`));
      else waiter.resolve(msg.result || {});
      return;
    }
    const handlers = this.listeners.get(msg.method) || [];
    for (const handler of handlers) {
      try { handler(msg.params || {}); } catch (_) {}
    }
  }

  on(method, handler) {
    const handlers = this.listeners.get(method) || [];
    handlers.push(handler);
    this.listeners.set(method, handlers);
  }

  send(method, params = {}, timeoutMs = 15000) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('CDP is not connected.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP command timed out: ${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, timeoutMs = 15000) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    }, timeoutMs);
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Renderer evaluation failed.';
      throw new Error(detail);
    }
    return result.result ? result.result.value : undefined;
  }

  async waitFor(expression, description, timeoutMs = 30000, intervalMs = 200) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        const value = await this.evaluate(expression, Math.min(5000, timeoutMs));
        if (value) return value;
      } catch (error) { lastError = error; }
      await sleep(intervalMs);
    }
    throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ''}`);
  }

  async click(selector) {
    const encoded = JSON.stringify(selector);
    return this.evaluate(`(() => { const el = document.querySelector(${encoded}); if (!el) throw new Error('Missing element: ' + ${encoded}); el.scrollIntoView({block:'center'}); el.focus(); el.click(); return true; })()`);
  }

  async setValue(selector, value) {
    const encodedSelector = JSON.stringify(selector);
    const encodedValue = JSON.stringify(String(value));
    return this.evaluate(`(() => {
      const el = document.querySelector(${encodedSelector});
      if (!el) throw new Error('Missing element: ' + ${encodedSelector});
      el.scrollIntoView({block:'center'}); el.focus();
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, ${encodedValue});
      el.dispatchEvent(new Event('input', {bubbles:true}));
      el.dispatchEvent(new Event('change', {bubbles:true}));
      return el.value;
    })()`);
  }

  close() {
    try { if (this.ws) this.ws.close(); } catch (_) {}
  }
}

module.exports = { CdpClient };
