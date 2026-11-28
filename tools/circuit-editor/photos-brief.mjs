// The photos of a circuit file, laid out for whoever dresses the circuit: one
// small JPEG per photo and a sheet, brief.md, place by place along the course.
//
//   node tools/circuit-editor/photos-brief.mjs <circuit.cambotrack.json> [out_dir]
//
// out_dir defaults to <file without .cambotrack.json>.photos/ beside the file.
// Images are written as they are in the file (320 px on their longest side for
// files from the editor of 27 November 2026 evening on, 512 px before): nothing
// is re-encoded. No network.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const VIEW = { front: 'devant', left: 'à gauche', right: 'à droite', extra: 'en plus', back: 'derrière' };
const SLUG = { front: 'devant', left: 'gauche', right: 'droite', extra: 'plus' };

function loadCore() {
  const html = fs.readFileSync(new URL('index.html', import.meta.url), 'utf8');
  const m = /<script id="core">([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error('index.html has no <script id="core"> block');
  const context = vm.createContext({});
  vm.runInContext(m[1], context, { filename: 'index.html#core' });
  return context.CircuitCore;
}

const num = (v, digits = 0) => v.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace(/ /g, ' ');
const metres = (v) => (v >= 1000 ? num(v / 1000, 2) + ' km' : num(Math.round(v)) + ' m');

export function brief(text, outDir, C = loadCore()) {
  const read = C.parseTrack(text);
  if (!read.ok) throw new Error('not a circuit file: ' + read.error);
  const t = read.track, scale = t.scale, n = t.points.length, closed = t.kind === 'loop';
  const rows = Array.isArray(t.photos) ? t.photos.filter((p) => C.cleanPhoto(p, true) && Number.isInteger(p.point) && p.point >= 0 && p.point < n) : [];
  // Places and views: as written by the editor, else worked out the editor's way.
  const auto = C.photoViews(rows);
  const places = new Map();
  rows.forEach((p, k) => {
    const spot = Number.isInteger(p.spot) && p.spot >= 1 ? p.spot : auto[k].spot + 1;
    const view = C.PHOTO_VIEWS.includes(p.view) ? p.view : auto[k].view;
    if (!places.has(spot)) places.set(spot, []);
    places.get(spot).push({ p, view });
  });
  fs.mkdirSync(outDir, { recursive: true });
  const lines = [];
  lines.push(`# Photos du circuit « ${t.name} »`, '');
  lines.push(`\`${t.id}\` · ${closed ? `boucle de ${metres(t.length_game_m)} de jeu, ${t.laps} tours` : `spéciale de ${metres(t.length_game_m)} de jeu`}` +
    ` · ${metres(t.length_real_m)} de vraies routes (échelle ${num(scale, 2)}) · départ ${t.origin.lat}, ${t.origin.lon}`, '');
  if (!rows.length) {
    lines.push('Aucune photo dans ce fichier.');
  } else {
    lines.push(`${rows.length} photo${rows.length > 1 ? 's' : ''}, ${places.size} lieu${places.size > 1 ? 'x' : ''}. Pour chaque lieu : devant = la route qui vient,` +
      ' à gauche et à droite pour qui roule dans le sens du circuit ; « en plus » décrit davantage l\'endroit. Distances depuis le départ en mètres de jeu' +
      ' (réels entre parenthèses).', '');
  }
  const order = (v) => C.PHOTO_VIEWS.indexOf(v);
  [...places.keys()].sort((a, b) => a - b).forEach((spot) => {
    const list = places.get(spot).sort((a, b) => order(a.view) - order(b.view));
    const first = list.reduce((m, x) => (x.p.at_m < m.p.at_m ? x : m), list[0]).p;
    lines.push(`## Lieu ${spot} · à ${metres(first.at_m)} du départ (${metres(first.at_m * scale)})`, '');
    lines.push(`${first.lat}, ${first.lon}` + (first.ele !== undefined ? ` · ${num(first.ele)} m d'altitude` : '') + ` · point ${first.point} du parcours`, '');
    const counts = {};
    list.forEach(({ p, view }) => {
      counts[view] = (counts[view] || 0) + 1;
      const file = `lieu-${String(spot).padStart(2, '0')}-${SLUG[view]}${view === 'extra' || counts[view] > 1 ? '-' + counts[view] : ''}.jpg`;
      fs.writeFileSync(path.join(outDir, file), Buffer.from(p.image.slice(p.image.indexOf(',') + 1), 'base64'));
      const bits = [`**${VIEW[view]}**`, `prise ${num(Math.round(p.offset_m * scale))} m à ${p.side === 'left' ? 'gauche' : 'droite'} de la route`];
      if (typeof p.bearing === 'number') {
        const a = t.points[(p.point - 1 + n) % n], b = t.points[(p.point + 1) % n];
        const ends = !closed && (p.point === 0 || p.point === n - 1);
        const from = ends && p.point === 0 ? t.points[0] : a, to = ends && p.point === n - 1 ? t.points[n - 1] : b;
        const look = Math.round(C.lookAngle(p.bearing, Math.atan2(to[0] - from[0], from[2] - to[2]) * 180 / Math.PI));
        const seen = C.viewOfLook(look);
        bits.push(`boussole : ${look > 0 ? '+' : ''}${look}° par rapport à la route (${VIEW[seen]})` + (seen !== view && view !== 'extra' ? ', pas comme son rôle' : ''));
      }
      if (p.taken) bits.push(p.taken.replace('T', ' '));
      bits.push(`${p.w} × ${p.h}`, `« ${p.name} »`);
      lines.push(`- \`${file}\` : ${bits.join(' · ')}`);
    });
    lines.push('');
  });
  const md = lines.join('\n');
  fs.writeFileSync(path.join(outDir, 'brief.md'), md);
  return { md, photos: rows.length, places: places.size };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [file, out] = process.argv.slice(2);
  if (!file) {
    console.error('usage: node photos-brief.mjs <circuit.cambotrack.json> [out_dir]');
    process.exit(2);
  }
  const dir = out || file.replace(/(\.cambotrack)?\.json$/i, '') + '.photos';
  const r = brief(fs.readFileSync(file, 'utf8'), dir);
  console.log(r.md);
  console.log(`\n${r.photos} photo(s), ${r.places} lieu(x) -> ${dir}`);
}
