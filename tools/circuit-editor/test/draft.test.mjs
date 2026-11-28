// The drawing in progress, kept from one visit to the next (core, section 12).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore, plain } from './helpers.mjs';

const C = loadCore();
const WPS = [[13.41384, 103.856094], [13.416375, 103.851813], [13.416303, 103.847743]];
const FORM = { 'f-name': 'Tour d\'essai', 'f-id': 'tour-d-essai', 'f-relief': true, 'f-laps': '3' };

test('boxOf: the box of the points, grown to a box given', () => {
  assert.deepEqual(plain(C.boxOf([1, 3, 2], [10, 12, 11], null)), [1, 10, 3, 12]);
  assert.deepEqual(plain(C.boxOf([2], [11], [1, 10, 3, 12])), [1, 10, 3, 12]);
  assert.deepEqual(plain(C.boxOf([0, 4], [9, 11], [1, 10, 3, 12])), [0, 9, 4, 12]);
  assert.deepEqual(plain(C.boxOf([5], [6], null)), [5, 6, 5, 6]);
  assert.equal(C.boxOf([], [], null), null);
});

test('a draft comes back as it was written', () => {
  const ele = { '53655_415424': 25, '53656_415424': 28.5, '-12_-7': 0 };
  const areas = [[13.40, 103.83, 13.43, 103.87], [13.43, 103.83, 13.46, 103.87]];
  const text = JSON.stringify(C.makeDraft('loop', WPS, FORM, [13.41, 103.84, 13.42, 103.86], ele, '2026-11-27T05:00:00Z', areas));
  const d = plain(C.parseDraft(text));
  assert.deepEqual(d, { v: 1, saved: '2026-11-27T05:00:00Z', kind: 'loop', waypoints: WPS, form: FORM,
    box: [13.41, 103.84, 13.42, 103.86], ele, areas, photos: [], objects: [], objects_made: '' });
  // Waypoints keep every digit: a point put back on its road must land where it was.
  assert.equal(JSON.parse(text).waypoints[0][1], 103.856094);
});

test('a draft without a box or elevations: the box is the waypoints\' own', () => {
  const d = plain(C.parseDraft(JSON.stringify(C.makeDraft('stage', WPS, {}, null, null, ''))));
  assert.equal(d.kind, 'stage');
  assert.deepEqual(d.box, [13.41384, 103.847743, 13.416375, 103.856094]);
  assert.equal(d.ele, null);
  assert.deepEqual(d.areas, []);
});

test('a box that leaves a waypoint out is grown to hold it', () => {
  const raw = C.makeDraft('loop', WPS, {}, [13.4160, 103.850, 13.4161, 103.851], null, '');
  const d = plain(C.parseDraft(JSON.stringify(raw)));
  assert.deepEqual(d.box, [13.41384, 103.847743, 13.416375, 103.856094]);
});

test('what is not a draft is refused', () => {
  const good = C.makeDraft('loop', WPS, FORM, null, null, '');
  const bad = (change) => { const d = JSON.parse(JSON.stringify(good)); change(d); return C.parseDraft(JSON.stringify(d)); };
  for (const text of [null, undefined, '', 'null', '[]', '{', '"draft"', '{"v":1}']) assert.equal(C.parseDraft(text), null, String(text));
  assert.equal(bad((d) => { d.v = 2; }), null, 'another version');
  assert.equal(bad((d) => { d.waypoints = []; }), null, 'no waypoint');
  assert.equal(bad((d) => { d.waypoints[1] = [91, 0]; }), null, 'a latitude out of range');
  assert.equal(bad((d) => { d.waypoints[1] = ['13.4', 103.8]; }), null, 'a waypoint that is not two numbers');
  assert.equal(bad((d) => { d.waypoints[1] = [13.4, null]; }), null, 'a missing longitude');
  assert.equal(bad((d) => { d.waypoints = new Array(C.DRAFT_MAX_WAYPOINTS + 1).fill([13.4, 103.8]); }), null, 'too many waypoints');
  assert.notEqual(bad(() => {}), null);
});

test('what cannot be used in a draft is dropped', () => {
  const raw = C.makeDraft('loop', WPS, {}, null, null, '');
  raw.kind = 'figure-eight';
  raw.saved = 12;
  raw.form = { 'f-name': 'Nom', 'f-relief': false, 'f-laps': 3, nested: { a: 1 }, long: 'x'.repeat(201) };
  raw.box = [13.42, 103.84, 13.41, 103.86];                    // south above north
  raw.ele = { '53655_415424': 25, 'not-a-key': 3, '1_2': 'high', '3_4': null, '5_6': Infinity };
  raw.areas = [[13.40, 103.83, 13.43, 103.87], [13.43, 103.87, 13.40, 103.83], [1, 2, 3], 'box', [0, 0, 91, 1]];
  const d = plain(C.parseDraft(JSON.stringify(raw)));
  assert.equal(d.kind, 'loop');
  assert.equal(d.saved, '');
  assert.deepEqual(d.form, { 'f-name': 'Nom', 'f-relief': false });
  assert.deepEqual(d.box, [13.41384, 103.847743, 13.416375, 103.856094]);
  assert.deepEqual(d.ele, { '53655_415424': 25 });
  assert.deepEqual(d.areas, [[13.40, 103.83, 13.43, 103.87]]);
  // No more areas than a draft may carry.
  const many = C.makeDraft('loop', WPS, {}, null, null, '', new Array(C.DRAFT_MAX_AREAS + 5).fill([13.40, 103.83, 13.43, 103.87]));
  assert.equal(many.areas.length, C.DRAFT_MAX_AREAS);
});

test('boxes: a key to the metre, and whether one holds another', () => {
  assert.equal(C.boxKey([10.4525, 104.2535, 10.5285, 104.3565]), '10.45250,104.25350,10.52850,104.35650');
  assert.equal(C.boxKey([-0.000004, 1, 2, 3]), '-0.00000,1.00000,2.00000,3.00000');
  const big = [10.45, 104.25, 10.53, 104.36];
  assert.ok(C.boxCovers(big, [10.46, 104.26, 10.52, 104.35]));
  assert.ok(C.boxCovers(big, big), 'a box holds itself');
  assert.ok(C.boxCovers(big, [10.449995, 104.25, 10.53, 104.36]), 'to within the precision of the key');
  assert.ok(!C.boxCovers(big, [10.44, 104.26, 10.52, 104.35]), 'not when it sticks out to the south');
  assert.ok(!C.boxCovers(big, [10.46, 104.26, 10.52, 104.37]), 'nor to the east');
  assert.ok(!C.boxCovers([10.46, 104.26, 10.52, 104.35], big));
});
