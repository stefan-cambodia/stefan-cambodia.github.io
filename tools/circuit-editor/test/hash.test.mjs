// SHA-256 in pure JavaScript and the canonical hash of FORMAT.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { loadCore, readFixture, readJsonFixture, canonicalText, referenceHash, coreSource } from './helpers.mjs';

const C = loadCore();
const nodeSha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

test('the core block uses no host API', () => {
  // It was evaluated in an empty context; make sure its code never names one either.
  const code = coreSource().replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  const found = code.match(/\b(document|window|fetch|localStorage|navigator|require|TextEncoder|crypto|process|console|setTimeout|XMLHttpRequest)\b/g);
  assert.equal(found, null, `the core names ${found}`);
});

test('SHA-256: published vectors', () => {
  assert.equal(C.sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(C.sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(C.sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
});

test('SHA-256: same as node:crypto on every block boundary and on UTF-8', () => {
  for (let n = 0; n <= 200; n++) {
    const s = 'x'.repeat(n);
    assert.equal(C.sha256(s), nodeSha(s), `length ${n}`);
  }
  for (const s of ['é', 'ភ្នំពេញ', 'Boucle d’essai 😀', '\u0000\u007f\u0080߿ࠀ￿', 'a😀b', 'x'.repeat(100000)]) {
    assert.equal(C.sha256(s), nodeSha(s));
  }
  // A lone surrogate becomes U+FFFD, as in every UTF-8 encoder.
  assert.equal(C.sha256('a\ud800b'), nodeSha('a�b'));
});

test('SHA-256: pseudo-random texts', () => {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 200; i++) {
    let s = '';
    const n = Math.floor(rnd() * 300);
    for (let k = 0; k < n; k++) s += String.fromCharCode(32 + Math.floor(rnd() * 2000));
    assert.equal(C.sha256(s), nodeSha(s));
  }
});

test('q2 and q3 are floor(v × 100 + 0.5) and floor(v × 1000 + 0.5)', () => {
  assert.equal(C.q2(11), 1100);
  assert.equal(C.q2(0.12), 12);
  assert.equal(C.q2(-0.07), -7);
  assert.equal(C.q2(-5), -500);
  assert.equal(C.q2(-0.004), 0);
  assert.equal(String(C.q2(-0.004)), '0');
  assert.equal(C.q3(2.5), 2500);
  assert.equal(C.q3(1.25), 1250);
});

test('hash vector: the canonical text, written out by hand', () => {
  // fixtures/hash-vector.cambotrack.json: twelve points heading north, 40 m apart.
  // Every value below is the file's value times 100 (x, y, z, width) or 1000
  // (scales), as an integer; surface index and flags are copied as they are.
  const track = readJsonFixture('hash-vector.cambotrack.json');
  const expected =
    'cambotrack/1\n' +
    'kind=stage\n' +
    'laps=1\n' +
    'scale=2500\n' +
    'vertical_scale=2500\n' +
    'road_width=1100\n' +
    'spacing=2000\n' +
    'surfaces=asphalt,dirt\n' +
    'points=12\n' +
    '0,0,0,1100,0,0;0,0,-4000,1100,0,0;12,25,-8000,1100,0,0;12,50,-12000,950,1,0;' +
    '0,75,-16000,800,1,1;-7,100,-20000,800,1,1;0,125,-24000,950,1,2;0,150,-28000,1100,0,3;' +
    '50,125,-32000,1100,0,0;101,100,-36000,1100,0,0;50,50,-40000,1100,0,0;0,0,-44000,1100,0,0\n' +
    'checkpoints=3,7\n' +
    'gates=5\n';
  assert.equal(C.canonicalText(track), expected);
  assert.equal(readFixture('hash-vector.canonical.txt'), expected);
  const hash = '2cc3ca236a70c0fe7b9cee0b30a6196a4832c144b5910dd491356916e626b3a0';
  assert.equal(nodeSha(expected), hash);
  assert.equal(C.trackHash(track), hash);
  assert.equal(track.hash, hash);
});

test('hash: what it covers and what it leaves out', () => {
  const base = readJsonFixture('hash-vector.cambotrack.json');
  const h = C.trackHash(base);
  // Dressing: no effect.
  for (const [key, value] of [['id', 'other'], ['name', 'Autre nom'], ['author', 'x'], ['created', '2027-01-01T00:00:00Z'],
    ['games', ['3d_buggy']], ['origin', { lat: 1, lon: 2, ele: 3 }], ['length_game_m', 1], ['elevation', null],
    ['waypoints', [[1, 2]]], ['allowed_classes', ['track']], ['attribution', 'x']]) {
    assert.equal(C.trackHash({ ...base, [key]: value }), h, `${key} changed the hash`);
  }
  // Geometry and rules: a different hash.
  const moved = structuredClone(base); moved.points[3][0] += 0.01;
  const wider = structuredClone(base); wider.points[3][3] += 0.01;
  const flagged = structuredClone(base); flagged.points[3][5] = 1;
  for (const [what, t] of [['a point', moved], ['a width', wider], ['a flag', flagged],
    ['kind', { ...base, kind: 'loop' }], ['laps', { ...base, laps: 2 }], ['scale', { ...base, scale: 2.501 }],
    ['vertical_scale', { ...base, vertical_scale: 3 }], ['road_width', { ...base, road_width: 10.99 }],
    ['spacing', { ...base, spacing: 5.01 }], ['surfaces', { ...base, surfaces: ['asphalt', 'sand'] }],
    ['checkpoints', { ...base, checkpoints: [4] }], ['gates', { ...base, gates: [2] }], ['no gates', { ...base, gates: [] }]]) {
    assert.notEqual(C.trackHash(t), h, `${what} did not change the hash`);
  }
  // laps absent is laps = 1; gates absent is gates empty (FORMAT.md, section Hash).
  assert.equal(C.trackHash({ ...base, laps: 1 }), h);
  const noGates = { ...base }; delete noGates.gates;
  assert.equal(C.trackHash(noGates), C.trackHash({ ...base, gates: [] }));
  assert.ok(C.canonicalText(noGates).endsWith('checkpoints=3,7\ngates=\n'));
  // No checkpoint at all: the line is there, empty.
  assert.ok(C.canonicalText({ ...base, checkpoints: [], gates: [] }).endsWith('\ncheckpoints=\ngates=\n'));
});

test('hash: the core and the second implementation agree on the samples', () => {
  for (const name of ['sample-loop.cambotrack.json', 'sample-stage.cambotrack.json']) {
    const t = readJsonFixture(name);
    assert.equal(C.canonicalText(t), canonicalText(t));
    assert.equal(C.trackHash(t), referenceHash(t));
    assert.equal(t.hash, referenceHash(t));
  }
});
