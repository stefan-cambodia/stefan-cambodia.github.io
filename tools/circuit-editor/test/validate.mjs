// Checks .cambotrack.json files against the schema and the rules of FORMAT.md.
//
//   node tools/circuit-editor/test/validate.mjs tracks/mon-circuit.cambotrack.json [more files…]
//
// Exit code 0 when every file is valid. Used by the end-to-end test on the file
// the browser downloads, and handy before publishing a file by hand.

import fs from 'node:fs';
import { readSchema, validateSchema, formatRuleErrors, loadCore } from './helpers.mjs';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node validate.mjs <file.cambotrack.json> [more files…]');
  process.exit(2);
}
const schema = readSchema();
const C = loadCore();
let bad = 0;
for (const file of files) {
  const problems = [];
  let track = null;
  const text = fs.readFileSync(file, 'utf8');
  if (Buffer.byteLength(text) > 4194304) problems.push('the file is over 4 MiB');
  try { track = JSON.parse(text); } catch (err) { problems.push(`not JSON: ${err.message}`); }
  if (track) {
    problems.push(...validateSchema(schema, track));
    if (!problems.length) {
      problems.push(...formatRuleErrors(track).errors);
      // The editor's own checker must agree with the one of the tests.
      const check = C.checkTrack(track);
      if (check.ok !== (problems.length === 0)) problems.push(`the core's checkTrack disagrees: ${JSON.stringify(check.errors)}`);
    }
  }
  if (problems.length) {
    bad++;
    console.log(`✖ ${file}`);
    for (const p of problems.slice(0, 20)) console.log(`    ${p}`);
  } else {
    const n = track.points.length, len = formatRuleErrors(track).length;
    console.log(`✔ ${file}: ${track.kind}, ${n} points, ${len.toFixed(1)} game m, hash ${track.hash}`);
  }
}
process.exit(bad ? 1 : 0);
