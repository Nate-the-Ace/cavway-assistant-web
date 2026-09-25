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
   `main`. Nothing pushed yet.

## Status

- [x] Upstream analysed
- [x] Design spec written: `docs/superpowers/specs/2026-09-24-cavway-web-port-design.md`
- [ ] **User review of the spec** (pending; approve or request changes)
- [ ] Implementation plan (next step after spec approval)
- [ ] Implementation, tests, demo-mode browser check
- [ ] Push to GitHub + enable Pages
- [ ] Real-device verification when the X1 arrives

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
