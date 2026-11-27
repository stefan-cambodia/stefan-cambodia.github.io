// The export chain: from a routed line to a .cambotrack.json file.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadCore, readSchema, validateSchema, formatRuleErrors, gaps, plain, buildSample, elevationStore,
  graphOf, routeThrough, readJsonFixture, SMALL_FIXTURE, SAMPLES,
} from './helpers.mjs';

const C = loadCore();
const schema = readSchema();
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} is not within ${tol} of ${b}`);

// Checks a built track against the schema and the rules of FORMAT.md.
function assertValid(track) {
  assert.deepEqual(validateSchema(schema, track), []);
  const { errors, length } = formatRuleErrors(track);
  assert.deepEqual(errors, []);
  const check = C.checkTrack(track);
  assert.deepEqual(plain(check.errors), []);
  return length;
}

// A hand-made network: nodes are [id, east, north] in metres from (LAT, LON).
const LAT = 10.6, LON = 104.18;
const M = C.metersPerDegree(LAT);
const ll = (east, north) => [LAT + north / M.lat, LON + east / M.lon];
function network(nodes, ways) {
  const g = C.createGraph();
  C.addOverpass(g, {
    elements: [
      ...ways.map(([id, refs, tags]) => ({ type: 'way', id, nodes: refs, tags })),
      ...nodes.map(([id, e, n]) => { const [lat, lon] = ll(e, n); return { type: 'node', id, lat, lon }; }),
    ],
  });
  return g;
}
function build(g, points, settings, ele = null) {
  const kind = settings.kind ?? 'loop';
  const { wps, route } = routeThrough(g, points.map(([e, n]) => ll(e, n)), kind, null, 5);
  assert.ok(route.ok, 'the test course must be routable');
  const s = { id: 'test', name: 'Test', relief: false, ...settings, waypoints: wps.map((w) => [w.lat, w.lon]) };
  return { res: C.buildTrack(g, route.line, s, ele), route, wps };
}
// A 2 km by 1 km rectangle of plain roads.
const RECT_NODES = [[1, 0, 0], [2, 2000, 0], [3, 2000, 1000], [4, 0, 1000]];
const rectangle = () => network(RECT_NODES, [[10, [1, 2, 3, 4, 1], { highway: 'secondary' }]]);
const RECT_VIA = [[500, 0], [2000, 500], [1000, 1000], [0, 500]];

/* ----------------------------------------------------------------- samples */

test('sample loop: fits the schema and every rule of the format', () => {
  const { result } = buildSample('loop');
  assert.ok(result.ok, JSON.stringify(result.errors));
  const t = result.track;
  const length = assertValid(t);
  assert.equal(t.kind, 'loop');
  assert.equal(t.laps, 3);
  assert.deepEqual(plain(t.points[0].slice(0, 3)), [0, 0, 0]);
  near(t.length_game_m, length, 0.06);
  assert.equal(t.elevation, null);
  assert.ok(t.points.every((p) => p[1] === 0), 'a flat course has y = 0 everywhere');
  assert.equal(t.origin.ele, undefined);
  assert.equal(t.id, 'sample-loop');
  assert.deepEqual(plain(t.surfaces), plain(C.SURFACES));
  assert.deepEqual(plain(t.allowed_classes), plain(C.DEFAULT_ALLOWED));
  assert.equal(t.waypoints.length, SAMPLES.loop.waypoints.length);
  assert.match(t.attribution, /OpenStreetMap contributors \(ODbL 1\.0\)/);
  assert.ok(!/Copernicus/.test(t.attribution));
});

test('loop: the closing stretch is as long as the others, the spacing is regular', () => {
  const { result } = buildSample('loop');
  const t = result.track, g = gaps(t), n = t.points.length;
  assert.equal(g.length, n);                              // the closing gap is counted
  const mean = g.reduce((a, b) => a + b, 0) / n;
  near(mean, t.spacing, 0.02 * t.spacing, 'mean gap');
  assert.equal(n, Math.round(t.length_game_m / t.spacing));
  // Equal steps along the curve: chords shorten a little in bends, never by much.
  const closing = g[n - 1];
  for (const d of g) near(d, mean, 0.03 * mean + 0.015, 'gap');
  near(closing, mean, 0.03 * mean + 0.015, 'closing gap');
  // On the straights the gaps are the step to the centimetre.
  const sorted = [...g].sort((a, b) => a - b);
  near(sorted[Math.floor(n / 2)], result.stats.step, 0.015, 'median gap');
});

test('loop: lengths', () => {
  const { result, route } = buildSample('loop');
  const t = result.track;
  // Real length: the routed line, to the decimetre, less the few metres of a
  // U-turn at a waypoint snapped beside a junction (see the test further down).
  near(route.length, route.legs.reduce((a, l) => a + l.length, 0), 1e-6);
  const clean = C.cleanLine({ ...plain(route.line), closed: true }, C.RULES.spikeMax);
  let real = 0;
  for (let i = 0; i < clean.lat.length; i++) {
    const j = (i + 1) % clean.lat.length;
    real += C.distance(clean.lat[i], clean.lon[i], clean.lat[j], clean.lon[j]);
  }
  near(t.length_real_m, real, 0.5);
  assert.ok(route.length - real >= 0 && route.length - real <= 2 * C.RULES.spikeMax * clean.trimmed);
  // Game length: real length over the scale, less what the smoothing cuts off the corners.
  const ideal = t.length_real_m / t.scale;
  assert.ok(t.length_game_m <= ideal + 0.5, 'smoothing cannot lengthen the course');
  assert.ok(t.length_game_m > 0.96 * ideal, `the course lost too much: ${t.length_game_m} of ${ideal}`);
  near(result.stats.lap_time_s, t.length_game_m / 17.75, 0.01);
  near(result.stats.total_time_s, 3 * t.length_game_m / 17.75, 0.02);
});

test('loop: the origin is where point 0 lies, the points sit on the map', () => {
  const { result, route } = buildSample('loop');
  const t = result.track, back = C.trackToLatLon(t);
  near(back[0][0], t.origin.lat, 1e-9); near(back[0][1], t.origin.lon, 1e-9);
  // The start stays within the smoothing radius of the first waypoint.
  assert.ok(C.distance(t.origin.lat, t.origin.lon, t.waypoints[0][0], t.waypoints[0][1]) < 15 * t.scale);
  // Every point is close to the routed line: smoothing only cuts corners.
  const line = route.line;
  let worst = 0;
  for (let k = 0; k < back.length; k += 3) {
    let best = Infinity;
    for (let i = 0; i + 1 < line.lat.length; i++) {
      const m = C.metersPerDegree(back[k][0]);
      const ax = (line.lon[i] - back[k][1]) * m.lon, ay = (line.lat[i] - back[k][0]) * m.lat;
      const bx = (line.lon[i + 1] - back[k][1]) * m.lon, by = (line.lat[i + 1] - back[k][0]) * m.lat;
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      const u = len2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0;
      best = Math.min(best, Math.hypot(ax + dx * u, ay + dy * u));
    }
    worst = Math.max(worst, best);
  }
  assert.ok(worst < 12, `a point lies ${worst.toFixed(1)} real metres from the roads`);
});

test('sample stage: fits the schema and the rules, ends on its last waypoint', () => {
  const { result, wps } = buildSample('stage', elevationStore());
  assert.ok(result.ok, JSON.stringify(result.errors));
  const t = result.track;
  assertValid(t);
  assert.equal(t.kind, 'stage');
  assert.equal(t.laps, undefined);
  assert.deepEqual(plain(t.points[0].slice(0, 3)), [0, 0, 0]);
  const back = C.trackToLatLon(t), n = t.points.length;
  assert.ok(C.distance(back[0][0], back[0][1], wps[0].lat, wps[0].lon) < 0.02, 'the start is the first waypoint');
  assert.ok(C.distance(back[n - 1][0], back[n - 1][1], wps.at(-1).lat, wps.at(-1).lon) < 0.05, 'the finish is the last waypoint');
  // Regular spacing, last gap included.
  const g = gaps(t), mean = g.reduce((a, b) => a + b, 0) / g.length;
  assert.equal(g.length, n - 1);
  for (const d of g) near(d, mean, 0.03 * mean + 0.015, 'gap');
  assert.equal(n, Math.round(t.length_game_m / t.spacing) + 1);
});

test('stage with relief: elevation read from the recorded answer, slopes limited', () => {
  const store = elevationStore();
  const { result, plan } = buildSample('stage', store);
  const t = result.track;
  assert.equal(t.elevation.source, 'copernicus-glo90/open-meteo');
  assert.match(t.attribution, /Copernicus DEM GLO-90 via Open-Meteo/);
  // One sample about every 30 real metres, at most 100 coordinates a request.
  const stepSeen = plan.length / (plan.chain.length - 1);
  near(stepSeen, 30, 1);
  assert.equal(C.elevationMissing(plan, store).key.length, 0);
  // The profile stays inside what the samples say, and the figures agree with the points.
  const raw = plan.key.map((k) => store.get(k));
  assert.ok(t.elevation.min >= Math.min(...raw) - 0.05 && t.elevation.max <= Math.max(...raw) + 0.05);
  assert.ok(t.elevation.max > t.elevation.min);
  const ys = t.points.map((p) => p[1]);
  near(Math.max(...ys) * t.vertical_scale + t.origin.ele, t.elevation.max, 0.15);
  near(Math.min(...ys) * t.vertical_scale + t.origin.ele, t.elevation.min, 0.15);
  let climb = 0;
  for (let i = 1; i < ys.length; i++) climb += Math.max(0, ys[i] - ys[i - 1]) * t.vertical_scale;
  near(climb, t.elevation.climb_m, 0.02 * t.elevation.climb_m + 0.5, 'positive climb');
  assert.ok(ys.some((y) => y !== 0));
  assert.equal(ys[0], 0);
  // 30 % in the file, half of what the format allows (a centimetre of rounding apart).
  const g = gaps(t);
  for (let i = 0; i < g.length; i++) {
    assert.ok(Math.abs(ys[i + 1] - ys[i]) <= 0.30 * g[i] + 0.011, `slope at ${i}`);
  }
  // The profile handed to the interface is the one of the file.
  assert.equal(result.profile.ele.length, t.points.length);
  near(result.profile.ele[0], t.origin.ele, 0.06);
});

test('relief: without elevations the export says so; relief off gives a flat file', () => {
  const missing = buildSample('stage', null);
  assert.equal(missing.result.ok, false);
  assert.equal(missing.result.errors[0].code, 'no_elevation');
  const g = graphOf(SMALL_FIXTURE);
  const { wps, route } = routeThrough(g, SAMPLES.stage.waypoints, 'stage', C.DEFAULT_ALLOWED);
  const flat = C.buildTrack(g, route.line, { ...SAMPLES.stage.settings, relief: false, waypoints: wps.map((w) => [w.lat, w.lon]) }, null);
  assert.ok(flat.ok);
  assert.equal(flat.track.elevation, null);
  assert.ok(flat.track.points.every((p) => p[1] === 0));
  assertValid(flat.track);
});

test('relief: a cliff in the data, or a strong vertical exaggeration, still gives 30 %', () => {
  const g = rectangle();
  const { route } = routeThrough(g, RECT_VIA.map(([e, n]) => ll(e, n)), 'loop', null, 5);
  const clean = C.cleanLine({ ...plain(route.line), closed: true }, C.RULES.spikeMax);
  const plan = C.elevationPlan(clean);
  // A 200 m wall across the course, and noise.
  const store = new Map();
  plan.key.forEach((k, i) => store.set(k, (plan.chain[i] > 1500 && plan.chain[i] < 3500 ? 200 : 0) + (i % 2) * 6));
  const ele = C.elevationSamples(plan, store);
  for (const vertical of [2.5, 0.5]) {
    const res = C.buildTrack(g, route.line, { id: 'wall', name: 'Wall', kind: 'loop', relief: true, vertical_scale: vertical }, ele);
    assert.ok(res.ok, JSON.stringify(res.errors));
    const t = res.track, gp = gaps(t), n = t.points.length;
    assertValid(t);
    let steepest = 0;
    for (let i = 0; i < n; i++) steepest = Math.max(steepest, Math.abs(t.points[(i + 1) % n][1] - t.points[i][1]) / gp[i]);
    assert.ok(steepest <= 0.305, `steepest slope ${steepest}`);
    assert.ok(steepest > 0.29, 'the wall should be climbed at the limit');
    assert.equal(t.points[0][1], 0);
  }
});

test('limitSlope: forward and backward passes, open and closed', () => {
  const v = Float64Array.from([0, 0, 0, 10, 10, 10, 0, 0]);
  const lim = new Float64Array(7).fill(2);
  const open = C.limitSlope(v, lim, false);
  for (let i = 0; i + 1 < open.length; i++) assert.ok(Math.abs(open[i + 1] - open[i]) <= 2 + 1e-12);
  // Symmetric: the summit is lowered as much as the foot is raised.
  near(open[3] + open[2], 10, 1e-9);
  const closed = C.limitSlope(Float64Array.from([10, 0, 0, 0, 0, 0, 0, 10]), new Float64Array(8).fill(1), true);
  for (let i = 0; i < 8; i++) assert.ok(Math.abs(closed[(i + 1) % 8] - closed[i]) <= 1 + 1e-12);
  // A profile already gentle is left alone.
  const gentle = Float64Array.from([0, 1, 2, 1, 0]);
  assert.deepEqual(plain(Array.from(C.limitSlope(gentle, new Float64Array(4).fill(1), false))), [0, 1, 2, 1, 0]);
});

test('levelNarrow: what is narrower than the window goes, what is wider stays', () => {
  const base = new Array(60).fill(5);
  const v = base.slice();
  for (let i = 10; i < 16; i++) v[i] = 33;            // a bump six points wide
  v[20] = 44;                                         // a spike
  for (let i = 26; i < 29; i++) v[i] = -4;            // a hollow three points wide
  for (let i = 36; i < 54; i++) v[i] = 25;            // a plateau eighteen points wide
  for (const closed of [false, true]) {
    const out = plain(Array.from(C.levelNarrow(Float64Array.from(v), closed, 5)));
    const want = base.slice();
    for (let i = 36; i < 54; i++) want[i] = 25;
    assert.deepEqual(out, want, closed ? 'closed' : 'open');
  }
  // A window of one point changes nothing, and a line too short is left alone.
  assert.deepEqual(plain(Array.from(C.levelNarrow(Float64Array.from(v), false, 0))), v);
  assert.deepEqual(plain(Array.from(C.levelNarrow(Float64Array.from([1, 9]), false, 3))), [1, 9]);
  // Two bumps a few points apart are two bumps, not a hill with a hollow in it: both go.
  const pair = base.slice();
  for (let i = 10; i < 16; i++) pair[i] = 33;
  pair[19] = 44;
  assert.deepEqual(plain(Array.from(C.levelNarrow(Float64Array.from(pair), false, 5))), base);
  // A bump at the seam of a closed line is a bump like another.
  const seam = base.slice();
  seam[58] = seam[59] = seam[0] = seam[1] = 40;
  assert.deepEqual(plain(Array.from(C.levelNarrow(Float64Array.from(seam), true, 5))), base);
});

// A loop of 6 km on flat ground at 5 m, with what a surface model adds beside a
// road (a hillside 180 m long, a single high cell, a river under a bridge) and
// a real hill: 60 m high, 1.5 km from foot to foot.
function bumpyRelief(settings) {
  const g = rectangle();
  const { route, wps } = routeThrough(g, RECT_VIA.map(([e, n]) => ll(e, n)), 'loop', null, 5);
  const plan = C.elevationPlan(C.cleanLine({ ...plain(route.line), closed: true }, C.RULES.spikeMax));
  const store = new Map();
  plan.key.forEach((k, i) => {
    const c = plan.chain[i];
    let h = 5;
    if (c >= 1000 && c < 1180) h = 33;
    else if (c >= 1300 && c < 1330) h = 44;
    else if (c >= 1600 && c < 1690) h = 0;
    else if (c >= 3000 && c <= 4500) h = 5 + 30 * (1 - Math.cos(2 * Math.PI * (c - 3000) / 1500));
    store.set(k, Math.round(h));
  });
  const s = { id: 'bumps', name: 'Bumps', kind: 'loop', relief: true, ...settings, waypoints: wps.map((w) => [w.lat, w.lon]) };
  const res = C.buildTrack(g, route.line, s, C.elevationSamples(plan, store));
  assert.ok(res.ok, JSON.stringify(res.errors));
  // The profile by real metres along the course: [from, to] -> lowest and highest.
  const between = (a, b) => {
    const ys = res.profile.ele.filter((_, i) => res.profile.dist[i] * res.track.scale >= a && res.profile.dist[i] * res.track.scale <= b);
    return [Math.min(...ys), Math.max(...ys)];
  };
  return { res, t: res.track, between };
}

test('relief smoothing: « Fort » takes the narrow bumps and hollows out and keeps the hill', () => {
  const normal = bumpyRelief({}), strong = bumpyRelief({ relief_smooth_m: 300 });
  assertValid(normal.t);
  assertValid(strong.t);
  // As it has always been: the hillside, the high cell and the river are in the road.
  assert.ok(normal.between(1030, 1150)[1] > 30, 'normal keeps the hillside');
  assert.ok(normal.between(1280, 1350)[1] > 15, 'normal keeps most of the high cell');
  assert.ok(normal.between(1620, 1670)[0] < 1, 'normal keeps the river');
  // « Fort »: the road stays at its 5 m there...
  for (const [a, b] of [[900, 1280], [1280, 1400], [1500, 1800]]) {
    const [lo, hi] = strong.between(a, b);
    assert.ok(lo > 4.4 && hi < 5.6, `strong, ${a} to ${b} m: ${lo} to ${hi}`);
  }
  // ... and the hill is still a hill. Its top (65 m) loses what the road gains
  // over the last 150 m, about 6 m here: the price of the choice.
  const top = strong.between(3700, 3800)[1];
  assert.ok(top > 58 && top < 60, `the hill's top: ${top}`);
  near(normal.between(3700, 3800)[1], 65, 0.5, 'normal keeps the top');
  near(strong.t.elevation.min, 5, 0.6);
  near(strong.t.elevation.climb_m, top - 5, 1, 'the only climb left is the hill');
  assert.ok(normal.t.elevation.climb_m > strong.t.elevation.climb_m + 40, `normal climbs ${normal.t.elevation.climb_m}`);
  assert.notEqual(strong.t.hash, normal.t.hash);
});

test('relief smoothing: the default is the file of always, the choice is kept for « Ouvrir »', () => {
  const normal = bumpyRelief({}), same = bumpyRelief({ relief_smooth_m: 90 }), strong = bumpyRelief({ relief_smooth_m: 300 });
  assert.equal(C.serializeTrack(same.t), C.serializeTrack(normal.t));
  assert.equal('relief_smooth_m' in normal.t.editor, false);
  assert.equal(strong.t.editor.relief_smooth_m, 300);
  // Out of range, it is brought back: never less than the plain 90 m, never more than a kilometre.
  assert.equal(C.normalizeSettings({ relief_smooth_m: 20 }).relief_smooth_m, 90);
  assert.equal(C.normalizeSettings({ relief_smooth_m: 5000 }).relief_smooth_m, 1000);
  assert.equal(C.normalizeSettings({ relief_smooth_m: 'fort' }).relief_smooth_m, 90);
  assert.equal(C.normalizeSettings({}).relief_smooth_m, 90);
  assert.equal(C.serializeTrack(bumpyRelief({ relief_smooth_m: 20 }).t), C.serializeTrack(normal.t));
  // A flat circuit has no relief to smooth: nothing is written.
  const flat = bumpyRelief({ relief: false, relief_smooth_m: 300 });
  assert.equal('relief_smooth_m' in flat.t.editor, false);
  // Read back from the file.
  const parsed = C.parseTrack(C.serializeTrack(strong.t));
  assert.ok(parsed.ok && parsed.check.ok);
  assert.equal(parsed.track.editor.relief_smooth_m, 300);
});

test('relief smoothing on real answers: the coast road at the point of Kep', () => {
  const kep = readJsonFixture('kep-loop.elevations.json');
  const raw = Float64Array.from(kep.elevation);
  const chain = (metres) => Math.max(1, Math.floor(metres / 2 / kep.step_m));
  const today = C.movingAverage(raw, true, chain(90));
  const strong = C.movingAverage(C.levelNarrow(raw, true, chain(300)), true, chain(300));
  const top = (v, a, b) => Math.max(...Array.from(v).slice(a, b + 1));
  const climb = (v) => Array.from(v).reduce((sum, y, i) => sum + Math.max(0, v[(i + 1) % v.length] - y), 0);
  // The hillside beside the road (33 m over 180 m) and one high cell (44 m).
  assert.ok(top(today, 571, 576) >= 33 && top(today, 579, 581) > 20, 'today the road climbs the hillside');
  assert.ok(top(strong, 565, 585) < 15, `strong: ${top(strong, 565, 585)} m at the point`);
  // The rise that is 480 m long stays.
  assert.ok(top(strong, 601, 616) > 25, `strong: ${top(strong, 601, 616)} m on the long rise`);
  near(Math.min(...strong), Math.min(...raw), 1);
  assert.ok(climb(today) > 190 && climb(strong) < 60, `climb ${climb(today)} then ${climb(strong)}`);
});

test('elevation plan: lattice keys, no repeats, missing values', () => {
  const g = rectangle();
  const { route } = routeThrough(g, RECT_VIA.map(([e, n]) => ll(e, n)), 'loop', null, 5);
  const plan = C.elevationPlan(C.cleanLine({ ...plain(route.line), closed: true }, 30));
  near(plan.length, 6000, 1);
  assert.equal(plan.chain.length, 200);
  const store = new Map();
  const miss = C.elevationMissing(plan, store);
  assert.equal(new Set(miss.key).size, miss.key.length);
  assert.ok(miss.key.length <= plan.key.length);
  // The coordinates asked are on the lattice, within 20 m of the course.
  miss.lat.forEach((lat, i) => {
    near(lat / C.RULES.elevationLattice, Math.round(lat / C.RULES.elevationLattice), 1e-6);
    assert.ok(String(lat).length <= 9 && String(miss.lon[i]).length <= 10);
  });
  assert.equal(C.elevationSamples(plan, store), null);
  miss.key.forEach((k) => store.set(k, 12));
  assert.equal(C.elevationMissing(plan, store).key.length, 0);
  const s = C.elevationSamples(plan, store);
  assert.equal(s.ele.length, plan.chain.length);
  store.set(miss.key[3], NaN);
  assert.equal(C.elevationSamples(plan, store), null);
});

/* ------------------------------------------------------- geometry of the file */

test('axes: x east, z south, north is -z', () => {
  const g = network([[1, 0, 0], [2, 0, 1000], [3, 800, 1000]], [[10, [1, 2, 3], { highway: 'primary' }]]);
  const { res } = build(g, [[0, 0], [800, 1000]], { kind: 'stage', scale: 2, smooth_m: 0 });
  assert.ok(res.ok, JSON.stringify(res.errors));
  const p = res.track.points, n = p.length;
  // 1000 m north then 800 m east, at 1:2.
  near(p[n - 1][0], 400, 0.05, 'x of the finish');
  near(p[n - 1][2], -500, 0.05, 'z of the finish');
  // The corner, 500 game metres north of the start, is one of the points.
  assert.ok(Math.min(...p.map((q) => Math.hypot(q[0], q[2] + 500))) < 0.05);
  assert.ok(p.every((q) => q[0] > -0.05 && q[2] < 0.05 && q[2] > -500.05), 'nothing west or south of the start');
  near(res.track.length_game_m, 900, 0.5);
  near(res.track.length_real_m, 1800, 0.5);
  assertValid(res.track);
});

test('stage: the smoothing leaves both ends in place and rounds the corners', () => {
  const g = network([[1, 0, 0], [2, 0, 1000], [3, 800, 1000]], [[10, [1, 2, 3], { highway: 'primary' }]]);
  const sharp = build(g, [[0, 0], [800, 1000]], { kind: 'stage', smooth_m: 0 }).res;
  const smooth = build(g, [[0, 0], [800, 1000]], { kind: 'stage', smooth_m: 15 }).res;
  assert.deepEqual(plain(smooth.track.points.at(-1).slice(0, 3)), plain(sharp.track.points.at(-1).slice(0, 3)));
  assert.ok(sharp.warnings.some((w) => w.code === 'hairpin'), 'a square corner is a hairpin without smoothing');
  assert.ok(!smooth.warnings.some((w) => w.code === 'hairpin'), 'with the default radius it is not');
  assert.ok(smooth.track.length_game_m < sharp.track.length_game_m);
});

test('attributes: surface, bridge, tunnel and widths come from the source edge', () => {
  const nodes = [[1, 0, 0], [2, 600, 0], [3, 1200, 0], [4, 1800, 0], [5, 2400, 0], [6, 3000, 0]];
  const ways = [
    [10, [1, 2], { highway: 'primary' }],
    [11, [2, 3], { highway: 'track', surface: 'laterite' }],
    [12, [3, 4], { highway: 'secondary', bridge: 'yes', width: '3', surface: 'concrete' }],
    [13, [4, 5], { highway: 'residential', tunnel: 'yes', surface: 'sand' }],
    [14, [5, 6], { highway: 'tertiary', bridge: 'viaduct', width: '6.5', surface: 'gravel' }],
  ];
  const g = network(nodes, ways);
  const course = [[0, 0], [3000, 0]];
  const { res } = build(g, course, { kind: 'stage', smooth_m: 0 });
  assert.ok(res.ok, JSON.stringify(res.errors));
  assertValid(res.track);
  const at = (east) => res.track.points[Math.round(east / 2.5 / res.stats.step)];
  const S = C.SURFACES;
  assert.deepEqual(plain(at(300)), [120, 0, 0, 11, S.indexOf('asphalt'), 0]);
  assert.deepEqual(plain(at(900).slice(3)), [8, S.indexOf('dirt'), 0]);                 // track: 8 m
  assert.deepEqual(plain(at(1500).slice(3)), [6, S.indexOf('concrete'), 1]);            // bridge 3 m: 4.2 -> at least 6
  assert.deepEqual(plain(at(2100).slice(3)), [11, S.indexOf('sand'), 2]);
  assert.deepEqual(plain(at(2700).slice(3)), [9.1, S.indexOf('gravel'), 1]);            // bridge 6.5 m: 1.4 × 6.5
  // Widths change gently: at most a quarter of a metre per metre.
  const p = res.track.points;
  for (let i = 1; i < p.length; i++) {
    assert.ok(Math.abs(p[i][3] - p[i - 1][3]) <= 0.25 * res.stats.step + 0.011, `width step at ${i}`);
  }
  // Options off: the base width everywhere.
  const plainW = build(g, course, { kind: 'stage', smooth_m: 0, narrow_tracks: false, bridge_widths: false }).res;
  assert.ok(plainW.track.points.every((q) => q[3] === 11));
  // A base width under the bridge minimum wins over it.
  const narrow = build(g, course, { kind: 'stage', smooth_m: 0, road_width: 5 }).res;
  assert.ok(narrow.track.points.every((q) => q[3] === 5));
});

test('checkpoints: one a kilometre up to 12 km, one every two beyond', () => {
  const g = rectangle();
  // 6 km of real road: 2400 m at 1:2.5, 6000 m at 1:1.
  const short = build(g, RECT_VIA, { scale: 2.5 }).res;
  assert.equal(short.track.checkpoints.length, 1);
  const six = build(g, RECT_VIA, { scale: 1 }).res;
  assert.equal(six.track.checkpoints.length, 5);
  const big = network([[1, 0, 0], [2, 6000, 0], [3, 6000, 3000], [4, 0, 3000]], [[10, [1, 2, 3, 4, 1], { highway: 'secondary' }]]);
  const long = build(big, [[500, 0], [6000, 500], [1000, 3000], [0, 500]], { scale: 1 }).res;      // 18 km
  near(long.track.length_game_m, 18000, 60);
  assert.equal(long.track.checkpoints.length, 8);
  for (const res of [short, six, long]) {
    const t = res.track, gp = gaps(t), total = gp.reduce((a, b) => a + b, 0), chain = [0];
    gp.forEach((d) => chain.push(chain.at(-1) + d));
    const every = total / (t.checkpoints.length + 1);
    t.checkpoints.forEach((idx, i) => {
      near(chain[idx], (i + 1) * every, 0.6 * t.spacing, 'checkpoint position');
      assert.ok(chain[idx] >= 150 && chain[idx] <= total - 150);
    });
    assertValid(t);
  }
});

test('checkpoints: a custom interval, never within 150 m of the start or the finish', () => {
  const g = rectangle();
  const dense = build(g, RECT_VIA, { scale: 2.5, checkpoint_every_m: 100 }).res;
  const t = dense.track, gp = gaps(t), chain = [0];
  gp.forEach((d) => chain.push(chain.at(-1) + d));
  assert.ok(t.checkpoints.length >= 20);
  for (const idx of t.checkpoints) assert.ok(chain[idx] >= 150 && chain[idx] <= chain.at(-1) - 150, `checkpoint at ${chain[idx]}`);
  assertValid(t);
  // The format allows 200 at most.
  const many = build(g, RECT_VIA, { scale: 1, checkpoint_every_m: 10 }).res;
  assert.ok(many.track.checkpoints.length <= 200);
  assert.ok(many.notes.some((n) => n.code === 'checkpoints_capped'));
  assertValid(many.track);
});

test('gates: on straights only, apart from each other, from checkpoints, start and finish', () => {
  for (const which of ['loop', 'stage']) {
    const { result } = buildSample(which, elevationStore());
    const t = result.track, p = t.points, n = p.length, loop = t.kind === 'loop';
    const gp = gaps(t), chain = [0];
    gp.forEach((d) => chain.push(chain.at(-1) + d));
    const total = chain.at(-1);
    assert.ok(t.gates.length >= 1, `${which}: at least one gate expected`);
    assert.ok(t.gates.length <= Math.round(total / 1000) + 1, 'about one gate a kilometre');
    const curvature = (i) => {
      const a = p[(i - 3 + n) % n], b = p[i], c = p[(i + 3) % n];
      const den = Math.hypot(b[0] - a[0], b[2] - a[2]) * Math.hypot(c[0] - b[0], c[2] - b[2]) * Math.hypot(a[0] - c[0], a[2] - c[2]);
      return 2 * Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0])) / den;
    };
    t.gates.forEach((idx, k) => {
      assert.ok(chain[idx] >= 150 && chain[idx] <= total - 150, 'clear of the start and the finish');
      for (const cp of t.checkpoints) assert.ok(Math.abs(chain[cp] - chain[idx]) >= 150, 'clear of the checkpoints');
      if (k > 0) assert.ok(chain[idx] - chain[t.gates[k - 1]] >= 600, 'gates 600 m apart');
      for (let i = 3; i < n - 3; i++) {
        if (Math.abs(chain[i] - chain[idx]) <= 56) assert.ok(curvature(i) < 1 / 250, `gate ${idx}: bend near point ${i}`);
      }
    });
    if (loop && t.gates.length > 1) assert.ok(total - chain[t.gates.at(-1)] + chain[t.gates[0]] >= 600);
  }
});

test('gates: none on a winding course, none when turned off', () => {
  // A zigzag: a 40 m leg, a square corner, and so on. No 120 m straight anywhere.
  const nodes = [], refs = [];
  for (let i = 0; i <= 60; i++) { nodes.push([i + 1, 40 * Math.ceil(i / 2), 40 * Math.floor(i / 2)]); refs.push(i + 1); }
  const g = network(nodes, [[10, refs, { highway: 'residential' }]]);
  const end = nodes.at(-1);
  const zig = build(g, [[0, 0], [end[1], end[2]]], { kind: 'stage', scale: 1, smooth_m: 10 }).res;
  assert.ok(zig.ok, JSON.stringify(zig.errors));
  assert.ok(zig.track.length_game_m > 2000);
  assert.deepEqual(plain(zig.track.gates), []);
  assertValid(zig.track);
  const off = build(rectangle(), RECT_VIA, { scale: 1, gates_auto: false }).res;
  assert.deepEqual(plain(off.track.gates), []);
  const on = build(rectangle(), RECT_VIA, { scale: 1 }).res;
  assert.ok(on.track.gates.length >= 4, `gates on a rectangle of straights: ${on.track.gates.length}`);
  assertValid(on.track);
});

test('20 000 points at most: the spacing is raised, and the file says so', () => {
  const nodes = [];
  for (let i = 0; i <= 60; i++) nodes.push([i + 1, i * 500, 0]);
  const g = network(nodes, [[10, nodes.map((nd) => nd[0]), { highway: 'trunk' }]]);
  const { res } = build(g, [[0, 0], [30000, 0]], { kind: 'stage', scale: 1, spacing: 1, gates_auto: false });
  assert.ok(res.ok, JSON.stringify(res.errors));
  const t = res.track;
  assert.ok(t.points.length <= 20000 && t.points.length > 19800, `${t.points.length} points`);
  const note = res.notes.find((n) => n.code === 'spacing_raised');
  assert.ok(note);
  assert.equal(note.from, 1);
  assert.equal(note.to, t.spacing);
  near(t.spacing, 1.51, 1e-9);
  assertValid(t);
  // One point a line, far under the 4 MiB the games accept.
  const text = C.serializeTrack(t);
  assert.ok(Buffer.byteLength(text) < 4194304 / 4, `${Buffer.byteLength(text)} bytes`);
  assert.equal(text.split('\n').filter((l) => /^ {4}\[/.test(l)).length, t.points.length);
});

test('errors: a course that leaves the 60 km the format allows, too many waypoints', () => {
  const nodes = [];
  for (let i = 0; i <= 140; i++) nodes.push([i + 1, i * 500, 0]);
  const road = network(nodes, [[10, nodes.map((nd) => nd[0]), { highway: 'trunk' }]]);
  const far = build(road, [[0, 0], [65000, 0]], { kind: 'stage', scale: 1, spacing: 10 }).res;
  assert.equal(far.ok, false);
  assert.equal(far.errors[0].code, 'extent_rule');
  assert.ok(build(road, [[0, 0], [59000, 0]], { kind: 'stage', scale: 1, spacing: 10 }).res.ok);
  const g = rectangle();
  const { route } = routeThrough(g, RECT_VIA.map(([e, n]) => ll(e, n)), 'loop', null, 5);
  const many = C.buildTrack(g, route.line, { kind: 'loop', relief: false, waypoints: new Array(2001).fill([LAT, LON]) }, null);
  assert.equal(many.errors[0].code, 'too_many_waypoints');
});

test('errors: too short, no route', () => {
  const g = rectangle();
  const tiny = build(g, [[0, 0], [600, 0]], { kind: 'stage', scale: 2.5 }).res;       // 240 m of game
  assert.equal(tiny.ok, false);
  assert.equal(tiny.errors[0].code, 'too_short');
  assert.equal(C.buildTrack(g, null, { kind: 'loop' }, null).errors[0].code, 'no_route');
  // 20 laps of 18 km: over the 300 km a game accepts.
  const big = network([[1, 0, 0], [2, 6000, 0], [3, 6000, 3000], [4, 0, 3000]], [[10, [1, 2, 3, 4, 1], { highway: 'secondary' }]]);
  const far = build(big, [[500, 0], [6000, 500], [1000, 3000], [0, 500]], { scale: 1, laps: 20 }).res;
  assert.equal(far.ok, false);
  assert.equal(far.errors[0].code, 'total_too_long');
});

/* ------------------------------------------------------------------ warnings */

test('warnings: under 1.5 km, over 40 km', () => {
  const g = rectangle();
  const codes = (res) => res.warnings.map((w) => w.code);
  assert.ok(codes(build(g, RECT_VIA, { scale: 5 }).res).includes('short'));           // 1200 m
  assert.ok(!codes(build(g, RECT_VIA, { scale: 2.5 }).res).includes('short'));        // 2400 m
  const nodes = [];
  for (let i = 0; i <= 90; i++) nodes.push([i + 1, i * 500, 0]);
  const road = network(nodes, [[10, nodes.map((nd) => nd[0]), { highway: 'trunk' }]]);
  const long = build(road, [[0, 0], [45000, 0]], { kind: 'stage', scale: 1 }).res;
  assert.ok(long.ok);
  assert.ok(codes(long).includes('long'));
  assert.ok(!codes(build(road, [[0, 0], [39000, 0]], { kind: 'stage', scale: 1 }).res).includes('long'));
});

test('warnings: the same road used twice', () => {
  // Out along the south side, round the block, and back along the same south side.
  const g = network([[1, 0, 0], [2, 1000, 0], [3, 2000, 0], [4, 2000, 600], [5, 1000, 600]],
    [[10, [1, 2], { highway: 'primary' }], [11, [2, 3, 4, 5, 2], { highway: 'residential' }]]);
  const twice = build(g, [[100, 0], [1500, 0], [1500, 600], [1000, 300]], { kind: 'loop', scale: 1 }).res;
  assert.ok(twice.ok, JSON.stringify(twice.errors));
  const w = twice.warnings.find((x) => x.code === 'road_twice');
  assert.ok(w, 'way 10 is driven both ways');
  assert.ok(w.length > 800);
  const once = build(rectangle(), RECT_VIA, {}).res;
  assert.ok(!once.warnings.some((x) => x.code === 'road_twice'));
});

test('warnings: a course that crosses itself', () => {
  // A figure of eight through the crossroads at (500, 500).
  const g = network([[1, 0, 500], [2, 500, 500], [3, 1000, 500], [4, 500, 0], [5, 500, 1000], [6, 1000, 1000], [7, 0, 0]],
    [[10, [1, 2, 3], { highway: 'primary' }], [11, [4, 2, 5], { highway: 'primary' }],
      [12, [3, 6, 5], { highway: 'residential' }], [13, [4, 7, 1], { highway: 'residential' }]]);
  const eight = build(g, [[200, 500], [1000, 700], [500, 800], [200, 0]], { kind: 'loop', scale: 1 }).res;
  assert.ok(eight.ok, JSON.stringify(eight.errors));
  const w = eight.warnings.find((x) => x.code === 'self_cross');
  assert.ok(w, 'the figure of eight crosses itself');
  assert.equal(w.count, 1);
  const [lat, lon] = w.at[0];
  assert.ok(C.distance(lat, lon, ...ll(500, 500)) < 25, 'the crossing is at the crossroads');
  assert.ok(!build(rectangle(), RECT_VIA, {}).res.warnings.some((x) => x.code === 'self_cross'));
});

test('warnings: a hairpin under 8 m of radius after smoothing', () => {
  // Two roads meeting at 30 degrees.
  const g = network([[1, 0, 0], [2, 1500, 0], [3, 200, 750]], [[10, [1, 2, 3], { highway: 'tertiary' }]]);
  const res = build(g, [[0, 0], [200, 750]], { kind: 'stage', scale: 2.5 }).res;
  assert.ok(res.ok, JSON.stringify(res.errors));
  const w = res.warnings.find((x) => x.code === 'hairpin');
  assert.ok(w);
  assert.equal(w.count, 1);
  assert.ok(w.radius < 8);
  assert.ok(C.distance(w.at[0][0], w.at[0][1], ...ll(1500, 0)) < 60);
  // A square corner: about 0.7 × the smoothing radius. 5 m is too tight, 15 m is not.
  const square = network([[1, 0, 0], [2, 1500, 0], [3, 1500, 800]], [[10, [1, 2, 3], { highway: 'tertiary' }]]);
  const tight = build(square, [[0, 0], [1500, 800]], { kind: 'stage', smooth_m: 5 }).res;
  const tw = tight.warnings.find((x) => x.code === 'hairpin');
  assert.ok(tw && tw.radius > 2.5 && tw.radius < 4.5, `radius ${tw && tw.radius}`);
  assert.ok(!build(square, [[0, 0], [1500, 800]], { kind: 'stage', smooth_m: 15 }).res.warnings.some((x) => x.code === 'hairpin'));
});

test('a U-turn of a few metres beside a junction is dropped, a long one is kept', () => {
  // The waypoint sits 12 m up a side road: the course would go in and come back.
  const g = network([[1, 0, 0], [2, 1000, 0], [3, 2000, 0], [4, 1000, 400]],
    [[10, [1, 2, 3], { highway: 'primary' }], [11, [2, 4], { highway: 'residential' }]]);
  const near12 = build(g, [[0, 0], [1000, 12], [2000, 0]], { kind: 'stage', scale: 1 }).res;
  assert.ok(near12.ok, JSON.stringify(near12.errors));
  assert.ok(near12.notes.some((n) => n.code === 'spike_trimmed'));
  near(near12.track.length_game_m, 2000, 0.5);
  assert.ok(near12.track.points.every((p) => Math.abs(p[2]) < 0.1), 'the course stays on the main road');
  // 200 m up the side road is a choice: it stays, and the file would break the gap rule.
  const far = build(g, [[0, 0], [1000, 200], [2000, 0]], { kind: 'stage', scale: 1 }).res;
  assert.ok(!far.notes.some((n) => n.code === 'spike_trimmed'));
  if (far.ok) near(far.track.length_game_m, 2400, 30);
  else assert.equal(far.errors[0].code, 'gap_rule');
});

/* ------------------------------------------------------ file and catalogue */

test('serialize, parse, check: a round trip', () => {
  const { result, text } = buildSample('stage', elevationStore());
  assert.ok(text.endsWith('}\n'));
  assert.deepEqual(JSON.parse(text), plain(result.track));
  const read = C.parseTrack(text);
  assert.ok(read.ok);
  assert.equal(read.check.hash, result.track.hash);
  assert.deepEqual(plain(read.check.errors), []);
  // The fields come in the order of FORMAT.md.
  assert.deepEqual(Object.keys(JSON.parse(text)).slice(0, 8), ['format', 'version', 'id', 'hash', 'name', 'author', 'created', 'games']);
  assert.equal(C.parseTrack('{nope').error, 'json');
  assert.equal(C.parseTrack('{"format":"other"}').error, 'format');
  assert.equal(C.parseTrack('[]').error, 'format');
});

test('reopening: the waypoints of a file rebuild the same circuit, hash for hash', () => {
  // What « Ouvrir » does: snap the file's waypoints again, route, export with the file's settings.
  const g = graphOf(SMALL_FIXTURE);
  for (const which of ['loop', 'stage']) {
    const first = buildSample(which, elevationStore());
    const file = JSON.parse(first.text);
    const again = routeThrough(g, file.waypoints, file.kind, file.allowed_classes, 1);
    // Snapping a snapped point returns it, to the last bit.
    again.wps.forEach((w, i) => {
      assert.equal(w.lat, file.waypoints[i][0]);
      assert.equal(w.lon, file.waypoints[i][1]);
      assert.ok(w.dist < 1e-6);
    });
    const settings = {
      ...file.editor, id: file.id, name: file.name, author: file.author, created: file.created, games: file.games,
      kind: file.kind, laps: file.laps, scale: file.scale, vertical_scale: file.vertical_scale, road_width: file.road_width,
      spacing: file.spacing, relief: file.elevation !== null, allowed_classes: file.allowed_classes,
      waypoints: again.wps.map((w) => [w.lat, w.lon]),
    };
    let ele = null;
    if (settings.relief) {
      const clean = C.cleanLine({ ...plain(again.route.line), closed: file.kind === 'loop' }, C.RULES.spikeMax);
      ele = C.elevationSamples(C.elevationPlan(clean), elevationStore());
    }
    const second = C.buildTrack(g, again.route.line, settings, ele);
    assert.ok(second.ok);
    assert.equal(second.track.hash, file.hash, `${which}: the hash changed on reopening`);
    assert.equal(C.serializeTrack(second.track), first.text, `${which}: the file changed on reopening`);
  }
});

test('checkTrack: each broken rule is named', () => {
  const { result } = buildSample('loop');
  const good = plain(result.track);
  const broken = (edit, rehash = true) => {
    const t = structuredClone(good);
    edit(t);
    if (rehash) t.hash = C.trackHash(t);
    return plain(C.checkTrack(t).errors.map((e) => e.code));
  };
  assert.deepEqual(broken(() => {}), []);
  assert.deepEqual(broken((t) => { t.points[5][0] += 0.01; }, false), ['hash']);
  assert.deepEqual(broken((t) => { t.version = 2; }), ['version_newer']);
  assert.deepEqual(broken((t) => { t.version = 1.5; }), ['version']);
  assert.deepEqual(broken((t) => { t.id = '-bad-'; }), ['id']);
  assert.deepEqual(broken((t) => { t.kind = 'rally'; }), ['kind']);
  assert.deepEqual(broken((t) => { t.laps = 21; }), ['laps']);
  assert.deepEqual(broken((t) => { t.points.length = 7; }), ['points_count']);
  assert.deepEqual(broken((t) => { t.points[4] = [1, 2, 3]; }), ['point']);
  assert.deepEqual(broken((t) => { t.points[4][0] = 'x'; }), ['point']);
  assert.deepEqual(broken((t) => { t.points[4][3] = 2; }), ['point_width']);
  assert.deepEqual(broken((t) => { t.points[4][4] = 7; }), ['point_surface']);
  assert.deepEqual(broken((t) => { t.points[4][5] = 256; }), ['point_flags']);
  assert.deepEqual(broken((t) => { t.points[0][0] = 0.5; }), ['origin']);
  assert.deepEqual(broken((t) => { t.points[9] = t.points[8].slice(); }), ['gap_rule']);
  assert.deepEqual(broken((t) => { t.points[9][1] = 5; }), ['slope_rule']);
  assert.deepEqual(broken((t) => { t.checkpoints = [10, 10]; }), ['checkpoints']);
  assert.deepEqual(broken((t) => { t.checkpoints = [0]; }), ['checkpoints']);
  assert.deepEqual(broken((t) => { t.checkpoints = [t.points.length]; }), ['checkpoints']);
  assert.deepEqual(broken((t) => { t.gates = [5, 3]; }), ['gates']);
  assert.deepEqual(broken((t) => { delete t.gates; }), []);
  assert.deepEqual(broken((t) => { delete t.checkpoints; }, false), ['checkpoints']);
  // A stage stops one point earlier: its last point is the finish.
  const stage = plain(buildSample('stage', elevationStore()).result.track);
  stage.checkpoints = [stage.points.length - 1];
  stage.hash = C.trackHash(stage);
  assert.deepEqual(plain(C.checkTrack(stage).errors.map((e) => e.code)), ['checkpoints']);
});

test('slugify: an id from a name', () => {
  assert.equal(C.slugify('Petit Circuit perso'), 'petit-circuit-perso');
  assert.equal(C.slugify('  Été à Kép — n°2 !'), 'ete-a-kep-n-2');
  assert.equal(C.slugify('ភ្នំពេញ'), '');
  assert.equal(C.slugify('a'.repeat(80)).length, 64);
  assert.ok(C.isValidId(C.slugify('Bokor: la montée')));
  assert.ok(!C.isValidId(''));
  assert.ok(!C.isValidId('A'));
  assert.ok(!C.isValidId('a-'));
  assert.ok(C.isValidId('a'));
});

test('catalogue: an entry is added, then replaced, never doubled', () => {
  const loop = buildSample('loop'), stage = buildSample('stage', elevationStore());
  const e1 = C.catalogEntry(loop.result.track, loop.result.bbox, '2026-11-26T14:00:00Z');
  assert.deepEqual(Object.keys(plain(e1)), ['id', 'name', 'file', 'hash', 'kind', 'laps', 'length_game_m', 'climb_m', 'games', 'author', 'updated', 'bbox']);
  assert.equal(e1.file, 'sample-loop.cambotrack.json');
  assert.equal(e1.climb_m, 0);
  assert.equal(e1.laps, 3);
  const [south, west, north, east] = e1.bbox;
  assert.ok(south < north && west < east);
  // The box is the one of the course; a waypoint may sit a few metres off it (dropped U-turn).
  for (const [lat, lon] of loop.result.track.waypoints) {
    assert.ok(lat >= south - 5e-4 && lat <= north + 5e-4 && lon >= west - 5e-4 && lon <= east + 5e-4);
  }
  assert.ok(C.bboxAreaKm2(south, west, north, east) > 0.2 && C.bboxAreaKm2(south, west, north, east) < 1);
  let cat = C.updateCatalog(null, e1, '2026-11-26T14:00:00Z');
  assert.deepEqual(plain(cat), { format: 'cambotrack-catalog', version: 1, updated: '2026-11-26T14:00:00Z', tracks: [plain(e1)] });
  const e2 = C.catalogEntry(stage.result.track, stage.result.bbox, '2026-11-26T15:00:00Z');
  assert.equal(e2.laps, 1);
  assert.ok(e2.climb_m > 0);
  cat = C.updateCatalog(cat, e2, '2026-11-26T15:00:00Z');
  assert.equal(cat.tracks.length, 2);
  const e1b = { ...plain(e1), hash: 'f'.repeat(64), updated: '2026-11-26T16:00:00Z' };
  cat = C.updateCatalog(cat, e1b, '2026-11-26T16:00:00Z');
  assert.equal(cat.tracks.length, 2);
  assert.equal(cat.tracks[0].hash, 'f'.repeat(64));
  assert.equal(cat.updated, '2026-11-26T16:00:00Z');
  assert.deepEqual(JSON.parse(C.serializeCatalog(cat)), plain(cat));
  assert.deepEqual(JSON.parse(C.serializeCatalog(C.emptyCatalog('2026-11-26T14:00:00Z'))),
    { format: 'cambotrack-catalog', version: 1, updated: '2026-11-26T14:00:00Z', tracks: [] });
  // What is not a catalogue is never replaced by one.
  assert.throws(() => C.updateCatalog({ tracks: 'x' }, e1, 'now'), /bad_catalog/);
  assert.throws(() => C.updateCatalog([], e1, 'now'), /bad_catalog/);
});

test('settings: defaults of the brief, values kept in range', () => {
  const d = C.normalizeSettings({});
  assert.equal(d.scale, 2.5);
  assert.equal(d.vertical_scale, 2.5);
  assert.equal(d.road_width, 11);
  assert.equal(d.kind, 'loop');
  assert.deepEqual(plain(d.games), ['3d_buggy', 'cambodia_rally']);
  assert.deepEqual(plain(d.allowed_classes), plain(C.DEFAULT_ALLOWED));
  // The vertical scale follows the scale unless it is set.
  assert.equal(C.normalizeSettings({ scale: 4 }).vertical_scale, 4);
  assert.equal(C.normalizeSettings({ scale: 4, vertical_scale: 1 }).vertical_scale, 1);
  const wild = C.normalizeSettings({ scale: 99, road_width: 1, spacing: 0, laps: 50, vertical_scale: 0, kind: 'x', name: 'n'.repeat(200) });
  assert.equal(wild.scale, 10);
  assert.equal(wild.road_width, 3);
  assert.equal(wild.spacing, 1);
  assert.equal(wild.laps, 20);
  assert.equal(wild.vertical_scale, 0.5);
  assert.equal(wild.kind, 'loop');
  assert.equal(wild.name.length, 80);
  // What the hash quantises is written already rounded: scale and vertical scale
  // to the thousandth, width and spacing to the hundredth.
  const fine = C.normalizeSettings({ scale: 2.34567, vertical_scale: 1.00049, road_width: 10.126, spacing: 3.333 });
  assert.deepEqual([fine.scale, fine.vertical_scale, fine.road_width, fine.spacing], [2.346, 1, 10.13, 3.33]);
  for (const v of [fine.scale, fine.vertical_scale]) assert.equal(C.q3(v) / 1000, v);
  for (const v of [fine.road_width, fine.spacing]) assert.equal(C.q2(v) / 100, v);
  // Names are cut by characters: no half emoji at the end.
  assert.equal(C.normalizeSettings({ name: '😀'.repeat(100) }).name, '😀'.repeat(80));
  assert.equal(C.normalizeSettings({ author: '  ' + 'é'.repeat(70) + ' ' }).author, 'é'.repeat(60));
  assert.equal(C.REF_SPEED, 17.75);
  near(21300 / C.REF_SPEED, 20 * 60, 0.5);       // the 21.3 km stage takes 20 minutes
});
