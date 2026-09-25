// Rough survey sketch of the downloaded shots: plan or extended elevation, as SVG.
// A sanity check before export, not a drawing -- no adjustment, no walls.
import { layout } from './cavecad.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, text) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
};

const rad = (d) => (d * Math.PI) / 180;
const label = (r) =>
  `${r.to ? `${r.from} → ${r.to}` : `${r.from} splay`}  ${r.shot.distance.toFixed(2)} m  ${r.azimuth.toFixed(1)}°  ${r.shot.inclination.toFixed(1)}°` +
  (r.shot.merged ? `  (mean of ${r.shot.merged})` : '') +
  (r.shot.errorInfo && r.shot.errorInfo !== 'No error' ? `\nX1: ${r.shot.errorInfo.trim()}` : '');

// Projects to 2-D points [u, v] (v up). Extended elevation unrolls legs in order.
function project(rows, view) {
  const { stations, legs, splays } = layout(rows);
  if (view === 'plan') {
    const p = (q) => [q[0], q[1]];
    return {
      stations: [...stations].map(([n, q]) => [n, p(q)]),
      legs: legs.map((l) => ({ a: p(l.a), b: p(l.b), row: l.row })),
      splays: splays.map((s) => ({ a: p(s.a), b: p(s.b), row: s.row })),
    };
  }
  const ext = new Map();
  const out = { stations: [], legs: [], splays: [] };
  let dir = 0; // azimuth of the last leg, for splay offsets
  let x = 0;
  for (const l of legs) {
    const h = Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]);
    const back = l.row.shot.flags === 2;
    const known = back ? l.row.to : l.row.from;
    const fresh = back ? l.row.from : l.row.to;
    const x0 = ext.get(known) ?? x;
    ext.set(known, x0);
    ext.set(fresh, x0 + h);
    x = x0 + h;
    dir = l.row.azimuth;
    const q = (n) => [ext.get(n), stations.get(n)[2]];
    out.legs.push({ a: q(l.row.from), b: q(l.row.to), row: l.row });
  }
  for (const s of splays) {
    const x0 = ext.get(s.row.from) ?? 0;
    const h = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
    out.splays.push({ a: [x0, s.a[2]], b: [x0 + h * Math.cos(rad(s.row.azimuth - dir)), s.b[2]], row: s.row });
  }
  out.stations = [...ext].map(([n, u]) => [n, [u, stations.get(n)[2]]]);
  return out;
}

// Renders into `svg` (an <svg> element). Returns a one-line summary.
export function renderPreview(svg, rows, view = 'plan') {
  svg.replaceChildren();
  const W = svg.clientWidth || 800, H = svg.clientHeight || 420;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const legsCount = rows.filter((r) => r.kind === 'leg').length;
  if (!rows.length) {
    svg.append(el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'pv-empty' }, 'No shots downloaded'));
    return '';
  }
  const g = project(rows, view);
  const pts = [...g.stations.map((s) => s[1]), ...g.splays.flatMap((s) => [s.a, s.b])];
  let [minU, maxU, minV, maxV] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const [u, v] of pts) { minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v); }
  const pad = 28;
  const span = Math.max(maxU - minU, maxV - minV, 1);
  const k = Math.min((W - 2 * pad) / Math.max(maxU - minU, 1), (H - 2 * pad) / Math.max(maxV - minV, 1));
  const cu = (minU + maxU) / 2, cv = (minV + maxV) / 2;
  const X = (u) => W / 2 + (u - cu) * k;
  const Y = (v) => H / 2 - (v - cv) * k;

  // Scale bar: a round length near a fifth of the width.
  const target = (W / 5) / k;
  const mag = 10 ** Math.floor(Math.log10(target));
  const bar = [1, 2, 5, 10].map((m) => m * mag).filter((b) => b <= target).pop() || mag;
  svg.append(el('line', { x1: pad, y1: H - 12, x2: pad + bar * k, y2: H - 12, class: 'pv-scale' }),
    el('text', { x: pad, y: H - 18, class: 'pv-text' }, `${+bar.toPrecision(3)} m`));
  if (view === 'plan') svg.append(el('text', { x: W - pad, y: pad, 'text-anchor': 'end', class: 'pv-text' }, 'N ↑'));

  const line = (s, cls) => {
    const ln = el('line', { x1: X(s.a[0]), y1: Y(s.a[1]), x2: X(s.b[0]), y2: Y(s.b[1]), class: cls });
    ln.append(el('title', {}, label(s.row)));
    svg.append(ln);
  };
  const bad = (r) => r.shot.errorInfo && r.shot.errorInfo !== 'No error';
  for (const s of g.splays) line(s, 'pv-splay' + (bad(s.row) ? ' pv-bad' : ''));
  for (const l of g.legs) line(l, 'pv-leg' + (bad(l.row) ? ' pv-bad' : ''));
  const every = Math.max(1, Math.ceil(g.stations.length / 60));
  g.stations.forEach(([n, [u, v]], i) => {
    svg.append(el('circle', { cx: X(u), cy: Y(v), r: i === 0 ? 4 : 2.5, class: i === 0 ? 'pv-start' : 'pv-station' }));
    if (i % every === 0 || i === g.stations.length - 1) svg.append(el('text', { x: X(u) + 5, y: Y(v) - 5, class: 'pv-text' }, n));
  });
  const length = rows.filter((r) => r.kind === 'leg').reduce((a, r) => a + r.shot.distance, 0);
  const zs = g.stations.map(([, q]) => q[1]);
  const depth = zs.length ? Math.max(...zs) - Math.min(...zs) : 0;
  return `${legsCount} legs, ${rows.length - legsCount} splays, ${length.toFixed(1)} m surveyed` +
    (view === 'elevation' ? `, ${depth.toFixed(1)} m vertical range` : `, ${span.toFixed(1)} m across`);
}
