// Shared by the Node tests of the circuit editor. No dependency.
//
// - loadCore(): the <script id="core"> block of index.html, evaluated in an empty
//   node:vm context. The context holds nothing but the language itself, so the
//   core cannot lean on a DOM, on fetch or on Node.
// - validateSchema(): a small validator for the part of JSON Schema that
//   cambotrack.schema.json uses. An unknown keyword is an error, never skipped.
// - formatRuleErrors(), canonicalText(): the rules and the hash of FORMAT.md
//   written a second time, away from the core, to check one against the other.

import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

export const TOOL_DIR = new URL('../', import.meta.url);
export const FIXTURES = new URL('./fixtures/', import.meta.url);

let cachedCore = null;

export function coreSource() {
  const html = fs.readFileSync(new URL('index.html', TOOL_DIR), 'utf8');
  const m = /<script id="core">([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error('index.html has no <script id="core"> block');
  return m[1];
}

export function loadCore() {
  if (cachedCore) return cachedCore;
  const context = vm.createContext({});
  vm.runInContext(coreSource(), context, { filename: 'index.html#core' });
  if (!context.CircuitCore) throw new Error('the core block did not define CircuitCore');
  cachedCore = context.CircuitCore;
  return cachedCore;
}

// Values built inside the vm context have that context's prototypes: compare
// them through JSON, or deepStrictEqual would see two different Array classes.
export function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

export function readFixture(name) {
  const buf = fs.readFileSync(new URL(name, FIXTURES));
  return name.endsWith('.gz') ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');
}

export function readJsonFixture(name) {
  return JSON.parse(readFixture(name));
}

export function readSchema() {
  return JSON.parse(fs.readFileSync(new URL('cambotrack.schema.json', TOOL_DIR), 'utf8'));
}

const graphs = new Map();

// A graph filled from an Overpass fixture (kept: the fixtures are read once).
export function graphOf(name) {
  if (!graphs.has(name)) {
    const C = loadCore();
    const g = C.createGraph();
    C.addOverpass(g, readJsonFixture(name));
    graphs.set(name, g);
  }
  return graphs.get(name);
}

/* ------------------------------------------------------------ JSON Schema */

const ANNOTATIONS = new Set(['$schema', '$id', 'title', 'description']);

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Returns a list of messages, empty when the value fits the schema.
export function validateSchema(schema, value, path = '$') {
  const errors = [];
  const fail = (msg) => errors.push(`${path}: ${msg}`);
  const t = typeOf(value);
  for (const [key, rule] of Object.entries(schema)) {
    if (ANNOTATIONS.has(key)) continue;
    switch (key) {
      case 'type': {
        const ok = rule === t || (rule === 'number' && t === 'integer');
        if (!ok) fail(`expected ${rule}, found ${t}`);
        break;
      }
      case 'const':
        if (!same(rule, value)) fail(`expected the constant ${JSON.stringify(rule)}`);
        break;
      case 'enum':
        if (!rule.some((r) => same(r, value))) fail(`${JSON.stringify(value)} is not one of ${JSON.stringify(rule)}`);
        break;
      case 'minimum':
        if (typeof value === 'number' && value < rule) fail(`${value} is under the minimum ${rule}`);
        break;
      case 'maximum':
        if (typeof value === 'number' && value > rule) fail(`${value} is over the maximum ${rule}`);
        break;
      case 'minLength':
        if (typeof value === 'string' && [...value].length < rule) fail(`shorter than ${rule} characters`);
        break;
      case 'maxLength':
        if (typeof value === 'string' && [...value].length > rule) fail(`longer than ${rule} characters`);
        break;
      case 'pattern':
        if (typeof value === 'string' && !new RegExp(rule, 'u').test(value)) fail(`does not match ${rule}`);
        break;
      case 'required':
        if (t === 'object') for (const name of rule) if (!(name in value)) fail(`missing property ${name}`);
        break;
      case 'properties':
        if (t === 'object') {
          for (const [name, sub] of Object.entries(rule)) {
            if (name in value) errors.push(...validateSchema(sub, value[name], `${path}.${name}`));
          }
        }
        break;
      case 'minItems':
        if (t === 'array' && value.length < rule) fail(`fewer than ${rule} items`);
        break;
      case 'maxItems':
        if (t === 'array' && value.length > rule) fail(`more than ${rule} items`);
        break;
      case 'uniqueItems':
        if (rule && t === 'array' && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) fail('items are not unique');
        break;
      case 'prefixItems':
        if (t === 'array') {
          rule.forEach((sub, i) => {
            if (i < value.length) errors.push(...validateSchema(sub, value[i], `${path}[${i}]`));
          });
        }
        break;
      case 'items':
        if (t === 'array') {
          const from = Array.isArray(schema.prefixItems) ? schema.prefixItems.length : 0;
          for (let i = from; i < value.length; i++) {
            errors.push(...validateSchema(rule, value[i], `${path}[${i}]`));
            if (errors.length > 20) return errors;
          }
        }
        break;
      case 'oneOf': {
        const fits = rule.filter((sub) => validateSchema(sub, value, path).length === 0).length;
        if (fits !== 1) fail(`fits ${fits} of the oneOf branches, not exactly one`);
        break;
      }
      default:
        throw new Error(`validateSchema: keyword "${key}" is not supported (at ${path})`);
    }
  }
  return errors;
}

/* ------------------------------------------- FORMAT.md, a second time over */

export const q2 = (v) => Math.floor(v * 100 + 0.5);
export const q3 = (v) => Math.floor(v * 1000 + 0.5);

export function canonicalText(t) {
  const lines = [
    'cambotrack/1',
    `kind=${t.kind}`,
    `laps=${t.laps ?? 1}`,
    `scale=${q3(t.scale)}`,
    `vertical_scale=${q3(t.vertical_scale)}`,
    `road_width=${q2(t.road_width)}`,
    `spacing=${q2(t.spacing)}`,
    `surfaces=${t.surfaces.join(',')}`,
    `points=${t.points.length}`,
    t.points.map((p) => [q2(p[0]), q2(p[1]), q2(p[2]), q2(p[3]), p[4], p[5]].join(',')).join(';'),
    `checkpoints=${t.checkpoints.join(',')}`,
    `gates=${t.gates === undefined ? 'auto' : t.gates.join(',')}`,
  ];
  return lines.map((l) => l + '\n').join('');
}

export function referenceHash(t) {
  return crypto.createHash('sha256').update(canonicalText(t), 'utf8').digest('hex');
}

// Horizontal gaps between consecutive points; a loop gets its closing gap.
export function gaps(t) {
  const p = t.points, n = p.length, out = [];
  const last = t.kind === 'loop' ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const j = (i + 1) % n;
    out.push(Math.hypot(p[j][0] - p[i][0], p[j][2] - p[i][2]));
  }
  return out;
}

// The rules of FORMAT.md that the schema cannot express. Returns messages.
export function formatRuleErrors(t) {
  const errors = [];
  const p = t.points, n = p.length, loop = t.kind === 'loop';
  if (p[0][0] !== 0 || p[0][1] !== 0 || p[0][2] !== 0) errors.push('point 0 is not at the origin');
  p.forEach((pt, i) => {
    for (let k = 0; k < 4; k++) {
      if (Math.abs(pt[k] * 100 - Math.round(pt[k] * 100)) > 1e-6) errors.push(`point ${i}: value ${k} is not rounded to the centimetre`);
    }
    if (Math.abs(pt[0]) > 60000 || Math.abs(pt[2]) > 60000) errors.push(`point ${i}: x or z out of range`);
    if (Math.abs(pt[1]) > 3000) errors.push(`point ${i}: y out of range`);
    if (pt[3] < 3 || pt[3] > 30) errors.push(`point ${i}: width out of range`);
    if (!Number.isInteger(pt[4]) || pt[4] < 0 || pt[4] >= t.surfaces.length) errors.push(`point ${i}: surface index out of the table`);
    if (!Number.isInteger(pt[5]) || pt[5] < 0 || pt[5] > 255) errors.push(`point ${i}: flags out of range`);
  });
  const g = gaps(t);
  let length = 0;
  g.forEach((d, i) => {
    length += d;
    if (d < 0.5 || d > 50) errors.push(`gap ${i} is ${d.toFixed(3)} m, outside 0.5 to 50`);
    const j = (i + 1) % n;
    if (Math.abs(p[j][1] - p[i][1]) > 0.6 * d + 1e-9) errors.push(`slope over 60 % between points ${i} and ${j}`);
  });
  if (length < 400) errors.push(`length ${length.toFixed(1)} m is under 400 m`);
  const laps = loop ? (t.laps ?? 1) : 1;
  if (laps * length > 300000) errors.push('laps × length is over 300 km');
  if (!loop && t.laps !== undefined && t.laps !== 1) errors.push('a stage has no laps (or 1)');
  const upper = loop ? n - 1 : n - 2;
  for (const name of ['checkpoints', 'gates']) {
    const list = t[name];
    if (list === undefined) continue;
    list.forEach((idx, i) => {
      if (!Number.isInteger(idx) || idx < 1 || idx > upper) errors.push(`${name}[${i}] = ${idx} is outside 1 to ${upper}`);
      if (i > 0 && idx <= list[i - 1]) errors.push(`${name} is not strictly increasing at ${i}`);
    });
  }
  if (t.checkpoints.length > 200) errors.push('more than 200 checkpoints');
  if ((t.gates ?? []).length > 400) errors.push('more than 400 gates');
  if (t.hash !== referenceHash(t)) errors.push('hash does not match the canonical form');
  return { errors, length };
}

/* ----------------------------------------------------------- Sample courses */

// Via points of the acceptance test, in real metres east and north of the centre
// of Angkor Wat's moat, as tools/angkor_routes.py of the game wrote them.
export const ANGKOR_ORIGIN = { lat: 13.41249, lon: 103.86659, mPerDegLon: 108280, mPerDegLat: 110630 };

export function viaToLatLon([east, north]) {
  return [ANGKOR_ORIGIN.lat + north / ANGKOR_ORIGIN.mPerDegLat, ANGKOR_ORIGIN.lon + east / ANGKOR_ORIGIN.mPerDegLon];
}

export const PETIT_CIRCUIT_VIA = [
  // HEAD
  [-1146, -190], [-1146, 200], [-779, 304], [-768, 1000], [-767, 1667], [-790, 2900], [-712, 3170], [-720, 3450], [-718, 3690],
  // PETIT middle
  [699, 3714], [1467, 3723], [1880, 3755], [2000, 3620], [2030, 2620], [1880, 2610], [1880, 2380], [2040, 2380], [2050, 2120], [3000, 2165],
  // TAIL, then back to the start
  [3850, 2203], [3890, 1640], [3590, 860], [1504, 153], [760, -150], [750, -645], [-798, -637], [-987, -637], [-1146, -400],
];

// Snaps a list of [lat, lon] and routes through them. Throws when a point finds
// no road within `reach` metres.
export function routeThrough(g, latlons, kind, allowed, reach = 25) {
  const C = loadCore();
  const wps = latlons.map(([lat, lon], i) => {
    const s = C.snap(g, lat, lon, reach, allowed);
    if (!s) throw new Error(`waypoint ${i} (${lat}, ${lon}) has no road within ${reach} m`);
    return s;
  });
  const route = C.buildRoute(g, wps, kind, allowed, null);
  return { wps, route };
}

export const SMALL_FIXTURE = 'angkor-wat.overpass.json';
export const PETIT_FIXTURE = 'angkor-petit-circuit.overpass.json.gz';
export const ELEVATION_FIXTURE = 'open-meteo-sample-stage.json';

// The two sample files of test/fixtures, as the core exports them from the
// small Angkor fixture. make-fixtures.mjs writes them, fixtures.test.mjs checks
// that they are still what the core gives.
export const SAMPLES = {
  loop: {
    file: 'sample-loop.cambotrack.json',
    waypoints: [[13.41384, 103.856094], [13.415043, 103.855957], [13.416375, 103.851813],
      [13.416303, 103.847743], [13.414833, 103.847378], [13.414028, 103.85076]],
    settings: {
      id: 'sample-loop', name: 'Boucle d’essai (Angkor, ouest)', author: 'circuit-editor tests',
      created: '2026-11-26T14:00:00Z', games: ['3d_buggy', 'cambodia_rally'], kind: 'loop', laps: 3,
      scale: 1.25, vertical_scale: 1.25, road_width: 11, spacing: 4, smooth_m: 15,
      narrow_tracks: true, bridge_widths: true, checkpoint_every_m: 0, gates_auto: true, relief: false,
    },
  },
  stage: {
    file: 'sample-stage.cambotrack.json',
    waypoints: [[13.414289, 103.856127], [13.408867, 103.855949], [13.406734, 103.85748],
      [13.406649, 103.873543], [13.411125, 103.873634], [13.413847, 103.880258]],
    settings: {
      id: 'sample-stage', name: 'Spéciale d’essai (douves d’Angkor Vat)', author: 'circuit-editor tests',
      created: '2026-11-26T14:00:00Z', games: ['cambodia_rally'], kind: 'stage',
      scale: 2.5, vertical_scale: 2.5, road_width: 11, spacing: 4, smooth_m: 15,
      narrow_tracks: true, bridge_widths: true, checkpoint_every_m: 0, gates_auto: true, relief: true,
    },
  },
};

// Elevations recorded from Open-Meteo, as a Map "lattice key" -> metres.
export function elevationStore() {
  const C = loadCore();
  const rec = readJsonFixture(ELEVATION_FIXTURE);
  const q = C.RULES.elevationLattice;
  const store = new Map();
  for (const call of rec.calls) {
    call.latitude.forEach((lat, i) => {
      store.set(`${Math.round(lat / q)}_${Math.round(call.longitude[i] / q)}`, call.response.elevation[i]);
    });
  }
  return store;
}

// Builds one of the samples. Returns { result, text, route, plan }.
export function buildSample(which, store = null) {
  const C = loadCore();
  const sample = SAMPLES[which];
  const g = graphOf(SMALL_FIXTURE);
  const allowed = C.DEFAULT_ALLOWED;
  const { wps, route } = routeThrough(g, sample.waypoints, sample.settings.kind, allowed);
  if (!route.ok) throw new Error(`sample ${which}: no route`);
  const settings = { ...sample.settings, allowed_classes: allowed, waypoints: wps.map((w) => [w.lat, w.lon]) };
  let ele = null, plan = null;
  if (settings.relief) {
    const clean = C.cleanLine({ lat: route.line.lat, lon: route.line.lon, seg: route.line.seg, closed: settings.kind === 'loop' }, C.RULES.spikeMax);
    plan = C.elevationPlan(clean);
    if (store) ele = C.elevationSamples(plan, store);
  }
  const result = C.buildTrack(g, route.line, settings, ele);
  return { result, text: result.ok ? C.serializeTrack(result.track) : null, route, plan, wps };
}

/* ------------------------------------------------------------------ photos */

// The TIFF structure of an Exif block (what follows "Exif\0\0"), written here
// away from the core's reader. little: byte order. lat, lon: both null for a
// block without a GPS directory. noMinSec: minutes and seconds written 0/0, as
// some cameras do when they only know the degrees (then lat and lon must be
// whole numbers).
export function exifTiff({ little = true, lat = null, lon = null, ele = null, taken = null, bearing = null, noMinSec = false } = {}) {
  const u16 = (v) => (little ? [v & 255, (v >> 8) & 255] : [(v >> 8) & 255, v & 255]);
  const u32 = (v) => (little ? [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]
    : [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]);
  const rational = (v, den) => [...u32(Math.round(v * den)), ...u32(den)];
  const dms = (v) => {
    const a = Math.abs(v), d = Math.floor(a + 1e-12), m = Math.floor((a - d) * 60 + 1e-9), s = (a - d - m / 60) * 3600;
    return noMinSec ? [...rational(d, 1), ...u32(0), ...u32(0), ...u32(0), ...u32(0)] : [...rational(d, 1), ...rational(m, 1), ...rational(Math.max(s, 0), 100000)];
  };
  const hasGps = lat !== null && lon !== null;
  // Directories as [tag, type, count, inline value or null, data bytes or null].
  const exif = taken ? [[0x9003, 2, 20, null, [...Buffer.from(taken + '\0', 'latin1')]]] : [];
  const gps = [];
  if (hasGps) {
    gps.push([1, 2, 2, [lat < 0 ? 0x53 : 0x4E, 0, 0, 0], null], [2, 5, 3, null, dms(lat)],
      [3, 2, 2, [lon < 0 ? 0x57 : 0x45, 0, 0, 0], null], [4, 5, 3, null, dms(lon)]);
    if (ele !== null) gps.push([5, 1, 1, [ele < 0 ? 1 : 0, 0, 0, 0], null], [6, 5, 1, null, rational(Math.abs(ele), 100)]);
    if (bearing !== null) gps.push([0x11, 5, 1, null, rational(bearing, 100)]);
  }
  const size = (dir) => (dir.length ? 2 + 12 * dir.length + 4 : 0);
  const ifd0 = [[0x0112, 3, 1, [...u16(1), 0, 0], null]];
  const at0 = 8, atExif = at0 + 2 + 12 * (1 + (exif.length ? 1 : 0) + (gps.length ? 1 : 0)) + 4;
  const atGps = atExif + size(exif);
  if (exif.length) ifd0.push([0x8769, 4, 1, u32(atExif), null]);
  if (gps.length) ifd0.push([0x8825, 4, 1, u32(atGps), null]);
  let dataAt = atGps + size(gps);
  const data = [];
  const write = (dir) => {
    if (!dir.length) return [];
    const out = [...u16(dir.length)];
    for (const [tag, type, count, inline, blob] of dir) {
      out.push(...u16(tag), ...u16(type), ...u32(count));
      if (inline) out.push(...inline);
      else { out.push(...u32(dataAt)); data.push(...blob); dataAt += blob.length; }
    }
    out.push(...u32(0));
    return out;
  };
  const head = [...(little ? [0x49, 0x49] : [0x4D, 0x4D]), ...u16(42), ...u32(8)];
  return Uint8Array.from([...head, ...write(ifd0), ...write(exif), ...write(gps), ...data]);
}

// A JPEG with that Exif block put right after its first two bytes (or after
// its first segment when afterFirst is set, as cameras that write JFIF do).
export function photoJpeg(base, tiff, afterFirst = false) {
  const app1 = [0xFF, 0xE1, ((tiff.length + 8) >> 8) & 255, (tiff.length + 8) & 255, 0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const cut = afterFirst ? 4 + ((base[4] << 8) | base[5]) : 2;
  return Uint8Array.from([...base.subarray(0, cut), ...app1, ...base.subarray(cut)]);
}

export function photoBase() {
  return new Uint8Array(fs.readFileSync(new URL('photo-base.jpg', FIXTURES)));
}

// The photo files of the fixtures folder (make-fixtures.mjs writes them, the
// browser test imports them). Positions are on the loop of the browser test:
// 20 m to the left of the middle of its first and of its last leg, then far
// away to the south.
export const PHOTO_FIXTURES = {
  'photo-near.jpg': { little: true, lat: 13.416314, lon: 103.853748, ele: 23.4, taken: '2026:11:25 17:26:46', bearing: 214.5 },
  'photo-near-2.jpg': { little: false, lat: 13.413798, lon: 103.853645, taken: '2026:11:25 17:41:02' },
  'photo-far.jpg': { little: true, lat: 13.403, lon: 103.8537, taken: '2026:11:25 18:05:10' },
  'photo-no-gps.jpg': { little: true, taken: '2026:11:25 18:10:00' },
};
export function photoFixture(name) {
  return photoJpeg(photoBase(), exifTiff(PHOTO_FIXTURES[name]), name === 'photo-near-2.jpg');
}

/* --------------------------------------------------------------- zip archives */

// A zip archive written here, away from the core's reader: files as [name,
// Buffer]. zip64: every size and offset of the directory moved to ZIP64 extra
// fields, and a ZIP64 end record, as an archive over 4 GiB has them.
export function zipBytes(files, { zip64 = false, deflate = false, comment = '' } = {}) {
  const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
  const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
  const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
  const parts = [], dir = [];
  let at = 0;
  for (const [name, data] of files) {
    const nameBytes = Buffer.from(name, 'utf8'), body = deflate ? zlib.deflateRawSync(data) : data;
    const crc = zlib.crc32(data);
    const local = Buffer.concat([u32(0x04034B50), u16(45), u16(0x0800), u16(deflate ? 8 : 0), u16(0), u16(0), u32(crc),
      u32(body.length), u32(data.length), u16(nameBytes.length), u16(0), nameBytes]);
    const extra = zip64 ? Buffer.concat([u16(1), u16(24), u64(data.length), u64(body.length), u64(at)]) : Buffer.alloc(0);
    dir.push(Buffer.concat([u32(0x02014B50), u16(45), u16(45), u16(0x0800), u16(deflate ? 8 : 0), u16(0), u16(0), u32(crc),
      u32(zip64 ? 0xFFFFFFFF : body.length), u32(zip64 ? 0xFFFFFFFF : data.length), u16(nameBytes.length), u16(extra.length), u16(0),
      u16(0), u16(0), u32(0), u32(zip64 ? 0xFFFFFFFF : at), nameBytes, extra]));
    parts.push(local, body);
    at += local.length + body.length;
  }
  const directory = Buffer.concat(dir), commentBytes = Buffer.from(comment, 'utf8');
  const tail = [];
  if (zip64) {
    const record = at + directory.length;
    tail.push(Buffer.concat([u32(0x06064B50), u64(44), u16(45), u16(45), u32(0), u32(0), u64(files.length), u64(files.length),
      u64(directory.length), u64(at)]));
    tail.push(Buffer.concat([u32(0x07064B50), u32(0), u64(record), u32(1)]));
  }
  tail.push(Buffer.concat([u32(0x06054B50), u16(0), u16(0), u16(zip64 ? 0xFFFF : files.length), u16(zip64 ? 0xFFFF : files.length),
    u32(zip64 ? 0xFFFFFFFF : directory.length), u32(zip64 ? 0xFFFFFFFF : at), u16(commentBytes.length), commentBytes]));
  return new Uint8Array(Buffer.concat([...parts, directory, ...tail]));
}

/* ------------------------------------------------- vector tiles and PMTiles */

// A Mapbox Vector Tile written here, away from the core's reader:
// { layer: [{ type (1 point, 2 line, 3 polygon), props, parts: [[[x, y]…]…] }] }.
// Polygon parts are given open (the writer closes them with ClosePath).
export function mvtBytes(layers, extent = 4096) {
  const out = [];
  const varint = (arr, v) => { while (v >= 128) { arr.push((v % 128) | 128); v = Math.floor(v / 128); } arr.push(v); };
  const field = (arr, f, wt) => varint(arr, f * 8 + wt);
  const bytesField = (arr, f, bytes) => { field(arr, f, 2); varint(arr, bytes.length); arr.push(...bytes); };
  const zz = (v) => (v < 0 ? -2 * v - 1 : 2 * v);
  for (const [name, feats] of Object.entries(layers)) {
    const L = [], keys = [], values = [], vkey = [];
    field(L, 15, 0); varint(L, 2);
    bytesField(L, 1, [...Buffer.from(name)]);
    for (const f of feats) {
      const tags = [];
      for (const [k, v] of Object.entries(f.props || {})) {
        let ki = keys.indexOf(k); if (ki < 0) { keys.push(k); ki = keys.length - 1; }
        const sig = typeof v + ':' + v;
        let vi = vkey.indexOf(sig); if (vi < 0) { vkey.push(sig); values.push(v); vi = values.length - 1; }
        tags.push(ki, vi);
      }
      const geom = [];
      let cx = 0, cy = 0;
      for (const part of f.parts) {
        geom.push((1 & 7) | (1 << 3)); geom.push(zz(part[0][0] - cx), zz(part[0][1] - cy)); cx = part[0][0]; cy = part[0][1];
        if (part.length > 1) {
          geom.push((2 & 7) | ((part.length - 1) << 3));
          for (const p of part.slice(1)) { geom.push(zz(p[0] - cx), zz(p[1] - cy)); cx = p[0]; cy = p[1]; }
        }
        if (f.type === 3) geom.push(7 | (1 << 3));
      }
      const F = [];
      field(F, 3, 0); varint(F, f.type);
      const tb = []; tags.forEach((t) => varint(tb, t)); bytesField(F, 2, tb);
      const gb = []; geom.forEach((g) => varint(gb, g)); bytesField(F, 4, gb);
      bytesField(L, 2, F);
    }
    for (const k of keys) bytesField(L, 3, [...Buffer.from(k)]);
    for (const v of values) {
      const V = [];
      if (typeof v === 'string') bytesField(V, 1, [...Buffer.from(v)]);
      else if (typeof v === 'boolean') { field(V, 7, 0); varint(V, v ? 1 : 0); }
      else if (Number.isInteger(v) && v >= 0) { field(V, 5, 0); varint(V, v); }
      else { field(V, 3, 1); const b = Buffer.alloc(8); b.writeDoubleLE(v); V.push(...b); }
      bytesField(L, 4, V);
    }
    field(L, 5, 0); varint(L, extent);
    bytesField(out, 3, L);
  }
  return Uint8Array.from(out);
}

// The PMTiles id of a tile, written here after the specification's own code.
export function pmtilesId(z, x, y) {
  let acc = 0;
  for (let t = 0; t < z; t++) acc += 4 ** t;
  const n = 2 ** z;
  let d = 0;
  for (let s = n / 2; s >= 1; s /= 2) {
    const rx = (x & s) > 0 ? 1 : 0, ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) { if (rx === 1) { x = s - 1 - x; y = s - 1 - y; } [x, y] = [y, x]; }
  }
  return acc + d;
}

// A PMTiles v3 archive of gzipped vector tiles: tiles as [{ z, x, y, bytes }].
// leaf: put the entries in a leaf directory, the root pointing at it.
export function pmtilesBytes(tiles, { leaf = false } = {}) {
  const varint = (arr, v) => { while (v >= 128) { arr.push((v % 128) | 128); v = Math.floor(v / 128); } arr.push(v); };
  const dirBytes = (entries) => {
    const a = [];
    varint(a, entries.length);
    let last = 0;
    for (const e of entries) { varint(a, e.tileId - last); last = e.tileId; }
    for (const e of entries) varint(a, e.runLength);
    for (const e of entries) varint(a, e.length);
    entries.forEach((e, i) => varint(a, i > 0 && e.offset === entries[i - 1].offset + entries[i - 1].length ? 0 : e.offset + 1));
    return zlib.gzipSync(Uint8Array.from(a));
  };
  const sorted = tiles.map((t) => ({ ...t, tileId: pmtilesId(t.z, t.x, t.y), data: zlib.gzipSync(t.bytes) })).sort((a, b) => a.tileId - b.tileId);
  let off = 0;
  const entries = sorted.map((t) => { const e = { tileId: t.tileId, offset: off, length: t.data.length, runLength: 1 }; off += t.data.length; return e; });
  const leafDir = leaf ? dirBytes(entries) : Buffer.alloc(0);
  const root = leaf ? dirBytes([{ tileId: entries[0].tileId, offset: 0, length: leafDir.length, runLength: 0 }]) : dirBytes(entries);
  const data = Buffer.concat(sorted.map((t) => t.data));
  const h = Buffer.alloc(127);
  Buffer.from('PMTiles').copy(h, 0); h[7] = 3;
  const rootOff = 127, metaOff = rootOff + root.length, leafOff = metaOff, dataOff = leafOff + leafDir.length;
  h.writeBigUInt64LE(BigInt(rootOff), 8); h.writeBigUInt64LE(BigInt(root.length), 16);
  h.writeBigUInt64LE(BigInt(metaOff), 24); h.writeBigUInt64LE(0n, 32);
  h.writeBigUInt64LE(BigInt(leafOff), 40); h.writeBigUInt64LE(BigInt(leafDir.length), 48);
  h.writeBigUInt64LE(BigInt(dataOff), 56); h.writeBigUInt64LE(BigInt(data.length), 64);
  h[96] = 1; h[97] = 2; h[98] = 2; h[99] = 1; h[100] = 0; h[101] = 14;
  return new Uint8Array(Buffer.concat([h, root, leafDir, data]));
}
