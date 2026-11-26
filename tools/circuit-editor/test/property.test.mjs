// Whatever the course and the settings, a file the core agrees to export fits
// the schema and every rule of FORMAT.md. Random courses on the real roads of
// Angkor, random settings, rough random relief; the generator is seeded, so the
// test always sees the same cases.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore, graphOf, readSchema, validateSchema, formatRuleErrors, plain, PETIT_FIXTURE } from './helpers.mjs';

const C = loadCore();
const schema = readSchema();

function generator(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The refusals the chain may give instead of a file.
const REFUSALS = new Set(['too_short', 'gap_rule', 'total_too_long', 'too_many_points', 'extent_rule']);

test('random courses and settings: every exported file is valid', (t) => {
  const g = graphOf(PETIT_FIXTURE);
  const rnd = generator(20261126);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const between = (lo, hi) => lo + rnd() * (hi - lo);
  const allowedSets = [C.DEFAULT_ALLOWED, C.DEFAULT_ALLOWED.filter((c) => c !== 'track')];
  const usable = allowedSets.map((allowed) => {
    const set = new Set(allowed), out = [];
    for (let e = 0; e < g.edgeA.length; e++) if (set.has(g.ways[g.edgeWay[e]].cls)) out.push(e);
    return out;
  });
  // Rough ground: up to 150 m of difference between two samples 30 m apart.
  const store = { get: (key) => { let h = 0; for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return 10 + (h % 1500) / 10; }, has: () => true };

  const seen = { ok: 0, noRoute: 0 }, refused = {};
  let withRelief = 0, loops = 0, points = 0, tightest = Infinity, steepest = 0;
  for (let k = 0; k < 160; k++) {
    const which = k % 2, allowed = allowedSets[which];
    const kind = rnd() < 0.5 ? 'loop' : 'stage';
    const wps = [];
    for (let i = 0, n = 2 + Math.floor(rnd() * 5); i < n; i++) {
      const edge = pick(usable[which]), tt = rnd() < 0.3 ? 0 : Math.round(rnd() * 1e9) / 1e9;
      const p = C.edgePoint(g, edge, tt);
      wps.push({ edge, t: tt, lat: p[0], lon: p[1] });
    }
    const route = C.buildRoute(g, wps, kind, allowed, null);
    if (!route.ok) { seen.noRoute++; continue; }
    const settings = {
      id: `random-${k}`, name: `Random ${k}`, author: '', created: '2026-11-26T14:00:00Z',
      games: pick([['3d_buggy'], ['cambodia_rally'], ['3d_buggy', 'cambodia_rally']]),
      kind, laps: 1 + Math.floor(rnd() * 20), scale: pick([1, 1.25, 2.5, 2.5, 3.3333, 5, 10]),
      road_width: pick([3, 6, 8.5, 11, 11, 20, 30]), spacing: pick([1, 2.5, 4, 4, 7.77, 20]),
      smooth_m: pick([0, 5, 15, 15, 40]), narrow_tracks: rnd() < 0.5, bridge_widths: rnd() < 0.7,
      checkpoint_every_m: pick([0, 0, 200, 777, 5000]), gates_auto: rnd() < 0.7, relief: rnd() < 0.5,
      allowed_classes: allowed, waypoints: wps.map((w) => [w.lat, w.lon]),
    };
    if (rnd() < 0.5) settings.vertical_scale = between(0.5, 12);
    let ele = null;
    if (settings.relief) {
      const clean = C.cleanLine({ ...plain(route.line), closed: kind === 'loop' }, C.RULES.spikeMax);
      if (clean.lat.length < 2) continue;
      ele = C.elevationSamples(C.elevationPlan(clean), store);
    }
    const res = C.buildTrack(g, route.line, settings, ele);
    if (!res.ok) {
      const code = res.errors[0].code;
      assert.ok(REFUSALS.has(code) || code === 'no_route', `case ${k}: unexpected refusal ${code}`);
      refused[code] = (refused[code] ?? 0) + 1;
      continue;
    }
    const track = JSON.parse(C.serializeTrack(res.track));      // what a game would read
    const context = `case ${k} (${kind}, scale ${settings.scale}, spacing ${settings.spacing}, smoothing ${settings.smooth_m})`;
    assert.deepEqual(validateSchema(schema, track), [], context);
    assert.deepEqual(formatRuleErrors(track).errors, [], context);
    assert.deepEqual(plain(C.checkTrack(track).errors), [], context);
    assert.ok(Buffer.byteLength(C.serializeTrack(res.track)) <= 4194304, context);
    // The numbers of the hash are written already rounded.
    assert.equal(C.q3(track.scale) / 1000, track.scale, context);
    assert.equal(C.q3(track.vertical_scale) / 1000, track.vertical_scale, context);
    assert.equal(C.q2(track.road_width) / 100, track.road_width, context);
    assert.equal(C.q2(track.spacing) / 100, track.spacing, context);
    assert.equal(track.gates.length === 0 || settings.gates_auto, true, context);
    assert.equal(track.laps, kind === 'loop' ? settings.laps : undefined, context);
    seen.ok++;
    if (track.elevation) withRelief++;
    if (kind === 'loop') loops++;
    points += track.points.length;
    const p = track.points, n = p.length;
    for (let i = 0; i < (kind === 'loop' ? n : n - 1); i++) {
      const q = p[(i + 1) % n], d = Math.hypot(q[0] - p[i][0], q[2] - p[i][2]);
      tightest = Math.min(tightest, d);
      steepest = Math.max(steepest, Math.abs(q[1] - p[i][1]) / d);
    }
  }
  t.diagnostic(`${seen.ok} files exported and valid (${loops} loops, ${withRelief} with relief, ${points} points in all); ` +
    `refused: ${JSON.stringify(refused)}; without a path: ${seen.noRoute}; ` +
    `smallest gap ${tightest.toFixed(2)} m, steepest slope ${(steepest * 100).toFixed(1)} %`);
  assert.ok(seen.ok >= 60, `only ${seen.ok} random courses gave a file`);
  assert.ok(withRelief >= 20 && loops >= 20);
  // 30 % in the chain; a centimetre of rounding on a very short gap can add a little.
  assert.ok(steepest <= 0.34, `steepest slope ${steepest}`);
});
