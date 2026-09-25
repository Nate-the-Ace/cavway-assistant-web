# Cavway Assistant Web

Browser port of [Cavway Assistant](https://github.com/tswcmpass/CavwayAssistant_Win),
the PC companion for the Cavway X1 cave-survey instrument. Talks to the X1 over
USB with the Web Serial API: no install, runs on Windows, macOS, Linux and ChromeOS.

- Needs desktop Chrome, Edge or Opera. Safari and Firefox have no Web Serial.
- Linux: your user must be in the `dialout` group to open the port.
- **Demo device** mode runs everything against a built-in emulator, no X1 needed.

Features match the Windows app: laser on/off, measure, clock sync, shot download
and CSV export, calibration coefficient download / save / load / upload (`.coe`
files interchange with the Windows app), and firmware upgrade.

> Firmware upgrade has not been tested on a real X1 yet.

## Development

Plain ES modules, no build step, no dependencies.

```bash
npm test
```

Serve the folder over `localhost` (Web Serial needs a secure context), e.g.
`python3 -m http.server`, and open it in Chrome.

Layout: `src/protocol.js` (device commands, port of `UART.cs`), `src/shot.js`,
`src/coeffs.js`, `src/firmware.js` (pure data code), `src/transport.js`
(Web Serial and the emulator pipe), `src/emulator.js` (fake X1), `src/app.js` (UI).
Design: `docs/superpowers/specs/2026-09-24-cavway-web-port-design.md`.

## License

GPLv3, as the upstream Windows app this is derived from. See `LICENSE`.
