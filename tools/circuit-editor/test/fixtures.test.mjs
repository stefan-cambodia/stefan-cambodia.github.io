// The committed files: fixtures, samples, the empty catalogue and the page itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  loadCore, readFixture, readJsonFixture, readSchema, validateSchema, formatRuleErrors, buildSample, elevationStore,
  TOOL_DIR, FIXTURES, SMALL_FIXTURE, PETIT_FIXTURE, ELEVATION_FIXTURE, SAMPLES,
} from './helpers.mjs';

const C = loadCore();
const schema = readSchema();

test('sample files are what the core exports today, byte for byte', () => {
  // If this fails after a change of the chain: node tools/circuit-editor/test/make-fixtures.mjs
  const store = elevationStore();
  for (const which of ['loop', 'stage']) {
    const { text } = buildSample(which, store);
    assert.equal(readFixture(SAMPLES[which].file), text, `${SAMPLES[which].file} is out of date`);
  }
});

test('sample files fit the schema, the rules and their own hash', () => {
  for (const name of [SAMPLES.loop.file, SAMPLES.stage.file, 'hash-vector.cambotrack.json']) {
    const text = readFixture(name), t = JSON.parse(text);
    assert.deepEqual(validateSchema(schema, t), [], name);
    assert.deepEqual(formatRuleErrors(t).errors, [], name);
    assert.equal(t.hash, crypto.createHash('sha256').update(C.canonicalText(t), 'utf8').digest('hex'), name);
    assert.ok(Buffer.byteLength(text) <= 4194304);
    assert.ok(text.endsWith('}\n') && !text.endsWith('\n\n'), 'ends with one newline');
  }
  const loop = readJsonFixture(SAMPLES.loop.file), stage = readJsonFixture(SAMPLES.stage.file);
  // The two samples exercise different sides of the format.
  assert.equal(loop.kind, 'loop'); assert.equal(loop.elevation, null); assert.equal(loop.scale, 1.25);
  assert.ok(new Set(loop.points.map((p) => p[3])).size > 2, 'the loop has more than one width');
  assert.ok(new Set(loop.points.map((p) => p[4])).size >= 2, 'the loop has more than one surface');
  assert.ok(loop.checkpoints.length >= 1 && loop.gates.length >= 1);
  assert.equal(stage.kind, 'stage'); assert.ok(stage.elevation.climb_m > 0); assert.equal(stage.laps, undefined);
  assert.ok(stage.points.some((p) => p[1] < 0) && stage.points.some((p) => p[1] > 0), 'the stage goes up and down');
  assert.ok(stage.checkpoints.length >= 1 && stage.gates.length >= 1);
});

test('the schema validator refuses what the schema forbids', () => {
  const good = readJsonFixture(SAMPLES.loop.file);
  const bad = (edit) => { const t = structuredClone(good); edit(t); return validateSchema(schema, t).length > 0; };
  assert.ok(!bad(() => {}));
  assert.ok(bad((t) => { t.format = 'other'; }));
  assert.ok(bad((t) => { t.version = 2; }));
  assert.ok(bad((t) => { t.version = 1.5; }));
  assert.ok(bad((t) => { t.id = 'Bad_Id'; }));
  assert.ok(bad((t) => { t.id = '-a'; }));
  assert.ok(bad((t) => { t.hash = t.hash.toUpperCase(); }));
  assert.ok(bad((t) => { t.name = ''; }));
  assert.ok(bad((t) => { t.author = 'x'.repeat(61); }));
  assert.ok(bad((t) => { t.created = '2026-11-26 14:00'; }));
  assert.ok(bad((t) => { t.games = ['other_game']; }));
  assert.ok(bad((t) => { t.games = ['3d_buggy', '3d_buggy']; }));
  assert.ok(bad((t) => { t.kind = 'rally'; }));
  assert.ok(bad((t) => { t.laps = 0; }));
  assert.ok(bad((t) => { t.scale = 0.5; }));
  assert.ok(bad((t) => { t.vertical_scale = 60; }));
  assert.ok(bad((t) => { t.road_width = 2; }));
  assert.ok(bad((t) => { t.spacing = 21; }));
  assert.ok(bad((t) => { t.origin = { lat: 13 }; }));
  assert.ok(bad((t) => { t.elevation = { source: 'x' }; }));
  assert.ok(bad((t) => { t.elevation = 3; }));
  assert.ok(bad((t) => { t.surfaces = []; }));
  assert.ok(bad((t) => { t.surfaces = ['Asphalt']; }));
  assert.ok(bad((t) => { t.points = t.points.slice(0, 7); }));
  assert.ok(bad((t) => { t.points[3] = [0, 0, 0, 11, 0]; }));
  assert.ok(bad((t) => { t.points[3][3] = 31; }));
  assert.ok(bad((t) => { t.points[3][4] = 1.5; }));
  assert.ok(bad((t) => { t.points[3][5] = 256; }));
  assert.ok(bad((t) => { t.points[3][0] = '1'; }));
  assert.ok(bad((t) => { t.checkpoints = [0]; }));
  assert.ok(bad((t) => { t.checkpoints = 'none'; }));
  assert.ok(bad((t) => { t.gates = [20000]; }));
  assert.ok(bad((t) => { t.waypoints = [[13, 103, 1]]; }));
  assert.ok(bad((t) => { t.allowed_classes = ['Primary']; }));
  assert.ok(bad((t) => { t.attribution = 'x'.repeat(301); }));
  assert.ok(bad((t) => { delete t.points; }));
  // Unknown fields are allowed (the games ignore them), a seventh number in a point too.
  assert.ok(!bad((t) => { t.future_field = { anything: true }; t.points[3].push(42); }));
  assert.throws(() => validateSchema({ notAKeyword: 1 }, {}), /not supported/);
});

test('Overpass fixtures are real answers for Angkor', () => {
  for (const [name, minWays] of [[SMALL_FIXTURE, 300], [PETIT_FIXTURE, 1000]]) {
    const data = readJsonFixture(name);
    assert.match(data.generator, /^Overpass API/);
    assert.match(data.osm3s.timestamp_osm_base, /^2026-11-26T/);
    assert.match(data.osm3s.copyright, /openstreetmap\.org.*ODbL/);
    const ways = data.elements.filter((e) => e.type === 'way'), nodes = data.elements.filter((e) => e.type === 'node');
    assert.ok(ways.length >= minWays, `${name}: ${ways.length} ways`);
    assert.ok(ways.every((w) => w.tags && w.tags.highway), 'the query is way[highway]');
    assert.ok(nodes.every((n) => n.lat > 13.2 && n.lat < 13.6 && n.lon > 103.7 && n.lon < 104.1), 'nodes are around Angkor');
    // "out skel" nodes: no tags; every node of every way is in the answer.
    const ids = new Set(nodes.map((n) => n.id));
    assert.ok(ways.every((w) => w.nodes.every((id) => ids.has(id))));
  }
  assert.ok(fs.statSync(new URL(PETIT_FIXTURE, FIXTURES)).size < 400000, 'the large fixture is compressed');
});

test('Open-Meteo fixture: real answers, 100 coordinates a request at most', () => {
  const rec = readJsonFixture(ELEVATION_FIXTURE);
  assert.ok(rec.calls.length >= 1);
  for (const call of rec.calls) {
    assert.ok(call.latitude.length <= 100);
    assert.equal(call.latitude.length, call.longitude.length);
    assert.equal(call.response.elevation.length, call.latitude.length);
    assert.ok(call.response.elevation.every((v) => typeof v === 'number' && v > 0 && v < 100), 'Angkor lies between 0 and 100 m');
  }
});

test('tracks/index.json is a valid catalogue', () => {
  const text = fs.readFileSync(new URL('../../tracks/index.json', TOOL_DIR), 'utf8');
  const cat = JSON.parse(text);
  assert.equal(cat.format, 'cambotrack-catalog');
  assert.equal(cat.version, 1);
  assert.match(cat.updated, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.ok(Array.isArray(cat.tracks));
  assert.ok(cat.tracks.length <= 500 && Buffer.byteLength(text) <= 1048576);
  for (const e of cat.tracks) {
    assert.ok(C.isValidId(e.id));
    assert.equal(e.file, `${e.id}.cambotrack.json`);
    assert.match(e.hash, /^[0-9a-f]{64}$/);
    assert.ok(fs.existsSync(new URL(`../../tracks/${e.file}`, TOOL_DIR)), `${e.file} is listed but missing`);
  }
  // The core's own empty catalogue has the same shape.
  assert.deepEqual(Object.keys(cat), Object.keys(JSON.parse(C.serializeCatalog(C.emptyCatalog(cat.updated)))));
});

test('index.html: one file, Leaflet 1.9.4 from cdnjs with the verified SRI hashes', () => {
  const html = fs.readFileSync(new URL('index.html', TOOL_DIR), 'utf8');
  // sha512 of the files served by cdnjs, computed from a download and equal to
  // the values of https://api.cdnjs.com/libraries/leaflet/1.9.4?fields=sri
  const js = 'sha512-puJW3E/qXDqYp9IfhAI54BJEaWIfloJ7JWs7OeD5i6ruC9JZL1gERT1wjtwXFlh7CjE7ZJ+/vcRZRkIYIb6p4g==';
  const css = 'sha512-h9FcoyWjHcOcmEVkxOfTLnmZFWIH0iZhZT1H2TbOq55xssQGEJHEaIm+PgoUaZbRvQTNTluNOEfb1ZRy6D3BOw==';
  const script = /<script[^>]*src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/leaflet\/1\.9\.4\/leaflet\.min\.js"[^>]*>/.exec(html);
  const link = /<link[^>]*href="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/leaflet\/1\.9\.4\/leaflet\.min\.css"[^>]*>/.exec(html);
  assert.ok(script && link, 'Leaflet 1.9.4 is loaded from cdnjs');
  assert.ok(script[0].includes(`integrity="${js}"`) && script[0].includes('crossorigin="anonymous"'));
  assert.ok(link[0].includes(`integrity="${css}"`) && link[0].includes('crossorigin="anonymous"'));
  // Nothing else is loaded from elsewhere: no other script, stylesheet or font.
  const external = [...html.matchAll(/<(?:script|link)[^>]*(?:src|href)="(https?:[^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(external.sort(), [script[0].match(/src="([^"]+)"/)[1], link[0].match(/href="([^"]+)"/)[1]].sort());
  assert.equal([...html.matchAll(/<script\b/g)].length, 5, 'Leaflet, the library of objects, the translations, the core, the interface');
  // The library of objects and the translations come from beside the page, not from elsewhere.
  assert.deepEqual([...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]).filter((u) => !/^https?:/.test(u)), ['objects-library.js', 'i18n.js']);
  // One font from elsewhere, only for a page in Khmer (the visitor may have no Khmer font).
  assert.deepEqual([...html.matchAll(/https:\/\/fonts\.googleapis\.com[^'"]*/g)].map((m) => m[0]),
    ['https://fonts.googleapis.com/css2?family=Noto+Sans+Khmer:wght@400;600;700&display=swap']);
  assert.match(html, /if \(LANG === 'km'\) \{\s*const f = document\.createElement\('link'\);/);
  // The HEIC decoder, loaded by the page only for a HEIC photo: an exact version and its hash
  // (of the file downloaded; its sha256 equals the one jsDelivr publishes for it).
  assert.match(html, /src: 'https:\/\/cdn\.jsdelivr\.net\/npm\/libheif-js@1\.23\.5\/libheif-wasm\/libheif-bundle\.js',/);
  assert.match(html, /integrity: 'sha512-mvcRkE7mf1NkKszQkZ4N7sEeGMKFJcOe\/3\/j0Cddu\+I6CdUx5P\+32P1yjL7G12xd0gio1uqlc6Riye9\+65NhDg=='/);
  assert.equal([...html.matchAll(/https:\/\/cdn\.jsdelivr\.net[^'"\s]*/g)].length, 1, 'nothing else from jsDelivr');
  assert.match(html, /<html lang="fr">/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1/);
});

test('no secret in the tool, its fixtures or the tracks folder', () => {
  const roots = [new URL('./', TOOL_DIR), new URL('../../tracks/', TOOL_DIR)];
  const secret = /(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gho_[A-Za-z0-9]{20,}|ghs_[A-Za-z0-9]{20,})/;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) { if (entry.name !== '__pycache__') walk(url); continue; }
      if (entry.name.endsWith('.gz') || entry.name.endsWith('.png')) continue;
      assert.ok(!secret.test(fs.readFileSync(url, 'utf8')), `${entry.name} holds something that looks like a GitHub token`);
    }
  };
  roots.forEach(walk);
});
