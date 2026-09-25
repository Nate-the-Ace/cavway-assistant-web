import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import { cavecadCsv, groupShots, nextStation } from '../src/cavecad.js';

const shot = (o) => ({ time: 1700000000, isLeg: true, isCali: false, flags: 7, distance: 3, azimuth: 10, inclination: 0, errorInfo: 'No error', ...o });

test('station names', () => {
  assert.equal(nextStation('A1'), 'A2');
  assert.equal(nextStation('A09'), 'A10');
  assert.equal(nextStation('X'), 'X1');
});

test('repeated leg shots merge, splays and cali shots handled', () => {
  const g = groupShots([
    shot({ azimuth: 359.5 }), shot({ azimuth: 0.5, distance: 3.02 }), shot({ azimuth: 0.1 }),
    shot({ isLeg: false }), shot({ isLeg: false, isCali: true }), shot({ distance: 5 }),
  ]);
  assert.deepEqual(g.map((x) => x.kind), ['leg', 'splay', 'leg']);
  assert.equal(g[0].shot.merged, 3);
  assert.ok(azNear(g[0].shot.azimuth, 0.033));
  assert.equal(groupShots([shot({}), shot({})], { mergeLegs: false }).length, 2);
});
const azNear = (a, b) => Math.abs(((a - b + 540) % 360) - 180) < 0.01;

test('csv text', () => {
  const csv = cavecadCsv([shot({ azimuth: 358 }), shot({ isLeg: false, distance: 1.2345 }), shot({ flags: 2, distance: 4 })],
    { declination: -4.5, start: 'A1', name: 'Test Cave', serial: 42 });
  const l = csv.split('\n');
  assert.equal(l[0], '# name: Test Cave');
  assert.equal(l[1], '# date: 2023-11-14');
  assert.equal(l[2], '# declination: -4.5');
  assert.equal(l[3], '# unit: m');
  assert.equal(l[6], 'A1,A2,3.000,353.50,0.00,,,,,,,,22:13:20');
  assert.equal(l[7], 'A2,,1.234,5.50,0.00,,,,,,,,22:13:20');
  assert.equal(l[8], 'A3,A2,4.000,5.50,0.00,,,,,,,,22:13:20; backsight');
  assert.throws(() => cavecadCsv([], { declination: '' }), /declination/);
});

// Parse with the real CaveCAD reader when the cavecad-tools checkout is beside this repo.
const core = new URL('../../cavecad-tools/scripts/CaveSurvey/Core/', import.meta.url);
test('CaveCAD CsFormatCsv reads the export', { skip: !existsSync(core) && 'cavecad-tools not found' }, () => {
  const ctx = vm.createContext({ console });
  for (const f of ['CsAngles.js', 'CsModel.js', 'CsTraverse.js', 'Format/CsCsv.js']) {
    vm.runInContext(readFileSync(new URL(f, core), 'utf8'), ctx, { filename: f });
  }
  const csv = cavecadCsv([shot({ azimuth: 100 }), shot({ isLeg: false, distance: 1.5 }), shot({ distance: 7, inclination: -12 })],
    { declination: 2, start: 'A1', name: 'Test Cave' });
  ctx.csv = csv;
  const s = vm.runInContext('CsFormatCsv.parse(csv)', ctx);
  assert.equal(s.distanceUnit, 'm');
  assert.equal(s.declination, 2);
  assert.equal(s.shots.length, 3);
  assert.equal(s.shots[0].azimuth, 102);
  assert.equal(s.shots[1].splay, true);
  assert.equal(s.shots[2].from, 'A2');
  assert.equal(s.shots[2].to, 'A3');
  assert.equal(s.shots[2].inclination, -12);
});

test('layout places stations, backsights and splays', async () => {
  const { traverse, layout } = await import('../src/cavecad.js');
  const rows = traverse([shot({ azimuth: 90, distance: 10 }), shot({ isLeg: false, azimuth: 0, distance: 2 }),
    shot({ flags: 2, azimuth: 180, distance: 5, inclination: -30 })], { start: 'A1', mergeLegs: false });
  const { stations, splays } = layout(rows);
  const near = (p, q) => p.every((v, i) => Math.abs(v - q[i]) < 1e-9);
  assert.ok(near(stations.get('A2'), [10, 0, 0]));
  // backsight from A3 to A2 at 180 deg, -30: A3 lies north of A2 and higher
  assert.ok(near(stations.get('A3'), [10, 5 * Math.cos(Math.PI / 6), 2.5]));
  assert.ok(near(splays[0].b, [10, 2, 0]));
});
