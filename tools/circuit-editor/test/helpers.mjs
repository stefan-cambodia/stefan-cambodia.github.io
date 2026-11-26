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
    `gates=${(t.gates ?? []).join(',')}`,
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
