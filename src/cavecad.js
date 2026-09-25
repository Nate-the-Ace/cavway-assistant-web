// Export to CaveCAD's survey CSV (the format CsFormatCsv in the Cave Survey
// add-on reads). The X1 stores no station names, so stations are generated:
// every leg moves on to the next station, splays hang off the current one.
// CaveCAD stores azimuths TRUE, so the magnetic readings are corrected here by
// the declination the user enters, and the "# declination:" line records it.
import { formatUtc } from './format.js';

const FLAG_NOTE = ['feature', 'ridge', 'backsight', 'generic'];
const LEG_DIST_TOL = 0.05; // m
const LEG_ANGLE_TOL = 1.5; // deg

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const azDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const agrees = (a, b) =>
  Math.abs(a.distance - b.distance) <= LEG_DIST_TOL &&
  azDiff(a.azimuth, b.azimuth) <= LEG_ANGLE_TOL &&
  Math.abs(a.inclination - b.inclination) <= LEG_ANGLE_TOL;

// Averages a run of repeated leg shots (azimuth as a vector mean).
function average(group) {
  const n = group.length;
  let x = 0, y = 0, d = 0, i = 0;
  for (const s of group) {
    x += Math.cos(rad(s.azimuth)); y += Math.sin(rad(s.azimuth));
    d += s.distance; i += s.inclination;
  }
  return { ...group[0], distance: d / n, azimuth: (deg(Math.atan2(y, x)) + 360) % 360, inclination: i / n, merged: n };
}

// Shots in memory order -> [{ kind: 'leg'|'splay', shot }], calibration shots dropped.
export function groupShots(shots, { mergeLegs = true } = {}) {
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length) out.push({ kind: 'leg', shot: run.length > 1 ? average(run) : run[0] });
    run = [];
  };
  for (const s of shots) {
    if (!s.isLeg && s.isCali) continue;
    if (s.isLeg) {
      if (mergeLegs && run.length && agrees(run[0], s)) { run.push(s); continue; }
      flush();
      run = [s];
    } else {
      flush();
      out.push({ kind: 'splay', shot: s });
    }
  }
  flush();
  return out;
}

export function nextStation(name) {
  const m = /^(.*?)(\d+)$/.exec(name);
  if (!m) return name + '1';
  return m[1] + String(Number(m[2]) + 1).padStart(m[2].length, '0');
}

const clean = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();

// opts: { declination (deg, east positive; required), start ('A1'), name, team, serial, mergeLegs }
export function cavecadCsv(shots, opts) {
  const raw = String(opts.declination ?? '').trim();
  const decl = Number(raw);
  if (raw === '' || !Number.isFinite(decl)) throw new Error('Enter the magnetic declination for the cave (0 if none).');
  const lines = [];
  if (opts.name) lines.push('# name: ' + clean(opts.name));
  if (shots.length) lines.push('# date: ' + formatUtc(shots[0].time, 'yyyy-MM-dd'));
  if (opts.team) lines.push('# team: ' + clean(opts.team));
  lines.push('# declination: ' + decl);
  lines.push('# unit: m');
  lines.push(`# source: Cavway X1${opts.serial ? ' serial ' + String(opts.serial).padStart(4, '0') : ''}, exported by Cavway Assistant Web; azimuths corrected to true`);
  lines.push('from,to,distance,azimuth,inclination,left,right,up,down,backazimuth,backinclination,flags,notes');
  for (const { from, to, shot, azimuth } of traverse(shots, opts, decl)) {
    const notes = [formatUtc(shot.time, 'HH:mm:ss')];
    if (FLAG_NOTE[shot.flags]) notes.push(FLAG_NOTE[shot.flags]);
    if (shot.merged) notes.push(`mean of ${shot.merged} shots`);
    if (shot.errorInfo && shot.errorInfo !== 'No error') notes.push('X1: ' + shot.errorInfo.trim());
    lines.push([from, to, shot.distance.toFixed(3), azimuth.toFixed(2), shot.inclination.toFixed(2),
      '', '', '', '', '', '', '', notes.join('; ')].join(','));
  }
  return lines.join('\n') + '\n';
}

// Named rows: { kind, from, to ('' for splays), shot, azimuth (true) }.
export function traverse(shots, opts, decl = 0) {
  const rows = [];
  let station = clean(opts.start) || 'A1';
  for (const { kind, shot } of groupShots(shots, opts)) {
    let from = station, to = '';
    if (kind === 'leg') {
      to = nextStation(station);
      if (shot.flags === 2) [from, to] = [to, from]; // backsight: shot taken from the far station
      station = nextStation(station);
    }
    rows.push({ kind, from, to, shot, azimuth: (((shot.azimuth + decl) % 360) + 360) % 360 });
  }
  return rows;
}

const vec = (az, inc, d) => {
  const h = d * Math.cos(rad(inc));
  return [h * Math.sin(rad(az)), h * Math.cos(rad(az)), d * Math.sin(rad(inc))];
};

// Station positions relative to the first station (x east, y north, z up, metres).
// Legs whose from-station is not placed yet start a new piece at the origin's
// last placed station, so a broken chain still draws.
export function layout(rows) {
  const pos = new Map();
  const legs = [], splays = [];
  let last = null;
  for (const r of rows) {
    if (!pos.size) pos.set(r.kind === 'leg' && r.shot.flags === 2 ? r.to : r.from, [0, 0, 0]);
    const v = vec(r.azimuth, r.shot.inclination, r.shot.distance);
    if (r.kind === 'splay') {
      const a = pos.get(r.from) ?? last ?? [0, 0, 0];
      splays.push({ a, b: [a[0] + v[0], a[1] + v[1], a[2] + v[2]], row: r });
      continue;
    }
    if (pos.has(r.from)) {
      const a = pos.get(r.from);
      pos.set(r.to, [a[0] + v[0], a[1] + v[1], a[2] + v[2]]);
    } else if (pos.has(r.to)) {
      const b = pos.get(r.to);
      pos.set(r.from, [b[0] - v[0], b[1] - v[1], b[2] - v[2]]);
    } else {
      const a = last ?? [0, 0, 0];
      pos.set(r.from, a);
      pos.set(r.to, [a[0] + v[0], a[1] + v[1], a[2] + v[2]]);
    }
    legs.push({ a: pos.get(r.from), b: pos.get(r.to), row: r });
    last = pos.get(r.kind === 'leg' && r.shot.flags === 2 ? r.from : r.to);
  }
  return { stations: pos, legs, splays };
}
