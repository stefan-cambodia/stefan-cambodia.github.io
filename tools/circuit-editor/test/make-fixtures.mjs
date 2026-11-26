// Writes the generated fixtures of the circuit editor from the recorded ones.
//
//   node tools/circuit-editor/test/make-fixtures.mjs
//       sample-loop.cambotrack.json, sample-stage.cambotrack.json and the hash
//       vector, from the committed Overpass and Open-Meteo answers. No network.
//
//   node tools/circuit-editor/test/make-fixtures.mjs --fetch-elevation
//       asks Open-Meteo again for the elevations of the sample stage and rewrites
//       open-meteo-sample-stage.json first (two small requests, one after the other).
//
// The Overpass fixtures are real answers, downloaded once with:
//   [out:json][timeout:60];way[highway](S,W,N,E);out body qt;>;out skel qt;
//   angkor-wat.overpass.json               bbox 13.400,103.850,13.420,103.875
//   angkor-petit-circuit.overpass.json.gz  bbox 13.402,103.851,13.451,103.908
// Map data © OpenStreetMap contributors, ODbL 1.0.

import fs from 'node:fs';
import { loadCore, FIXTURES, ELEVATION_FIXTURE, buildSample, elevationStore, canonicalText, referenceHash } from './helpers.mjs';

const C = loadCore();
const write = (name, text) => {
  fs.writeFileSync(new URL(name, FIXTURES), text);
  console.log(`wrote ${name} (${Buffer.byteLength(text)} bytes)`);
};

if (process.argv.includes('--fetch-elevation')) {
  const { plan } = buildSample('stage');
  const missing = C.elevationMissing(plan, new Map());
  const calls = [];
  for (let i = 0; i < missing.key.length; i += 100) {
    const latitude = Array.from(missing.lat.slice(i, i + 100));
    const longitude = Array.from(missing.lon.slice(i, i + 100));
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${latitude.join(',')}&longitude=${longitude.join(',')}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'circuit-editor-dev/1.0' } });
    if (!res.ok) throw new Error(`Open-Meteo answered ${res.status}`);
    calls.push({ latitude, longitude, response: await res.json() });
    await new Promise((r) => setTimeout(r, 500));
  }
  write(ELEVATION_FIXTURE, JSON.stringify({
    source: 'https://api.open-meteo.com/v1/elevation (Copernicus DEM GLO-90)',
    recorded: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    note: 'Real answers, one entry per request (at most 100 coordinates each).',
    calls,
  }, null, 1) + '\n');
}

for (const which of ['loop', 'stage']) {
  const { result, text } = buildSample(which, elevationStore());
  if (!result.ok) throw new Error(`sample ${which}: ${JSON.stringify(result.errors)}`);
  write(`sample-${which}.cambotrack.json`, text);
  console.log(`  ${result.track.points.length} points, ${result.track.length_game_m} game m, hash ${result.track.hash}`);
}

// A tiny track that can be checked by hand: eight points on a straight line
// heading north, 5 m apart, climbing 25 cm a point from the third one.
const vector = {
  format: 'cambotrack', version: 1, id: 'hash-vector', hash: '', name: 'Hash vector', kind: 'stage',
  scale: 2.5, vertical_scale: 2.5, road_width: 11, spacing: 5,
  surfaces: ['asphalt', 'dirt'],
  points: [
    [0, 0, 0, 11, 0, 0], [0, 0, -5, 11, 0, 0], [0.12, 0.25, -10, 11, 0, 0], [0.12, 0.5, -15, 9.5, 1, 0],
    [0, 0.75, -20, 8, 1, 1], [-0.07, 1, -25, 8, 1, 1], [0, 1.25, -30, 9.5, 1, 2], [0, 1.5, -35, 11, 0, 0],
  ],
  checkpoints: [3],
  gates: [],
};
vector.hash = referenceHash(vector);
if (C.trackHash(vector) !== vector.hash) throw new Error('the core and node:crypto disagree on the hash vector');
write('hash-vector.cambotrack.json', C.serializeTrack(vector));
write('hash-vector.canonical.txt', canonicalText(vector));
console.log(`  hash ${vector.hash}`);
