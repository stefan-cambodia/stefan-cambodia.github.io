// Objects placed by hand (core, section 10 b; FORMAT.md, « Objets posés »).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { loadCore, plain, TOOL_DIR, buildSample, SAMPLES, SMALL_FIXTURE, graphOf, validateSchema, readSchema } from './helpers.mjs';

const C = loadCore();
const O = { lat: 10.6104, lon: 104.1815 };            // a start in Kampot

test('the file has them in the frame of the points, rounded as FORMAT.md says', () => {
  const m = C.metersPerDegree(O.lat);
  // 25 m east and 50 m north of the start, at scale 2.5: x = 10, z = -20.
  const objs = [{ kind: 'palm_a', lat: O.lat + 50 / m.lat, lon: O.lon + 25 / m.lon, heading: 90.04, size: 1.234 }];
  const f = plain(C.objectsField(objs, O.lat, O.lon, 2.5, '2026-11-28T01:00:00Z'));
  assert.equal(f.v, 1);
  assert.equal(f.made, '2026-11-28T01:00:00Z');
  assert.equal(f.items.length, 1);
  const [kind, x, z, heading, size] = f.items[0];
  assert.equal(kind, 'palm_a');
  assert.ok(Math.abs(x - 10) < 0.02 && Math.abs(z + 20) < 0.02, `x ${x}, z ${z}`);
  assert.equal(heading, 90);
  assert.equal(size, 1.23);
  assert.ok(C.objectsOk(f));
});

test('headings and sizes are put back in range; bad objects are left out', () => {
  assert.equal(C.cleanHeading(-90), 270);
  assert.equal(C.cleanHeading(720.3), 0.3);
  assert.equal(C.cleanHeading(359.97), 0);
  assert.equal(C.cleanHeading(NaN), 0);
  assert.equal(C.cleanSize(5), 2);
  assert.equal(C.cleanSize(0.1), 0.5);
  assert.equal(C.cleanSize('x'), 1);
  assert.equal(C.cleanObject({ kind: 'Palm A', lat: 1, lon: 1 }), null);
  assert.equal(C.cleanObject({ kind: 'palm_a', lat: 91, lon: 1 }), null);
  assert.equal(C.cleanObject({ kind: 'x'.repeat(49), lat: 1, lon: 1 }), null);
  assert.deepEqual(plain(C.cleanObject({ kind: 'palm_a', lat: 1, lon: 2 })), { kind: 'palm_a', lat: 1, lon: 2, heading: 0, size: 1 });
  // Nothing to write: no field at all (the file stays what it was).
  assert.equal(C.objectsField([], O.lat, O.lon, 2.5, ''), null);
  assert.equal(C.objectsField([{ kind: '!', lat: O.lat, lon: O.lon }], O.lat, O.lon, 2.5, ''), null);
});

test('objectsOk refuses what the editor would not write', () => {
  const good = { v: 1, made: '2026-11-28T01:00:00Z', items: [['palm_a', 1.25, -3, 90, 1]] };
  assert.ok(C.objectsOk(good));
  const bad = (change) => { const f = JSON.parse(JSON.stringify(good)); change(f); return C.objectsOk(f); };
  assert.equal(bad((f) => { f.v = 2; }), false);
  assert.equal(bad((f) => { f.made = 'hier'; }), false);
  assert.equal(bad((f) => { f.items[0][0] = 'Palm'; }), false);
  assert.equal(bad((f) => { f.items[0][1] = 1.255; }), false);
  assert.equal(bad((f) => { f.items[0][2] = 60001; }), false);
  assert.equal(bad((f) => { f.items[0][3] = 360; }), false);
  assert.equal(bad((f) => { f.items[0][3] = 90.25; }), false);
  assert.equal(bad((f) => { f.items[0][4] = 2.5; }), false);
  assert.equal(bad((f) => { f.items[0].push(0); }), false);
  assert.equal(bad((f) => { f.items = Array(2001).fill(['palm_a', 0, 0, 0, 1]); }), false);
});

test('« Ouvrir » puts them back where they were placed', () => {
  const m = C.metersPerDegree(O.lat);
  const objs = [];
  for (let i = 0; i < 20; i++) {
    objs.push(C.cleanObject({ kind: i % 2 ? 'pagoda' : 'house_stilt_a', lat: O.lat + (i * 37 - 300) / m.lat, lon: O.lon + (i * 53 - 500) / m.lon, heading: i * 17, size: 0.5 + i * 0.05 }));
  }
  const f = C.objectsField(objs, O.lat, O.lon, 2.5, '2026-11-28T01:00:00Z');
  const back = plain(C.objectsFromTrack({ objects: f, origin: O, scale: 2.5 }));
  assert.equal(back.length, 20);
  back.forEach((b, i) => {
    // 2 decimals of a game metre at scale 2.5: within 2.5 cm real.
    assert.ok(C.distance(b.lat, b.lon, objs[i].lat, objs[i].lon) < 0.03, `object ${i} moved`);
    assert.equal(b.kind, objs[i].kind);
    assert.equal(b.heading, objs[i].heading);
    assert.equal(b.size, objs[i].size);
  });
  // A file without them, or without an origin: none.
  assert.deepEqual(plain(C.objectsFromTrack({ origin: O, scale: 2.5 })), []);
  assert.deepEqual(plain(C.objectsFromTrack({ objects: f, scale: 2.5 })), []);
});

test('the footprint turns with the heading: the front faces it, the model\'s X is to its left seen from the front', () => {
  const e = { w: 10, d: 4, cx: 0, cz: 0 };
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  // Facing north: 10 m east-west, 4 m north-south, the arrow to the north.
  let fp = plain(C.objectFootprint(e, { heading: 0, size: 1 }, 1));
  const span = (pts, k) => Math.max(...pts.map((p) => p[k])) - Math.min(...pts.map((p) => p[k]));
  assert.ok(near(span(fp.corners, 0), 10) && near(span(fp.corners, 1), 4));
  assert.ok(near(fp.front[0], 0) && fp.front[1] > 2);
  // Facing east, twice the size, at scale 2.5: 50 m north-south, 20 m east-west, the arrow east.
  fp = plain(C.objectFootprint(e, { heading: 90, size: 2 }, 2.5));
  assert.ok(near(span(fp.corners, 1), 50) && near(span(fp.corners, 0), 20));
  assert.ok(fp.front[0] > 10 && Math.abs(fp.front[1]) < 1e-9);
  // Godot: Basis(UP, PI - heading) takes the model's +X to (-cos h, sin h) east-north.
  const h = 30 * Math.PI / 180, a = Math.PI - h;
  const gx = [Math.cos(a), -Math.sin(a)];         // the basis' X in game x, z
  fp = plain(C.objectFootprint({ w: 2, d: 0, cx: 1, cz: 0 }, { heading: 30, size: 1 }, 1));
  assert.ok(near(fp.centre[0], gx[0]) && near(fp.centre[1], -gx[1]));
  // A kind the library does not know: a 4 m square.
  fp = plain(C.objectFootprint(null, { heading: 0, size: 1 }, 1));
  assert.ok(near(span(fp.corners, 0), 4) && near(span(fp.corners, 1), 4));
});

test('a draft keeps them, and the date they last changed', () => {
  const objs = [{ kind: 'tuk_tuk', lat: O.lat, lon: O.lon, heading: 45, size: 1 }];
  const text = JSON.stringify(C.makeDraft('loop', [[O.lat, O.lon]], {}, null, null, '', [], [], objs, '2026-11-28T02:00:00Z'));
  const d = plain(C.parseDraft(text));
  assert.deepEqual(d.objects, objs);
  assert.equal(d.objects_made, '2026-11-28T02:00:00Z');
  // A bad one is dropped, the others stay.
  const raw = JSON.parse(text);
  raw.objects.push(['Bad Kind', 1, 1, 0, 1], 'x');
  assert.equal(plain(C.parseDraft(JSON.stringify(raw))).objects.length, 1);
});

test('the library beside the page: every kind can be written in a file, and each has a thumbnail', () => {
  const src = fs.readFileSync(new URL('objects-library.js', TOOL_DIR), 'utf8');
  const ctx = vm.createContext({ window: {} });
  vm.runInContext(src, ctx);
  const lib = ctx.window.CIRCUIT_OBJECTS;
  assert.equal(lib.format, 'circuit-objects');
  assert.ok(lib.objects.length > 250, `${lib.objects.length} objects`);
  assert.match(lib.atlas, /^data:image\/webp;base64,/);
  const seen = new Set();
  lib.objects.forEach((e, i) => {
    assert.match(e.id, C.OBJECT_KIND);
    assert.ok(!seen.has(e.id), `${e.id} twice`);
    seen.add(e.id);
    assert.ok(e.f === 'p' || e.f === 's');
    assert.ok(typeof lib.groups[e.g] === 'string', `${e.id}: group ${e.g} has a name`);
    assert.ok(e.n && e.w >= 0 && e.d >= 0 && e.h > 0, `${e.id}: name and size`);
    assert.equal(e.t, i, 'thumbnails in the order of the list');
  });
  assert.ok(Math.ceil(lib.objects.length / lib.cols) * lib.cell > 0);
  // The race's own furniture is not in it.
  ['start_arch', 'checkpoint_arch', 'finish_arch', 'ramp', 'gate', 'bridge'].forEach((k) => assert.ok(!seen.has(k), k));
});

test('a track with objects: built, checked, written and read back; the hash ignores them', () => {
  const plainBuild = buildSample('loop');
  assert.ok(plainBuild.result.ok);
  const t0 = plainBuild.result.track;
  assert.equal(t0.objects, undefined, 'no objects, no field');
  const m = C.metersPerDegree(t0.origin.lat);
  const objs = [
    { kind: 'pagoda', lat: t0.origin.lat + 40 / m.lat, lon: t0.origin.lon + 20 / m.lon, heading: 180, size: 1 },
    { kind: 'cone', lat: t0.origin.lat, lon: t0.origin.lon, heading: 0, size: 1 }];
  const sample = SAMPLES.loop;
  const settings = { ...sample.settings, allowed_classes: C.DEFAULT_ALLOWED, waypoints: plainBuild.wps.map((w) => [w.lat, w.lon]),
    objects: objs, objects_made: '2026-11-28T03:00:00Z' };
  const res = C.buildTrack(graphOf(SMALL_FIXTURE), plainBuild.route.line, settings, null);
  assert.ok(res.ok);
  const t = res.track;
  assert.equal(t.hash, t0.hash, 'objects are outside the hash');
  assert.equal(t.objects.items.length, 2);
  assert.deepEqual(plain(t.objects.items[1]), ['cone', 0, 0, 0, 1], 'an object on the start stands at the origin');
  assert.ok(C.checkTrack(t).ok);
  assert.deepEqual(validateSchema(readSchema(), plain(t)), []);
  // Written one object a line, read back the same.
  const text = C.serializeTrack(t);
  assert.match(text, /\n  "objects": \{"v": 1, "made": "2026-11-28T03:00:00Z", "items": \[\n    \["pagoda",/);
  const back = C.parseTrack(text);
  assert.ok(back.ok && back.check.ok);
  assert.deepEqual(plain(back.track.objects), plain(t.objects));
  // A broken objects field does not make the file unreadable: the core says so, the games drop it.
  const broken = JSON.parse(text);
  broken.objects.items[0][3] = 400;
  const p2 = C.parseTrack(JSON.stringify(broken));
  assert.ok(p2.ok);
  assert.deepEqual(plain(p2.check.errors.map((e) => e.code)), ['objects']);
});

test('a row from one click to another: evenly spaced, both ends included', () => {
  const m = C.metersPerDegree(O.lat);
  const a = { lat: O.lat, lon: O.lon }, b = { lat: O.lat, lon: O.lon + 100 / m.lon };
  const row = plain(C.rowPlaces(a, b, 9));
  assert.equal(row.length, 12, '100 m every ~9 m: 11 gaps');
  assert.ok(Math.abs(row[11].lon - b.lon) < 1e-12 && row[0].lon === a.lon);
  const gap = C.distance(row[0].lat, row[0].lon, row[1].lat, row[1].lon);
  assert.ok(Math.abs(gap - 100 / 11) < 0.01, `gap ${gap}`);
  assert.equal(plain(C.rowPlaces(a, a, 5)).length, 1, 'one click twice: one object');
  assert.equal(plain(C.rowPlaces(a, { lat: O.lat, lon: O.lon + 50000 / m.lon }, 1)).length, C.ROW_MAX, 'at most ROW_MAX');
});

test('a row along the course keeps its side and distance, faces the road, and goes round a loop', () => {
  const m = C.metersPerDegree(O.lat);
  // A square loop of 200 m: east along the south side, north, west, then south down the west side.
  const pts = [[0, 0], [200, 0], [200, 200], [0, 200]];
  const lat = [], lon = [];
  for (let i = 0; i < 4; i++) {
    const [e0, n0] = pts[i], [e1, n1] = pts[(i + 1) % 4];
    for (let k = 0; k < 20; k++) { lat.push(O.lat + (n0 + (n1 - n0) * k / 20) / m.lat); lon.push(O.lon + (e0 + (e1 - e0) * k / 20) / m.lon); }
  }
  const line = { lat, lon };
  const ll = (e, n) => ({ lat: O.lat + n / m.lat, lon: O.lon + e / m.lon });
  // South of the south side (right of travel going east), 8 m off, from 20 m to 120 m.
  let row = plain(C.alongCourse(line, true, ll(20, -8), ll(120, -3), 10));
  assert.equal(row.length, 11);
  row.forEach((o) => {
    const n = (o.lat - O.lat) * m.lat;
    assert.ok(Math.abs(n + 8) < 0.01, `stays 8 m south (${n})`);
    assert.ok(Math.abs(o.heading - 0) < 0.1 || Math.abs(o.heading - 360) < 0.1, `faces north, the road (${o.heading})`);
  });
  // Round the corner: from the south side to the east side, outside the square.
  row = plain(C.alongCourse(line, true, ll(150, -10), ll(210, 60), 10));
  const last = row[row.length - 1];
  assert.ok(Math.abs((last.lon - O.lon) * m.lon - 210) < 0.05, 'ends 10 m east of the east side');
  assert.ok(Math.abs(last.heading - 270) < 0.1, `facing west, the road (${last.heading})`);
  // Past the start of the loop: the row goes on round, it does not turn back.
  row = plain(C.alongCourse(line, true, ll(-10, 150), ll(30, -10), 10));
  // 150 m down the west side, then 30 m along the south side: 180 m, 19 objects, all 10 m outside.
  assert.equal(row.length, 19, 'round the start');
  row.forEach((o) => {
    const e = (o.lon - O.lon) * m.lon, n = (o.lat - O.lat) * m.lat;
    assert.ok(Math.abs(e + 10) < 0.05 || Math.abs(n + 10) < 0.05 || (e < 0 && n < 0), `outside the square (${e.toFixed(2)}, ${n.toFixed(2)})`);
  });
  // On the road itself: along it.
  row = plain(C.alongCourse(line, true, ll(40, 0), ll(80, 0), 20));
  assert.ok(row.every((o) => Math.abs(o.heading - 90) < 0.1), 'on the road: facing the way of the race');
  assert.deepEqual(plain(C.alongCourse({ lat: [O.lat], lon: [O.lon] }, true, ll(0, 0), ll(1, 1), 5)), []);
});

test('water rings: on the Earth from a scenery, and a point inside or out', () => {
  const t = { origin: O, scale: 2, scenery: { water: [{ kind: 'pond', ring: [[0, 0], [50, 0], [50, -50], [0, -50]] }] } };
  const rings = plain(C.waterRings(t));
  assert.equal(rings.length, 1);
  const m = C.metersPerDegree(O.lat);
  // The pond: 100 x 100 real metres north-east of the start (z negative is north).
  assert.ok(C.inRing(O.lat + 50 / m.lat, O.lon + 50 / m.lon, rings[0]));
  assert.ok(!C.inRing(O.lat - 10 / m.lat, O.lon + 50 / m.lon, rings[0]));
  assert.ok(!C.inRing(O.lat + 50 / m.lat, O.lon + 120 / m.lon, rings[0]));
  assert.deepEqual(plain(C.waterRings({ origin: O, scale: 2 })), []);
});
