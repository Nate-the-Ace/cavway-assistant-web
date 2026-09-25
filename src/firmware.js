// Port of FrmFirmware: .bin header check and packetisation.
import { crc16modbus } from './crc.js';
import { formatUtc } from './format.js';

const BIN_ID = [0x11, 0x23, 0x55, 0x6e, 0x7c, 0xef, 0x6d, 0x5b];

// Returns { version, buildTime (epoch s, UTC) } or null if not a Cavway image.
export function checkHeader(bytes) {
  const h = new Uint8Array(256);
  h.set(bytes.slice(0, 256));
  if (!BIN_ID.every((b, i) => h[i] === b)) return null;
  return {
    version: `${h[12]}.${h[13]}.${h[14]}`,
    buildTime: ((h[8] << 24) | (h[9] << 16) | (h[10] << 8) | h[11]) >>> 0,
  };
}

export const headerText = (name, h) =>
  `Selected:\n${name}\nFirmware release time:${formatUtc(h.buildTime, 'yyyy-MM-dd HH:mm')}\nFirmware Version:${h.version}`;

// Mirrors the C# do/while: 128-byte reads padded with 0xFF, the first 256 bytes
// skipped, and one extra all-0xFF packet when the length is a multiple of 128.
export function buildPackets(bytes) {
  const packets = [];
  let offset = 0, pos = 0, res;
  do {
    const buf = new Uint8Array(128).fill(0xff);
    res = Math.min(128, bytes.length - pos);
    buf.set(bytes.slice(pos, pos + res));
    pos += res;
    if (offset >= 256) packets.push(buf);
    offset += 128;
  } while (res === 128);
  return packets;
}

export function checksum(packets) {
  let sum = 0;
  for (const p of packets) sum = (sum + crc16modbus(p)) >>> 0;
  return sum;
}

// Progress bar value after sending packet number `sent` (1-based), as C#.
export function progressAfter(sent, fileLength) {
  const per = Math.trunc((fileLength - 256) / 128);
  if (per <= 0) return 90;
  return Math.min(100, 10 + Math.trunc((sent * 80) / per));
}
