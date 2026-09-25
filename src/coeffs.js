// Port of FrmCali coefficient, calibration-info and .coe file handling.
import { FM, FV } from './shot.js';
import { fixed, general, FLOAT, DOUBLE, formatUtc, parseUtc } from './format.js';

const f32 = Math.fround;

// Byte offset -> [key, row|null, col, scale]; order as SetCoeffArray.
const LAYOUT = [];
for (const [b, a] of [['bG', 'aG'], ['bM', 'aM']]) {
  for (let r = 0; r < 3; r++) {
    LAYOUT.push([b, null, r, FV]);
    for (let c = 0; c < 3; c++) LAYOUT.push([a, r, c, FM]);
  }
}

export const emptySensor = () => ({
  bG: [0, 0, 0], bM: [0, 0, 0],
  aG: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], aM: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
});

export function parseSensor(bytes) {
  const s = emptySensor();
  LAYOUT.forEach(([k, r, c, scale], i) => {
    const v = ((bytes[2 * i + 1] << 8) | bytes[2 * i]) << 16 >> 16;
    if (r === null) s[k][c] = v / scale; else s[k][r][c] = v / scale;
  });
  return s;
}

// C# Math.Round: half to even.
function roundEven(v) {
  const r = Math.round(v);
  return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

export function encodeSensor(s) {
  const out = new Uint8Array(48);
  LAYOUT.forEach(([k, r, c, scale], i) => {
    const iv = roundEven((r === null ? s[k][c] : s[k][r][c]) * scale) & 0xffff;
    out[2 * i] = iv & 0xff;
    out[2 * i + 1] = iv >> 8;
  });
  return out;
}

// 128-byte coefficient block: sensor 1 at 0, sensor 2 at 64, rest 0xFF.
export function encodeCoeffBlock(sensors) {
  const out = new Uint8Array(128).fill(0xff);
  out.set(encodeSensor(sensors[0]), 0);
  out.set(encodeSensor(sensors[1]), 64);
  return out;
}

export const parseCoeffBlock = (b) => [parseSensor(b.slice(0, 64)), parseSensor(b.slice(64, 128))];

// Info: { time (epoch s, UTC wall clock), aver, stddev, max, dip } as floats.
export function parseCaliInfo(b) {
  if (b[0] !== 0x55) return null;
  const v = (i) => f32((((b[i + 1] << 8) | b[i]) << 16 >> 16) / 100.0);
  return { time: (b[2] | (b[3] << 8) | (b[4] << 16) | (b[5] << 24)) >>> 0, aver: v(6), stddev: v(8), max: v(10), dip: v(12) };
}

export function encodeCaliInfo(info) {
  const out = new Uint8Array(16).fill(0xff);
  if (!info) return out;
  out.fill(0);
  out[0] = 0x55;
  out[1] = 0x01;
  const t = info.time >>> 0;
  out.set([t & 0xff, (t >>> 8) & 0xff, (t >>> 16) & 0xff, t >>> 24], 2);
  [info.aver, info.stddev, info.max, info.dip].forEach((x, k) => {
    const iv = Math.trunc(f32(f32(x) * 100)) & 0xffff;
    out[6 + 2 * k] = iv & 0xff;
    out[7 + 2 * k] = iv >> 8;
  });
  return out;
}

const vecLine = (v) => v.map((x) => general(x, DOUBLE)).join(',');

function sensorLines(s) {
  return [vecLine(s.bG), vecLine(s.bM), ...s.aG.map(vecLine), ...s.aM.map(vecLine)];
}

// cali: { sensors: [s1, s2], info: object|null, serial: int }
export function writeCoe(cali) {
  const lines = [...sensorLines(cali.sensors[0]), ...sensorLines(cali.sensors[1])];
  if (cali.info) {
    const i = cali.info;
    lines.push(formatUtc(i.time, 'yyyy-MM-dd HH:mm:ss'),
      general(i.aver, FLOAT), general(i.stddev, FLOAT), general(i.max, FLOAT), general(i.dip, FLOAT),
      String(cali.serial));
  }
  return lines.map((l) => l + '\r\n').join('');
}

export class CoeFormatError extends Error {}

const num = (s) => {
  const v = Number(s.trim());
  if (s.trim() === '' || Number.isNaN(v)) throw new CoeFormatError('Wrong coe file format');
  return v;
};
const tryFloat = (s) => {
  const v = Number((s ?? '').trim());
  return (s ?? '').trim() === '' || Number.isNaN(v) ? 0 : f32(v);
};

export function readCoe(text) {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (lines.length < 16 || lines[0].split(',').length > 3) throw new CoeFormatError('Wrong coe file format');
  const row = (i) => {
    const p = lines[i].split(',');
    if (p.length < 3) throw new CoeFormatError('Wrong coe file format');
    return [num(p[0]), num(p[1]), num(p[2])];
  };
  const sensor = (o) => ({ bG: row(o), bM: row(o + 1), aG: [row(o + 2), row(o + 3), row(o + 4)], aM: [row(o + 5), row(o + 6), row(o + 7)] });
  const cali = { sensors: [sensor(0), sensor(8)], info: null, serial: 0 };
  if (lines.length >= 21) {
    cali.info = {
      time: parseUtc(lines[16]) ?? 0,
      aver: tryFloat(lines[17]), stddev: tryFloat(lines[18]), max: tryFloat(lines[19]), dip: tryFloat(lines[20]),
    };
    if (lines.length === 22) cali.serial = /^\s*[+-]?\d+\s*$/.test(lines[21]) ? parseInt(lines[21], 10) : 0;
  }
  return cali;
}

// The two labels of FrmCali.ShowCeofff.
export function caliText(cali) {
  let info = 'Calibration info:\n';
  if (cali.info) {
    const i = cali.info;
    info += 'Calibration Time: ' + formatUtc(i.time, 'yyyy-MM-dd HH:mm') + '\n';
    info += 'Average Error:' + general(i.aver, FLOAT) + '\n';
    info += 'Error Stddev.:' + general(i.stddev, FLOAT) + '\n';
    info += 'Max Error:' + general(i.max, FLOAT) + '\n';
    info += 'Dip:' + general(i.dip, FLOAT) + '\n';
    if (cali.serial !== 0) info += 'Serial:' + cali.serial + '\n';
  }
  const f = (v) => v.map((x) => fixed(x, 4, DOUBLE)).join('  ');
  let co = '';
  cali.sensors.forEach((s, k) => {
    const n = k + 1;
    co += `Sensor${n}:\n`;
    co += `bG${n}:  ${f(s.bG)}\naG${n}:  ${f(s.aG[0])}\n      ${f(s.aG[1])}\n      ${f(s.aG[2])}\n\n`;
    co += `bM${n}:  ${f(s.bM)}\naM${n}:  ${f(s.aM[0])}\n      ${f(s.aM[1])}\n      ${f(s.aM[2])}\n\n`;
  });
  return { info, coeffs: co };
}
