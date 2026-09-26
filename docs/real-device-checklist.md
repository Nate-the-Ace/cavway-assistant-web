# Real-device checklist

Run when the X1 arrives. Use Chrome, open the raw traffic panel, and keep the
Windows app on hand to compare. Tick each item or note what differed.

- [ ] Connect finds the X1 with the default filter (VID 0x1a86 / PID 0x55d3); serial shown matches the device.
- [ ] Unplugging the cable flips status to Disconnected and disables the controls.
- [ ] Laser On, Laser Off, Measure act on the device.
- [ ] Reset device (DTR/RTS pulse): does the X1 restart (laser off, screen reboots)? If nothing happens, the X1 does not wire DTR/RTS to reset; relabel or remove the button.
- [ ] Sync Time: device clock shows local wall-clock time.
- [ ] Download 1000 shots: stops at the last stored shot; values and times match the device screen and the Windows app.
- [ ] Take a shot on the device during a download: unsolicited packet is skipped, download still completes.
- [ ] Export CSV opens in a spreadsheet; diff against the Windows app export of the same shots.
- [ ] Download Coeffs: info and coefficients match the Windows app display.
- [ ] Save .coe, load it in the Windows app; save from the Windows app, load here. Numbers agree.
- [ ] Upload the just-downloaded coeffs back; download again; unchanged.
- [ ] Firmware: only with a known-good .bin and the Windows app ready to recover. Upgrade, then confirm the new version on the device. If it works, remove the "untested" banner.
- [ ] CaveCAD export: survey a short line with splays and a backsight. Check how the X1 stores a leg (one shot, or three flagged as legs) so merging is right, that backsight shots come out reversed, and that the file imports into CaveCAD and plots as surveyed.
