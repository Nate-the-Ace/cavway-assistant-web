// Port of Shot.cs: one 64-byte shot record from device memory.
import { fixed, FLOAT, formatUtc } from './format.js';

export const G_SCALE = 667;
export const M_SCALE = 4876;
export const FM = 16384;
export const FV = 24000;

const f32 = Math.fround;
const ABSSCALE = 10000;
const ANGLESCALE = f32(360.0 / 0xffff);
const i16 = (lo, hi) => ((hi << 8) | lo) << 16 >> 16;
const u16 = (lo, hi) => (hi << 8) | lo;

function parseErrInfo(e) {
  if (e[0] === 0xff) return 'No error';
  let res = '';
  let n = 0;
  const lo = () => u16(e[4 * n + 1], e[4 * n + 2]);
  const hi = () => u16(e[4 * n + 3], e[4 * n + 4]);
  const abs = (v) => fixed(f32(v / ABSSCALE), 4, FLOAT);
  const ang = (v) => fixed(f32(v * ANGLESCALE), 2, FLOAT);
  if (((e[0] >> 7) & 1) === 0) {
    res += 'absG error:' + ' absG1:' + abs(lo()) + ' ' + ' absG2:' + abs(hi()) + ' ';
    if (++n === 2) return res;
  }
  if (((e[0] >> 6) & 1) === 0) {
    res += 'absM error:' + ' absM1:' + abs(lo()) + ' ' + ' absM2:' + abs(hi()) + ' ';
    if (++n === 2) return res;
  }
  if (((e[0] >> 5) & 1) === 0) {
    res += 'dip error:' + ' err1:' + ang(lo() << 16 >> 16) + ' ' + ' err2:' + ang(hi() << 16 >> 16) + ' ';
    if (++n === 2) return res;
  }
  if (((e[0] >> 4) & 1) === 0) {
    res += 'angle error:' + ang(lo()) + ' ';
    if (++n === 2) return res;
  }
  return res;
}

// Returns null for an empty slot (byte 0 == 0xFF), which ends a download.
export function parseShot(s) {
  if (s[0] === 0xff) return null;
  const flg = s[1];
  const raw = (base) => ({ X: i16(s[base], s[base + 1]), Y: i16(s[base + 2], s[base + 3]), Z: i16(s[base + 4], s[base + 5]) });
  const errorBytes = Array.from(s.slice(45, 54));
  return {
    time: ((s[20] << 24) | (s[19] << 16) | (s[18] << 8) | s[17]) >>> 0,
    flgShot: flg,
    isLeg: (flg & 0x80) === 0,
    isCali: (flg & 0x01) === 0,
    flags: (flg >> 1) & 0x07,
    distance: f32(((s[2] << 16) | (s[4] << 8) | s[3]) / 1000),
    azimuth: f32((u16(s[5], s[6]) * 360) / 65535.0),
    inclination: f32((i16(s[7], s[8]) * 360) / 65535.0),
    absG: f32((u16(s[11], s[12]) * G_SCALE) / 1000.0 / FM),
    absM: f32((u16(s[13], s[14]) * M_SCALE) / 100.0 / FM),
    dip: f32((u16(s[15], s[16]) * 360) / 65535.0),
    rawG: [raw(21), raw(33)],
    rawM: [raw(27), raw(39)],
    errorBytes,
    errorInfo: parseErrInfo(errorBytes),
  };
}

export function flagText(shot) {
  let t = shot.isLeg ? 'leg' : shot.isCali ? 'cali' : 'splay';
  t += ['', ' (feature)', ' (ridge)', ' (backsight)', ' (generic)'][shot.flags + 1] ?? '';
  return t;
}

export const shotTimeText = (shot) => formatUtc(shot.time, 'yyyy/MM/dd HH:mm:ss');

export const COLUMNS = [
  'Time', 'Flag', 'Distance/m', 'Azimuth/deg', 'Inclination/deg', 'absG/g', 'absM/uT', 'dip/deg',
  'GX1', 'GY1', 'GZ1', 'MX1', 'MY1', 'MZ1', 'GX2', 'GY2', 'GZ2', 'MX2', 'MY2', 'MZ2', 'Error Infos',
];

const rawCells = (shot) => [0, 1].flatMap((j) => [
  shot.rawG[j].X, shot.rawG[j].Y, shot.rawG[j].Z, shot.rawM[j].X, shot.rawM[j].Y, shot.rawM[j].Z,
].map(String));

// Table cells exactly as FrmMain.Updatelistview.
export function tableRow(shot) {
  return [
    shotTimeText(shot), flagText(shot),
    fixed(shot.distance, 2, FLOAT), fixed(shot.azimuth, 1, FLOAT), fixed(shot.inclination, 1, FLOAT),
    fixed(shot.absG, 3, FLOAT), fixed(shot.absM, 2, FLOAT), fixed(shot.dip, 2, FLOAT),
    ...rawCells(shot), shot.errorInfo,
  ];
}

// CSV as FrmMain.btnExportData_Click: trailing comma on every header column.
export function shotsCsv(shots) {
  const lines = [COLUMNS.map((c) => c + ',').join('')];
  for (const s of shots) {
    lines.push([
      shotTimeText(s), flagText(s),
      fixed(s.distance, 3, FLOAT), fixed(s.azimuth, 2, FLOAT), fixed(s.inclination, 2, FLOAT),
      fixed(s.absG, 3, FLOAT), fixed(s.absM, 2, FLOAT), fixed(s.dip, 2, FLOAT),
      ...rawCells(s), s.errorInfo,
    ].join(','));
  }
  return lines.map((l) => l + '\r\n').join('');
}
