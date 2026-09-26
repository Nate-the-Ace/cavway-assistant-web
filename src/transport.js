// Byte transports: Web Serial for the real X1, and an in-memory pipe to the emulator.

export class TimeoutError extends Error {
  constructor(msg = 'Device did not answer in time') { super(msg); this.name = 'TimeoutError'; }
}

const concat = (a, b) => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
};

class BufferedTransport {
  constructor() {
    this.buf = new Uint8Array(0);
    this.waiter = null;
    this.isOpen = false;
    this._traffic = [];
    this._disconnect = [];
  }
  onTraffic(cb) { this._traffic.push(cb); }
  onDisconnect(cb) { this._disconnect.push(cb); }
  _emit(dir, bytes) { for (const cb of this._traffic) cb(dir, bytes, new Date()); }
  _lost() {
    if (!this.isOpen) return;
    this.isOpen = false;
    if (this.waiter) this.waiter.fail(new Error('Device disconnected'));
    for (const cb of this._disconnect) cb();
  }
  _receive(bytes) {
    this._emit('rx', bytes);
    this.buf = concat(this.buf, bytes);
    this._check();
  }
  _check() {
    const w = this.waiter;
    if (!w) return;
    const n = w.predicate(this.buf);
    if (n < 0) return;
    const out = this.buf.slice(0, n);
    this.buf = this.buf.slice(n);
    w.done(out);
  }
  flushInput() { this.buf = new Uint8Array(0); }
  async setSignals() {}

  // Resolves with the first `predicate(buf)` bytes once it returns >= 0.
  read(predicate, timeoutMs) {
    if (this.waiter) return Promise.reject(new Error('Read already pending'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => w.fail(new TimeoutError()), timeoutMs);
      const finish = () => { clearTimeout(timer); this.waiter = null; };
      const w = {
        predicate,
        done: (b) => { finish(); resolve(b); },
        fail: (e) => { finish(); reject(e); },
      };
      this.waiter = w;
      this._check();
    });
  }
}

export const X1_FILTER = { usbVendorId: 0x1a86, usbProductId: 0x55d3 }; // WCH CH343

export class WebSerialTransport extends BufferedTransport {
  static supported() { return typeof navigator !== 'undefined' && 'serial' in navigator; }

  async open({ showAll = false } = {}) {
    this.port = await navigator.serial.requestPort(showAll ? {} : { filters: [X1_FILTER] });
    await this.port.open({ baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none' });
    this.writer = this.port.writable.getWriter();
    this.isOpen = true;
    this._onDisc = (e) => { if (e.target === this.port) this._lost(); };
    navigator.serial.addEventListener('disconnect', this._onDisc);
    this._loopDone = this._loop();
  }
  async _loop() {
    this.reader = this.port.readable.getReader();
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value?.length) this._receive(value);
      }
    } catch { /* port lost */ } finally {
      this.reader.releaseLock();
    }
    if (!this._closing) this._lost();
  }
  async write(bytes) {
    this._emit('tx', bytes);
    await this.writer.write(bytes);
  }
  setSignals(signals) { return this.port.setSignals(signals); }
  async close() {
    this._closing = true;
    this.isOpen = false;
    navigator.serial.removeEventListener('disconnect', this._onDisc);
    try { await this.reader?.cancel(); await this._loopDone; } catch { /* already gone */ }
    try { this.writer?.releaseLock(); await this.port?.close(); } catch { /* already gone */ }
  }
}

// In-memory pipe to an Emulator; latencyMs delays every reply.
export class FakeTransport extends BufferedTransport {
  constructor(emulator, { latencyMs = 5 } = {}) {
    super();
    this.emulator = emulator;
    this.latencyMs = latencyMs;
  }
  async open() { this.isOpen = true; }
  async write(bytes) {
    if (!this.isOpen) throw new Error('Port closed');
    this._emit('tx', bytes);
    for (const reply of this.emulator.receive(bytes)) {
      setTimeout(() => { if (this.isOpen) this._receive(reply); }, this.latencyMs);
    }
  }
  async close() { this.isOpen = false; }
  async setSignals(signals) {
    if (!this.isOpen) throw new Error('Port closed');
    this.emulator.setSignals?.(signals);
  }
  unplug() { this._lost(); }
}
