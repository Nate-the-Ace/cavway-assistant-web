// Port of UART.cs: device commands over a transport.
import { parseShot } from './shot.js';
import { parseCaliInfo, parseCoeffBlock, encodeCaliInfo, encodeCoeffBlock } from './coeffs.js';
import { buildPackets, checksum, progressAfter } from './firmware.js';
import { crc16modbus } from './crc.js';

export const Command = { EnterCali: 0x30, QuitCali: 0x31, LaserOn: 0x36, LaserOff: 0x37, LaserTrig: 0x38 };
export const ADDR = { clock: 0x8000, serial: 0x8008, caliInfo: 0x9040, coeffs: 0x9080 };

export class ProtocolError extends Error {}

export function frame(payload) {
  const out = new Uint8Array(payload.length + 8);
  out.set([0x64, 0x61, 0x74, 0x61, 0x3a, payload.length & 0xff]); // "data:" + len
  out.set(payload, 6);
  out.set([0x0d, 0x0a], payload.length + 6);
  return out;
}

// Predicate for a 0x3D memory reply of `len` data bytes. When the buffer starts
// with an unsolicited data (0x01) or cali (0x02) packet, the reply is the first
// 0x3D that follows "\r\n", as in UART.readMemory.
export function memReplyPredicate(len) {
  return (buf) => {
    let ptr = 0;
    if (buf[0] === 0x01 || buf[0] === 0x02) {
      ptr = -1;
      for (let i = 3; i < buf.length; i++) {
        if (buf[i] === 0x3d && buf[i - 1] === 0x0a && buf[i - 2] === 0x0d) { ptr = i; break; }
      }
      if (ptr < 0) return -1;
    }
    return buf.length - ptr >= len + 4 ? ptr + len + 4 : -1;
  };
}

const memTimeout = (n) => Math.max(200, 8 + 2.5 * n) + 1000;

export class Device {
  constructor(transport) {
    this.t = transport;
    this._q = Promise.resolve();
  }

  // One operation at a time, like the modal C# forms.
  _run(fn) {
    const p = this._q.then(fn);
    this._q = p.catch(() => {});
    return p;
  }

  async _send(payload) {
    if (!this.t.isOpen) throw new ProtocolError('Device not connected');
    this.t.flushInput();
    await this.t.write(frame(payload));
  }

  async _memOp(payload, addr, len, timeoutMs) {
    await this._send(payload);
    const rx = await this.t.read(memReplyPredicate(len), timeoutMs);
    const r = rx.slice(rx.length - len - 4);
    if (r[0] !== 0x3d || r[1] !== (addr & 0xff) || r[2] !== ((addr >> 8) & 0xff)) {
      throw new ProtocolError('Bad reply from device');
    }
    return r.slice(4);
  }

  readMemory(addr, len) {
    return this._run(() => this._memOp(Uint8Array.of(0x3d, addr & 0xff, (addr >> 8) & 0xff, len), addr, len, memTimeout(len)));
  }

  writeMemory(addr, bytes) {
    return this._run(async () => {
      const cmd = new Uint8Array(bytes.length + 4);
      cmd.set([0x3e, addr & 0xff, (addr >> 8) & 0xff, bytes.length]);
      cmd.set(bytes, 4);
      const echo = await this._memOp(cmd, addr, bytes.length, memTimeout(bytes.length + 4));
      if (!echo.every((b, i) => b === bytes[i])) throw new ProtocolError('Device did not confirm the write');
    });
  }

  command(c) { return this._run(() => this._send(Uint8Array.of(c))); }

  // 0 when unreadable, as UART.readSerial.
  async readSerial() {
    try {
      const b = await this.readMemory(ADDR.serial, 4);
      return b[0] | (b[1] << 8);
    } catch { return 0; }
  }

  // Writes local wall-clock time as if it were UTC, as btnSyncTime_Click.
  syncTime(nowMs = Date.now(), tzOffsetMin = new Date(nowMs).getTimezoneOffset()) {
    const t = (Math.floor(nowMs / 1000) - tzOffsetMin * 60) >>> 0;
    return this.writeMemory(ADDR.clock, Uint8Array.of(t & 0xff, (t >>> 8) & 0xff, (t >>> 16) & 0xff, t >>> 24));
  }

  // Reads shots 0..count-1, stopping at the first empty slot. onShot(shot, i).
  async downloadShots(count, onShot = () => {}) {
    const shots = [];
    for (let i = 0; i < count; i++) {
      let bytes;
      try { bytes = await this.readMemory(i, 64); } catch (e) {
        e.shots = shots;
        throw e;
      }
      const shot = parseShot(bytes);
      if (!shot) break;
      shots.push(shot);
      onShot(shot, i);
    }
    return shots;
  }

  async downloadCali() {
    let infoBytes, coeffBytes;
    try { infoBytes = await this.readMemory(ADDR.caliInfo, 16); } catch (e) {
      throw new ProtocolError('Download calibration information failed', { cause: e });
    }
    try { coeffBytes = await this.readMemory(ADDR.coeffs, 128); } catch (e) {
      throw new ProtocolError('Download calibration coeffs failed', { cause: e });
    }
    return { info: parseCaliInfo(infoBytes), sensors: parseCoeffBlock(coeffBytes), serial: await this.readSerial() };
  }

  async uploadCali(cali) {
    try {
      await this.writeMemory(ADDR.caliInfo, encodeCaliInfo(cali.info));
      await this.writeMemory(ADDR.coeffs, encodeCoeffBlock(cali.sensors));
    } catch (e) {
      throw new ProtocolError('Upload coeff params failed!', { cause: e });
    }
  }

  // onProgress(percent). Stops at the first failure; no retries.
  upgradeFirmware(image, onProgress = () => {}) {
    return this._run(async () => {
      const packets = buildPackets(image);
      await this._send(Uint8Array.of(0x4b));
      const start = await this.t.read((b) => (b.length >= 2 ? 2 : -1), 3000).catch(() => null);
      if (!start || start[0] !== 0x4b || start[1] !== 0x01) throw new ProtocolError('Upgrade fail: device refused to start');
      onProgress(10);
      for (let i = 0; i < packets.length; i++) {
        const crc = crc16modbus(packets[i]);
        const p = new Uint8Array(133);
        p.set([0x4c, i & 0xff, (i >> 8) & 0xff]);
        p.set(packets[i], 3);
        p.set([crc & 0xff, crc >> 8], 131);
        await this._send(p);
        const r = await this.t.read((b) => (b.length >= 6 ? 6 : -1), 500).catch(() => null);
        if (!r || r[3] !== 0x00 || ((r[5] << 8) | r[4]) !== crc) {
          throw new ProtocolError(`Upgrade Fail at packet ${i} of ${packets.length}`);
        }
        onProgress(progressAfter(i + 1, image.length));
      }
      const sum = checksum(packets);
      await this._send(Uint8Array.of(0x4d, sum & 0xff, (sum >>> 8) & 0xff, (sum >>> 16) & 0xff, sum >>> 24));
      const end = await this.t.read((b) => (b.length >= 2 ? 2 : -1), 8000).catch(() => null);
      if (!end || end[0] !== 0x4d || end[1] !== 0x00) throw new ProtocolError('upgrade failed');
      onProgress(100);
    });
  }
}
