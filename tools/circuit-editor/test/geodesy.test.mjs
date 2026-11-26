// WGS84, ECEF and the local tangent plane.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore, ANGKOR_ORIGIN } from './helpers.mjs';

const C = loadCore();
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} is not within ${tol} of ${b}`);

test('ECEF: known points of the ellipsoid', () => {
  const eq = C.geodeticToEcef(0, 0, 0);
  near(eq[0], 6378137, 1e-6); near(eq[1], 0, 1e-6); near(eq[2], 0, 1e-6);
  const pole = C.geodeticToEcef(90, 0, 0);
  near(pole[0], 0, 1e-6); near(pole[2], 6356752.314245, 1e-5);
  const e90 = C.geodeticToEcef(0, 90, 100);
  near(e90[0], 0, 1e-6); near(e90[1], 6378237, 1e-6);
});

test('ECEF: there and back', () => {
  for (const [lat, lon, h] of [[13.41249, 103.86659, 0], [10.63, 104.03, 1000], [-33.9, 18.4, 250], [48.85, 2.35, 35], [0, -179.9, 0], [89.9, 10, 0]]) {
    const p = C.geodeticToEcef(lat, lon, h);
    const g = C.ecefToGeodetic(p[0], p[1], p[2]);
    near(g[0], lat, 1e-10, 'latitude'); near(g[1], lon, 1e-10, 'longitude'); near(g[2], h, 1e-5, 'height');
  }
});

test('metres per degree at Angkor match the figures of the game script', () => {
  const m = C.metersPerDegree(ANGKOR_ORIGIN.lat);
  near(m.lat, ANGKOR_ORIGIN.mPerDegLat, 10);    // 110 630 in the script
  near(m.lon, ANGKOR_ORIGIN.mPerDegLon, 30);    // 108 280 in the script
});

test('ENU: the origin is (0, 0, 0), east and north point the right way', () => {
  const enu = C.makeEnu(ANGKOR_ORIGIN.lat, ANGKOR_ORIGIN.lon);
  const o = enu.forward(ANGKOR_ORIGIN.lat, ANGKOR_ORIGIN.lon);
  near(o[0], 0, 1e-9); near(o[1], 0, 1e-9); near(o[2], 0, 1e-9);
  const m = C.metersPerDegree(ANGKOR_ORIGIN.lat);
  const north = enu.forward(ANGKOR_ORIGIN.lat + 0.001, ANGKOR_ORIGIN.lon);
  near(north[0], 0, 1e-3); near(north[1], 0.001 * m.lat, 1e-3);
  const east = enu.forward(ANGKOR_ORIGIN.lat, ANGKOR_ORIGIN.lon + 0.001);
  near(east[0], 0.001 * m.lon, 1e-3); near(east[1], 0, 1e-3);
});

test('ENU is a real projection, not a flat cos(latitude) one', () => {
  // 50 km north-east the two differ by metres; the plane also drops under the Earth.
  const enu = C.makeEnu(ANGKOR_ORIGIN.lat, ANGKOR_ORIGIN.lon);
  const m = C.metersPerDegree(ANGKOR_ORIGIN.lat);
  const p = enu.forward(ANGKOR_ORIGIN.lat + 0.32, ANGKOR_ORIGIN.lon + 0.33);
  const flat = [0.33 * m.lon, 0.32 * m.lat];
  assert.ok(Math.hypot(p[0] - flat[0], p[1] - flat[1]) > 5, 'ENU and the flat formula should differ at 50 km');
  assert.ok(Math.hypot(p[0] - flat[0], p[1] - flat[1]) < 200);
  near(p[2], -(p[0] * p[0] + p[1] * p[1]) / (2 * 6371000), 2, 'drop under the tangent plane');
});

test('ENU: the inverse gives the point back, near and far', () => {
  const enu = C.makeEnu(10.6104, 104.181);
  for (const [dlat, dlon] of [[0, 0], [0.0001, -0.0002], [0.01, 0.02], [-0.2, 0.3], [0.45, -0.45]]) {
    const lat = 10.6104 + dlat, lon = 104.181 + dlon;
    const p = enu.forward(lat, lon);
    const q = enu.inverse(p[0], p[1]);
    near(q[0], lat, 1e-9, 'latitude');
    near(q[1], lon, 1e-9, 'longitude');
  }
});

test('distance and area helpers', () => {
  const d = C.distance(13.4, 103.85, 13.4, 103.86);
  near(d, 0.01 * C.metersPerDegree(13.4).lon, 1e-6);
  // The fixture area of the acceptance test: about 5.4 km by 6.2 km.
  near(C.bboxAreaKm2(13.402, 103.851, 13.451, 103.908), 33.5, 0.5);
});
