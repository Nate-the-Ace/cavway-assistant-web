import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Emulator } from '../src/emulator.js';
import { FakeTransport, TimeoutError } from '../src/transport.js';
import { Device, Command, ADDR, frame, memReplyPredicate } from '../src/protocol.js';
import { buildPackets } from '../src/firmware.js';

async function connect(opts = {}) {
  const emu = new Emulator({ shots: 10, serial: 4321, now: 1700000000, ...opts });
  const t = new FakeTransport(emu, { latencyMs: 1 });
  await t.open();
  return { emu, t, dev: new Device(t) };
}

test('frame layout', () => {
  assert.deepEqual([...frame(Uint8Array.of(0x36))], [0x64, 0x61, 0x74, 0x61, 0x3a, 1, 0x36, 0x0d, 0x0a]);
});

test('stray packet predicate', () => {
  const p = memReplyPredicate(2);
  assert.equal(p(Uint8Array.of(0x3d, 0, 0, 2, 9)), -1);
  assert.equal(p(Uint8Array.of(0x3d, 0, 0, 2, 9, 9)), 6);
  assert.equal(p(Uint8Array.of(0x01, 5, 5, 0x0d, 0x0a, 0x3d, 0, 0, 2, 9, 9)), 11);
  assert.equal(p(Uint8Array.of(0x01, 5, 5, 0x3d, 0, 0, 2, 9, 9)), -1);
});

test('serial, shots, cali download', async () => {
  const { dev } = await connect();
  assert.equal(await dev.readSerial(), 4321);
  const seen = [];
  const shots = await dev.downloadShots(50, (s, i) => seen.push(i));
  assert.equal(shots.length, 10); // stops at first empty slot
  assert.equal(seen.length, 10);
  const cali = await dev.downloadCali();
  assert.equal(cali.serial, 4321);
  assert.ok(cali.info);
  assert.ok(Math.abs(cali.sensors[0].aG[0][0] - 1.0012) < 1e-4);
});

test('stray unsolicited packet before replies is skipped', async () => {
  const { emu, dev } = await connect();
  emu.strayBeforeReply = true;
  assert.equal(await dev.readSerial(), 4321);
  assert.equal((await dev.downloadShots(3)).length, 3);
});

test('dropped reply times out and keeps partial shots', async () => {
  const { emu, dev } = await connect();
  emu.dropReplyNumber = 3;
  await assert.rejects(dev.downloadShots(10), (e) => e instanceof TimeoutError && e.shots.length === 2);
  assert.equal((await dev.downloadShots(2)).length, 2); // device usable after failure
});

test('sync time writes local wall clock as UTC', async () => {
  const { emu, dev } = await connect();
  await dev.syncTime(1700000000_000, -120); // UTC+2
  const m = emu.memGet(ADDR.clock, 4);
  assert.equal((m[0] | (m[1] << 8) | (m[2] << 16) | (m[3] << 24)) >>> 0, 1700000000 + 7200);
});

test('cali upload round trip', async () => {
  const { dev } = await connect();
  const cali = await dev.downloadCali();
  cali.sensors[1].bM[0] = 0.05;
  cali.info.dip = Math.fround(58.5);
  await dev.uploadCali(cali);
  const back = await dev.downloadCali();
  assert.ok(Math.abs(back.sensors[1].bM[0] - 0.05) < 1 / 24000);
  assert.equal(back.info.dip, Math.fround(58.5));
  cali.info = null;
  await dev.uploadCali(cali);
  assert.equal((await dev.downloadCali()).info, null);
});

test('commands', async () => {
  const { emu, dev } = await connect();
  await dev.command(Command.LaserOn);
  await dev.command(Command.LaserTrig);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(emu.laser, true);
  assert.equal((await dev.downloadShots(20)).length, 11);
});

function image(len) {
  const img = new Uint8Array(len);
  for (let i = 0; i < len; i++) img[i] = (i * 31 + 7) & 0xff;
  img.set([0x11, 0x23, 0x55, 0x6e, 0x7c, 0xef, 0x6d, 0x5b]);
  return img;
}

test('firmware upgrade round trip', async () => {
  const { emu, dev } = await connect();
  const img = image(256 + 128 * 5 + 17);
  const progress = [];
  await dev.upgradeFirmware(img, (p) => progress.push(p));
  assert.equal(progress[0], 10);
  assert.equal(progress.at(-1), 100);
  const expected = buildPackets(img);
  assert.equal(emu.firmwareImage.length, expected.length * 128);
  expected.forEach((p, i) => assert.deepEqual(emu.firmwareImage.slice(i * 128, i * 128 + 128), p));
});

test('bad firmware CRC reply stops at that packet', async () => {
  const { emu, dev } = await connect();
  emu.corruptCrcAtPacket = 2;
  await assert.rejects(dev.upgradeFirmware(image(256 + 128 * 5)), /packet 2 of 6/);
  assert.equal(emu.firmwareImage, null);
});

test('disconnect fails pending read and later ops', async () => {
  const { emu, t, dev } = await connect();
  emu.dropReplyNumber = 1;
  let disc = false;
  t.onDisconnect(() => { disc = true; });
  const p = dev.readMemory(ADDR.serial, 4);
  setTimeout(() => t.unplug(), 5);
  await assert.rejects(p, /disconnected/);
  assert.ok(disc);
  await assert.rejects(dev.readMemory(ADDR.serial, 4), /not connected/);
});

test('reset device pulses DTR/RTS and leaves the device usable', async () => {
  const { emu, t, dev } = await connect();
  const seen = [];
  const orig = emu.setSignals.bind(emu);
  emu.setSignals = (s) => { seen.push(s); orig(s); };
  await dev.command(Command.LaserOn);
  await dev.resetDevice({ holdMs: 1, bootMs: 1 });
  assert.deepEqual(seen, [
    { dataTerminalReady: false, requestToSend: false },
    { dataTerminalReady: true, requestToSend: true },
  ]);
  assert.equal(emu.laser, false);
  assert.equal(await dev.readSerial(), 4321);
  await t.close();
  await assert.rejects(dev.resetDevice(), /not connected/);
});
