# Cavway Assistant Web

Browser port of [Cavway Assistant](https://github.com/tswcmpass/CavwayAssistant_Win),
the PC companion for the Cavway X1 cave-survey instrument. Talks to the X1 over
USB with the Web Serial API: no install, runs on Windows, macOS, Linux and ChromeOS.

- Needs desktop Chrome, Edge or Opera. Safari and Firefox have no Web Serial.
- Linux: your user must be in the `dialout` group to open the port.
- Live at https://nate-the-ace.github.io/cavway-assistant-web/
- **Demo device** mode runs everything against a built-in emulator, no X1 needed.

Features match the Windows app: laser on/off, measure, clock sync, shot download
and CSV export, calibration coefficient download / save / load / upload (`.coe`
files interchange with the Windows app), and firmware upgrade.

Beyond the Windows app: **Export CaveCAD CSV** writes the survey CSV that
[CaveCAD](https://github.com/Nate-the-Ace/CaveCAD)'s Cave Survey add-on imports.
The X1 stores no station names, so stations are generated from a first station
(legs advance, splays hang off the current station). Repeated leg shots are
averaged into one leg, calibration shots are dropped, and azimuths are corrected
to true north by the declination you enter (CaveCAD stores true azimuths).

**Survey preview** is a 3D viewport (orbit, pan,
zoom) built by CaveCAD's own 3D code: the export goes through CaveCAD's CSV
reader, `CsNetwork.resolve` and `CsMesh3d.build`, vendored unmodified in
`vendor/cavecad/` (GPLv3). Refresh it with `tools/sync-cavecad.sh`. A Fusion-style
ViewCube (faces TOP, BOTTOM, N, S, E, W) turns with the camera; click a face,
edge or corner to look from there, drag it to orbit, house for home.

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
