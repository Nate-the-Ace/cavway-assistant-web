import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixed, general, FLOAT, formatUtc, parseUtc } from '../src/format.js';
import { crc16modbus } from '../src/crc.js';
import { parseShot, tableRow, shotsCsv, flagText, COLUMNS } from '../src/shot.js';
import { parseSensor, encodeSensor, encodeCaliInfo, parseCaliInfo, writeCoe, readCoe, caliText, CoeFormatError } from '../src/coeffs.js';
import { checkHeader, buildPackets, checksum, progressAfter } from '../src/firmware.js';
import { demoCali } from '../src/emulator.js';

test('fixed rounds half away from zero on .NET digits', () => {
  assert.equal(fixed(1.005, 2), '1.01'); // binary 1.00499.. but 15 digits say 1.00500
  assert.equal(fixed(2.5, 0), '3');
  assert.equal(fixed(-2.5, 0), '-3');
  assert.equal(fixed(-0.001, 2), '0.00');
  assert.equal(fixed(0, 3), '0.000');
  assert.equal(fixed(123.456, 1), '123.5');
  assert.equal(fixed(Math.fround(0.1), 9, FLOAT), '0.100000000');
  assert.equal(fixed(0.00004166, 4), '0.0000');
  assert.equal(fixed(99.96, 1), '100.0');
});

test('general matches .NET G15/G7', () => {
  assert.equal(general(0), '0');
  assert.equal(general(1 / 3), '0.333333333333333');
  assert.equal(general(1 / 24000), '4.16666666666667E-05');
  assert.equal(general(0.0001), '0.0001');
  assert.equal(general(-1.5), '-1.5');
  assert.equal(general(Math.fround(0.21), FLOAT), '0.21');
  assert.equal(general(Math.fround(61.37), FLOAT), '61.37');
  assert.equal(general(1e15), '1E+15');
});

test('utc date helpers', () => {
  assert.equal(formatUtc(1700000000, 'yyyy/MM/dd HH:mm:ss'), '2023/11/14 22:13:20');
  assert.equal(parseUtc('2023-11-14 22:13:20'), 1700000000);
  assert.equal(parseUtc('2023-02-30 00:00:00'), null);
});

test('crc16 modbus check value', () => {
  assert.equal(crc16modbus(new TextEncoder().encode('123456789')), 0x4b37);
});

function shotBytes() {
  const s = new Uint8Array(64);
  s[0] = 0x00;
  s[1] = 0x07; // leg (bit7 0), not cali (bit0 1), flags=3 generic
  s.set([0x01, 0x34, 0xe2], 2); // distance = 0x01<<16 | 0xe2<<8 | 0x34 = 123444 -> 123.444
  s.set([0x00, 0x40], 5); // az 0x4000 -> 90.0014
  s.set([0x00, 0xf0], 7); // inc int16 0xf000 = -4096 -> -22.5003
  s.set([0x00, 0x60], 11); // absG 24576*667/1000/16384 = 1.0005
  s.set([0x00, 0x40], 13); // absM 16384*4876/100/16384 = 48.76
  s.set([0x00, 0x2b], 15); // dip 0x2b00 = 11008 -> 60.4700
  s.set([0x00, 0xf1, 0x53, 0x65], 17); // 0x6553f100 = 1700000000
  s.set([0xff, 0xff], 21); // GX1 = -1
  s.fill(0xff, 45, 54);
  return s;
}

test('parseShot and table row', () => {
  const shot = parseShot(shotBytes());
  assert.equal(flagText(shot), 'leg (generic)');
  const row = tableRow(shot);
  assert.equal(row.length, COLUMNS.length);
  assert.deepEqual(row.slice(0, 9), ['2023/11/14 22:13:20', 'leg (generic)', '123.44', '90.0', '-22.5', '1.001', '48.76', '60.47', '-1']);
  assert.equal(row[20], 'No error');
  assert.equal(parseShot(new Uint8Array(64).fill(0xff)), null);
});

test('flag text variants', () => {
  const b = shotBytes();
  b[1] = 0x80 | (0 << 1) | 0x00; // not leg, cali, feature
  assert.equal(flagText(parseShot(b)), 'cali (feature)');
  b[1] = 0x80 | (7 << 1) | 0x01;
  assert.equal(flagText(parseShot(b)), 'splay');
});

test('error info text', () => {
  const b = shotBytes();
  b.set([0x3f, 0x10, 0x27, 0x80, 0x27, 0x00, 0x10, 0x00, 0xf0], 45); // absG + absM errors
  assert.equal(parseShot(b).errorInfo, 'absG error: absG1:1.0000  absG2:1.0112 absM error: absM1:0.4096  absM2:6.1440 ');
  b.set([0xdf, 0x00, 0x10, 0x00, 0xf0], 45); // dip error only
  assert.equal(parseShot(b).errorInfo, 'dip error: err1:22.50  err2:-22.50 ');
});

test('csv header and row', () => {
  const csv = shotsCsv([parseShot(shotBytes())]);
  const [h, r, end] = csv.split('\r\n');
  assert.equal(h, COLUMNS.join(',') + ',');
  assert.equal(r, '2023/11/14 22:13:20,leg (generic),123.444,90.00,-22.50,1.001,48.76,60.47,-1,0,0,0,0,0,0,0,0,0,0,0,No error');
  assert.equal(end, '');
});

test('coeff encode/parse round trip and rounding', () => {
  const s = demoCali(0).sensors[0];
  const back = parseSensor(encodeSensor(s));
  assert.ok(Math.abs(back.aG[1][1] - s.aG[1][1]) < 1 / 16384);
  assert.ok(Math.abs(back.bM[2] - s.bM[2]) < 1 / 24000);
  s.bG[0] = 2.5 / 24000; // half-to-even -> 2
  assert.deepEqual([...encodeSensor(s).slice(0, 2)], [2, 0]);
  s.bG[0] = -1 / 24000;
  assert.deepEqual([...encodeSensor(s).slice(0, 2)], [0xff, 0xff]);
});

test('cali info encode/parse', () => {
  assert.deepEqual([...encodeCaliInfo(null)], new Array(16).fill(0xff));
  const b = encodeCaliInfo({ time: 1700000000, aver: 0.21, stddev: 0.09, max: 0.48, dip: 61.37 });
  assert.deepEqual([...b.slice(0, 8)], [0x55, 0x01, 0x00, 0xf1, 0x53, 0x65, 21, 0]);
  const i = parseCaliInfo(b);
  assert.equal(i.time, 1700000000);
  assert.equal(general(i.dip, FLOAT), '61.37');
  assert.equal(parseCaliInfo(new Uint8Array(16)), null);
});

test('.coe write/read round trip', () => {
  const c = demoCali(1700000000);
  c.info = parseCaliInfo(encodeCaliInfo(c.info));
  const text = writeCoe(c);
  const lines = text.split('\r\n');
  assert.equal(lines.length, 23);
  assert.equal(lines[0], '0.0123,-0.0045,0.0071');
  assert.equal(lines[16], '2023-11-02 22:13:20');
  assert.equal(lines[21], '1234');
  const back = readCoe(text);
  assert.deepEqual(back.sensors, c.sensors);
  assert.deepEqual(back.info, c.info);
  assert.equal(back.serial, 1234);
  const noInfo = readCoe(text.split('\r\n').slice(0, 16).join('\n'));
  assert.equal(noInfo.info, null);
  assert.equal(noInfo.serial, 0);
  assert.throws(() => readCoe('1,2,3,4\n'), CoeFormatError);
  assert.match(caliText(back).info, /Calibration Time: 2023-11-02 22:13\nAverage Error:0.21\n/);
  assert.match(caliText(back).coeffs, /^Sensor1:\nbG1:  0\.0123  -0\.0045  0\.0071\n/);
});

test('firmware header and packets', () => {
  const img = new Uint8Array(256 + 300).fill(0x11);
  img.set([0x11, 0x23, 0x55, 0x6e, 0x7c, 0xef, 0x6d, 0x5b, 0x65, 0x53, 0xf1, 0x00, 1, 2, 3]);
  assert.deepEqual(checkHeader(img), { version: '1.2.3', buildTime: 1700000000 });
  assert.equal(checkHeader(new Uint8Array(300)), null);
  const p = buildPackets(img);
  assert.equal(p.length, 3);
  assert.equal(p[2][43], 0x11);
  assert.equal(p[2][44], 0xff);
  const exact = new Uint8Array(256 + 256).fill(0x22);
  const q = buildPackets(exact);
  assert.equal(q.length, 3); // extra all-0xFF packet, as the C# do/while
  assert.ok(q[2].every((b) => b === 0xff));
  assert.equal(checksum(q), (crc16modbus(q[0]) * 2 + crc16modbus(q[2])) >>> 0);
  assert.equal(progressAfter(1, exact.length), 50);
  assert.equal(progressAfter(3, exact.length), 100);
});
