# Cavway Assistant Web — Design

Date: 2026-09-24
Upstream: https://github.com/tswcmpass/CavwayAssistant_Win @ ce01324 (GPLv3, C# WinForms, .NET 4.5.2)

## Goal

Browser port of Cavway Assistant (PC companion for the Cavway X1 cave-survey
instrument) so it runs on Windows, macOS, Linux and ChromeOS with no install.
Uses the Web Serial API. Exact feature parity with the Windows app; its CSV and
`.coe` files must interchange with this app.

## Non-goals (v1)

- Survey-format exports (Survex/Therion/etc.), Bluetooth, calibration math.
- Safari, Firefox, iOS (no Web Serial). Android not targeted.
- Build tooling, frameworks, npm dependencies.

## Constraints

- Web Serial needs a secure context: served from GitHub Pages (HTTPS) or
  `localhost` for development.
- Linux users need `dialout` group membership to open the port.
- License GPLv3 (derivative work). README credits upstream.
- No hardware available yet: every feature must be exercisable against an
  emulator. Firmware flashing is labelled "untested on hardware" until verified
  on a real X1.

## Architecture

Plain ES modules, no build step. Layers:

```
ui (index.html, ui/*.js)
  -> protocol.js            device commands
       -> transport          WebSerialTransport | FakeTransport
                                                    -> emulator.js
pure modules: shot.js, coeffs.js, firmware.js, crc.js, csv.js (no I/O, no DOM)
```

### transport.js

Interface:

- `open()`, `close()`, `isOpen`
- `write(Uint8Array)`
- `flushInput()` — drop buffered received bytes (C# `DiscardInBuffer`)
- `read(predicate, timeoutMs)` — wait until the accumulated receive buffer
  satisfies `predicate(buf)` (returns bytes consumed or -1), resolve with those
  bytes; reject with `TimeoutError` otherwise.
- `onTraffic(cb)` — hook for the raw hex log panel (direction, bytes, time).
- `onDisconnect(cb)`

`WebSerialTransport`: `navigator.serial.requestPort({filters:[{usbVendorId:
0x1a86, usbProductId: 0x55d3}]})` (WCH CH343); "show all ports" option calls
`requestPort()` unfiltered. 115200 8N1. A single background reader loop appends
to the receive buffer. Listens for `navigator.serial` `disconnect` events.

`FakeTransport`: in-memory pipe to an `Emulator` instance, with configurable
per-byte latency so timeouts are exercised.

### protocol.js — port of UART.cs

Framing (host to device): `"data:"` + `len` (1 byte = payload length) +
payload + `"\r\n"`. Every send first calls `flushInput()`.

| Operation | Payload | Expected reply |
|---|---|---|
| readMemory(addr, len) | `3D addrLo addrHi len` | `3D addrLo addrHi len data[len]` |
| writeMemory(addr, bytes) | `3E addrLo addrHi len data` | `3D addrLo addrHi len data` (echo; must equal written bytes) |
| command(c) | one byte: 0x30 EnterCali, 0x31 QuitCali, 0x36 LaserOn, 0x37 LaserOff, 0x38 LaserTrig | none |
| fwStart() | `4B` | `4B 01` |
| fwPacket(idx, data128) | `4C idxLo idxHi data[128] crcLo crcHi` | 6 bytes; `[3]==00`, `[4..5]` = crc (LE) |
| fwEnd(checksum) | `4D` + checksum u32 LE | `4D 00` |

Stray data: the device may emit unsolicited packets starting 0x01 (data) or
0x02 (cali) before a memory reply. As in C#: if the buffer starts with 0x01 or
0x02, the reply begins at the first 0x3D that follows `\r\n`. The predicate
for memory replies implements this scan and requires `len + 4` bytes after it.

Timeouts replace the C# fixed sleeps: memory ops `max(200, 8 + 2.5*len)` ms
**plus** a 1000 ms margin (C# checked once after the sleep; we wait until the
reply is complete or time runs out). fwStart 3000 ms, fwPacket 500 ms,
fwEnd 8000 ms (same as C#).

Addresses: serial number 0x8008 (u16 LE of 4 bytes read); clock 0x8000
(u32 LE); shot i at memory index i (64 bytes); cali info 0x9040 (16 bytes);
coeffs 0x90C0 (128 bytes).

Clock sync writes `Date.now()` local wall-clock as epoch seconds (C# treats
local time as UTC: `seconds = (Date.now() - tzOffset) / 1000`). Preserve.

### shot.js — port of Shot.cs

`parseShot(bytes64) -> Shot | null` (null when `bytes[0] == 0xFF`, which ends a
download). Fields and scaling copied exactly from Shot.cs, including leg/cali/
splay flag bits, `flags` (feature/ridge/backsight/generic), distance 24-bit
mixed order `b2<<16 | b4<<8 | b3`, absG/absM scales (G_SCALE 667, M_SCALE 4876,
FM 16384), raw G/M for two sensors, time_t at bytes 17-20 and error info at
bytes 45-53 with `parseErrInfo` text identical to C#.

Shot time: C# converts device time_t (local wall-clock seconds) so the displayed
time equals the wall-clock the device recorded. Port displays
`new Date(time_t*1000)` formatted in **UTC** as `yyyy/MM/dd HH:mm:ss`, which
gives the same text on any machine.

### csv.js

Header and rows byte-identical to FrmMain export (including the trailing comma
after every header column and the per-column decimal places F3/F2/F2/F3/F2/F2).
Flag column text is the table's flag text. Line ending `\r\n`, as C#
`StreamWriter.WriteLine` on Windows.

### coeffs.js — port of FrmCali coeff logic

- `parseCoeffs(bytes64) / encodeCoeffs(...)`: 24 int16 LE; biases scale by
  FV=24000, matrices by FM=16384; order bG.x, aG.x.{x,y,z}, bG.y, aG.y.*, ...
  then the same for M. Encoding rounds half-to-even (C# `Math.Round`).
- Upload buffer: 128 bytes of 0xFF; sensor 1 at 0, sensor 2 at 64 (48 each).
- Cali info (16 bytes): flag 0x55, ver 0x01, time u32, aver_err, stddev,
  max_err, dip as int16 x100. Absent info is uploaded as 16 x 0xFF.
- `.coe` text: 16 lines of 3 comma-separated numbers (bG1, bM1, aG1 rows, aM1
  rows, then sensor 2), optional 6 info lines (time `yyyy-MM-dd HH:mm:ss`, aver,
  stddev, max, dip, serial). Always `.` decimal separator on write; accept `.`
  on read. Number formatting uses shortest round-trip (matches C# `R` for most
  values; exact-text parity with C# is not required, numeric parity is).
- Upload with file serial != device serial requires a confirm dialog.

### firmware.js — port of FrmFirmware

- Header check: first 8 bytes `11 23 55 6e 7c ef 6d 5b`; version
  `b12.b13.b14`; build time u32 **big-endian** at bytes 8-11 (UTC).
- Packets: skip first 256 bytes; 128-byte chunks, last chunk padded with 0xFF;
  checksum = u32 sum of per-packet CRC16/MODBUS (poly 0xA001, init 0xFFFF).
- Progress: 10% after start, 10-90% across packets, 100% on success.
- Behaviour on failure: stop immediately, report packet index. No retries.
  Confirm dialog before start. Upgrade button disabled while running.

### emulator.js

A fake X1 used by `FakeTransport` and the tests:

- Memory map with serial, clock, N shots (default 25, realistic values built by
  encoding known azimuth/inclination/distance), cali info and coeffs.
- Parses host frames, answers per the table above, applies writes.
- Accepts firmware start/packets/end, verifies CRC and checksum like a device
  would, keeps the received image for tests to compare.
- Options: emit an unsolicited 0x01 packet before replies; drop the Nth reply;
  corrupt a firmware CRC reply; latency.

The emulator encodes our reading of the C# host code. Passing against it proves
we match what the Windows app expects, not what the device does.

### UI

Single page, sections: Connection (Connect / Demo device toggle / show all
ports, status, serial), Device (Laser On, Laser Off, Measure, Sync Time),
Shots (count input 0-1000, Download with progress, table with the 21 C#
columns, Export CSV), Calibration (Download, Save .coe, Load .coe, Upload, info
and coefficient display as in C#), Firmware (choose .bin, header info, Upgrade
with progress bar and "untested on hardware" banner), and a collapsible raw
traffic log (hex, direction, timestamp, clear, copy).

Controls needing a device are disabled until connected, as in C#. Unsupported
browser: a banner explaining Chrome/Edge/Opera is required; Demo device still
works.

Fixes over C#: Download button re-enabled after failure; decimal separator
always `.`.

## Testing

- `node --test` unit tests for crc, shot, csv, coeffs, firmware (golden vectors
  hand-derived from the C# code in the spec above).
- Protocol tests against the emulator: every operation, stray-packet skip,
  dropped reply -> timeout, bad firmware CRC -> stop at that packet, full
  firmware image round trip.
- Browser check of Demo mode in the built-in preview before publishing.
- Real-device checklist doc for when the X1 arrives.

## Hosting

Personal GitHub repo `cavway-assistant-web` (ndschonegg), GitHub Pages from
`main` root. Push/publish happens only on explicit go-ahead.
