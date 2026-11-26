#!/usr/bin/env node
// Measures how long a file pushed to the site takes to show at the two addresses
// the games can read: raw.githubusercontent.com and the GitHub Pages site.
// No dependency: Node 18 or later.
//
//   node tools/circuit-editor/measure-publish-delay.mjs <path> <what to expect> [options]
//
//   <path>                    path in the repository, for example tracks/index.json
//
//   What the new version looks like (one of):
//   --expect-substring=TEXT   its content holds TEXT (a circuit's hash, an "updated" date…)
//   --expect-sha256=HEX       its content has this SHA-256
//   --expect-etag=ETAG        the answer carries this ETag
//
//   --since=ISO               time of the push (for example 2026-11-27T08:15:00Z): delays are
//                             counted from it instead of from the start of the script
//   --interval=SECONDS        pause between two rounds (default 10)
//   --timeout=SECONDS         give up after that long (default 1800)
//   --owner=NAME --repo=NAME --branch=NAME
//                             default: the repository the editor publishes to
//   --once                    no polling: show how each host caches the file today, and
//                             whether a "?cb=…" query string gets round its cache
//
// Each round asks four URLs: both hosts, each with and without a cache-busting
// query string. A line is printed the first time each one shows the new content.
// Start the script BEFORE pushing: its own requests keep the caches warm, which
// is the situation of a phone that looked at the catalogue a moment earlier.
//
// Exit code: 0 when the four URLs showed the new content, 1 on timeout.

import crypto from 'node:crypto';

const DEFAULTS = { owner: 'stefan-cambodia', repo: 'stefan-cambodia.github.io', branch: 'main', interval: '10', timeout: '1800' };
const USER_AGENT = 'circuit-editor-measure/1.0';
const SHOWN = ['cache-control', 'age', 'x-cache', 'x-cache-hits', 'etag', 'last-modified', 'x-served-by', 'x-github-request-id'];

function parseArgs(argv) {
  const opts = { ...DEFAULTS }, rest = [];
  for (const arg of argv) {
    const m = /^--([a-z0-9-]+)(?:=(.*))?$/.exec(arg);
    if (m) opts[m[1]] = m[2] === undefined ? true : m[2];
    else rest.push(arg);
  }
  opts.path = rest[0];
  return opts;
}

function usage(message) {
  if (message) console.error(message + '\n');
  console.error('usage: node measure-publish-delay.mjs <path> (--expect-substring=TEXT | --expect-sha256=HEX | --expect-etag=ETAG)\n' +
    '       [--since=ISO] [--interval=10] [--timeout=1800] [--owner=…] [--repo=…] [--branch=…]\n' +
    '       node measure-publish-delay.mjs <path> --once');
  process.exit(2);
}

// The two addresses of a file of the repository.
function addresses(o) {
  const path = String(o.path).replace(/^\/+/, '');
  const raw = `https://raw.githubusercontent.com/${o.owner}/${o.repo}/${o.branch}/${path}`;
  // A user site (<owner>.github.io) is served at its own name, a project site under it.
  const pages = /\.github\.io$/i.test(o.repo) ? `https://${o.repo}/${path}` : `https://${o.owner}.github.io/${o.repo}/${path}`;
  return { raw, pages };
}

async function get(url) {
  const started = Date.now();
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' });
    const body = Buffer.from(await res.arrayBuffer());
    const headers = {};
    for (const name of SHOWN) if (res.headers.has(name)) headers[name] = res.headers.get(name);
    return { ok: res.ok, status: res.status, headers, body, ms: Date.now() - started };
  } catch (err) {
    return { ok: false, status: 0, headers: {}, body: Buffer.alloc(0), ms: Date.now() - started, error: String(err.cause?.code ?? err.message) };
  }
}

const bare = (etag) => String(etag ?? '').replace(/^W\//, '').replace(/"/g, '');

function isNew(r, o) {
  if (!r.ok) return false;
  if (o['expect-substring'] !== undefined) return r.body.includes(String(o['expect-substring']));
  if (o['expect-sha256'] !== undefined) return crypto.createHash('sha256').update(r.body).digest('hex') === String(o['expect-sha256']).toLowerCase();
  return bare(r.headers.etag) === bare(o['expect-etag']);
}

function describe(r) {
  if (r.error) return `no answer (${r.error})`;
  const h = r.headers;
  return [`HTTP ${r.status}`, `${r.body.length} bytes`, h['cache-control'], h.age !== undefined ? `age ${h.age}` : null,
    h['x-cache'] ? `x-cache ${h['x-cache']}` : null, h.etag ? `etag ${h.etag}` : null,
    h['x-github-request-id'] ? `origin request ${h['x-github-request-id']}` : null].filter(Boolean).join(', ');
}

const stamp = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let counter = 0;
const busted = (url) => `${url}?cb=${Date.now().toString(36)}${(counter++).toString(36)}`;

// --once: is the query string part of the cache key? Ask a never-seen "?cb="
// URL first, then the plain one, then another "?cb=". If the second and third
// answers are cache hits of the first (same origin request, growing age), the
// query string is ignored and cannot be used to get round the cache.
async function once(o) {
  const { raw, pages } = addresses(o);
  for (const [name, url] of [['raw.githubusercontent.com', raw], ['GitHub Pages', pages]]) {
    console.log(`\n${name}: ${url}`);
    const steps = [['with ?cb=', busted(url)], ['plain    ', url], ['with ?cb=', busted(url)]];
    const seen = [];
    for (const [label, u] of steps) {
      const r = await get(u);
      seen.push(r);
      console.log(`  ${label}  ${describe(r)}`);
      await sleep(1200);
    }
    const ids = seen.map((r) => r.headers['x-github-request-id']).filter(Boolean);
    const hits = seen.slice(1).every((r) => /HIT/i.test(r.headers['x-cache'] ?? ''));
    if (ids.length === 3 && new Set(ids).size === 1 && hits) {
      console.log('  -> the three answers come from one origin request: the query string is NOT part of the cache key here.');
    } else if (ids.length === 3 && new Set(ids).size === 3) {
      console.log('  -> each URL went to the origin: the query string IS part of the cache key here.');
    } else {
      console.log('  -> mixed answers (several cache nodes, or the entry expired in between): run it again.');
    }
  }
}

async function poll(o) {
  const { raw, pages } = addresses(o);
  const interval = Math.max(1, Number(o.interval)) * 1000, timeout = Math.max(1, Number(o.timeout)) * 1000;
  const zero = o.since ? Date.parse(o.since) : Date.now();
  if (Number.isNaN(zero)) usage(`--since=${o.since} is not a date`);
  const targets = [
    { name: 'raw, plain', url: () => raw },
    { name: 'raw, ?cb=', url: () => busted(raw) },
    { name: 'pages, plain', url: () => pages },
    { name: 'pages, ?cb=', url: () => busted(pages) },
  ];
  console.log(`${stamp()}  watching ${raw}\n${' '.repeat(22)}and ${pages}`);
  console.log(`${' '.repeat(22)}delays counted from ${o.since ? o.since : 'now (the start of this script)'}; one round every ${interval / 1000} s`);
  const started = Date.now();
  let round = 0;
  while (Date.now() - started < timeout) {
    round++;
    for (const t of targets) {
      if (t.done) continue;
      const r = await get(t.url());
      const state = r.error ? `error ${r.error}` : `${r.status}`;
      if (isNew(r, o)) {
        t.done = (Date.now() - zero) / 1000;
        console.log(`${stamp()}  ${t.name.padEnd(13)} NEW after ${t.done.toFixed(0)} s  (${describe(r)})`);
      } else if (round === 1 || state !== t.state) {
        console.log(`${stamp()}  ${t.name.padEnd(13)} old content  (${describe(r)})`);
      }
      t.state = state;
    }
    if (targets.every((t) => t.done)) break;
    await sleep(interval);
  }
  console.log('\nSeconds until the new content showed:');
  for (const t of targets) console.log(`  ${t.name.padEnd(13)} ${t.done ? t.done.toFixed(0) + ' s' : 'not seen (timeout)'}`);
  return targets.every((t) => t.done) ? 0 : 1;
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.path || opts.help) usage();
if (opts.once) {
  await once(opts);
  process.exit(0);
}
if (opts['expect-substring'] === undefined && opts['expect-sha256'] === undefined && opts['expect-etag'] === undefined) {
  usage('Say what the new version looks like: --expect-substring, --expect-sha256 or --expect-etag.');
}
process.exit(await poll(opts));
