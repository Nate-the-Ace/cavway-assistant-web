// Page wiring: the three C# forms (main, calibration, firmware) on one page.
import { WebSerialTransport, FakeTransport } from './transport.js';
import { Device, Command } from './protocol.js';
import { Emulator } from './emulator.js';
import { COLUMNS, tableRow, shotsCsv } from './shot.js';
import { writeCoe, readCoe, caliText } from './coeffs.js';
import { checkHeader, headerText } from './firmware.js';
import { cavecadCsv } from './cavecad.js';
import { loadCore, buildMesh, Viewport } from './view3d.js';

const $ = (id) => document.getElementById(id);
const state = { transport: null, device: null, serial: 0, shots: [], cali: null, caliFromDevice: false, firmware: null, busy: new Set() };

const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');
const log = (dir, bytes, t) => {
  const el = $('log');
  el.textContent += `${t.toISOString().slice(11, 23)} ${dir === 'tx' ? '>>' : '<<'} ${hex(bytes)}\n`;
  if (el.textContent.length > 400000) el.textContent = el.textContent.slice(-300000);
  el.scrollTop = el.scrollHeight;
};

function save(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function refresh() {
  const on = !!state.transport?.isOpen;
  document.querySelectorAll('.needs-device, .needs-device button').forEach((el) => { el.disabled = !on; });
  $('btnDownload').disabled = !on || state.busy.has('download');
  $('btnExport').disabled = state.shots.length === 0;
  $('btnExportCaveCAD').disabled = state.shots.length === 0;
  $('btnSaveCoeffs').disabled = !(state.cali && state.caliFromDevice);
  $('btnUploadCoeffs').disabled = !on || !state.cali;
  $('btnUpgrade').disabled = !on || !state.firmware || state.busy.has('fw');
  $('btnConnect').textContent = on ? 'Disconnect' : 'Connect';
  $('chkDemo').disabled = on;
  $('chkAllPorts').disabled = on || $('chkDemo').checked;
  $('lblStatus').textContent = on ? 'Connected' : 'Disconnected';
  $('lblStatus').className = on ? 'good' : 'bad';
  $('lblSerial').textContent = on ? 'Serial. ' + String(state.serial).padStart(4, '0') : '';
}

async function connect() {
  if (state.transport?.isOpen) {
    await state.transport.close();
    refresh();
    return;
  }
  const t = $('chkDemo').checked ? new FakeTransport(new Emulator(), { latencyMs: 15 }) : new WebSerialTransport();
  try {
    await t.open({ showAll: $('chkAllPorts').checked });
  } catch (e) {
    if (e.name !== 'NotFoundError') alert('Connect Device Failed.\n' + e.message); // NotFoundError: chooser cancelled
    return;
  }
  t.onTraffic(log);
  t.onDisconnect(refresh);
  state.transport = t;
  state.device = new Device(t);
  refresh();
  state.serial = await state.device.readSerial();
  refresh();
}

let viewport = null;

async function draw3d(decl) {
  if (!state.shots.length) { $('pvSummary').textContent = 'No shots downloaded'; return; }
  try {
    await loadCore();
    viewport ??= new Viewport($('v3Canvas'), $('v3Labels'));
    const csv = cavecadCsv(state.shots, { declination: String(decl), start: $('txtStart').value, mergeLegs: $('chkMerge').checked });
    const mesh = buildMesh(csv, $('v3Color').value);
    viewport.showWalls = $('v3Walls').checked;
    viewport.setMesh(mesh);
    const lg = mesh.legend;
    $('v3Legend').textContent = lg ? `${lg.title}: ${lg.stops.map((x) => x.label).join(' · ')}` : '';
    $('pvSummary').textContent = `${mesh.labels.names.length} stations, ${mesh.triangles.positions.length / 9} wall triangles`;
  } catch (e) {
    $('pvSummary').textContent = '3D view failed: ' + e.message;
  }
}

function drawPreview() {
  const d = Number($('txtDecl').value.trim());
  draw3d($('txtDecl').value.trim() !== '' && Number.isFinite(d) ? d : 0);
}

function renderHead() {
  $('tblShots').tHead.innerHTML = '<tr>' + COLUMNS.map((c) => `<th>${c}</th>`).join('') + '</tr>';
}

function addRow(shot) {
  const tr = document.createElement('tr');
  for (const cell of tableRow(shot)) tr.appendChild(document.createElement('td')).textContent = cell;
  $('tblShots').tBodies[0].appendChild(tr);
}

async function download() {
  const n = Number($('txtNumShot').value);
  if (!Number.isInteger(n) || n < 0 || n > 1000 || $('txtNumShot').value.trim() === '') {
    alert('Please input valid number');
    return;
  }
  $('tblShots').tBodies[0].replaceChildren();
  state.shots = [];
  state.busy.add('download');
  refresh();
  try {
    await state.device.downloadShots(n, (shot, i) => {
      state.shots.push(shot);
      addRow(shot);
      $('btnDownload').textContent = `downloading ${i + 1}/${n}`;
    });
  } catch {
    alert('Download failed');
  } finally {
    state.busy.delete('download');
    $('btnDownload').textContent = 'download';
    refresh();
    drawPreview();
  }
}

function showCali() {
  const { info, coeffs } = caliText(state.cali);
  $('lblInfo').textContent = info;
  $('lblCoeff').textContent = coeffs;
}

async function downloadCoeffs() {
  try {
    state.cali = await state.device.downloadCali();
    state.serial = state.cali.serial;
    state.caliFromDevice = true;
    showCali();
    refresh();
    alert('Download calibration coeffs successful!');
  } catch (e) {
    alert(e.message);
  }
}

async function loadCoe(file) {
  try {
    state.cali = readCoe(await file.text());
    state.caliFromDevice = false;
    showCali();
  } catch (e) {
    alert(e.message || 'Wrong coe file format');
  }
  refresh();
}

async function uploadCoeffs() {
  if (state.cali.serial !== state.serial && !confirm(
    'The serial number in the file does not match the connected device, or no serial number was found in the file.\n\nContinue anyway?')) return;
  try {
    await state.device.uploadCali(state.cali);
    alert('Upload coeff params successful!');
  } catch (e) {
    alert(e.message);
  }
}

async function chooseBin(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const h = checkHeader(bytes);
  if (h) {
    state.firmware = bytes;
    $('lblFirm').textContent = headerText(file.name, h);
  } else {
    state.firmware = null;
    $('lblFirm').textContent = 'Invalid Firmware file';
    alert('Invalid Firmware file!');
  }
  refresh();
}

async function upgrade() {
  if (!confirm('Upgrade the device firmware now?\n\nThis web version has not been tested on a real X1. Do not unplug the device while it runs.')) return;
  state.busy.add('fw');
  $('progFw').value = 0;
  refresh();
  try {
    await state.device.upgradeFirmware(state.firmware, (p) => { $('progFw').value = p; });
    alert('upgrade success');
  } catch (e) {
    $('progFw').value = 0;
    alert(e.message);
  } finally {
    state.busy.delete('fw');
    refresh();
  }
}

const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { alert(e.message); refresh(); } };

function init() {
  if (!WebSerialTransport.supported()) {
    $('unsupported').hidden = false;
    $('chkDemo').checked = true;
  }
  renderHead();
  $('btnConnect').onclick = guard(connect);
  $('chkDemo').onchange = refresh;
  document.querySelectorAll('[data-cmd]').forEach((b) => { b.onclick = guard(() => state.device.command(Command[b.dataset.cmd])); });
  $('btnSyncTime').onclick = async () => {
    try { await state.device.syncTime(); alert('sync time successful!'); } catch { alert('sync time failed'); }
  };
  $('btnDownload').onclick = guard(download);
  $('btnExport').onclick = () => save('cavway_shots.csv', shotsCsv(state.shots), 'text/csv');
  $('btnExportCaveCAD').onclick = () => {
    try {
      const csv = cavecadCsv(state.shots, {
        declination: $('txtDecl').value, start: $('txtStart').value, name: $('txtCaveName').value,
        team: $('txtTeam').value, serial: state.serial, mergeLegs: $('chkMerge').checked,
      });
      const base = ($('txtCaveName').value.trim() || 'cavway').replace(/[^\w-]+/g, '_');
      save(`${base}_cavecad.csv`, csv, 'text/csv');
    } catch (e) {
      alert(e.message);
      $('txtDecl').focus();
    }
  };
  $('btnDownCoeffs').onclick = guard(downloadCoeffs);
  $('btnSaveCoeffs').onclick = () => save(`cavway_${String(state.cali.serial).padStart(4, '0')}.coe`, writeCoe(state.cali), 'text/plain');
  $('fileCoe').onchange = (e) => { if (e.target.files[0]) loadCoe(e.target.files[0]); e.target.value = ''; };
  $('btnUploadCoeffs').onclick = guard(uploadCoeffs);
  $('fileBin').onchange = (e) => { if (e.target.files[0]) chooseBin(e.target.files[0]); e.target.value = ''; };
  $('btnUpgrade').onclick = guard(upgrade);
  $('btnClearLog').onclick = () => { $('log').textContent = ''; };
  $('btnCopyLog').onclick = () => navigator.clipboard.writeText($('log').textContent);
  for (const id of ['txtDecl', 'txtStart', 'chkMerge']) $(id).addEventListener('input', drawPreview);
  $('v3Color').addEventListener('change', drawPreview);
  $('v3Walls').addEventListener('change', () => { if (viewport) { viewport.showWalls = $('v3Walls').checked; viewport.draw(); } });
  document.querySelectorAll('[data-view]').forEach((b) => { b.onclick = () => viewport?.setView(b.dataset.view); });
  window.addEventListener('resize', () => viewport?.draw());
  refresh();
  drawPreview();
}

init();
