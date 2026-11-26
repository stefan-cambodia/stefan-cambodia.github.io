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
conflict on the catalogue, reopens the file, then checks what the page says when
every Overpass server is down. The editor is meant for a desktop browser: the
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
        self.nominatim_calls = []
        self.github_files = {}            # path -> (sha, bytes)
        self.github_log = []              # (method, path, authorization, body)
        self.github_conflict_once = True  # the catalogue changes under the first write
        self.unexpected = []

    def handle(self, route, request):
        url = urllib.parse.urlparse(request.url)
        host = url.hostname or ""
        if host in ("127.0.0.1", "localhost"):
            return route.continue_()
        if host == "cdnjs.cloudflare.com" and "/ajax/libs/leaflet/1.9.4/" in url.path:
            return route.continue_()      # the real file: the browser checks its SRI hash
        if host.endswith("tile.openstreetmap.org") or host.endswith("arcgisonline.com") or host.endswith("opentopomap.org"):
            return route.fulfill(status=200, content_type="image/png", body=PNG_1X1, headers=CORS)
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
            headers["retry-after"] = "1"
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


def new_page(context, errors, base, width, height):
    page = context.new_page()
    page.set_viewport_size({"width": width, "height": height})
    page.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    page.goto(base + PAGE)
    page.wait_for_function("window.circuitEditor && window.circuitEditor.map")
    return page


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

    # A click before any road is loaded: a hint, no waypoint.
    page.mouse.click(700, 400)
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
    shot(page, shots, "desktop-relief.png")

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
    page.wait_for_function("document.getElementById('export-status').textContent.length > 0")
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


def reopen_run(context, net, errors, base, shots, target):
    print("Reopening the downloaded file in a fresh page")
    net.overpass_down = set()
    calls = len(net.overpass_calls)
    page = new_page(context, errors, base, 1280, 800)
    page.click("#tabbtn-send")
    page.set_input_files("#open-file", str(target))
    page.wait_for_function("document.getElementById('export-status').textContent.includes('recalculé')", timeout=30000)
    check(len(net.overpass_calls) == calls + 1, "« Ouvrir » loads the roads of the course's area")
    st = page.evaluate("""() => { const e = window.circuitEditor;
        return { n: e.state.waypoints.length, ok: e.current.route.ok, kind: e.state.kind, lost: e.state.waypoints.filter(w => w.edge < 0).length }; }""")
    check(st == {"n": 4, "ok": True, "kind": "loop", "lost": 0}, "the route is rebuilt from the file's waypoints: %s" % st)
    check(page.input_value("#f-name") == "Essai de bout en bout" and page.input_value("#f-id") == "essai-de-bout-en-bout",
          "name and identifier come back from the file")
    # Same roads, same settings: the same circuit, hash for hash.
    original = json.loads(pathlib.Path(target).read_text(encoding="utf-8"))
    again = page.evaluate("window.circuitEditor.prepareExport().then(o => o.track.hash)")
    check(again == original["hash"], "exported again, the reopened circuit has the same hash")
    shot(page, shots, "desktop-reopened.png")
    page.close()


def outage_run(context, net, errors, base, shots):
    print("Services down")
    net.overpass_down = {"overpass-api.de", "maps.mail.ru", "overpass.openstreetmap.fr"}
    page = new_page(context, errors, base, 1280, 800)
    page.evaluate("(pts) => window.circuitEditor.map.fitBounds(pts, { padding: [170, 170], animate: false })", [list(w) for w in WAYPOINTS])
    page.wait_for_function("document.getElementById('load-roads').textContent.includes('Charger')")
    calls = len(net.overpass_calls)
    page.click("#load-roads")
    page.wait_for_function("document.getElementById('toast').textContent.includes('surchargés')", timeout=20000)
    check(len(net.overpass_calls) == calls + 3, "Overpass down everywhere: the three servers are tried, then a message in French")
    check(not page.locator("#load-roads").is_disabled(), "the button comes back for another try")
    shot(page, shots, "desktop-overpass-down.png")
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
