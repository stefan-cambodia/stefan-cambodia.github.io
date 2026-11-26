// The road graph: reading Overpass, the grid index, snapping and routing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore, readJsonFixture, graphOf, plain, SMALL_FIXTURE } from './helpers.mjs';

const C = loadCore();
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} is not within ${tol} of ${b}`);

// A hand-made Overpass answer on a 100 m grid near Kampot.
//
//   7 ------- 8 ------- 9          row 2 (north)
//   |         |         |
//   4 ------- 5 ------- 6          row 1     5-6 is a track
//   |         |         |
//   1 ------- 2 ------- 3          row 0     plus 20 - 21, a road apart from the rest
//
const LAT = 10.6, LON = 104.18;
const M = C.metersPerDegree(LAT);
const node = (id, col, row) => ({ type: 'node', id, lat: LAT + row * 100 / M.lat, lon: LON + col * 100 / M.lon });
const way = (id, nodes, tags) => ({ type: 'way', id, nodes, tags });
function synthetic() {
  return {
    elements: [
      way(100, [1, 2, 3], { highway: 'primary', surface: 'asphalt' }),
      way(101, [4, 5], { highway: 'residential' }),
      way(102, [5, 6], { highway: 'track', surface: 'laterite' }),
      way(103, [7, 8, 9], { highway: 'tertiary' }),
      way(104, [1, 4, 7], { highway: 'unclassified', surface: 'gravel' }),
      way(105, [2, 5, 8], { highway: 'secondary', bridge: 'yes', width: '4' }),
      way(106, [3, 6, 9], { highway: 'residential', tunnel: 'yes', surface: 'concrete:plates' }),
      way(107, [20, 21], { highway: 'residential' }),
      // Never loaded:
      way(200, [1, 5], { highway: 'footway' }),
      way(201, [1, 5], { highway: 'steps' }),
      way(202, [1, 5], { highway: 'pedestrian' }),
      way(203, [1, 5], { highway: 'construction' }),
      way(204, [1, 5], { highway: 'proposed' }),
      way(205, [1, 5], { highway: 'abandoned' }),
      way(206, [1, 2, 5, 1], { highway: 'service', area: 'yes' }),
      way(207, [1, 5], { building: 'yes' }),
      node(1, 0, 0), node(2, 1, 0), node(3, 2, 0), node(4, 0, 1), node(5, 1, 1), node(6, 2, 1),
      node(7, 0, 2), node(8, 1, 2), node(9, 2, 2), node(20, 5, 0), node(21, 6, 0),
    ],
  };
}
const at = (col, row) => [LAT + row * 100 / M.lat, LON + col * 100 / M.lon];
function graph() {
  const g = C.createGraph();
  C.addOverpass(g, synthetic());
  return g;
}
const ALL = null;
const NO_TRACK = C.DEFAULT_ALLOWED.filter((c) => c !== 'track');

test('default classes: the six of the brief, their links and trunk', () => {
  for (const c of ['primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'track', 'trunk', 'primary_link', 'secondary_link', 'tertiary_link']) {
    assert.ok(C.DEFAULT_ALLOWED.includes(c), c);
  }
  for (const c of ['footway', 'path', 'service', 'cycleway', 'motorway']) assert.ok(!C.DEFAULT_ALLOWED.includes(c), c);
});

test('addOverpass: keeps roads, drops excluded classes and areas', () => {
  const g = C.createGraph();
  const res = C.addOverpass(g, synthetic());
  assert.equal(res.ways.length, 8);
  assert.equal(res.excluded, 7);          // six classes and one area; the building has no highway tag
  assert.equal(res.nodes, 11);
  assert.equal(res.edges, 13);
  assert.equal(g.ways.length, 8);
  assert.deepEqual(plain(g.ways.map((w) => w.id)), [100, 101, 102, 103, 104, 105, 106, 107]);
  assert.throws(() => C.addOverpass(g, { nothing: true }), /bad_overpass/);
});

test('addOverpass: a second load merges by OSM id', () => {
  const g = C.createGraph();
  const data = synthetic();
  const first = { elements: data.elements.filter((e) => (e.type === 'way' && [100, 104].includes(e.id)) || (e.type === 'node' && [1, 2, 3, 4, 7].includes(e.id))) };
  C.addOverpass(g, first);
  assert.equal(g.ways.length, 2);
  assert.equal(g.lat.length, 5);
  const v1 = g.version;
  const res = C.addOverpass(g, data);
  assert.equal(res.known, 2);             // ways 100 and 104 were there
  assert.equal(res.ways.length, 6);
  assert.equal(res.nodes, 6);             // nodes 1, 2, 3, 4, 7 are not added twice
  assert.equal(g.lat.length, 11);
  assert.ok(g.version > v1);
  // Loading the same answer again changes nothing.
  const again = C.addOverpass(g, data);
  assert.equal(again.ways.length, 0);
  assert.equal(again.nodes, 0);
  assert.equal(g.edgeA.length, 13);
  // The two loads are one network: from way 100 (first load) to way 103 (second).
  const a = C.snap(g, ...at(0.5, 0), 10, ALL), b = C.snap(g, ...at(1.5, 2), 10, ALL);
  const r = C.route(g, a, b, ALL);
  assert.ok(r.ok);
  near(r.length, 300, 0.01);
});

test('addOverpass: a way with a node outside the answer is cut there', () => {
  const g = C.createGraph();
  C.addOverpass(g, { elements: [way(1, [1, 2, 99, 3], { highway: 'primary' }), node(1, 0, 0), node(2, 1, 0), node(3, 3, 0)] });
  assert.equal(g.edgeA.length, 1);
});

test('tags: surfaces, widths, bridges and tunnels', () => {
  const S = C.SURFACES;
  assert.deepEqual(plain(S), ['asphalt', 'concrete', 'paved', 'gravel', 'dirt', 'sand', 'unknown']);
  const name = (surface, cls) => S[C.surfaceIndex(surface, cls)];
  assert.equal(name('asphalt', 'track'), 'asphalt');
  for (const v of ['concrete', 'concrete:plates', 'concrete:lanes']) assert.equal(name(v, 'track'), 'concrete');
  for (const v of ['paved', 'paving_stones', 'sett', 'cobblestone']) assert.equal(name(v, 'track'), 'paved');
  for (const v of ['gravel', 'fine_gravel', 'compacted', 'pebblestone']) assert.equal(name(v, 'primary'), 'gravel');
  for (const v of ['dirt', 'earth', 'ground', 'unpaved', 'mud', 'laterite', 'clay']) assert.equal(name(v, 'primary'), 'dirt');
  assert.equal(name('sand', 'primary'), 'sand');
  assert.equal(name(' Asphalt ; dirt', 'track'), 'asphalt');
  // No tag: by class.
  for (const c of ['trunk', 'primary', 'secondary', 'tertiary', 'primary_link', 'tertiary_link']) assert.equal(name(undefined, c), 'asphalt');
  assert.equal(name(undefined, 'track'), 'dirt');
  for (const c of ['residential', 'unclassified', 'service']) assert.equal(name(undefined, c), 'unknown');
  assert.equal(name('something_new', 'residential'), 'unknown');

  assert.equal(C.parseWidth('4'), 4);
  assert.equal(C.parseWidth('4.5 m'), 4.5);
  assert.equal(C.parseWidth('4,5'), 4.5);
  near(C.parseWidth('12 ft'), 3.6576, 1e-9);
  near(C.parseWidth("12'"), 3.6576, 1e-9);
  for (const bad of ['', 'narrow', '-3', '0', undefined, null, '3;4']) assert.equal(C.parseWidth(bad), null);

  const g = graph();
  const byId = (id) => g.ways[g.wayIndex.get(id)];
  assert.equal(byId(105).flags, 1);
  assert.equal(byId(105).width, 4);
  assert.equal(byId(106).flags, 2);
  assert.equal(S[byId(106).surface], 'concrete');
  assert.equal(S[byId(102).surface], 'dirt');
  assert.equal(S[byId(101).surface], 'unknown');
  assert.equal(byId(100).flags, 0);
});

test('class families for the map', () => {
  assert.equal(C.classFamily('primary'), 'major');
  assert.equal(C.classFamily('secondary_link'), 'major');
  assert.equal(C.classFamily('residential'), 'minor');
  assert.equal(C.classFamily('track'), 'track');
  assert.equal(C.classFamily('service'), 'other');
  assert.equal(C.classFamily('path'), 'other');
  // What is drawn as a road or a track is what the router may use, and nothing else.
  for (const c of C.DEFAULT_ALLOWED) assert.notEqual(C.classFamily(c), 'other', c);
  for (const c of ['motorway', 'living_street', 'service', 'path', 'cycleway', 'bridleway', 'road']) assert.equal(C.classFamily(c), 'other', c);
});

test('snap: the nearest point of the nearest segment', () => {
  const g = graph();
  const [lat, lon] = at(0.5, 0);
  const s = C.snap(g, lat + 5 / M.lat, lon, 20, ALL);
  assert.ok(s);
  near(s.dist, 5, 0.01);
  near(s.t, 0.5, 1e-6);
  near(s.lat, lat, 1e-9); near(s.lon, lon, 1e-9);
  assert.equal(s.cls, 'primary');
  // Past the end of a road: the end itself.
  const end = C.snap(g, ...at(6.1, 0), 20, ALL);
  near(end.dist, 10, 0.01);
  assert.ok(end.t === 0 || end.t === 1);
  // Too far.
  assert.equal(C.snap(g, ...at(0.5, 0.5), 20, ALL), null);
  assert.ok(C.snap(g, ...at(0.5, 0.5), 51, ALL));
});

test('snap: only the allowed classes', () => {
  const g = graph();
  const [lat, lon] = at(1.5, 1);     // on the track 5 - 6
  assert.equal(C.snap(g, lat, lon, 20, ALL).cls, 'track');
  assert.equal(C.snap(g, lat, lon, 20, NO_TRACK), null);
  const far = C.snap(g, lat, lon, 60, NO_TRACK);
  near(far.dist, 50, 0.01);
  assert.notEqual(far.cls, 'track');
});

test('snap: the grid index finds what a full scan finds (real roads)', () => {
  const g = graphOf(SMALL_FIXTURE);
  const allowed = C.DEFAULT_ALLOWED, set = new Set(allowed);
  let seed = 7, found = 0;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let k = 0; k < 400; k++) {
    const lat = 13.398 + rnd() * 0.024, lon = 103.846 + rnd() * 0.032, reach = [15, 60, 400, 3000][k % 4];
    const m = C.metersPerDegree(lat);
    let best = Infinity;
    for (let e = 0; e < g.edgeA.length; e++) {
      if (!set.has(g.ways[g.edgeWay[e]].cls)) continue;
      const a = g.edgeA[e], b = g.edgeB[e];
      const ax = (g.lon[a] - lon) * m.lon, ay = (g.lat[a] - lat) * m.lat, bx = (g.lon[b] - lon) * m.lon, by = (g.lat[b] - lat) * m.lat;
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0;
      best = Math.min(best, Math.hypot(ax + dx * t, ay + dy * t));
    }
    const s = C.snap(g, lat, lon, reach, allowed);
    if (best <= reach) { assert.ok(s, `point ${k}: a road at ${best.toFixed(1)} m was missed`); near(s.dist, best, 1e-6); found++; }
    else assert.equal(s, null, `point ${k}: nothing within ${reach} m, yet a snap`);
  }
  assert.ok(found > 100, 'the sample should hit roads often enough to mean something');
});

test('route: shortest path with the partial lengths at both ends', () => {
  const g = graph();
  // From 30 m along 1-2 to 80 m along 8-9 (north row): 70 + 200 + 80 or 30 + 200 + 180.
  const a = C.snap(g, ...at(0.3, 0), 5, ALL), b = C.snap(g, ...at(1.8, 2), 5, ALL);
  const r = C.route(g, a, b, ALL);
  assert.ok(r.ok);
  near(r.length, 350, 0.01);
  assert.equal(r.lat.length, r.seg.length + 1);
  near(r.lat[0], a.lat, 1e-12); near(r.lon.at(-1), b.lon, 1e-12);
  // The line it returns is as long as the length it reports.
  let len = 0;
  for (let i = 0; i + 1 < r.lat.length; i++) len += C.distance(r.lat[i], r.lon[i], r.lat[i + 1], r.lon[i + 1]);
  near(len, r.length, 0.01);
  // It leaves through node 2 (70 m) rather than node 1 (30 m back, then 400 m).
  near(r.lat[1], at(1, 0)[0], 1e-9); near(r.lon[1], at(1, 0)[1], 1e-9);
});

test('route: both ends of the first segment are tried', () => {
  const g = graph();
  // From 30 m along 1-2 to the west column: leaving backwards through node 1 is shorter.
  const a = C.snap(g, ...at(0.3, 0), 5, ALL), b = C.snap(g, ...at(0, 1.5), 5, ALL);
  const r = C.route(g, a, b, ALL);
  near(r.length, 30 + 150, 0.01);
  near(r.lon[1], at(0, 0)[1], 1e-9);
});

test('route: two waypoints on the same segment', () => {
  const g = graph();
  const a = C.snap(g, ...at(0.2, 0), 5, ALL), b = C.snap(g, ...at(0.9, 0), 5, ALL);
  assert.equal(a.edge, b.edge);
  const r = C.route(g, a, b, ALL);
  assert.ok(r.ok);
  near(r.length, 70, 0.01);
  assert.equal(r.lat.length, 2);
  assert.deepEqual(plain(r.seg), [a.edge]);
  const back = C.route(g, b, a, ALL);
  near(back.length, 70, 0.01);
  const still = C.route(g, a, a, ALL);
  assert.ok(still.ok);
  assert.equal(still.length, 0);
});

test('route: forbidden classes are not used', () => {
  const g = graph();
  const a = C.snap(g, ...at(1, 1.1), 5, ALL), b = C.snap(g, ...at(2, 1.1), 5, ALL);
  near(C.route(g, a, b, ALL).length, 10 + 100 + 10, 0.01);            // along the track 5 - 6
  near(C.route(g, a, b, NO_TRACK).length, 90 + 100 + 90, 0.01);       // round by the north row
  // A waypoint on a forbidden road cannot be routed at all.
  const onTrack = C.snap(g, ...at(1.5, 1), 5, ALL);
  const r = C.route(g, a, onTrack, NO_TRACK);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'class');
});

test('route: no path is a result, not an exception', () => {
  const g = graph();
  const a = C.snap(g, ...at(0.5, 0), 5, ALL), island = C.snap(g, ...at(5.5, 0), 5, ALL);
  const r = C.route(g, a, island, ALL);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no_path');
  assert.equal(C.route(g, a, { edge: -1, t: 0 }, ALL).reason, 'unsnapped');
});

test('route: Dijkstra with a heap gives the lengths of a plain Dijkstra (real roads)', () => {
  const g = graphOf(SMALL_FIXTURE);
  const allowed = C.DEFAULT_ALLOWED, set = new Set(allowed), n = g.lat.length;
  const usable = [];
  for (let e = 0; e < g.edgeA.length; e++) if (set.has(g.ways[g.edgeWay[e]].cls)) usable.push(e);
  // Plain O(n²) Dijkstra from a node, written without the core.
  function plainDijkstra(src) {
    const dist = new Float64Array(n).fill(Infinity), done = new Uint8Array(n);
    const adj = new Map();
    for (const e of usable) {
      for (const [u, v] of [[g.edgeA[e], g.edgeB[e]], [g.edgeB[e], g.edgeA[e]]]) {
        if (!adj.has(u)) adj.set(u, []);
        adj.get(u).push([v, g.edgeLen[e]]);
      }
    }
    dist[src] = 0;
    for (;;) {
      let u = -1, best = Infinity;
      for (const k of adj.keys()) if (!done[k] && dist[k] < best) { best = dist[k]; u = k; }
      if (u < 0) break;
      done[u] = 1;
      for (const [v, w] of adj.get(u)) if (dist[u] + w < dist[v]) dist[v] = dist[u] + w;
    }
    return dist;
  }
  let seed = 99, compared = 0, unreachable = 0;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let k = 0; k < 6; k++) {
    const ea = usable[Math.floor(rnd() * usable.length)];
    const from = { edge: ea, t: 0 };                        // exactly at node edgeA
    const dist = plainDijkstra(g.edgeA[ea]);
    for (let q = 0; q < 25; q++) {
      const eb = usable[Math.floor(rnd() * usable.length)], t = rnd();
      if (eb === ea) continue;
      const r = C.route(g, from, { edge: eb, t }, allowed);
      const want = Math.min(dist[g.edgeA[eb]] + t * g.edgeLen[eb], dist[g.edgeB[eb]] + (1 - t) * g.edgeLen[eb]);
      if (want === Infinity) { assert.equal(r.ok, false); unreachable++; continue; }
      assert.ok(r.ok);
      near(r.length, want, 1e-6, `pair ${k}/${q}`);
      compared++;
    }
  }
  assert.ok(compared > 60, `only ${compared} reachable pairs were compared (${unreachable} unreachable)`);
});

test('buildRoute: a stage has n - 1 legs, a loop n, and each leg is cached', () => {
  const g = graph();
  const wps = [at(0.5, 0), at(2, 0.5), at(1.5, 2), at(0, 1.5)].map(([la, lo]) => C.snap(g, la, lo, 5, ALL));
  const cache = C.createLegCache();
  const stage = C.buildRoute(g, wps, 'stage', ALL, cache);
  assert.ok(stage.ok);
  assert.equal(stage.legs.length, 3);
  near(stage.length, 200 + 200 + 200, 0.01);
  assert.equal(stage.line.closed, false);
  assert.equal(stage.line.lat.length, stage.line.seg.length + 1);
  assert.equal(cache.size, 3);
  const loop = C.buildRoute(g, wps, 'loop', ALL, cache);
  assert.equal(loop.legs.length, 4);
  assert.equal(cache.size, 4);            // three legs came from the cache
  assert.equal(loop.legs[0], stage.legs[0]);
  near(loop.length, 800, 0.01);
  // The loop's line ends where it began.
  near(loop.line.lat.at(-1), loop.line.lat[0], 1e-12);
  near(loop.line.lon.at(-1), loop.line.lon[0], 1e-12);
  // Other classes: other legs.
  C.buildRoute(g, wps, 'loop', NO_TRACK, cache);
  assert.equal(cache.size, 8);
});

test('buildRoute: a leg without a path is reported, the others are kept', () => {
  const g = graph();
  const wps = [at(0.5, 0), at(5.5, 0), at(1.5, 2)].map(([la, lo]) => C.snap(g, la, lo, 5, ALL));
  const r = C.buildRoute(g, wps, 'stage', ALL, null);
  assert.equal(r.ok, false);
  assert.equal(r.line, null);
  assert.deepEqual(plain(r.legs.map((l) => l.ok)), [false, false]);
  assert.equal(r.legs[0].reason, 'no_path');
  const one = C.buildRoute(g, wps.slice(0, 1), 'loop', ALL, null);
  assert.equal(one.ok, false);
  assert.equal(one.legs.length, 0);
});

test('buildRoute: the cache does not outlive a change of the graph', () => {
  const g = C.createGraph();
  const data = synthetic();
  // First without the middle column 2-5-8: the way round is longer.
  C.addOverpass(g, { elements: data.elements.filter((e) => e.id !== 105) });
  const cache = C.createLegCache();
  const wps = () => [at(1, 0.02), at(1, 1.98)].map(([la, lo]) => C.snap(g, la, lo, 30, ALL));
  const before = C.buildRoute(g, wps(), 'stage', ALL, cache);
  near(before.length, 100 + 200 + 100, 0.5);      // snapped on the rows, round by a side column
  C.addOverpass(g, data);
  const after = C.buildRoute(g, wps(), 'stage', ALL, cache);
  near(after.length, 196, 0.5);                  // snapped on the new column, straight up it
});

test('real fixture: what was loaded', () => {
  const g = graphOf(SMALL_FIXTURE);
  const raw = readJsonFixture(SMALL_FIXTURE);
  assert.match(raw.osm3s.copyright, /ODbL/);
  const classes = new Set(g.ways.map((w) => w.cls));
  for (const c of C.EXCLUDED_CLASSES) assert.ok(!classes.has(c), `${c} was loaded`);
  assert.ok(classes.has('secondary') && classes.has('track') && classes.has('residential'));
  assert.ok(raw.elements.some((e) => e.type === 'way' && e.tags?.highway === 'footway'), 'the fixture should hold footways to exclude');
  assert.equal(g.ways.length, raw.elements.filter((e) => e.type === 'way' && !C.EXCLUDED_CLASSES.includes(e.tags.highway) && e.tags.area !== 'yes').length);
  for (let e = 0; e < g.edgeA.length; e++) assert.ok(Number.isFinite(g.edgeLen[e]) && g.edgeLen[e] >= 0);
});
