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

// A small track that can be checked by hand, and that a game accepts: twelve
// points heading north, 40 m apart (440 m), a little climb, three widths, two
// surfaces, every flag value, negative and fractional coordinates.
const vector = {
  format: 'cambotrack', version: 1, id: 'hash-vector', hash: '', name: 'Hash vector', kind: 'stage',
  scale: 2.5, vertical_scale: 2.5, road_width: 11, spacing: 20,
  surfaces: ['asphalt', 'dirt'],
  points: [
    [0, 0, 0, 11, 0, 0], [0, 0, -40, 11, 0, 0], [0.12, 0.25, -80, 11, 0, 0], [0.12, 0.5, -120, 9.5, 1, 0],
    [0, 0.75, -160, 8, 1, 1], [-0.07, 1, -200, 8, 1, 1], [0, 1.25, -240, 9.5, 1, 2], [0, 1.5, -280, 11, 0, 3],
    [0.5, 1.25, -320, 11, 0, 0], [1.01, 1, -360, 11, 0, 0], [0.5, 0.5, -400, 11, 0, 0], [0, 0, -440, 11, 0, 0],
  ],
  checkpoints: [3, 7],
  gates: [5],
};
vector.hash = referenceHash(vector);
if (C.trackHash(vector) !== vector.hash) throw new Error('the core and node:crypto disagree on the hash vector');
write('hash-vector.cambotrack.json', C.serializeTrack(vector));
write('hash-vector.canonical.txt', canonicalText(vector));
console.log(`  hash ${vector.hash}`);
