// The scenery of the real place: PMTiles archives, vector tiles, and the
// `scenery` field built from them (FORMAT.md, Décor).
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { loadCore, plain, readSchema, validateSchema, mvtBytes, pmtilesBytes, pmtilesId } from './helpers.mjs';

const C = loadCore();
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} is not within ${tol} of ${b}`);

/* ------------------------------------------------------------------ PMTiles */

test('pmTileId: the specification\'s Hilbert ids', () => {
  assert.deepEqual([[0, 0, 0], [1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0], [2, 0, 0]].map(([z, x, y]) => C.pmTileId(z, x, y)), [0, 1, 2, 3, 4, 5]);
  for (const [z, x, y] of [[13, 6466, 3836], [14, 12933, 7672], [14, 0, 16383], [10, 1023, 0], [7, 55, 99]]) {
    assert.equal(C.pmTileId(z, x, y), pmtilesId(z, x, y), `${z}/${x}/${y}`);
  }
});

function readArchive(bytes) {
  const h = C.pmHeader(bytes.subarray(0, 127));
  const dir = (o, l) => C.pmDirectory(new Uint8Array(zlib.gunzipSync(bytes.subarray(o, o + l))));
  const root = dir(h.rootOffset, h.rootLength);
  return (z, x, y) => {
    const id = C.pmTileId(z, x, y);
    let entries = root;
    for (let d = 0; d < 4; d++) {
      const e = C.pmFind(entries, id);
      if (!e) return null;
      if (e.runLength > 0) return new Uint8Array(zlib.gunzipSync(bytes.subarray(h.dataOffset + e.offset, h.dataOffset + e.offset + e.length)));
      entries = dir(h.leafOffset + e.offset, e.length);
    }
    return null;
  };
}

test('PMTiles: header, directory, a leaf directory, tiles found and missing', () => {
  const tiles = [[14, 12933, 7672], [14, 12934, 7672], [14, 12933, 7673], [13, 6466, 3836]].map(([z, x, y], i) => ({ z, x, y, bytes: Uint8Array.from([i, i, i]) }));
  for (const leaf of [false, true]) {
    const tile = readArchive(pmtilesBytes(tiles, { leaf }));
    tiles.forEach((t, i) => assert.deepEqual([...tile(t.z, t.x, t.y)], [i, i, i], `${leaf} ${t.z}/${t.x}/${t.y}`));
    assert.equal(tile(14, 12935, 7672), null);
    assert.equal(tile(3, 1, 1), null);
  }
  assert.equal(C.pmHeader(new Uint8Array(127)), null);
  assert.throws(() => C.pmDirectory(Uint8Array.from([0x80])), /varint/);
});

/* ------------------------------------------------------------- vector tiles */

test('mvtDecode: layers, properties of every type, points, lines, closed rings', () => {
  const b = mvtBytes({
    building: [{ type: 3, props: { id: 'a1', subtype: 'religious', height: 7.5, num_floors: 2, is_underground: false }, parts: [[[10, 10], [60, 10], [60, 30], [10, 30]]] }],
    water: [{ type: 2, props: { subtype: 'stream' }, parts: [[[0, 0], [100, 50], [200, 0]]] }, { type: 1, props: {}, parts: [[[5, 6]]] }],
  }, 4096);
  const L = C.mvtDecode(b);
  assert.deepEqual(Object.keys(L).sort(), ['building', 'water']);
  assert.equal(L.building.extent, 4096);
  const f = L.building.features[0];
  assert.deepEqual(plain(f.props), { id: 'a1', subtype: 'religious', height: 7.5, num_floors: 2, is_underground: false });
  assert.deepEqual(plain(f.parts), [[[10, 10], [60, 10], [60, 30], [10, 30], [10, 10]]]);
  assert.deepEqual(plain(L.water.features.map((x) => [x.type, x.parts])), [[2, [[[0, 0], [100, 50], [200, 0]]]], [1, [[[5, 6]]]]]);
  // A tile cut short is refused, never read past its end.
  assert.throws(() => C.mvtDecode(b.subarray(0, b.length - 3)));
});

test('minRect: the smallest rectangle round a building', () => {
  const rect = (cx, cy, l, w, deg) => {
    const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return [[l, w], [-l, w], [-l, -w], [l, -w]].map(([u, v]) => [cx + (u / 2) * c - (v / 2) * s, cy + (u / 2) * s + (v / 2) * c]);
  };
  for (const deg of [0, 17, 45, 104, 160]) {
    const r = C.minRect(rect(5, -3, 14, 6, deg));
    near(r[0], 5, 1e-6); near(r[1], -3, 1e-6); near(r[2], 14, 1e-6); near(r[3], 6, 1e-6);
    assert.equal(r[4], deg % 180, `${deg}°`);
  }
  // An L-shaped house: its bounding rectangle.
  const r = C.minRect([[0, 0], [10, 0], [10, 4], [4, 4], [4, 9], [0, 9]]);
  assert.deepEqual(plain(r.map((v) => Math.round(v * 10) / 10)), [5, 4.5, 10, 9, 0]);
});

/* ------------------------------------------------------------- the scenery */

// A square loop of 400 m of game a side at Angkor, scale 2.5, and tiles drawn
// round it in real metres east and north of its start.
const FRAME = { lat: 13.4125, lon: 103.8666, scale: 2.5, halfRoad: 5.5 };
const LOOP = [];
for (let i = 0; i < 40; i++) LOOP.push([i * 10, 0]);
for (let i = 0; i < 40; i++) LOOP.push([400, -i * 10]);
for (let i = 0; i < 40; i++) LOOP.push([400 - i * 10, -400]);
for (let i = 0; i < 40; i++) LOOP.push([0, -400 + i * 10]);
const enu = C.makeEnu(FRAME.lat, FRAME.lon);
// Real metres east/north to a tile's units.
function tileUnits(z, x, y, extent = 4096) {
  const n = 2 ** z;
  return ([e, nn]) => {
    const [lat, lon] = enu.inverse(e, nn), r = lat * Math.PI / 180;
    return [Math.round(((lon + 180) / 360 * n - x) * extent), Math.round(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n - y) * extent)];
  };
}
const box = (e0, n0, e1, n1) => [[e0, n0], [e0, n1], [e1, n1], [e1, n0]];     // clockwise on screen: an outer ring
const boxCcw = (e0, n0, e1, n1) => box(e0, n0, e1, n1).reverse();             // a hole
function sceneryTiles() {
  const plan = C.sceneryPlan(LOOP, FRAME);
  const buildings = plan.buildings.map(([z, x, y]) => {
    const u = tileUnits(z, x, y), feats = [];
    const house = (id, props, ring) => feats.push({ type: 3, props: { id, ...props }, parts: [ring.map(u)] });
    // 20 m real outside the south road (z = 0 is north = 0 m): kept.
    house('near', { subtype: 'residential' }, box(100, -32, 112, -24));
    // A temple and a hotel, near too.
    house('temple', { subtype: 'religious', height: 9 }, box(300, -40, 320, -26));
    house('hotel', { subtype: 'commercial', class: 'hotel', num_floors: 3 }, box(500, -40, 516, -26));
    // 300 m real away: left out. On the road: left out.
    house('far', {}, box(100, -330, 110, -320));
    house('road', {}, box(200, -3, 208, 3));
    return { z, x, y, layers: C.mvtDecode(mvtBytes({ building: feats })) };
  });
  const base = plan.base.map(([z, x, y]) => {
    const u = tileUnits(z, x, y);
    return { z, x, y, layers: C.mvtDecode(mvtBytes({
      land_cover: [
        { type: 3, props: { subtype: 'crop', cartography: '{"sort_key":1}' }, parts: [box(-2000, -2000, 3000, 2000).map(u)] },
        { type: 3, props: { subtype: 'forest', cartography: '{"sort_key":2}' }, parts: [box(1050, -2000, 3000, 2000).map(u)] },
      ],
      land_use: [{ type: 3, props: { subtype: 'residential' }, parts: [box(-200, -200, 0, 200).map(u)] }],
      // A pond inside the loop (the loop runs north of its start: z < 0), with an island.
      water: [{ type: 3, props: { subtype: 'pond' }, parts: [box(300, 300, 700, 700).map(u), boxCcw(450, 450, 550, 550).map(u)] }],
    })) };
  });
  return { buildings, base };
}

test('buildScenery: buildings near the course and off the road, cover, water with its island', () => {
  const tiles = sceneryTiles();
  const { scenery: sc, stats } = C.buildScenery(LOOP, FRAME, tiles, '2026-11-27T20:00:00Z');
  assert.equal(sc.v, 1); assert.equal(sc.made, '2026-11-27T20:00:00Z'); assert.match(sc.source, /Overture Maps .*ODbL.*ESA WorldCover/);
  // Each building appears once although every tile of the plan carries it.
  const kinds = sc.buildings.map((b) => b[6]).sort();
  assert.deepEqual(plain(kinds), [1, 4, 7], 'home, temple, hotel; not the far one, not the one on the road');
  const home = sc.buildings.find((b) => b[6] === 1);
  // Tile units are 0.6 m real at zoom 14 (1.2 m at 13): the tolerances.
  near(home[0], 106 / 2.5, 0.5, 'x'); near(home[1], 28 / 2.5, 0.5, 'z (south is +z)');
  near(home[2], 12, 1.3, 'length, real metres'); near(home[3], 8, 1.3, 'width');
  assert.equal(home[4], 0); assert.equal(home[5], 0);
  assert.equal(sc.buildings.find((b) => b[6] === 4)[5], 9, 'height given');
  assert.equal(sc.buildings.find((b) => b[6] === 7)[5], 9, 'three floors: 9 m');

  // Cover: 400 m real of margin round the loop; crops, forest to the east, homes to the west, water in the pond but not on its island.
  const cv = sc.cover, cells = C.coverCells(cv);
  assert.equal(cells.length, cv.w * cv.h);
  assert.ok(cv.x0 <= -160 && cv.z0 <= -160 && cv.x0 + cv.w * cv.cell >= 560 && cv.z0 + cv.h * cv.cell >= 160);
  const at = (x, z) => cells[Math.floor((z - cv.z0) / cv.cell) * cv.w + Math.floor((x - cv.x0) / cv.cell)];
  assert.equal(at(200, -100), 'c', 'crops');
  assert.equal(at(500, -100), 'f', 'forest, drawn over the crops (higher sort key)');
  assert.equal(at(-40, -20), 'u', 'homes: land use built on');
  assert.equal(at(140, -140), 'a', 'the pond (game x 120 to 280, z -280 to -120)');
  assert.equal(at(260, -250), 'a');
  assert.equal(at(200, -200), 'c', 'its island is not water');
  assert.equal(at(200, -320), 'c', 'north of the pond');
  assert.deepEqual(Object.keys(stats.cover).sort(), ['a', 'c', 'f', 'u']);
  // One water ring, the pond's outline in game metres; the island is not written.
  assert.equal(sc.water.length, 1);
  assert.equal(sc.water[0].kind, 'pond');
  const xs = sc.water[0].ring.map((p) => p[0]), zs = sc.water[0].ring.map((p) => p[1]);
  near(Math.min(...xs), 120, 0.8); near(Math.max(...xs), 280, 0.8); near(Math.min(...zs), -280, 0.8); near(Math.max(...zs), -120, 0.8);
  assert.ok(sc.water[0].ring.length <= 6, 'simplified: a square stays a square');
  // The field fits the schema and the check.
  assert.ok(C.sceneryOk(sc));
  const schema = readSchema();
  assert.deepEqual(validateSchema({ ...schema, required: [] }, { scenery: plain(sc) }), []);
});

test('buildScenery: a building cut by two tiles is put back together', () => {
  const plan = C.sceneryPlan(LOOP, FRAME);
  const [z, x, y] = plan.buildings[0];
  // The tile's east edge, in real metres: a house astride it, half in each tile.
  const u0 = tileUnits(z, x, y), u1 = tileUnits(z, x + 1, y);
  const [lat, lon] = C.tileLatLon(z, x + 1, y + 0.5), e = enu.forward(lat, lon);
  const ring = box(e[0] - 10, e[1] - 4, e[0] + 10, e[1] + 4);
  const clipW = ring.map(([ee, nn]) => [Math.min(ee, e[0]), nn]), clipE = ring.map(([ee, nn]) => [Math.max(ee, e[0]), nn]);
  const T = (zz, xx, yy, u, r) => ({ z: zz, x: xx, y: yy, layers: C.mvtDecode(mvtBytes({ building: [{ type: 3, props: { id: 'astride' }, parts: [r.map(u)] }] })) });
  // A course passing right by it.
  const pts = [];
  for (let i = -30; i <= 30; i++) pts.push([e[0] / 2.5 + i * 4, -(e[1] + 30) / 2.5]);
  const { scenery: sc } = C.buildScenery(pts, FRAME, { buildings: [T(z, x, y, u0, clipW), T(z, x + 1, y, u1, clipE)], base: [] }, 'x');
  assert.equal(sc.buildings.length, 1);
  near(sc.buildings[0][2], 20, 1.3, 'whole length'); near(sc.buildings[0][3], 8, 1.3);
});

test('sceneryOk and checkTrack: a scenery that is not one is flagged, the track still opens', () => {
  const { scenery: sc } = C.buildScenery(LOOP, FRAME, sceneryTiles(), 'x');
  const bad = [
    { ...sc, v: 2 }, { ...sc, cover: { ...sc.cover, rle: sc.cover.rle + 'u' } }, { ...sc, cover: { ...sc.cover, w: 0 } },
    { ...sc, buildings: [[1, 2, 3, 4, 5, 6]] }, { ...sc, buildings: [[1, 2, 3, 4, 180, 0, 1]] }, { ...sc, buildings: [[1, 2, 3, 9, 0, 0, 1]] },
    { ...sc, buildings: [[1, 2, 9, 4, 0, 0, 8]] }, { ...sc, water: [{ kind: 'pond', ring: [[0, 0], [1, 1]] }] }, null, [],
  ];
  for (const b of bad) assert.equal(C.sceneryOk(b), false, JSON.stringify(b).slice(0, 80));
  assert.ok(C.sceneryOk(sc));
  assert.equal(C.coverCells({ rle: '3u2a', w: 5, h: 1 }).join(''), 'uuuaa');
  assert.equal(C.coverCells({ rle: '3u2a', w: 4, h: 1 }), null);
});

test('paveTown: a road of unknown surface is paved where the land is built on, and the hash follows', () => {
  const { scenery: sc } = C.buildScenery(LOOP, FRAME, sceneryTiles(), 'x');
  const surfaces = C.SURFACES.slice(), unknown = surfaces.indexOf('unknown'), paved = surfaces.indexOf('paved');
  // Points at the homes' corner (built on), in the crops, and one already asphalt.
  const t = { format: 'cambotrack', version: 1, kind: 'loop', laps: 1, scale: 2.5, vertical_scale: 2.5, road_width: 11, spacing: 4, surfaces,
    points: [[-40, 0, -20, 11, unknown, 0], [200, 0, -100, 11, unknown, 0], [-40, 0, -24, 11, 0, 0]], checkpoints: [], gates: [] };
  t.hash = C.trackHash(t);
  const before = t.hash;
  assert.equal(C.paveTown(t, sc), 1);
  assert.deepEqual(plain(t.points.map((p) => p[4])), [paved, unknown, 0]);
  assert.notEqual(t.hash, before);
  assert.equal(t.hash, C.trackHash(t));
  assert.equal(C.paveTown(t, null), 0);
});
