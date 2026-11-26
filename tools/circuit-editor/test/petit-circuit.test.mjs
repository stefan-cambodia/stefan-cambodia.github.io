// Acceptance: the editor's core reproduces the existing « Petit Circuit » stage.
//
// The stage of the games was derived by tools/angkor_routes.py from via points
// in real metres (east, north) of the centre of Angkor Wat's moat, driven
// clockwise as a closed loop, at 1:2.5. One lap of it is 7.1 km of game. The
// same via points, snapped and routed by the core on today's OpenStreetMap
// (fixture recorded 2026-11-26), must give that length within 3 %.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadCore, graphOf, readSchema, validateSchema, formatRuleErrors, plain,
  PETIT_FIXTURE, PETIT_CIRCUIT_VIA, viaToLatLon,
} from './helpers.mjs';

const C = loadCore();
const TARGET = 7100;      // game metres, one lap of the existing stage
const TOLERANCE = 0.03;
const SNAP_REACH = 60;    // real metres

function petitCircuit() {
  const g = graphOf(PETIT_FIXTURE);
  const allowed = C.DEFAULT_ALLOWED;
  const snaps = PETIT_CIRCUIT_VIA.map((via) => {
    const [lat, lon] = viaToLatLon(via);
    return C.snap(g, lat, lon, SNAP_REACH, allowed);
  });
  return { g, allowed, snaps };
}

test('Petit Circuit: every via point of the game script still finds its road', (t) => {
  const { snaps } = petitCircuit();
  snaps.forEach((s, i) => assert.ok(s, `via point ${i} ${JSON.stringify(PETIT_CIRCUIT_VIA[i])} has no road within ${SNAP_REACH} m`));
  const worst = snaps.reduce((a, s, i) => (s.dist > a.dist ? { dist: s.dist, i } : a), { dist: 0, i: -1 });
  t.diagnostic(`farthest snap: via point ${worst.i} ${JSON.stringify(PETIT_CIRCUIT_VIA[worst.i])}, ${worst.dist.toFixed(1)} m from its road`);
  assert.ok(worst.dist <= SNAP_REACH);
});

test('Petit Circuit: one lap is 7.1 km of game within 3 % (scale 2.5)', (t) => {
  const { g, allowed, snaps } = petitCircuit();
  const route = C.buildRoute(g, snaps, 'loop', allowed, C.createLegCache());
  assert.ok(route.ok, 'every leg has a path');
  assert.equal(route.legs.length, PETIT_CIRCUIT_VIA.length);
  const res = C.buildTrack(g, route.line, {
    id: 'angkor-petit-circuit', name: 'Petit Circuit perso', kind: 'loop', laps: 3, scale: 2.5, relief: false,
    allowed_classes: allowed, waypoints: snaps.map((s) => [s.lat, s.lon]),
  }, null);
  assert.ok(res.ok, JSON.stringify(res.errors));
  const track = res.track;
  const deviation = track.length_game_m / TARGET - 1;
  t.diagnostic(`real length ${track.length_real_m} m, game length ${track.length_game_m} m, ` +
    `${(deviation * 100).toFixed(2)} % from ${TARGET} m; ${track.points.length} points, ` +
    `${track.checkpoints.length} checkpoints, ${track.gates.length} gates, ` +
    `estimated lap ${(res.stats.lap_time_s / 60).toFixed(1)} min`);
  assert.ok(Math.abs(deviation) <= TOLERANCE, `game length ${track.length_game_m} m is ${(deviation * 100).toFixed(2)} % from ${TARGET} m`);

  // The file is a valid one.
  assert.deepEqual(validateSchema(readSchema(), track), []);
  assert.deepEqual(formatRuleErrors(track).errors, []);
  assert.deepEqual(plain(C.checkTrack(track).errors), []);

  // Same density as the existing stage: 6 checkpoints and 7 gates on its 7.1 km.
  assert.equal(track.checkpoints.length, 6);
  assert.ok(track.gates.length >= 5 && track.gates.length <= 8, `${track.gates.length} gates`);

  // Driven clockwise: negative area with x east and north up.
  let area = 0;
  const p = track.points;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    area += p[i][0] * -q[2] - q[0] * -p[i][2];
  }
  assert.ok(area < 0, 'the loop runs clockwise');
  // A circuit of roads, each driven once, that does not cross itself.
  const codes = res.warnings.map((w) => w.code);
  assert.ok(!codes.includes('road_twice') && !codes.includes('self_cross') && !codes.includes('short') && !codes.includes('long'),
    `unexpected warnings: ${codes}`);
});
