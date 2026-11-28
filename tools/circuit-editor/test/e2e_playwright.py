#!/usr/bin/env python3
"""End-to-end test of the circuit editor in a real browser, network mocked.

    python3 tools/circuit-editor/test/e2e_playwright.py [--browser webkit|chrome|chromium]
                                                         [--screenshots DIR] [--headed]

Needs the Python "playwright" module and one browser it can launch. WebKit is
tried first, then the Chrome installed on the machine, then Playwright's own
Chromium; the script says which one ran and why the others did not.

What is real: the page, served from this checkout by a local web server, and
Leaflet, loaded from cdnjs with its SRI hash (so the hash is checked by a
browser). What is mocked: map tiles, Overpass (the recorded Angkor answer),
Open-Meteo, Nominatim and the GitHub API. Any other request fails the test.

It loads the roads, places four waypoints, checks undo and redo, downloads the
file and validates it (hash recomputed here in Python, schema and rules by
test/validate.mjs when Node is there), sends it to the mocked GitHub API with a
conflict on the catalogue, reopens the file (with the roads kept on the computer,
then without), leaves a drawing and takes it up again on a new visit, then
keeps two circuits in « Mes circuits » and goes from one to the other, imports
photos that carry a GPS position (accepted near the course, refused elsewhere), and
checks what the page says when Open-Meteo has given
its 600 altitudes of the minute and when every Overpass server is down. The editor is meant for a desktop browser: the
test runs at 1280 x 800.
"""

import argparse
import base64
import functools
import hashlib
import http.server
import json
import math
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import urllib.parse

from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]                      # the site's checkout
PAGE = "/tools/circuit-editor/index.html"
FIXTURE = HERE / "fixtures" / "angkor-wat.overpass.json"
# Four points of the sample loop (see helpers.mjs), on roads of the fixture.
WAYPOINTS = [(13.41384, 103.856094), (13.416375, 103.851813), (13.416303, 103.847743), (13.414028, 103.85076)]
# Where photo-near.jpg and photo-near-2.jpg were "taken" (helpers.mjs, PHOTO_FIXTURES).
PHOTO_FIXTURE_PLACES = [(13.416314, 103.853748), (13.413798, 103.853645)]
FAKE_TOKEN = "e2e-token-not-a-real-one"
PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")
CORS = {"access-control-allow-origin": "*", "access-control-expose-headers": "retry-after"}

checks = []


def check(ok, what):
    checks.append((bool(ok), what))
    print(("  ok   " if ok else "  FAIL ") + what)
    return ok


def q2(v):
    return math.floor(v * 100 + 0.5)


def canonical_text(t):
    """The canonical form of FORMAT.md, a third time (the core and helpers.mjs hold the others)."""
    lines = [
        "cambotrack/1", "kind=%s" % t["kind"], "laps=%d" % t.get("laps", 1),
        "scale=%d" % math.floor(t["scale"] * 1000 + 0.5),
        "vertical_scale=%d" % math.floor(t["vertical_scale"] * 1000 + 0.5),
        "road_width=%d" % q2(t["road_width"]), "spacing=%d" % q2(t["spacing"]),
        "surfaces=" + ",".join(t["surfaces"]), "points=%d" % len(t["points"]),
        ";".join("%d,%d,%d,%d,%d,%d" % (q2(p[0]), q2(p[1]), q2(p[2]), q2(p[3]), p[4], p[5]) for p in t["points"]),
        "checkpoints=" + ",".join(str(i) for i in t["checkpoints"]),
        "gates=" + ",".join(str(i) for i in t.get("gates", [])),
    ]
    return "".join(line + "\n" for line in lines)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve():
    handler = functools.partial(Quiet, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


class Network:
    """Answers every request the page makes outside this machine."""

    def __init__(self):
        self.overpass_body = FIXTURE.read_bytes()
        self.overpass_calls = []          # (host, query)
        self.overpass_down = set()        # hosts that answer 504
        self.elevation_calls = []         # coordinates per request
        self.elevation_429 = 0            # how many times to answer 429 first
        self.elevation_retry_after = "1"  # seconds, as the minute's allowance gives them
        self.nominatim_calls = []
        self.github_files = {}            # path -> (sha, bytes)
        self.github_log = []              # (method, path, authorization, body)
        self.github_conflict_once = True  # the catalogue changes under the first write
        self.unexpected = []
        self.libheif_calls = 0
        self.overture = {name: (HERE / "fixtures" / ("overture-%s.pmtiles" % name)).read_bytes() for name in ("buildings", "base")}
        self.overture_calls = []          # (archive, first byte, length)
        self.overture_down = False

    def handle(self, route, request):
        url = urllib.parse.urlparse(request.url)
        host = url.hostname or ""
        if host in ("127.0.0.1", "localhost"):
            return route.continue_()
        if host == "cdnjs.cloudflare.com" and "/ajax/libs/leaflet/1.9.4/" in url.path:
            return route.continue_()      # the real file: the browser checks its SRI hash
        if host == "cdn.jsdelivr.net" and url.path == "/npm/libheif-js@1.23.5/libheif-wasm/libheif-bundle.js":
            self.libheif_calls += 1
            return route.continue_()      # the real HEIC decoder, SRI checked too
        if host.endswith("tile.openstreetmap.org") or host.endswith("arcgisonline.com") or host.endswith("opentopomap.org"):
            return route.fulfill(status=200, content_type="image/png", body=PNG_1X1, headers=CORS)
        if host == "tiles.overturemaps.org":
            return self.overture_tiles(route, request, url)
        if url.path.endswith("/api/interpreter"):
            return self.overpass(route, request, host)
        if host == "api.open-meteo.com":
            return self.elevation(route, url)
        if host == "nominatim.openstreetmap.org":
            self.nominatim_calls.append(url.query)
            body = [{"display_name": "Angkor Vat, Siem Reap, Cambodge", "lat": "13.4125", "lon": "103.8666",
                     "boundingbox": ["13.4084", "13.4166", "103.8614", "103.8717"]},
                    {"display_name": "Angkor Thom, Siem Reap, Cambodge", "lat": "13.4412", "lon": "103.8590",
                     "boundingbox": ["13.4270", "13.4550", "103.8440", "103.8740"]}]
            return route.fulfill(status=200, content_type="application/json", body=json.dumps(body), headers=CORS)
        if host == "api.github.com":
            return self.github(route, request, url)
        self.unexpected.append(request.url)
        return route.abort()

    def overture_tiles(self, route, request, url):
        m = re.match(r"^/[0-9.-]+/(buildings|base)\.pmtiles$", url.path)
        rng = re.match(r"bytes=(\d+)-(\d+)$", request.headers.get("range", ""))
        if self.overture_down:
            return route.fulfill(status=503, body="down", headers=CORS)
        if not m or not rng:
            self.unexpected.append(request.url)
            return route.fulfill(status=400, body="bad", headers=CORS)
        data, a, b = self.overture[m.group(1)], int(rng.group(1)), int(rng.group(2))
        self.overture_calls.append((m.group(1), a, b - a + 1))
        headers = dict(CORS, **{"content-range": "bytes %d-%d/%d" % (a, min(b, len(data) - 1), len(data)),
                                "access-control-expose-headers": "content-range"})
        return route.fulfill(status=206, content_type="application/octet-stream", body=data[a:b + 1], headers=headers)

    def overpass(self, route, request, host):
        query = urllib.parse.parse_qs(request.post_data or "").get("data", [""])[0]
        self.overpass_calls.append((host, query))
        if host in self.overpass_down:
            return route.fulfill(status=504, content_type="text/html", body="<h1>504 Gateway Time-out</h1>", headers=CORS)
        return route.fulfill(status=200, content_type="application/json", body=self.overpass_body, headers=CORS)

    def elevation(self, route, url):
        q = urllib.parse.parse_qs(url.query)
        lats = [float(v) for v in q["latitude"][0].split(",")]
        lons = [float(v) for v in q["longitude"][0].split(",")]
        self.elevation_calls.append(len(lats))
        if self.elevation_429 > 0:
            self.elevation_429 -= 1
            headers = dict(CORS)
            headers["retry-after"] = self.elevation_retry_after
            return route.fulfill(status=429, content_type="application/json",
                                 body='{"error":true,"reason":"Too many requests"}', headers=headers)
        # A gentle hill, in whole metres like the real answers.
        ele = [float(round(24 + 9 * math.sin(la * 1500) + 7 * math.cos(lo * 1100))) for la, lo in zip(lats, lons)]
        return route.fulfill(status=200, content_type="application/json", body=json.dumps({"elevation": ele}), headers=CORS)

    def github(self, route, request, url):
        headers = dict(CORS)
        headers["access-control-allow-headers"] = "authorization, content-type, x-github-api-version, accept"
        headers["access-control-allow-methods"] = "GET, PUT, OPTIONS"
        if request.method == "OPTIONS":
            return route.fulfill(status=204, headers=headers)
        path = urllib.parse.unquote(url.path).split("/contents/", 1)[-1]
        self.github_log.append((request.method, url.path, url.query, request.headers.get("authorization"), request.post_data))

        def reply(status, body):
            return route.fulfill(status=status, content_type="application/json", body=json.dumps(body), headers=headers)

        if request.headers.get("authorization") != "Bearer " + FAKE_TOKEN:
            return reply(401, {"message": "Bad credentials"})
        if request.method == "GET":
            if path not in self.github_files:
                return reply(404, {"message": "Not Found"})
            sha, data = self.github_files[path]
            return reply(200, {"type": "file", "path": path, "sha": sha, "size": len(data), "encoding": "base64",
                               "content": base64.encodebytes(data).decode()})
        if request.method == "PUT":
            body = json.loads(request.post_data)
            data = base64.b64decode(body["content"])
            existing = self.github_files.get(path)
            if path.endswith("index.json") and self.github_conflict_once:
                # Someone else publishes at the same moment: the file is not what the page read.
                self.github_conflict_once = False
                other = b'{"format": "cambotrack-catalog", "version": 1, "updated": "2026-11-26T13:00:00Z", "tracks": [\n' \
                        b'  {"id": "someone-else", "name": "Autre", "file": "someone-else.cambotrack.json", "hash": "' + b"a" * 64 + \
                        b'", "kind": "stage", "laps": 1, "length_game_m": 2000, "climb_m": 0, "games": ["3d_buggy"], ' \
                        b'"author": "", "updated": "2026-11-26T13:00:00Z"}\n]}\n'
                self.github_files[path] = (hashlib.sha1(other).hexdigest(), other)
                return reply(409, {"message": "%s does not match" % path})
            if existing and body.get("sha") != existing[0]:
                return reply(409 if body.get("sha") else 422, {"message": "sha mismatch"})
            if not existing and body.get("sha"):
                return reply(422, {"message": "sha given for a new file"})
            if body.get("branch") != "main":
                return reply(422, {"message": "wrong branch"})
            sha = hashlib.sha1(data).hexdigest()
            self.github_files[path] = (sha, data)
            return reply(200 if existing else 201, {"content": {"path": path, "sha": sha},
                                                    "commit": {"sha": "c0ffee", "html_url": "https://github.com/example/commit/c0ffee"}})
        return reply(405, {"message": "method"})


def launch(p, wanted):
    """Returns (browser, name). Tries the browsers in order and reports the failures."""
    order = [wanted] if wanted else ["webkit", "chrome", "chromium"]
    for name in order:
        try:
            if name == "webkit":
                return p.webkit.launch(), name
            if name == "chrome":
                return p.chromium.launch(channel="chrome"), name
            return p.chromium.launch(), name
        except Exception as err:            # noqa: BLE001 - whatever stops a launch, try the next
            lines = [line.strip("║ \\").strip() for line in str(err).strip().splitlines()]
            reason = " ".join(line for line in lines[:14] if line.strip("╔╗╚╝═ ") and "Playwright Team" not in line)
            print("  note: %s cannot run here: %s" % (name, reason[:400]))
    raise SystemExit("No browser could be launched: the end-to-end test did not run.")


def click_latlon(page, lat, lon):
    x, y = page.evaluate(
        """([lat, lon]) => {
            const p = window.circuitEditor.map.latLngToContainerPoint([lat, lon]);
            const r = document.getElementById('map').getBoundingClientRect();
            return [r.left + p.x, r.top + p.y];
        }""", [lat, lon])
    page.mouse.click(x, y)


def new_page(context, errors, base, width, height, keep_offer=False):
    """A page of its own. The drawing an earlier page left is declined, unless keep_offer."""
    page = context.new_page()
    page.set_viewport_size({"width": width, "height": height})
    page.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    page.goto(base + PAGE)
    page.wait_for_function("window.circuitEditor && window.circuitEditor.map")
    if not keep_offer and page.locator("#draft").is_visible():
        page.click("#draft-ignore")
    return page


def forget_roads(page):
    """The roads kept by earlier pages are forgotten, with the page's own button (Tracé tab)."""
    page.click("#tabbtn-trace")
    page.wait_for_selector("#roads-kept:not([hidden])")
    page.click("#roads-forget")
    page.wait_for_selector("#roads-kept", state="hidden")


def forget_elevations(page):
    """The altitudes kept by earlier pages are forgotten (no button: straight in the database)."""
    page.evaluate("""() => new Promise((done) => { const q = indexedDB.open('circuit-editor');
        q.onsuccess = () => { const tx = q.result.transaction(['elevations'], 'readwrite');
            tx.objectStore('elevations').clear(); tx.oncomplete = () => { q.result.close(); done(); }; }; })""")


def shot(page, folder, name):
    if folder:
        pathlib.Path(folder).mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(pathlib.Path(folder) / name))


def desktop_run(context, net, errors, base, shots, tmp):
    print("Desktop, 1280 x 800")
    page = new_page(context, errors, base, 1280, 800)
    check(page.evaluate("typeof L === 'object' && L.version") == "1.9.4", "Leaflet 1.9.4 loaded from cdnjs (the SRI hash matched)")
    check(page.locator("html").get_attribute("lang") == "fr", "the page is in French")
    check(page.locator("#download").is_disabled() and page.locator("#send").is_disabled(), "nothing to export before a course exists")

    # A click before any road is loaded (beside the first steps' card): a hint, no waypoint.
    check(page.locator("#welcome").is_visible(), "the first steps are on the map of an empty page")
    page.mouse.click(60, 300)
    page.wait_for_selector("#toast:not([hidden])")
    check("Chargez d'abord les routes" in page.inner_text("#toast").replace(" ", " "), "hint when no road is loaded")

    # Too wide a view is refused.
    page.evaluate("window.circuitEditor.map.setView([13.41, 103.86], 9, { animate: false })")
    page.wait_for_function("document.getElementById('load-roads').textContent.includes('Zoomez')")
    page.click("#load-roads")
    page.wait_for_function("document.getElementById('toast').textContent.includes('Zone trop grande')")
    check(len(net.overpass_calls) == 0, "over 1 500 km²: refused, no request sent")

    # The search runs on Enter only.
    page.fill("#search-input", "Angkor")
    page.wait_for_timeout(400)
    check(len(net.nominatim_calls) == 0, "search: nothing is asked while typing")
    page.press("#search-input", "Enter")
    page.wait_for_selector("#search-results button")
    check(len(net.nominatim_calls) == 1 and "q=Angkor" in net.nominatim_calls[0], "search: one request on Enter")
    page.click("#search-results button >> nth=0")
    page.wait_for_function("window.circuitEditor.map.getZoom() >= 14")
    check(page.locator("#search-results").is_hidden(), "search: choosing a result moves the map and closes the list")

    # Frame the four waypoints, then load the roads: the first server is down, the mirror answers.
    page.evaluate(
        """(pts) => window.circuitEditor.map.fitBounds(pts, { padding: [170, 170], animate: false })""",
        [list(w) for w in WAYPOINTS])
    page.wait_for_function("document.getElementById('load-roads').textContent.includes('Charger')")
    net.overpass_down = {"overpass-api.de"}
    page.click("#load-roads")
    page.wait_for_function("window.circuitEditor.graph.ways.length > 0", timeout=20000)
    page.wait_for_function("document.getElementById('toast').textContent.includes('routes ajoutées')")
    hosts = [h for h, _ in net.overpass_calls]
    check(hosts[:2] == ["overpass-api.de", "maps.mail.ru"], "Overpass: a 504 on the main server, the mirror is asked next (%s)" % hosts)
    query = net.overpass_calls[-1][1]
    check(query.startswith("[out:json][timeout:60];way[highway](") and query.endswith(");out body qt;>;out skel qt;"),
          "Overpass query: way[highway] on the view, then its nodes")
    ways = page.evaluate("window.circuitEditor.graph.ways.length")
    check(ways == 229, "roads loaded without footways, steps or pedestrian ways (%d ways)" % ways)
    # Loading the same view again adds nothing, and starts with the server that worked.
    page.click("#load-roads")
    page.wait_for_function("document.getElementById('toast').textContent.includes('Aucune nouvelle route')")
    check(net.overpass_calls[-1][0] == "maps.mail.ru" and page.evaluate("window.circuitEditor.graph.ways.length") == ways,
          "a second load merges by OSM id and adds nothing")

    # Four waypoints.
    for lat, lon in WAYPOINTS:
        click_latlon(page, lat, lon)
    page.wait_for_function("window.circuitEditor.state.waypoints.length === 4")
    check(page.locator(".wp").count() == 4, "four waypoints placed by clicking on roads")
    state = page.evaluate("""() => { const c = window.circuitEditor.current;
        return { ok: c.route.ok, legs: c.route.legs.length, len: c.result && c.result.stats.length_game_m }; }""")
    check(state["ok"] and state["legs"] == 4 and state["len"] > 400, "the loop is routed: 4 legs, %.0f m of game" % (state["len"] or 0))
    check("Boucle" in page.inner_text("#summary"), "the panel head sums the course up: %s" % page.inner_text("#summary").replace(" ", " "))

    # A click away from any road: a hint, still four waypoints.
    click_latlon(page, 13.4188, 103.8492)
    page.wait_for_function("document.getElementById('toast').textContent.includes('Pas de route')")
    check(page.locator(".wp").count() == 4, "a click away from the roads adds nothing and says why")

    # Undo, redo, with the keyboard.
    page.keyboard.press("Control+z")
    page.wait_for_function("window.circuitEditor.state.waypoints.length === 3")
    page.keyboard.press("Control+y")
    page.wait_for_function("window.circuitEditor.state.waypoints.length === 4")
    check(True, "Ctrl+Z and Ctrl+Y undo and redo")

    # Tool « Modifier »: a click on the course inserts a waypoint; right click deletes it.
    mid = page.evaluate("""() => { const l = window.circuitEditor.current.route.legs[1], k = Math.floor(l.lat.length / 2);
        return [l.lat[k], l.lon[k]]; }""")
    page.click("#tool-edit")
    click_latlon(page, mid[0], mid[1])
    page.wait_for_function("window.circuitEditor.state.waypoints.length === 5")
    check(page.evaluate("window.circuitEditor.state.waypoints[2].lat") - mid[0] < 1e-4, "« Modifier »: a click on the course inserts a waypoint in that leg")
    page.locator(".wp").nth(2).click(button="right")
    page.wait_for_function("window.circuitEditor.state.waypoints.length === 4")
    check(True, "a right click on a waypoint deletes it")
    page.click("#tool-add")

    # Dragging a waypoint snaps it again.
    before = page.evaluate("window.circuitEditor.state.waypoints[1]")
    box = page.locator(".wp").nth(1).bounding_box()
    page.mouse.move(box["x"] + 15, box["y"] + 15)
    page.mouse.down()
    page.mouse.move(box["x"] + 45, box["y"] + 22, steps=6)
    page.mouse.up()
    page.wait_for_function("(lat) => window.circuitEditor.state.waypoints[1].lat !== lat", arg=before["lat"])
    after = page.evaluate("window.circuitEditor.state.waypoints[1]")
    check(after["edge"] >= 0 and page.evaluate("window.circuitEditor.current.route.ok"), "a dragged waypoint snaps to a road and the course is recomputed")
    page.keyboard.press("Control+z")
    page.wait_for_function("(lat) => window.circuitEditor.state.waypoints[1].lat === lat", arg=before["lat"])

    # Reverse keeps the start of a loop.
    first = page.evaluate("window.circuitEditor.state.waypoints.map(w => w.lat)")
    page.click("#reverse")
    rev = page.evaluate("window.circuitEditor.state.waypoints.map(w => w.lat)")
    check(rev == [first[0]] + first[:0:-1], "« Inverser » turns the loop the other way round from the same start")
    page.click("#reverse")

    # Relief: fetched in the background, at most 100 coordinates a request, with a 429 on the way.
    net.elevation_429 = 1
    page.click("#tabbtn-relief")
    page.wait_for_function("document.getElementById('relief-status').textContent.includes('Relief chargé')", timeout=30000)
    check(net.elevation_calls and max(net.elevation_calls) <= 100, "Open-Meteo: %s coordinates per request, 100 at most" % net.elevation_calls)
    check("m" in page.inner_text("#rl-climb"), "relief: positive climb shown (%s)" % page.inner_text("#rl-climb").replace(" ", " "))
    check("surface" in page.inner_text("#tab-relief"), "relief: the page says it is a surface model")
    # The profile points at the map: the spot under the pointer, and a click takes the map there.
    box = page.locator("#profile").bounding_box()
    page.mouse.move(box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.5)
    page.wait_for_function("window.circuitEditor.probe.index >= 0")
    spot = page.evaluate("""() => { const e = window.circuitEditor, i = e.probe.index, pr = e.current.result.profile, ll = e.probe.ll[i];
        let near = Infinity; const line = e.current.route.line;
        for (let k = 0; k < line.lat.length; k++) near = Math.min(near, window.CircuitCore.distance(ll[0], ll[1], line.lat[k], line.lon[k]));
        return { share: pr.dist[i] / pr.dist[pr.dist.length - 1], near: near, shown: !!document.querySelector('.leaflet-probe-pane path[fill="#e8590c"]'), ll: ll }; }""")
    check(abs(spot["share"] - 0.5) < 0.02 and spot["near"] < 40 and spot["shown"],
          "hovering the middle of the profile shows that spot on the map: %.0f %% of the course, %.0f m from the routed line" % (100 * spot["share"], spot["near"]))
    page.mouse.click(box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.5)
    page.wait_for_function("(ll) => { const c = window.circuitEditor.map.getCenter(); return Math.abs(c.lat - ll[0]) < 1e-4 && Math.abs(c.lng - ll[1]) < 1e-4; }", arg=spot["ll"])
    check(True, "a click on the profile brings the map to that spot")
    page.mouse.move(box["x"] - 30, box["y"] - 30)
    page.wait_for_function("window.circuitEditor.probe.index === -1")
    check(True, "the spot goes when the pointer leaves the profile")
    # « Lissage du relief »: the course is computed again, and the choice travels in the file.
    climb = page.evaluate("window.circuitEditor.current.result.track.elevation.climb_m")
    page.select_option("#f-rsmooth", "300")
    page.wait_for_function("window.circuitEditor.current.settings.relief_smooth_m === 300 && window.circuitEditor.current.result.ok")
    strong = page.evaluate("(() => { const t = window.circuitEditor.current.result.track; return [t.elevation.climb_m, t.editor.relief_smooth_m]; })()")
    check(strong[1] == 300 and strong[0] <= climb, "« Lissage du relief » on « Fort »: %s m of climb instead of %s, kept in the file" % (strong[0], climb))
    shot(page, shots, "desktop-relief.png")

    objects_run(page, shots)

    # Settings, then download.
    page.click("#tabbtn-settings")
    page.fill("#f-name", "Essai de bout en bout")
    check(page.input_value("#f-id") == "essai-de-bout-en-bout", "the identifier follows the name")
    page.fill("#f-author", "e2e")
    page.click("#tabbtn-send")
    with page.expect_download() as info:
        page.click("#download")
    download = info.value
    target = pathlib.Path(tmp) / download.suggested_filename
    download.save_as(str(target))
    check(download.suggested_filename == "essai-de-bout-en-bout.cambotrack.json", "download: %s" % download.suggested_filename)
    text = target.read_text(encoding="utf-8")
    track = json.loads(text)
    check(track["format"] == "cambotrack" and track["version"] == 1 and track["kind"] == "loop" and track["laps"] == 3,
          "the file is a cambotrack loop, version 1, 3 laps")
    check(track["points"][0][:3] == [0, 0, 0] and len(track["points"]) >= 8, "%d points, the first at the origin" % len(track["points"]))
    check(hashlib.sha256(canonical_text(track).encode("utf-8")).hexdigest() == track["hash"], "its hash is the SHA-256 of the canonical form (recomputed in Python)")
    check(track["elevation"] and track["elevation"]["source"] == "copernicus-glo90/open-meteo" and any(p[1] != 0 for p in track["points"]),
          "it carries the relief")
    check(len(track["waypoints"]) == 4 and track["scale"] == 2.5 and track["road_width"] == 11, "waypoints and default settings are in the file")
    check(FAKE_TOKEN not in text and "token" not in text.lower(), "no token in the file")
    ob = track.get("objects") or {}
    check(ob.get("v") == 1 and [it[0] for it in ob.get("items", [])] == ["pagoda", "pagoda"] and "2 objets posés" in page.inner_text("#export-status").replace("\u00a0", " "),
          "the two objects placed are in the file (outside the hash, which still matches): %s" % ob.get("items"))
    sc = track.get("scenery") or {}
    status = page.inner_text("#export-status").replace("\u00a0", " ").replace("\u202f", " ")
    kinds = sorted(set(b[6] for b in sc.get("buildings", [])))
    check(sc.get("v") == 1 and len(sc.get("buildings", [])) > 20 and kinds == [0, 1, 2, 4] and [w["kind"] for w in sc.get("water", [])] == ["pond"]
          and "Décor : " in status and "bâtiments" in status and "cultures" in status,
          "the file carries the place's scenery read from Overture Maps (simulated): %d buildings, kinds %s, water %s; « %s »"
          % (len(sc.get("buildings", [])), kinds, [w["kind"] for w in sc.get("water", [])], status[status.find("Décor"):]))
    cells = page.evaluate("(cv) => window.CircuitCore.coverCells(cv).join('')", sc.get("cover"))
    check("c" in cells and "f" in cells and "a" in cells, "its cover grid holds crops, forest and the pond")
    check(len(net.overture_calls) >= 4 and page.locator(".leaflet-roads-pane path, .leaflet-pane canvas").count() > 0,
          "the archives were read by ranges (%d requests) and the scenery is drawn on the map" % len(net.overture_calls))
    shot(page, shots, "desktop-scenery.png")
    # Without the scenery: unticked, the file has none, and says so for « Ouvrir ».
    page.click("#tabbtn-settings")
    page.uncheck("#f-scenery")
    plain_track = page.evaluate("window.circuitEditor.prepareExport().then(o => [('scenery' in o.track), o.track.editor.scenery])")
    check(plain_track == [False, False], "« Décor du lieu réel » unticked: no scenery in the file, editor.scenery = false")
    page.check("#f-scenery")
    # Overture down: the file is written without its scenery, and the page says why.
    net.overture_down = True
    page.evaluate("window.circuitEditor.forgetScenery()")
    down = page.evaluate("window.circuitEditor.prepareExport().then(o => 'scenery' in o.track)")
    said = page.inner_text("#export-status")
    check(down is False and "Décor laissé de côté" in said, "Overture Maps down: the file without scenery, and why (« %s »)" % said)
    net.overture_down = False
    # The browser logs the 503 it was given on purpose.
    errors[:] = [e for e in errors if "status of 503" not in e]
    page.click("#tabbtn-send")
    node = shutil.which("node")
    if node:
        res = subprocess.run([node, str(HERE / "validate.mjs"), str(target)], capture_output=True, text=True)
        check(res.returncode == 0, "schema and format rules (test/validate.mjs): %s" % (res.stdout.strip() or res.stderr.strip()))
    else:
        print("  note: node not found, schema validation of the download skipped")
    in_page = page.evaluate("(text) => { const c = window.CircuitCore.parseTrack(text); return c.ok && c.check.ok; }", text)
    check(in_page, "the core reads the file back and finds nothing wrong")

    # Copy.
    try:
        context.grant_permissions(["clipboard-read", "clipboard-write"])
    except Exception:                        # noqa: BLE001 - WebKit has no such permission
        pass
    page.click("#copy")
    page.wait_for_function("/copié|refusé la copie/.test(document.getElementById('export-status').textContent)")
    status = page.inner_text("#export-status").replace(" ", " ")
    check("copié" in status or "refusé la copie" in status, "« Copier »: %s" % status)

    # Send: the token stays out of storage unless asked, the catalogue conflict is retried once.
    check(page.locator("#send").is_disabled(), "« Envoyer au jeu » is off without a token")
    page.fill("#f-token", FAKE_TOKEN)
    check(page.evaluate("Object.keys(localStorage).every(k => !localStorage.getItem(k).includes('%s'))" % FAKE_TOKEN),
          "the token is not stored when « mémoriser » is not ticked")
    page.click("#send")
    page.wait_for_selector("#send-status .done", timeout=30000)
    sent = page.inner_text("#send-status").replace(" ", " ")
    check("Circuits perso → Actualiser" in sent, "after sending: what to do in the game")
    check("raw.githubusercontent.com/stefan-cambodia/stefan-cambodia.github.io/main/tracks/essai-de-bout-en-bout.cambotrack.json" in sent,
          "after sending: the URLs of the circuit and the catalogue")
    methods = [(m, p.split("/contents/")[-1]) for m, p, _, _, _ in net.github_log]
    check(methods == [("GET", "tracks/essai-de-bout-en-bout.cambotrack.json"), ("PUT", "tracks/essai-de-bout-en-bout.cambotrack.json"),
                      ("GET", "tracks/index.json"), ("PUT", "tracks/index.json"),
                      ("GET", "tracks/index.json"), ("PUT", "tracks/index.json")],
          "GitHub: circuit, then catalogue; on the 409 the sha is read again and the write retried once")
    check(all(p.startswith("/repos/stefan-cambodia/stefan-cambodia.github.io/contents/") for _, p, _, _, _ in net.github_log),
          "GitHub: only the contents of the one repository are touched")
    check(all(q == "ref=main" for m, _, q, _, _ in net.github_log if m == "GET") and
          all(json.loads(b)["branch"] == "main" for m, _, _, _, b in net.github_log if m == "PUT"), "GitHub: branch main")
    catalog = json.loads(net.github_files["tracks/index.json"][1])
    ids = [e["id"] for e in catalog["tracks"]]
    check(ids == ["someone-else", "essai-de-bout-en-bout"], "the catalogue keeps the entry written meanwhile and gains ours: %s" % ids)
    entry = catalog["tracks"][-1]
    published = json.loads(net.github_files["tracks/essai-de-bout-en-bout.cambotrack.json"][1])
    check(entry["hash"] == published["hash"] and entry["file"] == "essai-de-bout-en-bout.cambotrack.json" and len(entry["bbox"]) == 4,
          "the catalogue entry names the file and carries its hash and its box")
    check(hashlib.sha256(canonical_text(published).encode("utf-8")).hexdigest() == published["hash"], "the published file has a correct hash")
    check(all("token" not in (b or "").lower() and FAKE_TOKEN not in (b or "") for _, _, _, _, b in net.github_log),
          "the token travels in the Authorization header only")
    # Sending again updates the same file, with its sha.
    net.github_log.clear()
    page.click("#send")
    page.wait_for_function("document.querySelector('#send-status .done') && !document.getElementById('send').disabled", timeout=30000)
    puts = [json.loads(b) for m, _, _, _, b in net.github_log if m == "PUT"]
    check(len(puts) == 2 and all("sha" in b for b in puts), "sending again replaces the file and the entry (sha given)")
    check(len(json.loads(net.github_files["tracks/index.json"][1])["tracks"]) == 2, "no double entry in the catalogue")
    # A bad token: a message in French that says what to do.
    page.fill("#f-token", "wrong")
    page.click("#send")
    page.wait_for_function("document.getElementById('send-status').classList.contains('bad')", timeout=30000)
    check("401" in page.inner_text("#send-status") and "jeton" in page.inner_text("#send-status"), "a refused token is explained")
    page.fill("#f-token", FAKE_TOKEN)
    page.check("#f-remember")
    check(page.evaluate("localStorage.getItem('circuit-editor.github-token')") == FAKE_TOKEN, "« mémoriser »: the token is kept in localStorage")
    page.uncheck("#f-remember")
    check(page.evaluate("localStorage.getItem('circuit-editor.github-token')") is None, "unticking forgets it at once")
    shot(page, shots, "desktop-sent.png")

    # Stage mode, tracks off.
    page.click("#tabbtn-trace")
    page.click("#kind-stage")
    check(page.evaluate("window.circuitEditor.current.route.legs.length") == 3 and page.locator(".wp.finish").count() == 1,
          "« Spéciale »: one leg fewer, the last waypoint is the finish")
    page.uncheck("#allow-tracks")
    page.wait_for_timeout(100)
    check(page.evaluate("window.circuitEditor.current.settings.allowed_classes.includes('track')") is False,
          "« Autoriser les pistes » off: tracks leave the allowed classes")
    messages = page.inner_text("#messages").replace(" ", " ")
    lost = page.locator(".wp.lost").count()
    check(lost > 0 or "Tronçon" in messages or page.evaluate("window.circuitEditor.current.route.ok"),
          "the course reacts to the change of classes (lost waypoints: %d)" % lost)
    shot(page, shots, "desktop-stage-no-tracks.png")
    page.check("#allow-tracks")
    page.click("#kind-loop")
    page.wait_for_function("window.circuitEditor.current.route.ok")

    # Clear, undo.
    page.click("#clear")
    check(page.locator(".wp").count() == 0, "« Tout effacer » empties the drawing")
    page.keyboard.press("Control+z")
    page.wait_for_function("window.circuitEditor.state.waypoints.length === 4")
    shot(page, shots, "desktop-course.png")
    page.close()
    return target


def mark_point(page, i):
    """Where the mark of object i is on the screen."""
    return page.evaluate("""(i) => { const o = window.circuitEditor.state.objects[i];
        const p = window.circuitEditor.map.latLngToContainerPoint([o.lat, o.lon]), r = document.getElementById('map').getBoundingClientRect();
        return [r.left + p.x, r.top + p.y]; }""", i)


def objects_run(page, shots):
    """The Objets tab: the library, placing on the map, turning, moving, deleting, undo."""
    page.click("#tabbtn-objects")
    lib_n = page.evaluate("window.CIRCUIT_OBJECTS.objects.length")
    tiles = page.locator("#obj-lib .otile").count()
    check(lib_n > 250 and tiles == lib_n, "the library of the game's objects: %d tiles with their thumbnails" % tiles)
    first = page.evaluate("Array.from(document.querySelectorAll('#obj-lib .otile')).slice(0, 3).map(b => b.dataset.kind)")
    check(first[0].startswith("house_stilt"), "Cambodia first: the list opens on the Khmer houses (%s)" % ", ".join(first))
    page.fill("#obj-search", "pagode")
    names = page.inner_text("#obj-lib")
    check(page.locator("#obj-lib .otile").count() >= 1 and "Pagode" in names, "search « pagode » finds the pagoda")
    page.fill("#obj-search", "ELEPHANT")
    check(page.locator("#obj-lib .otile").count() >= 5, "the search ignores case and accents (« ELEPHANT » finds the éléphants)")
    page.fill("#obj-search", "")
    page.select_option("#obj-group", "khmer_houses")
    n_h = page.locator("#obj-lib .otile").count()
    check(n_h == page.evaluate("window.CIRCUIT_OBJECTS.objects.filter(e => e.g === 'khmer_houses').length") and n_h >= 5,
          "a family shows its own objects (%d Khmer houses)" % n_h)
    page.select_option("#obj-group", "")
    page.fill("#obj-search", "pagode")
    page.click("#obj-lib .otile[data-kind=pagoda]")
    check("Cliquez sur la carte" in page.inner_text("#obj-armed"), "a chosen object waits for a click on the map")
    # 45 m north of a point of the course.
    spot = page.evaluate("""() => { const l = window.circuitEditor.current.route.line, k = Math.floor(l.lat.length / 3);
        return [l.lat[k] + 0.0004, l.lon[k]]; }""")
    click_latlon(page, spot[0], spot[1])
    page.wait_for_function("window.circuitEditor.state.objects.length === 1")
    o = page.evaluate("window.circuitEditor.state.objects[0]")
    check(o["kind"] == "pagoda" and abs(o["lat"] - spot[0]) < 2e-5 and abs(o["lon"] - spot[1]) < 2e-5 and page.evaluate("window.circuitEditor.state.waypoints.length") == 4,
          "a click places it where clicked, and adds no waypoint")
    check(page.evaluate("""(() => { const e = window.circuitEditor, o = e.state.objects[0], l = e.current.route.line;
        let best = 1e9, bi = 0; for (let i = 0; i < l.lat.length; i++) { const d = (l.lat[i] - o.lat) ** 2 + ((l.lon[i] - o.lon) * Math.cos(o.lat * Math.PI / 180)) ** 2; if (d < best) { best = d; bi = i; } }
        const want = Math.atan2((l.lon[bi] - o.lon) * Math.cos(o.lat * Math.PI / 180), l.lat[bi] - o.lat) * 180 / Math.PI;
        return Math.abs(((o.heading - want) % 360 + 540) % 360 - 180) < 1; })()"""), "a new object faces the nearest point of the course (heading %s°)" % o["heading"])
    check(page.locator(".omark").count() == 1 and page.locator(".leaflet-objshapes-pane path:not(.oghost)").count() == 2,
          "on the map: its mark with its thumbnail, its outline at its size and its front arrow")
    check(page.locator("#obj-sel").is_visible() and "Pagode" in page.inner_text("#obj-sel") and "× 1" in page.inner_text("#obj-placed"),
          "the panel shows the object placed and the list of objects")
    click_latlon(page, spot[0] + 0.0005, spot[1] + 0.0006)
    page.wait_for_function("window.circuitEditor.state.objects.length === 2")
    page.keyboard.press("Escape")
    check(page.inner_text("#obj-armed").strip() == "" and not page.evaluate("window.circuitEditor.objUi.armed"), "Échap stops placing")
    h0 = page.evaluate("window.circuitEditor.state.objects[1].heading")
    page.keyboard.press("r")
    h1 = page.evaluate("window.circuitEditor.state.objects[1].heading")
    page.keyboard.press("Shift+R")
    page.keyboard.press("Shift+R")
    h2 = page.evaluate("window.circuitEditor.state.objects[1].heading")
    check(round((h1 - h0) % 360, 1) == 15 and round((h0 - h2) % 360, 1) == 15, "R turns the chosen object by 15°, Maj+R the other way")
    page.click("#obj-turn")
    check(round((page.evaluate("window.circuitEditor.state.objects[1].heading") - h2) % 360, 1) == 90, "« Tourner de 90° »")
    page.fill("#obj-size", "1.5")
    page.dispatch_event("#obj-size", "change")
    check(page.evaluate("window.circuitEditor.state.objects[1].size") == 1.5, "the size slider: × 1,5")
    page.keyboard.press("Control+z")
    check(page.evaluate("window.circuitEditor.state.objects[1].size") == 1, "Ctrl+Z undoes the size in one step")
    # A drag moves the first one.
    before = page.evaluate("window.circuitEditor.state.objects[0]")
    x, y = mark_point(page, 0)
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + 20, y + 10, steps=4)
    page.mouse.move(x + 40, y + 20, steps=4)
    page.mouse.up()
    page.wait_for_function("window.circuitEditor.state.objects[0].lon > %r" % (before["lon"] + 1e-6))
    moved = page.evaluate("window.circuitEditor.state.objects[0]")
    check(moved["lat"] < before["lat"] and moved["lon"] > before["lon"] and page.evaluate("window.circuitEditor.state.waypoints.length") == 4,
          "dragging a mark moves its object (and nothing else)")
    page.keyboard.press("Control+z")
    check(page.evaluate("window.circuitEditor.state.objects[0].lat") == before["lat"], "Ctrl+Z puts it back")
    # Delete with the key, back with Ctrl+Z; a right click deletes too.
    page.evaluate("window.circuitEditor.objUi.selected")
    x, y = mark_point(page, 1)
    page.mouse.click(x, y)
    page.keyboard.press("Delete")
    check(page.evaluate("window.circuitEditor.state.objects.length") == 1, "Suppr deletes the chosen object")
    page.keyboard.press("Control+z")
    x, y = mark_point(page, 1)
    page.mouse.click(x, y, button="right")
    check(page.evaluate("window.circuitEditor.state.objects.length") == 1, "a right click on a mark deletes its object")
    page.keyboard.press("Control+z")
    check(page.evaluate("window.circuitEditor.state.objects.length") == 2 and page.locator(".omark").count() == 2, "and Ctrl+Z brings it back")
    rows_run(page, shots)
    shot(page, shots, "desktop-objects.png")


def hover_latlon(page, lat, lon):
    x, y = page.evaluate("""([lat, lon]) => { const p = window.circuitEditor.map.latLngToContainerPoint([lat, lon]),
        r = document.getElementById('map').getBoundingClientRect(); return [r.left + p.x, r.top + p.y]; }""", [lat, lon])
    page.mouse.move(x, y)


def rows_run(page, shots):
    """The ghost under the pointer, R while placing, a row, a row along the course; all undone after."""
    ghost = "document.querySelectorAll('.leaflet-objshapes-pane path.oghost[stroke-dasharray]').length"
    page.fill("#obj-search", "palmier")
    page.click("#obj-lib .otile[data-kind=palm_a]")
    l = page.evaluate("""() => { const l = window.circuitEditor.current.route.line, k = Math.floor(l.lat.length / 2), j = Math.floor(l.lat.length * 0.6);
        return [l.lat[k], l.lon[k], l.lat[j], l.lon[j]]; }""")
    hover_latlon(page, l[0] + 0.0003, l[1])
    page.wait_for_function("%s >= 1" % ghost)
    check(page.evaluate(ghost) >= 1, "with an object chosen, its outline follows the pointer before the click")
    page.keyboard.press("r")
    check(page.evaluate("window.circuitEditor.objUi.manual") is True, "R while placing turns what is about to be placed")
    page.keyboard.press("Escape")
    n0 = page.evaluate("window.circuitEditor.state.objects.length")
    # A straight row of 50 m every 10 m: 6 palms, one Ctrl+Z.
    page.click("#obj-lib .otile[data-kind=palm_a]")
    page.click(".objmode .seg-btn[data-mode=row]")
    page.fill("#obj-gap", "10")
    a = [l[0] + 0.0003, l[1]]
    b = [l[0] + 0.0003, l[1] + 50 / (111320 * 0.9728)]
    click_latlon(page, *a)
    check("finit" in page.inner_text("#obj-armed"), "« En ligne »: a first click, then it asks where the row ends")
    hover_latlon(page, *b)
    page.wait_for_function("%s >= 6" % ghost)
    click_latlon(page, *b)
    page.wait_for_function("window.circuitEditor.state.objects.length === %d" % (n0 + 6))
    check(True, "a row of 50 m with a gap of 10 m: 6 objects placed at once")
    page.keyboard.press("Control+z")
    check(page.evaluate("window.circuitEditor.state.objects.length") == n0, "one Ctrl+Z takes the whole row away")
    # Along the course, 20 m off, between two points of it.
    page.click(".objmode .seg-btn[data-mode=course]")
    page.fill("#obj-gap", "15")
    click_latlon(page, l[0] + 0.00018, l[1])
    click_latlon(page, l[2] + 0.00018, l[3])
    page.wait_for_function("window.circuitEditor.state.objects.length > %d" % (n0 + 2))
    res = page.evaluate("""(n0) => { const e = window.circuitEditor, l = e.current.route.line, objs = e.state.objects.slice(n0);
        const m = 111320, c = Math.cos(objs[0].lat * Math.PI / 180), out = { n: objs.length, dist: [], facing: 0 };
        objs.forEach((o) => {
          let best = 1e18, qx = 0, qy = 0;
          for (let i = 0; i < l.lat.length; i++) {
            const j = (i + 1) % l.lat.length, ax = (l.lon[i] - o.lon) * m * c, ay = (l.lat[i] - o.lat) * m, bx = (l.lon[j] - o.lon) * m * c, by = (l.lat[j] - o.lat) * m;
            const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1))), px = ax + dx * t, py = ay + dy * t, d = px * px + py * py;
            if (d < best) { best = d; qx = px; qy = py; }
          }
          out.dist.push(Math.sqrt(best));
          const want = Math.atan2(qx, qy) * 180 / Math.PI;
          const off = Math.abs(((o.heading - want) % 360 + 540) % 360 - 180);
          if (off < 10) out.facing++;
          out.worst = Math.max(out.worst || 0, off); });
        return out; }""", n0)
    d = sorted(res["dist"])
    mid = d[len(d) // 2]
    near = sum(1 for v in d if abs(v - mid) < 1.0)
    check(res["n"] >= 3 and near >= 0.8 * res["n"] and res["facing"] >= 0.8 * res["n"] and res["worst"] < 30,
          "« Le long du tracé »: %d objects, %d of them %.1f m from the course (± 1 m), %d facing it within 10° (in a bend: within %.0f°)"
          % (res["n"], near, mid, res["facing"], res["worst"]))
    shot(page, shots, "desktop-objects-row.png")
    page.keyboard.press("Control+z")
    page.fill("#obj-gap", "")
    page.click(".objmode .seg-btn[data-mode=one]")
    check(page.locator("#obj-gap").is_hidden(), "one by one: no spacing to give")
    page.keyboard.press("Escape")
    page.fill("#obj-search", "")
    check(page.evaluate("window.circuitEditor.state.objects.length") == n0, "undone, the two objects of before remain")


def reopen_run(context, net, errors, base, shots, target):
    print("Reopening the downloaded file in a fresh page")
    net.overpass_down = set()
    calls = len(net.overpass_calls)
    page = new_page(context, errors, base, 1280, 800)
    page.click("#tabbtn-send")
    page.set_input_files("#open-file", str(target))
    page.wait_for_function("document.getElementById('export-status').textContent.includes('recalculé')", timeout=30000)
    said = page.inner_text("#export-status").replace("\u00a0", " ")
    check(len(net.overpass_calls) == calls and "reprises de cet ordinateur" in said,
          "« Ouvrir » takes the roads kept on the computer: Overpass is not asked (« %s »)" % said[-90:])
    st = page.evaluate("""() => { const e = window.circuitEditor;
        return { n: e.state.waypoints.length, ok: e.current.route.ok, kind: e.state.kind, lost: e.state.waypoints.filter(w => w.edge < 0).length }; }""")
    check(st == {"n": 4, "ok": True, "kind": "loop", "lost": 0}, "the route is rebuilt from the file's waypoints: %s" % st)
    check(page.input_value("#f-name") == "Essai de bout en bout" and page.input_value("#f-id") == "essai-de-bout-en-bout",
          "name and identifier come back from the file")
    check(page.input_value("#f-rsmooth") == "300", "the relief smoothing comes back from the file")
    # Same roads, same settings: the same circuit, hash for hash.
    original = json.loads(pathlib.Path(target).read_text(encoding="utf-8"))
    again = page.evaluate("window.circuitEditor.prepareExport().then(o => o.track.hash)")
    check(again == original["hash"], "exported again, the reopened circuit has the same hash")
    objs = page.evaluate("window.circuitEditor.prepareExport().then(o => o.track.objects)")
    check(objs == original["objects"] and page.locator(".omark").count() == 2,
          "« Ouvrir » puts the objects back on the map, where they were: exported again, the same items")
    shot(page, shots, "desktop-reopened.png")
    page.close()

    # The roads forgotten, « Ouvrir » asks Overpass for the course's area, and they are kept again.
    page = new_page(context, errors, base, 1280, 800)
    forget_roads(page)
    page.click("#tabbtn-send")
    page.set_input_files("#open-file", str(target))
    page.wait_for_function("document.getElementById('export-status').textContent.includes('recalculé')", timeout=30000)
    check(len(net.overpass_calls) == calls + 1, "nothing kept: « Ouvrir » loads the roads of the course's area from Overpass")
    check(page.evaluate("window.circuitEditor.prepareExport().then(o => o.track.hash)") == original["hash"], "and the circuit has the same hash")
    page.click("#tabbtn-trace")
    page.wait_for_selector("#roads-kept:not([hidden])")
    check("1 zone" in page.inner_text("#roads-kept-text").replace("\u00a0", " "), "the roads just loaded are kept on the computer")
    page.close()


def stored_draft(page):
    text = page.evaluate("localStorage.getItem('circuit-editor.draft')")
    return json.loads(text) if text else None


def frame_and_load(page):
    page.evaluate("(pts) => window.circuitEditor.map.fitBounds(pts, { padding: [170, 170], animate: false })", [list(w) for w in WAYPOINTS])
    page.wait_for_function("document.getElementById('load-roads').textContent.includes('Charger')")
    page.click("#load-roads")
    page.wait_for_function("window.circuitEditor.graph.ways.length > 0", timeout=20000)


def draft_run(context, net, errors, base, shots):
    print("The drawing in progress, kept from one visit to the next")
    net.overpass_down = set()
    page = new_page(context, errors, base, 1280, 800)
    forget_roads(page)
    calls = len(net.overpass_calls)
    frame_and_load(page)
    check(len(net.overpass_calls) == calls + 1, "a view never loaded is asked for")
    page.wait_for_selector("#roads-kept:not([hidden])")
    page.close()
    # On a later visit the same view comes from the computer; a second click asks OpenStreetMap again.
    page = new_page(context, errors, base, 1280, 800)
    frame_and_load(page)
    said = page.inner_text("#toast").replace("\u00a0", " ")
    check(len(net.overpass_calls) == calls + 1 and "reprises de cet ordinateur" in said and "229 routes" in said,
          "the same view on a later visit: the roads kept, no request (« %s »)" % said)
    page.click("#load-roads")
    page.wait_for_function("document.getElementById('toast').textContent.includes('Aucune nouvelle route')")
    check(len(net.overpass_calls) == calls + 2, "a second click asks Overpass again")
    for lat, lon in WAYPOINTS:
        click_latlon(page, lat, lon)
    page.wait_for_function("window.circuitEditor.state.waypoints.length === 4")
    page.click("#tabbtn-settings")
    page.fill("#f-name", "Tracé gardé")
    page.fill("#f-laps", "2")
    page.dispatch_event("#f-laps", "change")
    page.click("#tabbtn-relief")
    page.select_option("#f-rsmooth", "600")
    page.wait_for_function("document.getElementById('relief-status').textContent.includes('Relief chargé')", timeout=30000)
    page.wait_for_function("(() => { const t = localStorage.getItem('circuit-editor.draft') || '';"
                           " return t.includes('Tracé gardé') && t.includes('\"ele\"') && t.includes('\"f-laps\":\"2\"'); })()")
    kept = stored_draft(page)
    samples = page.evaluate("new Set(window.circuitEditor.current.plan.key).size")
    check(len(kept["waypoints"]) == 4 and kept["kind"] == "loop" and len(kept["ele"]) == samples and len(kept["box"]) == 4
          and len(kept["areas"]) == 1,
          "the drawing is kept as it is made: 4 waypoints, the form, the course's box, its areas, %d elevations" % len(kept["ele"]))
    before = page.evaluate("window.circuitEditor.prepareExport().then(o => o.track.hash)")
    asked = []
    page.on("dialog", lambda d: (asked.append(d.type), d.accept()))
    page.close(run_before_unload=True)
    if not page.is_closed():
        page.wait_for_event("close", timeout=10000)
    check(not asked, "leaving the page asks nothing: the drawing is kept")

    # A new visit: the page offers the drawing and draws nothing by itself.
    roads, heights = len(net.overpass_calls), len(net.elevation_calls)
    page = new_page(context, errors, base, 1280, 800, keep_offer=True)
    said = page.inner_text("#draft-text").replace("\u00a0", " ")
    check(page.locator("#draft").is_visible() and "« Tracé gardé »" in said and "4 points de passage" in said,
          "a new visit offers the drawing (« %s »)" % said)
    check(page.evaluate("window.circuitEditor.state.waypoints.length") == 0 and len(net.overpass_calls) == roads,
          "nothing is drawn and no road is asked for before « Reprendre »")
    shot(page, shots, "desktop-draft-offer.png")
    page.click("#draft-resume")
    page.wait_for_function("(() => { const t = document.getElementById('toast').textContent;"
                           " return t.includes('Tracé repris') && t.includes('4 points'); })()", timeout=30000)
    st = page.evaluate("(() => { const e = window.circuitEditor, v = (id) => document.getElementById(id).value;"
                       " return { n: e.state.waypoints.length, ok: e.current.route.ok, lost: e.state.waypoints.filter(w => w.edge < 0).length,"
                       " name: v('f-name'), id: v('f-id'), laps: v('f-laps'), smooth: v('f-rsmooth') }; })()")
    check(st == {"n": 4, "ok": True, "lost": 0, "name": "Tracé gardé", "id": "trace-garde", "laps": "2", "smooth": "600"},
          "« Reprendre »: the waypoints are back on their roads, with the form: %s" % st)
    said = page.inner_text("#toast").replace("\u00a0", " ")
    check(len(net.overpass_calls) == roads and "reprises de cet ordinateur" in said,
          "the roads the drawing was made on come from the computer: no request (« %s »)" % said)
    check(page.evaluate("window.circuitEditor.graph.ways.length") == 229, "all of them: 229 ways")
    page.wait_for_function("document.getElementById('relief-status').textContent.includes('Relief chargé')", timeout=30000)
    check(len(net.elevation_calls) == heights, "the elevations kept with the drawing are not asked for again")
    again = page.evaluate("window.circuitEditor.prepareExport().then(o => o.track.hash)")
    check(again == before, "the resumed circuit has the hash it had before the page was left")
    check(page.locator("#draft").is_hidden(), "the offer is gone once taken")
    shot(page, shots, "desktop-draft-resumed.png")
    forget_roads(page)
    page.close()

    # The roads no longer on the computer: « Reprendre » asks Overpass for the course's box, once.
    roads = len(net.overpass_calls)
    page = new_page(context, errors, base, 1280, 800, keep_offer=True)
    page.click("#draft-resume")
    page.wait_for_function("(() => { const t = document.getElementById('toast').textContent;"
                           " return t.includes('Tracé repris') && t.includes('4 points'); })()", timeout=30000)
    check(len(net.overpass_calls) == roads + 1, "nothing kept: the roads of the course's box are asked for once")
    check(page.evaluate("window.circuitEditor.prepareExport().then(o => o.track.hash)") == before, "and the circuit still has its hash")
    page.close()

    # Declined, the earlier drawing stays until a new one takes its place; erasing all forgets it.
    page = new_page(context, errors, base, 1280, 800, keep_offer=True)
    page.click("#draft-ignore")
    check(page.locator("#draft").is_hidden() and len(stored_draft(page)["waypoints"]) == 4, "« Ignorer » hides the offer and keeps the drawing")
    frame_and_load(page)
    click_latlon(page, *WAYPOINTS[0])
    page.wait_for_function("(JSON.parse(localStorage.getItem('circuit-editor.draft') || '{}').waypoints || []).length === 1")
    check(True, "a new drawing takes the place of the one declined")
    page.click("#clear")
    page.wait_for_function("localStorage.getItem('circuit-editor.draft') === null")
    check(True, "« Tout effacer » forgets the kept drawing")
    page.close()

    # The altitudes stay on the computer: the same course drawn again on a new visit,
    # with no drawing kept, asks Open-Meteo for nothing.
    page = new_page(context, errors, base, 1280, 800)
    heights = len(net.elevation_calls)
    frame_and_load(page)
    for lat, lon in WAYPOINTS:
        click_latlon(page, lat, lon)
    page.wait_for_function("window.circuitEditor.state.waypoints.length === 4")
    page.click("#tabbtn-relief")
    page.wait_for_function("document.getElementById('relief-status').textContent.includes('Relief chargé')", timeout=30000)
    check(len(net.elevation_calls) == heights, "drawn again on a later visit: its altitudes come from this computer (%d requests)"
          % (len(net.elevation_calls) - heights))
    page.click("#clear")
    page.close()


def circuits(page):
    """The rows of « Mes circuits » as the page shows them: [name, detail]."""
    return page.evaluate("Array.from(document.querySelectorAll('#circuits li')).map(li => [li.querySelector('b').textContent,"
                         " li.querySelector('small').textContent.replace(/\\u00a0/g, ' ')])")


def library_run(context, net, errors, base, shots):
    print("Mes circuits: several drawings kept on the computer")
    net.overpass_down = set()
    page = new_page(context, errors, base, 1280, 800)
    answers = []                                   # what each « are you sure » is answered
    asked = []
    page.on("dialog", lambda d: (asked.append(d.message.replace("\u00a0", " ")), d.accept() if answers.pop(0) else d.dismiss()))
    page.click("#tabbtn-send")
    for row in page.locator("#circuits .circuit-del").all():          # what the earlier runs exported
        answers.append(True)
        page.locator("#circuits .circuit-del").first.click()
        page.wait_for_function("document.getElementById('toast').textContent.includes('plus dans Mes circuits')")
        page.evaluate("document.getElementById('toast').textContent = ''")
    asked.clear()
    check(circuits(page) == [] and page.locator("#circuits-empty").is_visible() and page.locator("#keep").is_disabled(),
          "an empty list says so, and there is nothing to keep before a drawing exists")

    # A first circuit, kept by its button.
    frame_and_load(page)
    for lat, lon in WAYPOINTS:
        click_latlon(page, lat, lon)
    page.wait_for_function("window.circuitEditor.state.waypoints.length === 4")
    page.click("#keep")
    page.wait_for_function("document.getElementById('toast').textContent.includes('Donnez un nom')")
    check(circuits(page) == [], "a circuit without a name is not kept, and the page says why")
    page.fill("#f-name", "Circuit A")
    page.click("#tabbtn-relief")
    page.wait_for_function("document.getElementById('relief-status').textContent.includes('Relief chargé')", timeout=30000)
    page.click("#tabbtn-send")
    page.click("#keep")
    page.wait_for_function("document.querySelectorAll('#circuits li').length === 1")
    rows = circuits(page)
    check(rows[0][0] == "Circuit A" and "de jeu" in rows[0][1] and "3 tours" in rows[0][1] and "gardé le" in rows[0][1],
          "« Garder ce circuit » puts it in the list: %s" % rows)
    hash_a = page.evaluate("window.circuitEditor.prepareExport().then(o => o.track.hash)")

    # A new circuit: nothing is asked, the first one is kept as it is.
    page.click("#new")
    page.wait_for_function("window.circuitEditor.state.waypoints.length === 0")
    check(not asked and page.input_value("#f-name") == "" and page.input_value("#f-id") == "",
          "« Nouveau circuit » after keeping: no question, the drawing and the name are empty")
    page.wait_for_function("localStorage.getItem('circuit-editor.draft') === null")
    for lat, lon in WAYPOINTS[:3]:
        click_latlon(page, lat, lon)
    page.wait_for_function("window.circuitEditor.state.waypoints.length === 3")
    page.click("#tabbtn-settings")
    page.fill("#f-name", "Circuit B")
    page.click("#tabbtn-send")
    with page.expect_download() as info:
        page.click("#download")
    info.value.path()
    page.wait_for_function("document.querySelectorAll('#circuits li').length === 2")
    check([r[0] for r in circuits(page)] == ["Circuit B", "Circuit A"], "a downloaded circuit is kept without being asked, the latest first")
    hash_b = page.evaluate("window.circuitEditor.prepareExport().then(o => o.track.hash)")

    # The drawing changed since it was kept: opening another one asks first.
    click_latlon(page, *WAYPOINTS[3])
    page.wait_for_function("window.circuitEditor.state.waypoints.length === 4")
    answers.append(False)
    page.locator("#circuits .circuit-open").nth(1).click()
    page.wait_for_function("(n) => n === 1", arg=len(asked))
    check(len(asked) == 1 and "pas gardé" in asked[0] and "Circuit A" in asked[0]
          and page.input_value("#f-name") == "Circuit B" and page.evaluate("window.circuitEditor.state.waypoints.length") == 4,
          "a drawing changed since it was kept: the page asks, and « no » leaves everything (« %s »)" % (asked[0] if asked else ""))
    roads, heights = len(net.overpass_calls), len(net.elevation_calls)
    answers.append(True)
    page.locator("#circuits .circuit-open").nth(1).click()
    page.wait_for_function("(() => { const t = document.getElementById('toast').textContent; return t.includes('Circuit A') && t.includes('ouvert'); })()", timeout=30000)
    page.wait_for_function("document.getElementById('relief-status').textContent.includes('Relief chargé')", timeout=30000)
    again = page.evaluate("window.circuitEditor.prepareExport().then(o => o.track.hash)")
    check(again == hash_a and page.input_value("#f-name") == "Circuit A" and page.evaluate("window.circuitEditor.state.waypoints.length") == 4,
          "« yes » opens the other circuit as it was kept: same hash")
    check(len(net.overpass_calls) == roads and len(net.elevation_calls) == heights, "without asking for a road or an elevation")
    asked.clear()
    page.locator("#circuits .circuit-open").nth(0).click()
    page.wait_for_function("(() => { const t = document.getElementById('toast').textContent; return t.includes('Circuit B') && t.includes('ouvert'); })()", timeout=30000)
    check(not asked and page.evaluate("window.circuitEditor.prepareExport().then(o => o.track.hash)") == hash_b,
          "from a circuit that is kept to another: no question, and the downloaded one is back with its hash")
    page.close()

    # The list is on the computer: a later visit finds it. A circuit can be taken out.
    page = new_page(context, errors, base, 1280, 800)
    page.on("dialog", lambda d: d.accept())
    page.click("#tabbtn-send")
    page.wait_for_function("document.querySelectorAll('#circuits li').length === 2")
    check(True, "a later visit finds the two circuits")
    page.locator("#circuits .circuit-del").nth(0).click()
    page.wait_for_function("document.querySelectorAll('#circuits li').length === 1")
    check([r[0] for r in circuits(page)] == ["Circuit A"], "the bin takes one circuit out of the list")
    shot(page, shots, "desktop-circuits.png")
    page.close()


def photo_state(page):
    """The photos of the drawing and what the page shows of them."""
    return page.evaluate("""() => { const e = window.circuitEditor, q = (s) => Array.from(document.querySelectorAll(s));
        const text = (el) => el.textContent.replace(/\\u00a0/g, ' ');
        return { n: e.state.photos.length, waypoints: e.state.waypoints.length, tab: text(document.getElementById('tabbtn-photos')),
                 status: text(document.getElementById('photos-status')), refused: q('#photos-refused li').map(text),
                 rows: q('#photos li.photo').map(li => [text(li.querySelector('b')), text(li.querySelector('small:not(.look)')), li.className,
                                                        li.querySelector('select') ? li.querySelector('select').value : null,
                                                        li.querySelector('select') ? text(li.querySelector('select').options[0]) : null,
                                                        li.querySelector('small.look') ? text(li.querySelector('small.look')) : '']),
                 places: q('#photos li.place').map(text),
                 pins: q('.photo-pin').length, names: e.state.photos.map(p => p.name) }; }""")


def photos_run(context, net, errors, base, shots, tmp):
    print("Photos with their GPS position")
    net.overpass_down = set()
    fixtures = HERE / "fixtures"
    near, near2, far, nogps = (str(fixtures / n) for n in ("photo-near.jpg", "photo-near-2.jpg", "photo-far.jpg", "photo-no-gps.jpg"))
    png = pathlib.Path(tmp) / "capture.png"
    png.write_bytes(PNG_1X1)
    page = new_page(context, errors, base, 1280, 800)
    frame_and_load(page)
    page.click("#tabbtn-photos")

    for lat, lon in WAYPOINTS:
        click_latlon(page, lat, lon)
    page.wait_for_function("window.circuitEditor.state.waypoints.length === 4")
    page.click("#tabbtn-settings")
    page.fill("#f-name", "Circuit aux photos")
    page.click("#tabbtn-photos")
    before = page.evaluate("window.circuitEditor.prepareExport().then(o => [o.track.hash, 'photos' in o.track])")

    # Five files at once: one near the course, one far, one without a position, one that is no JPEG, the first again.
    page.set_input_files("#photos-file", [near, far, nogps, str(png), near])
    page.wait_for_function("document.getElementById('photos-status').textContent.includes('lues')", timeout=30000)
    st = photo_state(page)
    check(st["n"] == 2 and st["names"] == ["photo-near.jpg", "photo-far.jpg"] and "5 photos lues : 2 acceptées, 3 refusées" in st["status"],
          "five files: the two with a position are taken (« %s »)" % st["status"])
    why = " | ".join(st["refused"])
    check(len(st["refused"]) == 3 and "photo-no-gps.jpg : pas de position GPS" in why and "capture.png : ce n'est ni un JPEG ni un HEIC" in why
          and "photo-near.jpg : déjà dans le circuit" in why,
          "the three others are refused, each with its reason: %s" % why)
    check(st["waypoints"] == 5 and "1 point de passage ajouté" in st["status"], "the place near the course became a waypoint of it: 5 waypoints")
    check("1 photo est à plus de 100 m du tracé : en rouge sur la carte" in st["status"] and st["rows"][1][0] == "photo-far.jpg" and st["rows"][1][2] == "photo out"
          and re.search(r"^à 1\W175 m du parcours : elle ne sera pas dans le fichier$", st["rows"][1][1]),
          "the one taken 1.2 km away stays, in red, out of the file, for the course to be brought to it: « %s »" % st["rows"][1][1])
    check(st["rows"][0][0] == "photo-near.jpg" and re.search(r"prise (19|20|21|22) m à gauche de la route", st["rows"][0][1]) and st["tab"] == "Photos2" and st["pins"] == 2,
          "it is listed with its place, counted on the tab and pinned on the map: %s" % st["rows"])
    check(len(st["places"]) == 1 and re.match(r"Lieu 1 · à [0-9 ,]+ (m|km) du départ$", st["places"][0]) and st["rows"][0][3] == "" and st["rows"][0][4] == "Selon l'ordre : devant",
          "alone at its place, it shows the road ahead, by its order: %s, « %s »" % (st["places"], st["rows"][0][4]))
    # Its compass said 214.5°: the page warns only when that is not the way the view given looks.
    look = page.evaluate("(() => { const f = window.circuitEditor.current.result.photos[0]; return [f.look, window.CircuitCore.viewOfLook(f.look), f.view]; })()")
    check(isinstance(look[0], int) and (st["rows"][0][5] != "") == (look[1] != look[2]) and (look[1] == look[2] or "D'après la boussole" in st["rows"][0][5]),
          "the camera looked %+d° from the road ahead (%s): « %s »" % (look[0], look[1], st["rows"][0][5] or "no warning"))
    shot(page, shots, "desktop-photos.png")
    out = page.evaluate("""() => window.circuitEditor.prepareExport().then(o => { const p = o.track.photos || [];
        return { n: p.length, first: p[0] && { name: p[0].name, lat: p[0].lat, lon: p[0].lon, ele: p[0].ele, taken: p[0].taken, bearing: p[0].bearing,
                 side: p[0].side, off: p[0].offset_m * o.track.scale, w: p[0].w, h: p[0].h, jpeg: p[0].image.startsWith('data:image/jpeg;base64,/9j/'),
                 size: p[0].image.length, point: p[0].point, points: o.track.points.length }, check: window.CircuitCore.checkTrack(o.track).ok,
                 route: window.circuitEditor.current.route.ok }; })""")
    f = out["first"]
    check(out["n"] == 1 and out["check"] and f["name"] == "photo-near.jpg" and abs(f["lat"] - 13.416314) < 1e-6 and abs(f["lon"] - 103.853748) < 1e-6
          and f["ele"] == 23.4 and f["taken"] == "2026-11-25T17:26:46" and f["bearing"] == 214.5,
          "the file carries the photo with what its metadata said: place, altitude, date, direction")
    check(f["side"] == "left" and abs(f["off"] - 20) < 4 and 0 <= f["point"] < f["points"], "at its place beside the course: %.0f m to the left" % f["off"])
    check(f["jpeg"] and (f["w"], f["h"]) == (160, 120) and f["size"] < 400000, "its image is a JPEG of %d x %d written in the file" % (f["w"], f["h"]))
    check(before[1] is False, "a circuit without photos had no photos field")

    # Undo takes the import back, redo brings it again.
    page.keyboard.press("Control+z")
    page.wait_for_function("window.circuitEditor.state.photos.length === 0 && window.circuitEditor.state.waypoints.length === 4")
    page.keyboard.press("Control+y")
    page.wait_for_function("window.circuitEditor.state.photos.length === 2 && window.circuitEditor.state.waypoints.length === 5")
    check(True, "« Annuler » undoes the import, photos and waypoint together; « Rétablir » brings them back")
    # The far one goes to the bin.
    page.locator("#photos li.photo").nth(1).locator(".btn.icon").click()
    page.wait_for_function("window.circuitEditor.state.photos.length === 1")

    # The distance allowed is a setting: tightened, the photo is left out of the file, and the page says so.
    page.fill("#f-photo-max", "10")
    page.dispatch_event("#f-photo-max", "change")
    page.wait_for_function("document.querySelector('#photos li.photo').className === 'photo out'")
    st = photo_state(page)
    page.click("#tabbtn-trace")
    notes = page.inner_text("#messages").replace("\u00a0", " ")
    left_out = page.evaluate("window.circuitEditor.prepareExport().then(o => 'photos' in o.track)")
    check("ne sera pas dans le fichier" in st["rows"][0][1] and "photo-near.jpg" in notes and left_out is False,
          "10 m allowed: the photo at 20 m is left out of the file, and the page warns (« %s »)" % st["rows"][0][1])
    page.click("#tabbtn-photos")
    page.fill("#f-photo-max", "100")
    page.dispatch_event("#f-photo-max", "change")
    page.wait_for_function("document.querySelector('#photos li.photo').className === 'photo'")

    # A second photo, dropped on the map.
    data = base64.b64encode(pathlib.Path(near2).read_bytes()).decode("ascii")
    page.evaluate("""(b64) => { const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0)), dt = new DataTransfer();
        dt.items.add(new File([bytes], 'photo-near-2.jpg', { type: 'image/jpeg' }));
        const app = document.getElementById('app');
        app.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
        app.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }""", data)
    page.wait_for_function("window.circuitEditor.state.photos.length === 2", timeout=30000)
    st = photo_state(page)
    check(st["waypoints"] == 6 and st["pins"] == 2 and st["tab"] == "Photos2" and "1 photo lue : 1 acceptée, 0 refusée" in st["status"],
          "a photo dropped on the page is imported the same way: %s" % st["status"])
    kept = page.evaluate("window.circuitEditor.prepareExport().then(o => [o.track.hash, o.track.photos.map(p => p.name + '@' + p.point + p.side)])")
    page.wait_for_function("(localStorage.getItem('circuit-editor.draft') || '').includes('photo-near-2.jpg')")
    draft = stored_draft(page)
    check(len(draft["photos"]) == 2 and "base64" not in json.dumps(draft), "the kept drawing names its two photos and carries no image")
    page.click("#tabbtn-send")
    with page.expect_download() as info:
        page.click("#download")
    target = pathlib.Path(tmp) / info.value.suggested_filename
    info.value.save_as(str(target))
    node = shutil.which("node")
    if node:
        res = subprocess.run([node, str(HERE / "validate.mjs"), str(target)], capture_output=True, text=True)
        check(res.returncode == 0, "the downloaded file with photos fits the schema and the rules: %s" % (res.stdout.strip() or res.stderr.strip())[-90:])
    page.close()

    # A later visit: the photos come back with the drawing, images included.
    page = new_page(context, errors, base, 1280, 800, keep_offer=True)
    page.click("#draft-resume")
    page.wait_for_function("document.getElementById('toast').textContent.includes('Tracé repris')", timeout=30000)
    again = page.evaluate("window.circuitEditor.prepareExport().then(o => [o.track.hash, o.track.photos.map(p => p.name + '@' + p.point + p.side)])")
    check(again == kept and photo_state(page)["pins"] == 2, "« Reprendre »: the two photos are back at their places, same circuit")

    # From the file: a new circuit, then « Ouvrir… ».
    page.on("dialog", lambda d: d.accept())
    page.click("#tabbtn-send")
    page.click("#new")
    page.wait_for_function("window.circuitEditor.state.waypoints.length === 0 && window.circuitEditor.state.photos.length === 0")
    page.set_input_files("#open-file", str(target))
    page.wait_for_function("document.getElementById('export-status').textContent.includes('recalculé')", timeout=30000)
    opened = page.evaluate("window.circuitEditor.prepareExport().then(o => [o.track.hash, o.track.photos.map(p => p.name + '@' + p.point + p.side)])")
    check(opened == kept, "« Ouvrir… » reads the photos back from the file: same circuit, same photos at the same places")

    # A photo taken out: its waypoint stays.
    page.click("#tabbtn-photos")
    page.locator("#photos .btn.icon").first.click()
    page.wait_for_function("window.circuitEditor.state.photos.length === 1")
    st = photo_state(page)
    check(st["names"] == ["photo-near-2.jpg"] and st["waypoints"] == 6 and st["pins"] == 1, "the bin takes a photo out of the circuit; its waypoint stays")

    # An album downloaded from Google Photos: a zip, read as it is. In it, the
    # two photos again (one is still in the circuit), a PNG, a folder, and a
    # copy of the first photo under another name.
    page.set_input_files("#photos-file", str(fixtures / "photos-album.zip"))
    page.wait_for_function("document.getElementById('photos-status').textContent.includes('lues')", timeout=30000)
    st = photo_state(page)
    why = " | ".join(st["refused"])
    check(st["n"] == 3 and "4 photos lues : 2 acceptées, 2 refusées" in st["status"] and "photo-near-2.jpg : déjà dans le circuit" in why
          and "capture.png : ce n'est ni un JPEG ni un HEIC" in why and st["waypoints"] == 6,
          "a zip archive gives its photos: 2 taken, the folder skipped, a PNG and a photo already there refused, no new waypoint (« %s »)" % st["status"])
    rows = [(r[0], r[4]) for r in st["rows"]]
    check(len(st["places"]) == 2 and rows == [("photo-near.jpg", "Selon l'ordre : devant"), ("Été à Kep.jpg", "Selon l'ordre : à gauche"),
                                              ("photo-near-2.jpg", "Selon l'ordre : devant")],
          "two photos at one place: the first taken shows the road ahead, the next the left side: %s" % rows)
    shot(page, shots, "desktop-photos-places.png")

    # The view chosen by hand: the other photo of the place takes the next one, and « Annuler » takes the choice back.
    page.locator("#photos li.photo").nth(1).locator("select").select_option("front")
    page.wait_for_function("document.querySelectorAll('#photos li.photo select')[0].value === 'front'")
    views = page.evaluate("window.circuitEditor.prepareExport().then(o => o.track.photos.map(p => [p.spot, p.view, p.name]))")
    check(views == [[1, "front", "Été à Kep.jpg"], [1, "left", "photo-near.jpg"], [2, "front", "photo-near-2.jpg"]],
          "« Devant » chosen for the second photo: the file goes place by place, the road ahead first: %s" % views)
    page.wait_for_function("(localStorage.getItem('circuit-editor.draft') || '').includes('\"view\":\"front\"')")
    check(True, "the view chosen is kept with the drawing")
    page.click("#undo")
    page.wait_for_function("window.circuitEditor.state.photos.every(p => !p.view)")
    check(photo_state(page)["rows"][0][0] == "photo-near.jpg", "« Annuler » takes the choice back")

    # A photo of a phone's size: 1600 x 1200, drawn in the page, with the GPS block of photo-near-2.jpg.
    raw = pathlib.Path(near2).read_bytes()
    seg = raw.index(b"\xff\xe1")
    app1 = raw[seg:seg + 2 + int.from_bytes(raw[seg + 2:seg + 4], "big")]
    page.evaluate("""async (b64) => { const app1 = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const cv = document.createElement('canvas'); cv.width = 1600; cv.height = 1200;
        const g = cv.getContext('2d'); g.fillStyle = '#6a8'; g.fillRect(0, 0, 1600, 1200); g.fillStyle = '#c84'; g.fillRect(0, 700, 1600, 500);
        const jpeg = new Uint8Array(await (await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.9))).arrayBuffer());
        const bytes = new Uint8Array(jpeg.length + app1.length);
        bytes.set(jpeg.subarray(0, 2)); bytes.set(app1, 2); bytes.set(jpeg.subarray(2), 2 + app1.length);
        const dt = new DataTransfer(); dt.items.add(new File([bytes], 'grande.jpg', { type: 'image/jpeg' }));
        const app = document.getElementById('app');
        app.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
        app.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }""", base64.b64encode(app1).decode("ascii"))
    page.wait_for_function("window.circuitEditor.state.photos.length === 4", timeout=30000)
    big = page.evaluate("(() => { const p = window.circuitEditor.state.photos[3]; return [p.w, p.h, p.image.length]; })()")
    st = photo_state(page)
    check(net.libheif_calls == 0, "no HEIC so far: the HEIC decoder was not loaded")
    check(big[0] == 320 and big[1] == 240 and big[2] < 40000 and [r[4] for r in st["rows"] if r[0] == "grande.jpg"] == ["Selon l'ordre : à gauche"],
          "a 1600 x 1200 photo is kept at %d x %d (%d characters), and at a place already shown it is the left side" % (big[0], big[1], big[2]))

    # HEIC, the photos of Samsung and iPhone phones: as a phone writes them (metadata first) and as an
    # album downloaded from Google Photos lays them out (metadata after the picture). Same picture as photo-near-2.jpg.
    page.set_input_files("#photos-file", [str(fixtures / "photo-near-2.heic"), str(fixtures / "photo-near-2-late.heic")])
    page.wait_for_function("document.getElementById('photos-status').textContent.includes('lues')", timeout=60000)
    st = photo_state(page)
    heics = page.evaluate("""async () => { const ps = window.circuitEditor.state.photos, load = (src) => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = src; });
        const pixels = async (src) => { const i = await load(src), c = document.createElement('canvas'); c.width = 160; c.height = 120;
          const g = c.getContext('2d'); g.drawImage(i, 0, 0, 160, 120); return g.getImageData(0, 0, 160, 120).data; };
        const ref = await pixels(ps.find(p => p.name === 'photo-near-2.jpg').image);
        return Promise.all(ps.filter(p => /heic$/.test(p.name)).map(async p => { const d = await pixels(p.image); let sum = 0;
          for (let k = 0; k < d.length; k += 4) sum += Math.abs(d[k] - ref[k]) + Math.abs(d[k + 1] - ref[k + 1]) + Math.abs(d[k + 2] - ref[k + 2]);
          return [p.name, p.w, p.h, Math.round(sum / (d.length / 4) / 3), Math.round(p.lat * 1e6) / 1e6, p.taken]; })); }""")
    check("2 photos lues : 2 acceptées, 0 refusée" in st["status"] and net.libheif_calls == 1,
          "two HEIC photos are read, and the decoder is loaded once for both (« %s »)" % st["status"])
    check(len(heics) == 2 and all(h[1:3] == [160, 120] and h[3] < 25 and h[4] == 13.413798 and h[5] == "2026-11-25T17:41:02" for h in heics),
          "each is decoded to the picture of the JPEG it was made from (mean difference per channel: %s), with its position and date" % [h[3] for h in heics])

    page.click("#clear")
    page.wait_for_function("window.circuitEditor.state.photos.length === 0 && window.circuitEditor.state.waypoints.length === 0")
    check(True, "« Tout effacer » erases the photos with the drawing")
    page.close()


def photos_first_run(context, net, errors, base, shots):
    print("Photos first, no course yet")
    net.overpass_down = set()
    page = new_page(context, errors, base, 1280, 800)
    forget_roads(page)
    page.click("#tabbtn-photos")
    calls = len(net.overpass_calls)
    # An album downloaded from Google Photos, given before anything else: the map goes to the photos,
    # the roads around them are loaded, and a course is drawn through their places in the order taken.
    page.set_input_files("#photos-file", str(HERE / "fixtures" / "photos-album.zip"))
    page.wait_for_function("document.getElementById('photos-status').textContent.includes('Tracé proposé')", timeout=60000)
    st = photo_state(page)
    info = page.evaluate("""(() => { const e = window.circuitEditor, c = e.map.getCenter();
        return { route: !!(e.current.route && e.current.route.ok), centre: [c.lat, c.lng], kind: e.state.kind,
                 wps: e.state.waypoints.map(w => [w.lat, w.lon]) }; })()""")
    check(st["n"] == 3 and len(st["places"]) == 2 and st["waypoints"] == 2 and info["route"] and len(net.overpass_calls) == calls + 1,
          "photos first: 3 photos at 2 places, the roads around them loaded (one request), a course through both places: %s" % st["status"])
    near1, near2 = PHOTO_FIXTURE_PLACES
    d = lambda a, b: math.hypot((a[0] - b[0]) * 110600, (a[1] - b[1]) * 108300)
    check(d(info["wps"][0], near1) < 40 and d(info["wps"][1], near2) < 40,
          "the waypoints are on the roads nearest the places, in the order the photos were taken (%.0f m, %.0f m)" % (d(info["wps"][0], near1), d(info["wps"][1], near2)))
    check(13.40 < info["centre"][0] < 13.42 and 103.84 < info["centre"][1] < 103.87, "the map shows where they were taken")
    check("adaptez-le" in st["status"] and all(r[2] == "photo" for r in st["rows"]), "every photo is near the course drawn, and the page says the course is to be adapted")
    shot(page, shots, "desktop-photos-first.png")
    # One « Annuler » takes back the photos and the course they made.
    page.click("#undo")
    page.wait_for_function("window.circuitEditor.state.photos.length === 0 && window.circuitEditor.state.waypoints.length === 0")
    check(True, "« Annuler » takes back the photos and the course they made; the roads stay loaded")
    page.close()


def relief_wait_run(context, net, errors, base, shots):
    print("Relief, the minute's allowance used up")
    net.overpass_down = set()
    net.elevation_429, net.elevation_retry_after = 1, "3"
    page = new_page(context, errors, base, 1280, 800)
    forget_elevations(page)
    page.evaluate("(pts) => window.circuitEditor.map.fitBounds(pts, { padding: [170, 170], animate: false })", [list(w) for w in WAYPOINTS])
    page.wait_for_function("document.getElementById('load-roads').textContent.includes('Charger')")
    page.click("#load-roads")
    page.wait_for_function("window.circuitEditor.graph.ways.length > 0", timeout=20000)
    page.click("#tabbtn-relief")
    for lat, lon in WAYPOINTS:
        click_latlon(page, lat, lon)
    # The refusal carries the delay: the page says what it waits for, and for how long.
    page.wait_for_function("document.getElementById('relief-status').textContent.includes('la suite dans 3 s')", timeout=20000)
    said = page.inner_text("#relief-status").replace("\u00a0", " ")
    check("points demandés à Open-Meteo" in said and "600 par minute" in said,
          "Open-Meteo answers 429: the count stays on screen with the wait (« %s »)" % said)
    shot(page, shots, "desktop-relief-wait.png")
    page.wait_for_function("document.getElementById('relief-status').textContent.includes('Relief chargé')", timeout=30000)
    check(net.elevation_429 == 0, "then the relief is asked again and arrives")
    net.elevation_retry_after = "1"
    page.close()


def outage_run(context, net, errors, base, shots):
    print("Services down")
    net.overpass_down = {"overpass-api.de", "maps.mail.ru", "overpass.openstreetmap.fr"}
    page = new_page(context, errors, base, 1280, 800)
    forget_roads(page)
    page.evaluate("(pts) => window.circuitEditor.map.fitBounds(pts, { padding: [170, 170], animate: false })", [list(w) for w in WAYPOINTS])
    page.wait_for_function("document.getElementById('load-roads').textContent.includes('Charger')")
    calls = len(net.overpass_calls)
    page.click("#load-roads")
    page.wait_for_function("document.getElementById('toast').textContent.includes('surchargés')", timeout=20000)
    check(len(net.overpass_calls) == calls + 3, "Overpass down everywhere: the three servers are tried, then a message in French")
    check(not page.locator("#load-roads").is_disabled(), "the button comes back for another try")
    shot(page, shots, "desktop-overpass-down.png")
    page.close()


def chrome_run(context, net, errors, base, shots):
    print("The menu bar, the command search, the shortcuts, the steps")
    net.overpass_down = set()
    page = new_page(context, errors, base, 1280, 800)
    sp = lambda t: t.replace("\u202f", " ").replace("\u00a0", " ")
    page.click(".mb-btn[data-menu=file]")
    items = page.evaluate("Array.from(document.querySelectorAll('.mb-pop .mi')).map(b => [b.textContent, b.disabled])")
    labels = [i[0] for i in items]
    check(any("Ouvrir un fichier" in l for l in labels) and any("Télécharger" in l and d for l, d in items),
          "« Fichier » lists open, keep, download… and download waits for a course (%d items)" % len(items))
    page.hover(".mb-btn[data-menu=view]")
    check(page.locator(".mb-pop").count() == 1 and "Fond : satellite" in sp(page.inner_text(".mb-pop")), "the pointer moves from one menu to the next")
    page.keyboard.press("Escape")
    check(page.locator(".mb-pop").count() == 0, "Échap closes the menu")
    frame_and_load(page)
    check(page.locator("#welcome").is_hidden(), "no first steps once roads are loaded")
    for lat, lon in WAYPOINTS:
        click_latlon(page, lat, lon)
    page.wait_for_function("window.circuitEditor.state.waypoints.length === 4")
    page.wait_for_function("document.getElementById('tabbtn-trace').classList.contains('done')")
    check(not page.locator("#tabbtn-settings").evaluate("b => b.classList.contains('done')"), "the course is ticked, the settings wait for a name")
    # A right click on the map: what can be done there; Échap closes it, a click elsewhere too, without a waypoint.
    x, y = page.evaluate("""(ll) => { const p = window.circuitEditor.map.latLngToContainerPoint(ll), r = document.getElementById('map').getBoundingClientRect();
        return [r.left + p.x, r.top + p.y]; }""", list(WAYPOINTS[1]))
    page.mouse.click(x + 40, y + 40, button="right")
    page.wait_for_selector("#mapmenu:not([hidden])")
    said = page.inner_text("#mapmenu")
    check("Ajouter un point de passage ici" in said and "Copier les coordonnées" in said, "a right click on the map offers what can be done there")
    page.mouse.click(x + 300, y + 200)
    check(page.locator("#mapmenu").is_hidden() and page.evaluate("window.circuitEditor.state.waypoints.length") == 4,
          "a click elsewhere closes it and adds no point")
    page.fill("#bar-name", "Nom dans la barre")
    check(page.input_value("#f-name") == "Nom dans la barre" and page.input_value("#f-id") == "nom-dans-la-barre",
          "the name typed in the bar is the circuit's, and its identifier follows")
    page.wait_for_function("document.getElementById('tabbtn-settings').classList.contains('done')")
    check(page.locator("#bar-download").is_enabled(), "with a course, « Télécharger » of the bar is ready")
    page.keyboard.press("Control+k")
    page.wait_for_selector("#palette-veil:not([hidden])")
    page.keyboard.type("satel")
    found = sp(page.inner_text("#palette-list"))
    page.keyboard.press("Enter")
    sat = page.evaluate("(() => { let on = false; window.circuitEditor.map.eachLayer(l => { if (l._url && l._url.includes('arcgisonline')) on = true; }); return on; })()")
    check("Fond : satellite" in found and sat and page.locator("#palette-veil").is_hidden(),
          "Ctrl+K, « satel », Entrée: the satellite view, and the search closes")
    page.keyboard.press("?")
    page.wait_for_selector("#keys-veil:not([hidden])")
    keys = page.inner_text("#keys-table")
    check("Ctrl+K" in keys and "Télécharger le fichier" in keys and "clic droit" in keys, "« ? » shows the sheet of shortcuts")
    shot(page, shots, "desktop-keys.png")
    page.keyboard.press("Escape")
    page.keyboard.press("4")
    check(page.locator("#tab-photos").is_visible(), "a figure goes to its step (4: Photos)")
    page.keyboard.press("p")
    page.wait_for_function("document.getElementById('panel').offsetWidth === 0")
    check(True, "P hides the panel: the map takes the whole window")
    page.keyboard.press("p")
    page.wait_for_function("document.getElementById('panel').offsetWidth > 0")
    page.wait_for_function("document.getElementById('bar-saved').textContent.includes('Brouillon gardé')")
    check(True, "the bar says when the drawing in progress was last kept")
    page.keyboard.press("Control+s")
    page.wait_for_function("document.getElementById('toast').textContent.includes('Mes circuits')", timeout=10000)
    check(True, "Ctrl+S keeps the circuit in « Mes circuits »")
    shot(page, shots, "desktop-menubar.png")
    page.click("#clear")
    page.wait_for_selector("#toast .toast-act")
    page.click("#toast .toast-act")
    page.wait_for_function("window.circuitEditor.state.waypoints.length === 4")
    check(True, "« Tout effacer »: the message carries « Annuler », and it brings the course back")
    page.click("#tabbtn-objects")
    page.click("#obj-lib .otile[data-kind=palm_a]")
    page.keyboard.press("Escape")
    check(page.locator("#obj-recent .otile[data-kind=palm_a]").count() == 1, "an object picked goes into « Utilisés récemment »")
    page.click("#clear")
    page.close()


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--browser", choices=["webkit", "chrome", "chromium"])
    ap.add_argument("--screenshots", metavar="DIR")
    ap.add_argument("--headed", action="store_true")
    args = ap.parse_args()

    server = serve()
    base = "http://127.0.0.1:%d" % server.server_address[1]
    net = Network()
    errors = []
    with sync_playwright() as p, tempfile.TemporaryDirectory() as tmp:
        browser, name = launch(p, args.browser)
        print("Browser: %s %s" % (name, browser.version))
        context = browser.new_context(accept_downloads=True, locale="fr-FR")
        context.route("**/*", net.handle)
        try:
            target = desktop_run(context, net, errors, base, args.screenshots, tmp)
            reopen_run(context, net, errors, base, args.screenshots, target)
            draft_run(context, net, errors, base, args.screenshots)
            library_run(context, net, errors, base, args.screenshots)
            chrome_run(context, net, errors, base, args.screenshots)
            photos_run(context, net, errors, base, args.screenshots, tmp)
            photos_first_run(context, net, errors, base, args.screenshots)
            relief_wait_run(context, net, errors, base, args.screenshots)
            outage_run(context, net, errors, base, args.screenshots)
        finally:
            context.close()
            browser.close()
            server.shutdown()
    print("Whole run")
    # A refused request shows in the console: the mocked 401, 409, 429 and 504 are expected there.
    expected = ("status of 401", "status of 409", "status of 429", "status of 504", "status of 404")
    real = [e for e in errors if not any(x in e for x in expected)]
    check(not real, "no error in the console (%s)" % (real[:3] or "none"))
    check(not net.unexpected, "no request to an unexpected host (%s)" % (net.unexpected[:3] or "none"))
    failed = [w for ok, w in checks if not ok]
    print("%d checks, %d failed" % (len(checks), len(failed)))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
