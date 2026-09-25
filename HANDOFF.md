# Handoff — Cavway Assistant Web

Context for picking this up in a new session (human or AI agent).

## What this is

A browser port (Web Serial API) of Cavway Assistant, the Windows companion app
for the Cavway X1 cave-survey instrument.

- Upstream: https://github.com/tswcmpass/CavwayAssistant_Win @ `ce01324`
  (GPLv3, C# WinForms, .NET 4.5.2, ~2,350 lines incl. designer code).
  Clone it for reference: the spec was derived from `UART.cs`, `Shot.cs`,
  `FrmMain.cs`, `FrmCali.cs`, `FrmFirmware.cs`, `log.cs`.
- This repo is a derivative work, so it stays **GPLv3** (LICENSE copied from
  upstream).

## Decisions made (2026-09-24)

1. Considered: Avalonia/.NET 8 port, Qt port, browser app. **Chose browser app**
   (Web Serial): most portable, no installer, no macOS code signing.
2. Plain ES modules, **no build step, no npm dependencies**. Tests with
   `node --test` (Node 24 used).
3. **Exact feature parity** with the Windows app for v1. CSV and `.coe` files
   must interchange. No survey-format exports, no Bluetooth yet.
4. **No X1 hardware yet** (one is on the way): everything must be testable
   against an emulator (`emulator.js` + `FakeTransport`) and a "Demo device"
   mode in the UI. Firmware flashing ships labelled "untested on hardware".
5. Hosting: personal GitHub repo `cavway-assistant-web`, GitHub Pages from
   `main`. Pushed to https://github.com/Nate-the-Ace/cavway-assistant-web
   (2026-09-24); Pages not enabled yet (no site to serve).

## Status

- [x] Upstream analysed
- [x] Design spec written: `docs/superpowers/specs/2026-09-24-cavway-web-port-design.md`
- [x] Implementation (2026-09-24; spec treated as approved, built straight from it
      and the upstream C# source), 23 `node --test` tests, demo-mode browser check
- [x] Push to GitHub
- [ ] Enable GitHub Pages (main, root)
- [ ] Real-device verification when the X1 arrives: `docs/real-device-checklist.md`

## Things worth knowing

- USB-serial chip is WCH CH343, VID 0x1a86 / PID 0x55d3, 115200 8N1.
- Web Serial works only in Chrome/Edge/Opera (desktop); needs HTTPS or
  localhost. Linux users need `dialout` group.
- Protocol, memory addresses, byte layouts, timing and the C# quirks that must
  be preserved (clock sync local-as-UTC, shot time display, firmware extra
  0xFF packet, CSV trailing header comma) are all in the spec.
- Original bugs deliberately fixed: download button stuck disabled after a
  failure; `.coe`/CSV decimal separator depended on OS locale (always `.` now);
  CSV export appended to existing files.

## Implementation notes

- CaveCAD export (`src/cavecad.js`, added 2026-09-24 at Nathan's request) targets
  `CsFormatCsv` in cavecad-tools. A test parses the export with the real CaveCAD
  reader when `../cavecad-tools` is checked out beside this repo. Leg-merge
  tolerance 5 cm / 1.5 deg is a guess until the X1's leg storage is known.

- Number formatting reproduces .NET Framework (`src/format.js`): floats go through
  7 significant digits, doubles 15, then round half away from zero; `.coe` numbers
  use .NET `G15`/`G7` text (including `E-05` style), so files diff clean against
  the Windows app.
- `.coe` time and cali time are the stored epoch read as UTC, like the shot time.
- Emulator fault switches: `strayBeforeReply`, `dropReplyNumber`,
  `corruptCrcAtPacket`. Laser trigger adds a shot.
