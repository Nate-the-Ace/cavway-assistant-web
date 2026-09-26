// A fake Cavway X1 built from our reading of the C# host code. Passing against
// it proves we match what the Windows app expects, not what the device does.
import { crc16modbus } from './crc.js';
import { G_SCALE, M_SCALE, FM } from './shot.js';
import { encodeCaliInfo, encodeCoeffBlock, emptySensor } from './coeffs.js';
import { Command } from './protocol.js';

const u16 = (v) => [v & 0xff, (v >> 8) & 0xff];

// Builds a 64-byte shot record from readable values.
export function encodeShot({ time, distance, azimuth, inclination, leg = true, flags = 7, absG = 1, absM = 48, dip = 60, err = null, seed = 1 }) {
  const s = new Uint8Array(64).fill(0);
  s[0] = 0x00;
  s[1] = (leg ? 0x00 : 0x80) | ((flags & 7) << 1) | 0x01;
  const d = Math.round(distance * 1000);
  s[2] = (d >> 16) & 0xff; s[3] = d & 0xff; s[4] = (d >> 8) & 0xff;
  s.set(u16(Math.round(((azimuth % 360) * 65535) / 360)), 5);
  s.set(u16(Math.round((inclination * 65535) / 360) & 0xffff), 7);
  s.set(u16(Math.round((absG * 1000 * FM) / G_SCALE)), 11);
  s.set(u16(Math.round((absM * 100 * FM) / M_SCALE)), 13);
  s.set(u16(Math.round((dip * 65535) / 360)), 15);
  s.set([time & 0xff, (time >>> 8) & 0xff, (time >>> 16) & 0xff, time >>> 24], 17);
  const az = (azimuth * Math.PI) / 180, inc = (inclination * Math.PI) / 180;
  for (let k = 0; k < 2; k++) {
    const j = 1 + ((seed * 7 + k * 13) % 40);
    const g = [Math.sin(inc) * 16000 + j, -Math.cos(inc) * 300 + j, Math.cos(inc) * 16000 - j];
    const m = [Math.cos(az) * 9000 + j, Math.sin(az) * 9000 - j, 12000 + j];
    [...g, ...m].forEach((v, i) => s.set(u16(Math.round(v) & 0xffff), 21 + k * 12 + i * 2));
  }
  s.fill(0xff, 45, 54);
  if (err) s.set(err, 45);
  return s;
}

// A passage: each leg is followed by a fan of splays round the new station,
// so the demo has walls to loft in 3D.
function demoShots(n, now) {
  const shots = [];
  let t = now - n * 40;
  let az = 40, inc = -10;
  for (let i = 0; shots.length < n; i++) {
    const k = shots.length;
    az = (az + ((i * 53) % 70) - 30 + 360) % 360;
    inc = Math.max(-40, Math.min(40, inc + ((i * 29) % 30) - 15));
    shots.push(encodeShot({
      time: (t += 45), distance: 3 + ((i * 1.37) % 5), azimuth: az, inclination: inc, leg: true,
      flags: i === 3 ? 0 : i === 5 ? 2 : 7, absG: 1 + ((i % 5) - 2) * 0.0015, absM: 48 + ((i % 7) - 3) * 0.2,
      dip: 60 + ((i % 3) - 1) * 0.3, err: i === 2 ? [0x7f, 0x10, 0x27, 0x80, 0x27, 0, 0, 0, 0] : null, seed: k,
    }));
    const a = (az * Math.PI) / 180, c = (inc * Math.PI) / 180;
    const d = [Math.sin(a) * Math.cos(c), Math.cos(a) * Math.cos(c), Math.sin(c)];
    const r = [Math.cos(a), -Math.sin(a), 0];
    const u = [d[1] * r[2] - d[2] * r[1], d[2] * r[0] - d[0] * r[2], d[0] * r[1] - d[1] * r[0]];
    const width = 1.2 + ((i * 0.7) % 2), height = 1 + ((i * 0.9) % 1.8);
    for (let j = 0; j < 6 && shots.length < n; j++) {
      const th = (j * Math.PI) / 3 + 0.2;
      const w = [0, 1, 2].map((q) => Math.cos(th) * width * r[q] + Math.sin(th) * height * u[q] + 0.1 * d[q]);
      const dist = Math.hypot(...w);
      shots.push(encodeShot({
        time: (t += 8), distance: dist, azimuth: ((Math.atan2(w[0], w[1]) * 180) / Math.PI + 360) % 360,
        inclination: (Math.asin(w[2] / dist) * 180) / Math.PI, leg: false, seed: shots.length,
      }));
    }
  }
  return shots;
}

export function demoCali(now) {
  const sensor = (k) => {
    const s = emptySensor();
    s.bG = [0.0123 + k * 0.001, -0.0045, 0.0071];
    s.bM = [-0.0312, 0.0187 - k * 0.002, 0.0405];
    s.aG = [[1.0012, 0.0021, -0.0008], [-0.0015, 0.9987, 0.0033], [0.0006, -0.0027, 1.0021]];
    s.aM = [[0.9876, 0.0112, -0.0043], [-0.0098, 1.0134, 0.0061], [0.0029, -0.0074, 0.9951]];
    return s;
  };
  return { sensors: [sensor(0), sensor(1)], info: { time: now - 86400 * 12, aver: 0.21, stddev: 0.09, max: 0.48, dip: 61.37 }, serial: 1234 };
}

export class Emulator {
  constructor({ shots = 70, serial = 1234, now = Math.floor(Date.now() / 1000) - new Date().getTimezoneOffset() * 60 } = {}) {
    this.shots = demoShots(shots, now);
    this.mem = new Uint8Array(0x2000).fill(0xff); // 0x8000..0x9FFF
    this.memSet(0x8000, [now & 0xff, (now >>> 8) & 0xff, (now >>> 16) & 0xff, now >>> 24]);
    this.memSet(0x8008, [serial & 0xff, serial >> 8, 0, 0]);
    const cali = demoCali(now);
    this.memSet(0x9040, encodeCaliInfo(cali.info));
    this.memSet(0x9080, encodeCoeffBlock(cali.sensors));
    this.laser = false;
    this.caliMode = false;
    this.fw = null;
    this.firmwareImage = null;
    // Fault injection
    this.strayBeforeReply = false;
    this.dropReplyNumber = null; // drop the Nth reply (1-based)
    this.corruptCrcAtPacket = null;
    this.replies = 0;
    this.pending = new Uint8Array(0);
  }

  memSet(addr, bytes) { this.mem.set(bytes, addr - 0x8000); }
  memGet(addr, len) {
    if (addr < 0x8000) {
      const s = this.shots[addr] ?? new Uint8Array(64).fill(0xff);
      const out = new Uint8Array(len).fill(0xff);
      out.set(s.slice(0, len));
      return out;
    }
    return this.mem.slice(addr - 0x8000, addr - 0x8000 + len);
  }

  // Host bytes in, reply chunks out.
  receive(bytes) {
    const buf = new Uint8Array(this.pending.length + bytes.length);
    buf.set(this.pending);
    buf.set(bytes, this.pending.length);
    const out = [];
    let p = 0;
    while (buf.length - p >= 8) {
      if (String.fromCharCode(...buf.slice(p, p + 5)) !== 'data:') { p++; continue; }
      const len = buf[p + 5];
      if (buf.length - p < len + 8) break;
      const reply = this.handle(buf.slice(p + 6, p + 6 + len));
      p += len + 8;
      if (!reply) continue;
      if (this.dropReplyNumber === ++this.replies) continue;
      if (this.strayBeforeReply && reply[0] === 0x3d) out.push(Uint8Array.of(0x01, ...new Array(16).fill(0x20), 0x0d, 0x0a));
      out.push(reply);
    }
    this.pending = buf.slice(p);
    return out;
  }

  handle(pl) {
    const addr = pl[1] | (pl[2] << 8);
    switch (pl[0]) {
      case 0x3d: return Uint8Array.of(0x3d, pl[1], pl[2], pl[3], ...this.memGet(addr, pl[3]));
      case 0x3e:
        if (addr >= 0x8000) this.memSet(addr, pl.slice(4, 4 + pl[3]));
        return Uint8Array.of(0x3d, pl[1], pl[2], pl[3], ...this.memGet(addr, pl[3]));
      case Command.LaserOn: this.laser = true; return null;
      case Command.LaserOff: this.laser = false; return null;
      case Command.LaserTrig: this.measure(); return null;
      case Command.EnterCali: this.caliMode = true; return null;
      case Command.QuitCali: this.caliMode = false; return null;
      case 0x4b: this.fw = { packets: [], sum: 0 }; return Uint8Array.of(0x4b, 0x01);
      case 0x4c: {
        const idx = pl[1] | (pl[2] << 8);
        const data = pl.slice(3, 131);
        let crc = crc16modbus(data);
        const sent = pl[131] | (pl[132] << 8);
        const ok = this.fw && crc === sent && idx === this.fw.packets.length;
        if (this.corruptCrcAtPacket === idx) crc ^= 0x5a5a;
        if (ok) { this.fw.packets.push(data); this.fw.sum = (this.fw.sum + sent) >>> 0; }
        return Uint8Array.of(0x4c, pl[1], pl[2], ok ? 0x00 : 0x01, crc & 0xff, crc >> 8);
      }
      case 0x4d: {
        const sum = (pl[1] | (pl[2] << 8) | (pl[3] << 16) | (pl[4] << 24)) >>> 0;
        const ok = this.fw && sum === this.fw.sum;
        if (ok) {
          this.firmwareImage = new Uint8Array(this.fw.packets.length * 128);
          this.fw.packets.forEach((d, i) => this.firmwareImage.set(d, i * 128));
        }
        this.fw = null;
        return Uint8Array.of(0x4d, ok ? 0x00 : 0x01);
      }
      default: return null;
    }
  }

  // Dropping DTR or RTS holds the device in reset; raising them boots it.
  setSignals({ dataTerminalReady, requestToSend }) {
    if (dataTerminalReady === false || requestToSend === false) {
      this.laser = false;
      this.caliMode = false;
      this.fw = null;
      this.pending = new Uint8Array(0);
      this.resets = (this.resets ?? 0) + 1;
    }
  }

  // Laser trigger stores a new leg at the next free slot.
  measure() {
    const clock = this.mem[0] | (this.mem[1] << 8) | (this.mem[2] << 16) | (this.mem[3] << 24);
    const i = this.shots.length;
    this.shots.push(encodeShot({ time: (clock >>> 0) + i * 30, distance: 2 + (i % 7) * 0.9, azimuth: (i * 41) % 360, inclination: (i % 11) * 3 - 15, seed: i }));
  }
}
