// Photos: the GPS position a JPEG carries, and a photo's place beside the course.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import {
  loadCore, plain, readSchema, validateSchema, formatRuleErrors, graphOf, routeThrough, SMALL_FIXTURE, FIXTURES,
  exifTiff, photoJpeg, photoBase, photoFixture, PHOTO_FIXTURES, zipBytes,
} from './helpers.mjs';

const C = loadCore();
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} is not within ${tol} of ${b}`);
const base = photoBase();
const jpeg = (opts, afterFirst) => photoJpeg(base, exifTiff(opts), afterFirst);
const IMAGE = 'data:image/jpeg;base64,' + Buffer.from(base).toString('base64');

/* ------------------------------------------------------------ reading Exif */

test('Exif GPS: both byte orders, the four hemispheres', () => {
  for (const little of [true, false]) {
    for (const [lat, lon] of [[13.416314, 103.853748], [-33.924869, 18.424055], [48.858370, -2.294481], [-0.180653, -78.467838]]) {
      const r = C.readExifGps(jpeg({ little, lat, lon }));
      assert.ok(r.ok, `${little ? 'II' : 'MM'} ${lat},${lon}: ${r.error}`);
      near(r.lat, lat, 1e-7, 'latitude'); near(r.lon, lon, 1e-7, 'longitude');
      assert.equal(r.ele, null); assert.equal(r.taken, null); assert.equal(r.bearing, null);
    }
  }
});

test('Exif GPS: altitude above and below the sea, date taken, direction', () => {
  const r = C.readExifGps(jpeg({ lat: 10.4775, lon: 104.29675, ele: 23.4, taken: '2026:11:25 17:26:46', bearing: 214.5 }));
  assert.deepEqual(plain({ ok: r.ok, ele: r.ele, taken: r.taken, bearing: r.bearing }), { ok: true, ele: 23.4, taken: '2026-11-25T17:26:46', bearing: 214.5 });
  assert.equal(C.readExifGps(jpeg({ little: false, lat: 31.5, lon: 35.47, ele: -430.5 })).ele, -430.5);
  // A date that is not one is left out, the position stays.
  const odd = C.readExifGps(jpeg({ lat: 10.5, lon: 104.3, taken: '    :  :     :  :  ' }));
  assert.ok(odd.ok); assert.equal(odd.taken, null);
});

test('Exif GPS: the block after a first segment, minutes and seconds left out', () => {
  const r = C.readExifGps(jpeg({ lat: 13.416314, lon: 103.853748 }, true));
  assert.ok(r.ok); near(r.lat, 13.416314, 1e-7);
  const whole = C.readExifGps(jpeg({ lat: 13, lon: 104, noMinSec: true }));
  assert.ok(whole.ok); assert.equal(whole.lat, 13); assert.equal(whole.lon, 104);
});

test('Exif GPS: what is not a position is refused, with the reason', () => {
  assert.equal(C.readExifGps(base).error, 'no_exif');
  assert.equal(C.readExifGps(jpeg({ taken: '2026:11:25 18:10:00' })).error, 'no_gps');
  assert.equal(C.readExifGps(jpeg({ lat: 0, lon: 0 })).error, 'bad_gps', 'a receiver without a fix writes zeros');
  assert.equal(C.readExifGps(Uint8Array.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])).error, 'not_jpeg');
  assert.equal(C.readExifGps(new Uint8Array(0)).error, 'not_jpeg');
  assert.equal(C.readExifGps(null).error, 'not_jpeg');
  // Degrees out of range.
  const far = exifTiff({ lat: 13, lon: 104, noMinSec: true });
  const bad = photoJpeg(base, far);
  // The latitude's degrees are the first rational of the data area: write 91 there.
  const at = bad.length - (base.length - 2) - 48;
  bad[at] = 91;
  assert.equal(C.readExifGps(bad).error, 'bad_gps');
});

test('Exif GPS: a file cut anywhere, or damaged, never breaks the reader', () => {
  const whole = jpeg({ little: false, lat: 13.416314, lon: 103.853748, ele: 12, taken: '2026:11:25 17:26:46', bearing: 10 });
  let read = 0;
  for (let n = 0; n <= whole.length; n += 1) {
    const r = C.readExifGps(whole.subarray(0, n));
    assert.equal(typeof r.ok, 'boolean');
    if (r.ok) { read++; near(r.lat, 13.416314, 1e-7); }
  }
  assert.ok(read > 0 && read < whole.length, 'read once the block is whole, not before');
  // Every byte of the block set to 0xFF in turn, then to 0: still an answer, never a throw.
  const blockEnd = whole.length - (base.length - 2);
  for (const value of [0xFF, 0x00]) {
    for (let i = 2; i < blockEnd; i++) {
      const copy = Uint8Array.from(whole);
      copy[i] = value;
      const r = C.readExifGps(copy);
      assert.equal(typeof r.ok, 'boolean');
      if (r.ok) assert.ok(Math.abs(r.lat) <= 90 && Math.abs(r.lon) <= 180);
    }
  }
});

test('the photo fixtures are what the helper builds, and read as written', () => {
  for (const name of Object.keys(PHOTO_FIXTURES)) {
    const want = PHOTO_FIXTURES[name], file = new Uint8Array(fs.readFileSync(new URL(name, FIXTURES)));
    assert.deepEqual(Array.from(file), Array.from(photoFixture(name)), `${name}: run make-fixtures.mjs`);
    const r = C.readExifGps(file);
    if (want.lat === undefined) assert.equal(r.error, 'no_gps', name);
    else { assert.ok(r.ok, name); near(r.lat, want.lat, 1e-7); near(r.lon, want.lon, 1e-7); }
  }
});

/* ------------------------------------------------------ nearest on a line */

test('nearestOnLine: the foot of the perpendicular, the ends, a closed line', () => {
  const M = C.metersPerDegree(10.6), at = (e, n) => [10.6 + n / M.lat, 104.18 + e / M.lon];
  const line = [at(0, 0), at(1000, 0), at(1000, 500)], lats = line.map((p) => p[0]), lons = line.map((p) => p[1]);
  let r = C.nearestOnLine(...at(400, 30), lats, lons, false);
  near(r.dist, 30, 0.05); assert.equal(r.index, 0); near(r.t, 0.4, 1e-3);
  r = C.nearestOnLine(...at(1040, 250), lats, lons, false);
  near(r.dist, 40, 0.05); assert.equal(r.index, 1); near(r.t, 0.5, 1e-3);
  r = C.nearestOnLine(...at(-30, -40), lats, lons, false);
  near(r.dist, 50, 0.05); assert.equal(r.index, 0); assert.equal(r.t, 0);
  // Closed, the way back from the last point to the first counts too.
  r = C.nearestOnLine(...at(500, 260), lats, lons, false);
  near(r.dist, 260, 0.05);
  r = C.nearestOnLine(...at(500, 260), lats, lons, true);
  near(r.dist, 8.9, 0.5); assert.equal(r.index, 2);
});

/* ------------------------------------------------- photos in the export chain */

const WAYPOINTS = [[13.41384, 103.856094], [13.416375, 103.851813], [13.416303, 103.847743], [13.414028, 103.85076]];
const photo = (name, extra = {}) => {
  const f = PHOTO_FIXTURES[name];
  return { name, lat: f.lat, lon: f.lon, w: 160, h: 120, image: IMAGE, ...extra };
};
function loopWith(settings) {
  const g = graphOf(SMALL_FIXTURE);
  const { wps, route } = routeThrough(g, WAYPOINTS, 'loop', null, 25);
  const s = { id: 'photos', name: 'Photos', kind: 'loop', relief: false, ...settings, waypoints: wps.map((w) => [w.lat, w.lon]) };
  return { res: C.buildTrack(g, route.line, s, null), route };
}

test('a photo near the course is written at its place; one too far is left out', () => {
  const { res } = loopWith({ photos: [photo('photo-near.jpg', { ele: 23.4, taken: '2026-11-25T17:26:46', bearing: 214.5 }), photo('photo-far.jpg'), photo('photo-near-2.jpg')] });
  assert.ok(res.ok, JSON.stringify(res.errors));
  const t = res.track;
  assert.deepEqual(validateSchema(readSchema(), t), []);
  assert.deepEqual(formatRuleErrors(t).errors, []);
  assert.deepEqual(plain(C.checkTrack(t).errors), []);
  assert.equal(t.photos.length, 2);
  assert.deepEqual(plain(res.photos.map((p) => [p.kept, p.why ?? ''])), [[true, ''], [false, 'far'], [true, '']]);
  assert.ok(res.photos[1].dist_m > 1000);
  assert.deepEqual(plain(res.notes.filter((n) => n.code === 'photo_far').map((n) => n.name)), ['photo-far.jpg']);
  const [a, b] = t.photos;
  assert.deepEqual(Object.keys(a), ['name', 'spot', 'view', 'lat', 'lon', 'ele', 'taken', 'bearing', 'point', 'at_m', 'side', 'offset_m', 'x', 'z', 'w', 'h', 'image']);
  assert.deepEqual(Object.keys(b), ['name', 'spot', 'view', 'lat', 'lon', 'point', 'at_m', 'side', 'offset_m', 'x', 'z', 'w', 'h', 'image']);
  // Two places, far apart: each one's only photo shows the road ahead.
  assert.deepEqual(plain([a, b].map((p) => [p.spot, p.view])), [[1, 'front'], [2, 'front']]);
  for (const p of [a, b]) {
    // 20 m to the left of the road, in real metres: the file is in game metres.
    near(p.offset_m * t.scale, 20, 3, `${p.name} offset`);
    assert.equal(p.side, 'left');
    // The place written is the place of the photo on the Earth, in the frame of the points.
    const enu = C.makeEnu(t.origin.lat, t.origin.lon), ll = enu.inverse(p.x * t.scale, -p.z * t.scale);
    near(C.distance(ll[0], ll[1], p.lat, p.lon), 0, 0.1, `${p.name} place`);
    // And the point named is the nearest of the course.
    const d = (q) => Math.hypot(q[0] - p.x, q[2] - p.z);
    const nearest = t.points.reduce((best, q, i) => (d(q) < d(t.points[best]) ? i : best), 0);
    assert.equal(p.point, nearest);
    near(d(t.points[p.point]), p.offset_m, 0.011);
  }
  assert.ok(a.at_m < b.at_m, 'the first leg comes before the last');
  // Driven the other way, the same photo is on the right.
  const g = graphOf(SMALL_FIXTURE);
  const back = routeThrough(g, [WAYPOINTS[0], WAYPOINTS[3], WAYPOINTS[2], WAYPOINTS[1]], 'loop', null, 25);
  const other = C.buildTrack(g, back.route.line, { id: 'photos', name: 'Photos', kind: 'loop', relief: false, photos: [photo('photo-near.jpg')] }, null);
  assert.ok(other.ok);
  assert.equal(other.track.photos[0].side, 'right');
});

test('photos change neither the course nor its hash, and a file without photos is the file of always', () => {
  const plainTrack = loopWith({}).res.track, withPhotos = loopWith({ photos: [photo('photo-near.jpg')] }).res.track;
  assert.equal(withPhotos.hash, plainTrack.hash);
  assert.deepEqual(plain(withPhotos.points), plain(plainTrack.points));
  assert.equal('photos' in plainTrack, false);
  assert.equal('photo_max_m' in withPhotos.editor, false, 'the default distance is not written');
  // All photos left out: no field at all.
  const none = loopWith({ photos: [photo('photo-far.jpg')] }).res.track;
  assert.equal(C.serializeTrack(none), C.serializeTrack(plainTrack));
});

test('the distance allowed is a setting, kept for « Ouvrir »', () => {
  const tight = loopWith({ photo_max_m: 10, photos: [photo('photo-near.jpg')] }).res;
  assert.equal(tight.track.photos, undefined);
  assert.equal(tight.photos[0].why, 'far'); near(tight.photos[0].dist_m, 20, 3);
  const wide = loopWith({ photo_max_m: 2000, photos: [photo('photo-near.jpg'), photo('photo-far.jpg')] }).res;
  assert.equal(wide.track.photos.length, 2);
  assert.equal(wide.track.editor.photo_max_m, 2000);
  assert.equal(C.normalizeSettings({ photo_max_m: 1 }).photo_max_m, 5);
  assert.equal(C.normalizeSettings({ photo_max_m: 1e9 }).photo_max_m, 2000);
  assert.equal(C.normalizeSettings({}).photo_max_m, 100);
});

test('no more photos than a file may carry, and none that is not a photo', () => {
  const many = [];
  for (let i = 0; i < C.LIMITS.maxPhotos + 3; i++) many.push(photo('photo-near.jpg', { name: `p${i}.jpg` }));
  const res = loopWith({ photos: many }).res;
  assert.equal(res.track.photos.length, C.LIMITS.maxPhotos);
  assert.equal(res.photos.filter((p) => p.why === 'too_many').length, 3);
  const odd = loopWith({ photos: [null, 'photo', { lat: 13.4163, lon: 103.8537 }, photo('photo-near.jpg', { image: 'data:image/png;base64,AAAA' }),
    photo('photo-near.jpg', { image: IMAGE + '<script>' }), photo('photo-near.jpg', { lat: 0, lon: 0 }), photo('photo-near.jpg', { w: 0 }),
    photo('photo-near.jpg', { image: 'data:image/jpeg;base64,' + 'A'.repeat(C.LIMITS.maxPhotoImage) })] }).res;
  assert.equal(odd.track.photos, undefined);
  assert.deepEqual(plain(odd.photos.map((p) => p.why)), new Array(8).fill('bad'));
});

test('cleanPhoto: what is kept of a photo, and how', () => {
  const p = C.cleanPhoto({ name: '  a/very:long name.jpg  ', lat: 13.41631449, lon: 103.85374851, ele: 23.449, taken: '2026-11-25T17:26:46',
    bearing: 359.96, w: 512.2, h: 384, image: IMAGE, extra: 1 }, true);
  assert.deepEqual(plain(p), { name: 'a/very:long name.jpg', lat: 13.416314, lon: 103.853749, ele: 23.4, taken: '2026-11-25T17:26:46', bearing: 0,
    w: 512, h: 384, view: null, image: IMAGE });
  assert.equal(C.cleanPhoto({ lat: 13.4, lon: 103.8, view: 'left' }, false).view, 'left');
  assert.equal(C.cleanPhoto({ lat: 13.4, lon: 103.8, view: 'back' }, false).view, null, 'not a view the file knows');
  assert.equal(C.cleanPhoto({ lat: 13.4, lon: 103.8, name: 'x'.repeat(300) }, false).name.length, C.LIMITS.maxPhotoName);
  assert.equal(C.cleanPhoto({ lat: 13.4, lon: 103.8 }, false).name, 'photo');
  assert.equal(C.cleanPhoto({ lat: 13.4, lon: 103.8, taken: '25/11/2026' }, false).taken, null);
  assert.equal(C.cleanPhoto({ lat: 13.4, lon: 103.8, bearing: 360 }, false).bearing, null);
  assert.equal(C.cleanPhoto({ lat: 13.4, lon: 103.8, bearing: 214.46 }, false).bearing, 214.5);
  assert.equal(C.cleanPhoto({ lat: 91, lon: 0 }, false), null);
  assert.equal(C.cleanPhoto({ lat: '13.4', lon: 103.8 }, false), null);
  assert.equal(C.cleanPhoto({ lat: 13.4, lon: 103.8, w: 10, h: 10 }, true), null, 'an image is needed');
});

test('a file with photos reads back; photos that cannot be used are left out, the file stays readable', () => {
  const t = loopWith({ photos: [photo('photo-near.jpg'), photo('photo-near-2.jpg')] }).res.track;
  const text = C.serializeTrack(t);
  assert.equal(text.split('\n').filter((l) => l.startsWith('    {"name":"photo-near')).length, 2, 'one photo a line');
  const back = C.parseTrack(text);
  assert.ok(back.ok && back.check.ok);
  assert.deepEqual(plain(C.trackPhotos(back.track).map((p) => p.name)), ['photo-near.jpg', 'photo-near-2.jpg']);
  // Tampered with: the check says so, the track still opens, the bad photo is not read.
  const bad = JSON.parse(text);
  bad.photos[0].image = 'https://example.org/photo.jpg';
  bad.photos[1].point = 999999;
  const again = C.parseTrack(JSON.stringify(bad));
  assert.ok(again.ok, 'photos never make a track unreadable');
  assert.deepEqual(plain(again.check.errors.map((e) => e.code)), ['photos']);
  assert.deepEqual(plain(C.trackPhotos(again.track).map((p) => p.name)), ['photo-near-2.jpg']);
  assert.deepEqual(plain(C.trackPhotos({ photos: 'none' })), []);
  assert.deepEqual(plain(C.trackPhotos({})), []);
});

test('a draft carries its photos by reference, without the images', () => {
  const photos = [{ id: 'a1b2c3d4e5f60718', ...photo('photo-near.jpg', { taken: '2026-11-25T17:26:46' }) }, { id: 'not an id', ...photo('photo-near-2.jpg') },
    { id: '0011223344556677', lat: 0, lon: 0 }];
  const d = C.makeDraft('loop', WAYPOINTS, {}, null, null, '', [], photos);
  const text = JSON.stringify(d);
  assert.ok(!text.includes('base64'), 'no image in the draft');
  const back = plain(C.parseDraft(text));
  assert.deepEqual(back.photos, [{ name: 'photo-near.jpg', lat: 13.416314, lon: 103.853748, ele: null, taken: '2026-11-25T17:26:46', bearing: null, w: 160, h: 120, view: null, id: 'a1b2c3d4e5f60718' }]);
  const chosen = C.makeDraft('loop', WAYPOINTS, {}, null, null, '', [], [{ id: 'a1b2c3d4e5f60718', ...photo('photo-near.jpg', { view: 'right' }) }]);
  assert.equal(C.parseDraft(JSON.stringify(chosen)).photos[0].view, 'right', 'a view chosen by hand is kept with the drawing');
  assert.deepEqual(plain(C.parseDraft(JSON.stringify(C.makeDraft('loop', WAYPOINTS, {}, null, null, ''))).photos), []);
});

/* ------------------------------------------------ places and views of photos */

// A point so many metres east and north of photo-near.jpg's place.
const NEAR = PHOTO_FIXTURES['photo-near.jpg'];
const beside = (east, north) => {
  const m = C.metersPerDegree(NEAR.lat);
  return { lat: NEAR.lat + north / m.lat, lon: NEAR.lon + east / m.lon };
};

test('photoViews: the photos of a place show, in the order taken, the road ahead, its left, its right, then more', () => {
  const at = [beside(0, 0), beside(5, 3), beside(-4, 2), beside(10, -8), beside(0, 0)];
  const views = plain(C.photoViews(at));
  assert.deepEqual(views.map((v) => v.view), ['front', 'left', 'right', 'extra', 'extra']);
  assert.ok(views.every((v) => v.spot === 0 && v.auto));
  // Further than PHOTO_SPOT_M from the first photo of a place: another place.
  const two = plain(C.photoViews([beside(0, 0), beside(0, C.PHOTO_SPOT_M + 2), beside(3, 0), beside(0, C.PHOTO_SPOT_M + 4)]));
  assert.deepEqual(two.map((v) => [v.spot, v.view]), [[0, 'front'], [1, 'front'], [0, 'left'], [1, 'left']]);
  // A place is measured from its first photo, not from the last one: no chain along the road.
  const chain = plain(C.photoViews([0, 20, 40, 60].map((n) => beside(0, n))));
  assert.deepEqual(chain.map((v) => v.spot), [0, 0, 1, 1]);
});

test('photoViews: a view chosen by hand stays, the others take the views left in order', () => {
  const at = [beside(0, 0), { ...beside(1, 0), view: 'front' }, beside(2, 0), beside(3, 0)];
  assert.deepEqual(plain(C.photoViews(at)).map((v) => [v.view, v.auto]), [['left', true], ['front', false], ['right', true], ['extra', true]]);
  // Two chosen the same: both keep it.
  const same = [{ ...beside(0, 0), view: 'left' }, { ...beside(1, 0), view: 'left' }, beside(2, 0)];
  assert.deepEqual(plain(C.photoViews(same)).map((v) => v.view), ['left', 'left', 'front']);
  assert.deepEqual(plain(C.photoViews([])), []);
});

test('lookAngle and viewOfLook: where the camera looked against the road ahead', () => {
  assert.equal(C.lookAngle(10, 350), 20);
  assert.equal(C.lookAngle(350, 10), -20);
  assert.equal(C.lookAngle(90, 270), 180);
  assert.equal(C.lookAngle(0, 0), 0);
  assert.deepEqual([0, 45, -45, 46, -46, 90, -90, 134, 135, -135, 180].map((a) => C.viewOfLook(a)),
    ['front', 'front', 'front', 'right', 'left', 'right', 'left', 'right', 'back', 'back', 'back']);
});

test('in the file, photos go place by place along the course, the road ahead first', () => {
  const near2 = PHOTO_FIXTURES['photo-near-2.jpg'];
  // Taken in this order: two at the end of the loop, three at its start, the last one chosen as the road ahead.
  const photos = [
    photo('photo-near-2.jpg', { name: 'end-1.jpg' }), photo('photo-near-2.jpg', { name: 'end-2.jpg', lat: near2.lat + 0.00005 }),
    photo('photo-near.jpg', { name: 'start-1.jpg' }), photo('photo-near.jpg', { name: 'start-2.jpg', lon: NEAR.lon + 0.00005 }),
    photo('photo-near.jpg', { name: 'start-3.jpg', lat: NEAR.lat - 0.00005, view: 'front' }),
  ];
  const res = loopWith({ photos }).res;
  assert.ok(res.ok);
  assert.deepEqual(validateSchema(readSchema(), res.track), []);
  assert.deepEqual(plain(C.checkTrack(res.track).errors), []);
  assert.deepEqual(plain(res.track.photos.map((p) => [p.spot, p.view, p.name])), [
    [1, 'front', 'start-3.jpg'], [1, 'left', 'start-1.jpg'], [1, 'right', 'start-2.jpg'], [2, 'front', 'end-1.jpg'], [2, 'left', 'end-2.jpg']]);
  // What became of each is said in the order given.
  assert.deepEqual(plain(res.photos.map((p) => [p.spot, p.view, p.auto])), [[2, 'front', true], [2, 'left', true], [1, 'left', true], [1, 'right', true], [1, 'front', false]]);
  // Read back, the file gives the same places and views.
  const back = C.parseTrack(C.serializeTrack(res.track));
  const again = loopWith({ photos: C.trackPhotos(back.track) }).res;
  assert.deepEqual(plain(again.track.photos.map((p) => [p.spot, p.view, p.name])), plain(res.track.photos.map((p) => [p.spot, p.view, p.name])));
  // Only the view that the order would not give stays a choice once read back.
  assert.deepEqual(plain(C.trackPhotos(back.track).map((p) => [p.name, p.view])),
    [['start-3.jpg', null], ['start-1.jpg', null], ['start-2.jpg', null], ['end-1.jpg', null], ['end-2.jpg', null]]);
  const chosen = JSON.parse(C.serializeTrack(res.track));
  chosen.photos[1].view = 'extra';
  assert.deepEqual(plain(C.trackPhotos(chosen).map((p) => p.view)), ['front', 'extra', 'right', 'front', 'left'],
    'left to the order, the third photo would become the left side: every view stays as written');
  chosen.photos[2].view = 'extra';
  assert.deepEqual(plain(C.trackPhotos(chosen).map((p) => p.view)), [null, 'extra', 'extra', null, null]);
  // A spot or a view that is not one is caught by the check.
  for (const [k, v] of [['spot', 0], ['spot', 1.5], ['view', 'back'], ['view', 3]]) {
    const t = JSON.parse(C.serializeTrack(res.track));
    t.photos[0][k] = v;
    assert.deepEqual(plain(C.checkTrack(t).errors.map((e) => e.code)), ['photos'], `${k} ${v}`);
  }
});

test('the camera\'s direction is measured against the road ahead', () => {
  const res = loopWith({ photos: [photo('photo-near.jpg', { bearing: 214.5 }), photo('photo-near-2.jpg')] }).res;
  const t = res.track, p = t.photos[0], n = t.points.length;
  const a = t.points[(p.point - 1 + n) % n], b = t.points[(p.point + 1) % n];
  const heading = Math.atan2(b[0] - a[0], a[2] - b[2]) * 180 / Math.PI;
  near(res.photos[0].look, C.lookAngle(214.5, heading), 1);
  assert.equal(res.photos[1].look, null, 'no direction in its metadata');
});

/* --------------------------------------------------------------- zip archives */

// An archive as the page reads it: the tail, the directory, then each entry.
function readZip(bytes) {
  const tailAt = Math.max(0, bytes.length - C.ZIP_TAIL);
  let end = C.zipEnd(bytes.subarray(tailAt), tailAt);
  if (end && end.zip64 !== undefined) end = C.zip64End(bytes.subarray(end.zip64, end.zip64 + 56));
  if (!end) return null;
  const entries = C.zipDirectory(bytes.subarray(end.at, end.at + end.size), end.count);
  if (!entries) return null;
  return Array.from(entries, (e) => {
    const start = e.local + C.zipDataStart(bytes.subarray(e.local, e.local + 30));
    const data = bytes.subarray(start, start + e.csize);
    return { name: e.name, flags: e.flags, usize: e.usize, data: Buffer.from(e.method === 8 ? zlib.inflateRawSync(data) : data) };
  });
}

test('zip: an archive written by Python\'s zipfile, stored and deflated entries, a folder, a comment', () => {
  const got = readZip(new Uint8Array(fs.readFileSync(new URL('photos-album.zip', FIXTURES))));
  assert.deepEqual(got.map((e) => e.name), ['Album Kep/', 'Album Kep/photo-near.jpg', 'Album Kep/photo-near-2.jpg', 'Album Kep/capture.png', 'Album Kep/Été à Kep.jpg']);
  assert.ok(got[1].data.equals(Buffer.from(photoFixture('photo-near.jpg'))));
  assert.ok(got[2].data.equals(Buffer.from(photoFixture('photo-near-2.jpg'))));
  assert.ok(got[4].data.equals(Buffer.from(photoFixture('photo-near.jpg'))), 'a deflated copy under a name in UTF-8');
  assert.ok(C.readExifGps(new Uint8Array(got[2].data)).ok);
});

test('zip: ZIP64 records and extra fields, as archives over 4 GiB have them', () => {
  const files = [['a.jpg', Buffer.from(photoFixture('photo-near.jpg'))], ['b.txt', Buffer.from('hello')]];
  for (const deflate of [false, true]) {
    const got = readZip(zipBytes(files, { zip64: true, deflate, comment: 'Google Photos' }));
    assert.deepEqual(got.map((e) => [e.name, e.data.length]), files.map(([n, d]) => [n, d.length]));
    assert.ok(got[0].data.equals(files[0][1]));
  }
});

test('zip: what is not an archive is refused, never a crash', () => {
  const good = zipBytes([['a.jpg', Buffer.from('jpeg')]], { comment: 'x' });
  assert.deepEqual(readZip(good).map((e) => e.data.toString()), ['jpeg']);
  assert.equal(C.zipEnd(new Uint8Array(0), 0), null);
  assert.equal(C.zipEnd(photoFixture('photo-near.jpg'), 0), null);
  assert.equal(C.zipDataStart(new Uint8Array(10)), -1);
  assert.equal(C.zip64End(new Uint8Array(56)), null);
  // Cut anywhere, or one byte changed anywhere: null or entries, nothing thrown.
  for (let k = 0; k < good.length; k++) {
    const cut = good.subarray(0, k);
    C.zipEnd(cut, 0);
    const bent = Uint8Array.from(good); bent[k] ^= 0xA5;
    const end = C.zipEnd(bent, 0);
    if (end && end.at !== undefined) C.zipDirectory(bent.subarray(end.at, end.at + end.size), end.count);
  }
  // The end record's directory must lie before it.
  const lying = Uint8Array.from(good);
  const eocd = lying.length - 22 - 1;
  lying[eocd + 16] = 0xFF; lying[eocd + 17] = 0xFF;
  assert.equal(C.zipEnd(lying, 0), null);
});

/* ------------------------------------------------- the sheet for the dresser */

test('photos-brief: one image per photo and a sheet, place by place, the road ahead first', async () => {
  const { brief } = await import('../photos-brief.mjs');
  const near2 = PHOTO_FIXTURES['photo-near-2.jpg'];
  const res = loopWith({ photos: [
    photo('photo-near-2.jpg', { name: 'end-1.jpg' }),
    photo('photo-near.jpg', { name: 'start-1.jpg', bearing: 214.5, taken: '2026-11-25T17:26:46' }), photo('photo-near.jpg', { name: 'start-2.jpg', lon: NEAR.lon + 0.00005 }),
    photo('photo-near.jpg', { name: 'start-3.jpg', lat: NEAR.lat - 0.00005 }), photo('photo-near.jpg', { name: 'start-4.jpg', lat: NEAR.lat + 0.00005 }),
    photo('photo-near-2.jpg', { name: 'end-2.jpg', lat: near2.lat + 0.00005 }),
  ] }).res;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-'));
  try {
    const r = brief(C.serializeTrack(res.track), dir, C);
    assert.deepEqual([r.photos, r.places], [6, 2]);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['brief.md', 'lieu-01-devant.jpg', 'lieu-01-droite.jpg', 'lieu-01-gauche.jpg', 'lieu-01-plus-1.jpg',
      'lieu-02-devant.jpg', 'lieu-02-gauche.jpg']);
    assert.ok(fs.readFileSync(path.join(dir, 'lieu-01-devant.jpg')).equals(Buffer.from(base)), 'the image as the file carries it');
    const md = fs.readFileSync(path.join(dir, 'brief.md'), 'utf8');
    assert.match(md, /^# Photos du circuit « Photos »/);
    assert.match(md, /6 photos, 2 lieux/);
    assert.ok(md.indexOf('## Lieu 1') < md.indexOf('## Lieu 2'));
    assert.match(md, /`lieu-01-devant\.jpg` : \*\*devant\*\* · prise \d+ m à gauche de la route · boussole : [+-]\d+° par rapport à la route/);
    assert.match(md, /2026-11-25 17:26:46/);
    assert.match(md, /« start-4\.jpg »/);
    // A file without photos has a sheet that says so.
    const none = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-'));
    assert.equal(brief(C.serializeTrack(loopWith({}).res.track), none, C).photos, 0);
    assert.match(fs.readFileSync(path.join(none, 'brief.md'), 'utf8'), /Aucune photo/);
    fs.rmSync(none, { recursive: true });
  } finally { fs.rmSync(dir, { recursive: true }); }
});

/* ---------------------------------------------------------------------- HEIC */

// A HEIC's position read as the page reads it: the top-level boxes walked to the
// metadata box, wherever it lies, then the Exif item's extents.
function heifGps(bytes) {
  let pos = 0, place = null;
  while (pos < bytes.length && !place) {
    const box = C.heifBoxHeader(bytes.subarray(pos, pos + 16));
    if (!box) break;
    const size = box.size || bytes.length - pos;
    if (box.type === 'meta') place = C.heifExifPlace(bytes.subarray(pos, pos + size), pos);
    pos += size;
  }
  if (!place || !place.ok) return { ok: false, error: 'no_exif' };
  return C.readHeifExifGps(new Uint8Array(Buffer.concat(place.extents.map(([o, l]) => bytes.subarray(o, o + l)))));
}
const heic = (name) => new Uint8Array(fs.readFileSync(new URL(name, FIXTURES)));

test('HEIC: the position of a photo written by heif-enc, metadata first or after the picture', () => {
  const want = PHOTO_FIXTURES['photo-near-2.jpg'];
  for (const name of ['photo-near-2.heic', 'photo-near-2-late.heic']) {
    const b = heic(name);
    assert.ok(C.isHeif(b), name);
    const r = heifGps(b);
    assert.ok(r.ok, `${name}: ${r.error}`);
    near(r.lat, want.lat, 1e-7, name); near(r.lon, want.lon, 1e-7, name);
    assert.equal(r.taken, '2026-11-25T17:41:02');
  }
  // As a phone writes it, the metadata box is in the first bytes read.
  const first = C.heifExifPlace(heic('photo-near-2.heic').subarray(0, 4096), 0);
  assert.ok(first.ok);
  // Read from the start of the file, the late one has its metadata box out of reach.
  assert.equal(C.heifExifPlace(heic('photo-near-2-late.heic').subarray(0, 600), 0).error, 'no_exif');
});

test('HEIC: what is not one, or is broken, is refused, never a crash', () => {
  assert.equal(C.isHeif(photoFixture('photo-near.jpg')), false);
  assert.equal(C.isHeif(new Uint8Array(4)), false);
  assert.equal(C.isHeif(null), false);
  assert.equal(C.heifBoxHeader(new Uint8Array(4)), null);
  assert.equal(C.heifBoxHeader(Uint8Array.from([0, 0, 0, 4, 0x6d, 0x64, 0x61, 0x74])), null, 'a box smaller than its header');
  assert.deepEqual(plain(C.heifBoxHeader(Uint8Array.from([0, 0, 0, 1, 0x6d, 0x64, 0x61, 0x74, 0, 0, 0, 1, 0, 0, 0, 0]))), { type: 'mdat', size: 4294967296, head: 16 });
  assert.deepEqual(plain(C.heifBoxHeader(Uint8Array.from([0, 0, 0, 0, 0x6d, 0x64, 0x61, 0x74]))), { type: 'mdat', size: 0, head: 8 });
  assert.equal(C.readHeifExifGps(new Uint8Array(8)).error, 'no_exif');
  assert.equal(C.readHeifExifGps(Uint8Array.from([255, 255, 255, 255, ...new Uint8Array(20)])).error, 'no_exif');
  const good = heic('photo-near-2.heic');
  for (let k = 0; k < good.length; k++) {
    C.heifExifPlace(good.subarray(0, k), 0);
    const bent = Uint8Array.from(good); bent[k] ^= 0x5A;
    const r = heifGps(bent);
    assert.ok(r.ok || ['no_exif', 'no_gps', 'bad_gps'].includes(r.error), `byte ${k}: ${JSON.stringify(r)}`);
  }
});
