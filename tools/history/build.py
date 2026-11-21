#!/usr/bin/env python3
"""Build the history page of every followed project page, from the site's own Git history.

A page is followed when it has a Last changes section (class="changes"). For each one,
history/<slug>.html lists every version of the page, newest first: what changed (the text
in tools/history/entries.json, or the commit's subject when none was written) and the
captures and videos that version put on the page.

Nothing is generated. Every capture and video shown is the file the site published at the
time. A version no longer in the working tree (replaced or deleted since) is copied out of
Git, byte for byte, into assets/history/<slug>/<date>-<commit>/, so that GitHub Pages can
serve it. What the site never published cannot appear here.

Run from anywhere in the repository, with its full history (not a shallow clone):
    python3 tools/history/build.py
Python 3.8+, standard library only.
"""
import html, json, os, re, struct, subprocess, sys

ROOT = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True).stdout.strip()
SITE_REPO = "https://github.com/stefan-cambodia/stefan-cambodia.github.io"
MEDIA = re.compile(r"\.(jpe?g|png|webp|gif|mp4|webm)$", re.I)
VIDEO = re.compile(r"\.(mp4|webm)$", re.I)
LANGS = ("en", "fr", "km")


def git(*args, binary=False):
    out = subprocess.run(["git", "-C", ROOT, *args], capture_output=True, check=True).stdout
    return out if binary else out.decode("utf-8")


def show(rev, path):
    try:
        return git("show", f"{rev}:{path}")
    except subprocess.CalledProcessError:
        return ""


def esc(s):
    return html.escape(s, quote=True)


# ---------- dates and words in the three languages
MONTHS = {
    "en": "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(),
    "fr": "janv. févr. mars avr. mai juin juil. août sept. oct. nov. déc.".split(),
    "km": "មករា កុម្ភៈ មីនា មេសា ឧសភា មិថុនា កក្កដា សីហា កញ្ញា តុលា វិច្ឆិកា ធ្នូ".split(),
}


def day(date, lang):
    y, m, d = date.split("-")
    return f"{int(d)} {MONTHS[lang][int(m) - 1]} {y}"


def L(**t):  # one span per language, shown by game.css according to <html lang>
    return "".join(f'<span data-l="{k}">{t[k]}</span>' for k in LANGS)


WORDS = {
    "kicker": L(en="History", fr="Historique", km="ប្រវត្តិ"),
    "now": L(en="On the page", fr="Sur la page", km="នៅលើទំព័រ"),
    "latest": L(en="Latest version", fr="Dernière version", km="កំណែចុងក្រោយ"),
}


def badge(v):
    if v["state"] == "on":
        return WORDS["now"]
    if v["state"] == "unshown":
        return L(en="Published, never shown on the page", fr="Publiée, jamais affichée sur la page", km="បានផ្សាយ ប៉ុន្តែមិនដែលបង្ហាញលើទំព័រ")
    d = {k: day(v["state_date"], k) for k in LANGS}
    if v["state"] == "replaced":
        return L(en=f"Replaced on {d['en']}", fr=f"Remplacée le {d['fr']}", km=f"ត្រូវបានជំនួស {d['km']}")
    if v["state"] == "removed":
        return L(en=f"Removed on {d['en']}", fr=f"Retirée le {d['fr']}", km=f"ត្រូវបានដកចេញ {d['km']}")
    return L(en=f"Off the page since {d['en']}", fr=f"Plus sur la page depuis le {d['fr']}", km=f"លែងនៅលើទំព័រតាំងពី {d['km']}")


def plural(n, en, fr, km):
    return L(en=f"{n} {en[0] if n == 1 else en[1]}", fr=f"{n} {fr[0] if n == 1 else fr[1]}", km=f"{km} {n}")


# ---------- image sizes without third-party modules
def image_size(data):
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return struct.unpack(">II", data[16:24])
    if data[:2] == b"\xff\xd8":
        i = 2
        while i < len(data) - 9:
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
                i += 2
                continue
            length = struct.unpack(">H", data[i + 2:i + 4])[0]
            if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                h, w = struct.unpack(">HH", data[i + 5:i + 9])
                return w, h
            i += 2 + length
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP" and data[12:16] == b"VP8X":
        return 1 + int.from_bytes(data[24:27], "little"), 1 + int.from_bytes(data[27:30], "little")
    return None


# ---------- the followed pages
def followed_pages():
    pages = []
    for kind in ("games", "projects"):
        for f in sorted(os.listdir(os.path.join(ROOT, kind))):
            if not f.endswith(".html"):
                continue
            text = open(os.path.join(ROOT, kind, f), encoding="utf-8").read()
            if 'class="changes"' not in text:
                continue
            slug = f[:-5]
            h1 = re.search(r"<h1[^>]*>(.*?)</h1>", text, re.S).group(1).strip()
            titles = {k: re.search(rf'<title[^>]*data-{k}="([^"]*)"', text) for k in LANGS}
            names = {k: re.sub(r"\s+—\s+Chantrea Systems$", "", html.unescape(titles[k].group(1))).split(",")[0] if titles[k] else re.sub("<[^>]+>", "", h1) for k in LANGS}
            alias = re.search(r'class="alias">([^<]*)<', text)
            repo = re.search(r'href="(https://github\.com/stefan-cambodia/[^"/]+)"', text)
            pages.append({"slug": slug, "kind": kind, "h1": h1, "names": names, "alias": alias.group(1) if alias else "",
                          "repo": repo.group(1) if repo else None, "text": text})
    return pages


def page_order(pages):
    index = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
    dev = re.findall(r'data-dev="([^"]+)"', index)
    games = re.findall(r'href="games/([a-z0-9-]+)\.html"', index)
    m = re.search(r"const projectPages=\{(.*?)\}", index)
    projects = re.findall(r':"([^"]+)"', m.group(1)) if m else []
    rank = {}
    for i, s in enumerate(dev + games + projects):
        rank.setdefault(s, i)
    pages.sort(key=lambda p: (rank.get(p["slug"], 999), p["slug"]))
    for p in pages:
        p["dev"] = p["slug"] in dev
    return index


# ---------- the versions of one page's media
def history_of(page, head_blobs, index_now):
    slug, kind = page["slug"], page["kind"]
    page_path = f"{kind}/{slug}.html"
    cover = f"assets/screenshots/{slug}.jpg"
    paths = [page_path, f"assets/screenshots/{slug}", cover, f"assets/videos/{slug}"]
    log = git("log", "--reverse", "--no-renames", "--format=@@%H %h %ad %s", "--date=short", "--raw", "--abbrev=40", "--", *paths)
    commits, cur = [], None
    for line in log.splitlines():
        if line.startswith("@@"):
            full, short, date, subject = line[2:].split(" ", 3)
            cur = {"full": full, "hash": full[:7], "date": date, "subject": subject, "events": [], "page": False}
            commits.append(cur)
        elif line.startswith(":"):
            meta, path = line.split("\t")
            _, _, old, new, st = meta[1:].split()
            if path == page_path:
                cur["page"] = True
            elif MEDIA.search(path):
                cur["events"].append((st[0], path, old, new))
    versions, live = [], {}
    for c in commits:
        for st, path, old, new in c["events"]:
            if st in "MD" and path in live:
                v = live.pop(path)
                v["state"], v["state_date"] = ("replaced" if st == "M" else "removed"), c["date"]
            if st in "AM":
                v = {"path": path, "blob": new, "commit": c, "state": None, "state_date": None,
                     "video": bool(VIDEO.search(path)), "poster": None, "is_poster": False}
                versions.append(v)
                live[path] = v
    order = {c["full"]: i for i, c in enumerate(commits)}
    for v in versions:
        rel = v["path"][len("assets/"):]
        if v["path"] != cover and rel not in show(v["commit"]["full"], page_path):
            v["shown"] = False  # published with the page (a source of a composite, say) but never on it
        else:
            v["shown"] = True
        if v["state"] is None:
            if v["path"] == cover or rel in page["text"]:
                v["state"] = "on"
            elif not v["shown"]:
                v["state"] = "unshown"
            else:  # still in the tree but no longer on the page: find the version of the page that dropped it
                v["state"], v["state_date"] = "off", commits[-1]["date"]
                for c in commits[order[v["commit"]["full"]] + 1:]:
                    if c["page"] and rel not in show(c["full"], page_path):
                        v["state_date"] = c["date"]
                        break
        v["current"] = v["state"] in ("on", "off", "unshown") and head_blobs.get(v["path"]) == v["blob"]
        v["src"] = v["path"] if v["current"] else f"assets/history/{slug}/{v['commit']['date']}-{v['commit']['hash']}/{os.path.basename(v['path'])}"
    # a video's poster is the image of the same name in the same folder, published with it
    for v in versions:
        if v["video"]:
            stem = os.path.splitext(v["path"])[0]
            for p in versions:
                if not p["video"] and os.path.splitext(p["path"])[0] == stem and p["commit"] is v["commit"]:
                    v["poster"], p["is_poster"] = p, True
    # alternative text, as the page (or the home page, for its card) gave it then
    for v in versions:
        rev, rel = v["commit"]["full"], v["path"]
        if rel == cover:
            m = re.search(rf'src="assets/screenshots/{re.escape(slug)}\.jpg"[^>]*alt="([^"]*)"', show(rev, "index.html"))
            v["alt"] = html.unescape(m.group(1)) if m else f"{page['names']['en']}, home page card"
        else:
            text = show(rev, page_path)
            m = re.search(rf'<img[^>]*src="\.\./{re.escape(rel)}"[^>]*>', text)
            alt = re.search(r'alt="([^"]*)"', m.group(0)) if m else None
            v["alt"] = html.unescape(alt.group(1)) if alt else f"{page['names']['en']}, {os.path.basename(rel)}"
    return commits, versions


def materialise(v):
    """Copy a version that left the tree out of Git, so that the site can serve it."""
    if v["current"]:
        return
    dest = os.path.join(ROOT, v["src"])
    if os.path.exists(dest):
        return
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "wb") as f:
        f.write(git("cat-file", "blob", v["blob"], binary=True))


# ---------- HTML
HEAD = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#080b12">
<meta name="description" content="{desc}">
<title data-en="{t_en}" data-fr="{t_fr}" data-km="{t_km}">{t_en}</title>
<link rel="icon" type="image/svg+xml" href="../assets/logo/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Manrope:wght@400;500;600;700;800&family=Noto+Sans+Khmer:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;700&family=Kantumruy+Pro:wght@300&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../games/game.css">
<link rel="stylesheet" href="history.css">
<script src="../games/game.js"></script>
</head>
<body>
<!-- Generated by tools/history/build.py from the site's Git history: edit tools/history/entries.json, then run the script. -->
<header><div class="wrap nav">
<a class="brand" href="../" aria-label="Chantrea Systems"><img class="brand-logo" src="../assets/logo/chantrea-mark.svg" alt="" width="56" height="43"><span class="brand-name"><span class="brand-word">chantrea<i>_</i></span><span class="brand-sub"><span>SYSTEMS</span><span lang="km">ចន្ទ្រា</span></span></span></a>
<div class="nav-right"><a class="back" href="{back}">← {back_label}</a><button class="lang" id="langBtn">EN / FR / ខ្មែរ</button></div>
</div></header>
<main class="wrap">
"""
FOOT = """</main>
<footer><div class="wrap foot"><span>© <span id="year"></span> CHANTREA SYSTEMS</span><a href="{back}">← {back_label}</a></div></footer>
</body></html>
"""


def figure(v):
    cls = "hshot " + ("on" if v["state"] == "on" else "old")
    src = "../" + v["src"]
    if v["video"]:
        poster = f' poster="../{v["poster"]["src"]}"' if v["poster"] else ""
        size = v["poster"]["size"] if v["poster"] and v["poster"].get("size") else (1280, 720)
        media = (f'<video controls preload="none"{poster} width="{size[0]}" height="{size[1]}" aria-label="{esc(v["alt"])}">'
                 f'<source src="{src}" type="video/{os.path.splitext(src)[1][1:].lower()}"></video>')
        label = L(en="Video", fr="Vidéo", km="វីដេអូ") + " · "
    else:
        size = v.get("size")
        dims = f' width="{size[0]}" height="{size[1]}"' if size else ""
        media = f'<a href="{src}" target="_blank" rel="noopener"><img src="{src}"{dims} alt="{esc(v["alt"])}" loading="lazy"></a>'
        label = ""
    return f'<figure class="{cls}">{media}<figcaption>{label}{badge(v)}</figcaption></figure>'


def retired_block(items):
    out = ['<div class="ver-retired"><div class="kicker">' + L(
        en="Taken off the page’s Last changes, kept here",
        fr="Sortis des derniers changements de la page, gardés ici",
        km="ដកចេញពីការផ្លាស់ប្តូរចុងក្រោយនៃទំព័រ រក្សាទុកនៅទីនេះ") + "</div>"]
    for lang in LANGS:
        out.append(f'<ol class="changelog" data-l="{lang}">')
        for it in items[lang]:
            out.append(f'<li><time datetime="{it["time"]}">{it["label"]}</time><div><b>{it["title"]}</b><p>{it["text"]}</p></div></li>')
        out.append("</ol>")
    out.append("</div>")
    return "\n".join(out)


def build_page(page, entries, versions, prev_next):
    slug, kind, names = page["slug"], page["kind"], page["names"]
    shown = [v for v in versions if not v["is_poster"]]
    first = entries[-1]["date"] if entries else None
    stats = {
        "versions": len(entries),
        "captures": sum(1 for v in shown if not v["video"]),
        "kept": sum(1 for v in shown if v["state"] in ("replaced", "removed", "off")),
        "videos": sum(1 for v in shown if v["video"]),
    }
    back = f"../{kind}/{slug}.html"
    back_label = L(**{k: esc(names[k]) for k in LANGS})
    out = [HEAD.format(
        desc=esc(f"History of the {names['en']} page on Chantrea Systems: every version, with the captures and videos shown at the time."),
        t_en=esc(f"History of {names['en']} — Chantrea Systems"), t_fr=esc(f"Historique de {names['fr']} — Chantrea Systems"),
        t_km=esc(f"ប្រវត្តិ {names['km']} — Chantrea Systems"), back=back, back_label=back_label)]
    since = {k: day(first, k) for k in LANGS} if first else None
    out.append('<div class="hero">')
    out.append(f'<div class="kicker">{WORDS["kicker"]}{" · " + L(en="In development", fr="En développement", km="កំពុងអភិវឌ្ឍ") if page["dev"] else ""}</div>')
    out.append(f"<h1>{page['h1']}</h1>")
    if page["alias"]:
        out.append(f'<div class="alias">{page["alias"]}</div>')
    if since:
        out.append(f'<p class="lead" data-l="en">Every version of this page since {since["en"]}, newest first: what changed, and the captures and videos as the page showed them at the time.</p>')
        out.append(f'<p class="lead" data-l="fr">Chaque version de cette page depuis le {since["fr"]}, de la plus récente à la plus ancienne : ce qui a changé, et les captures et vidéos telles que la page les montrait à l’époque.</p>')
        out.append(f'<p class="lead" data-l="km">គ្រប់កំណែនៃទំព័រនេះ តាំងពីថ្ងៃទី {since["km"]} ពីថ្មីបំផុតទៅចាស់៖ អ្វីដែលបានផ្លាស់ប្តូរ និងរូបថតអេក្រង់ និងវីដេអូ ដូចដែលទំព័របានបង្ហាញនៅពេលនោះ។</p>')
    acts = [f'<a class="btn primary" href="{back}">{L(en="Current page", fr="Page actuelle", km="ទំព័របច្ចុប្បន្ន")} →</a>']
    if page["repo"]:
        acts.append(f'<a class="btn secondary" href="{page["repo"]}/commits" target="_blank" rel="noopener noreferrer">{L(en="Every commit of the project", fr="Tous les commits du projet", km="commit ទាំងអស់នៃគម្រោង")} ↗</a>')
    out.append('<div class="actions">' + "".join(acts) + "</div></div>")
    out.append('<div class="stats">')
    out.append(f'<div class="stat"><strong>{stats["versions"]}</strong>{L(en="Versions of the page", fr="Versions de la page", km="កំណែនៃទំព័រ")}</div>')
    out.append(f'<div class="stat"><strong>{stats["captures"]}</strong>{L(en="Captures published", fr="Captures publiées", km="រូបថតអេក្រង់ដែលបានផ្សាយ")}</div>')
    out.append(f'<div class="stat"><strong>{stats["kept"]}</strong>{L(en="No longer on the page, kept here", fr="Plus sur la page, gardées ici", km="លែងនៅលើទំព័រ រក្សាទុកនៅទីនេះ")}</div>')
    out.append(f'<div class="stat"><strong>{stats["videos"]}</strong>{L(en="Videos", fr="Vidéos", km="វីដេអូ")}</div>')
    out.append("</div>")
    note = entries_note(page)
    out.append(f'<section class="hist-note">{note}</section>')
    out.append(f'<section><div class="kicker">{L(en="Versions", fr="Versions", km="កំណែ")}</div>')
    out.append(f'<h2>{L(en="From the latest to the first.", fr="De la plus récente à la première.", km="ពីកំណែចុងក្រោយ ដល់កំណែដំបូង។")}</h2>')
    out.append('<ol class="timeline">')
    for i, e in enumerate(entries):
        out.append(f'<li class="ver{" now" if i == 0 else ""}" id="v-{e["hash"]}">')
        meta = f'<time datetime="{e["date"]}">{L(**{k: day(e["date"], k) for k in LANGS})}</time>'
        if i == 0:
            meta += f'<span class="ver-badge">{WORDS["latest"]}</span>'
        meta += f'<a class="ver-commit" href="{SITE_REPO}/commit/{e["full"]}" target="_blank" rel="noopener noreferrer">{e["hash"]} ↗</a>'
        out.append(f'<div class="ver-meta">{meta}</div>')
        t = e["text"]
        out.append("<h3>" + L(**{k: t[k][0] for k in LANGS}) + "</h3>")
        for k in LANGS:
            if t[k][1]:
                out.append(f'<p data-l="{k}">{t[k][1]}</p>')
        if e.get("auto"):
            out.append('<p class="ver-auto">' + L(en="Commit subject; no summary was written for this version.",
                                                    fr="Sujet du commit, en anglais ; aucun résumé n’a été écrit pour cette version.",
                                                    km="ប្រធានបទនៃ commit ជាភាសាអង់គ្លេស គ្មានសេចក្តីសង្ខេបសម្រាប់កំណែនេះទេ។") + "</p>")
        if e.get("retired"):
            out.append(retired_block(e["retired"]))
        media = e["media"]
        if media:
            ni = sum(1 for v in media if not v["video"])
            nv = sum(1 for v in media if v["video"])
            parts = []
            if ni:
                parts.append(plural(ni, ("capture", "captures"), ("capture", "captures"), "រូបថតអេក្រង់"))
            if nv:
                parts.append(plural(nv, ("video", "videos"), ("vidéo", "vidéos"), "វីដេអូ"))
            out.append(f'<div class="ver-media-head">{" · ".join(parts)}</div>')
            out.append('<div class="hgallery">' + "".join(figure(v) for v in media) + "</div>")
        out.append("</li>")
    out.append("</ol></section>")
    prev, nxt = prev_next
    out.append('<nav class="pager">')
    for p, label in ((prev, L(en="Previous history", fr="Historique précédent", km="ប្រវត្តិមុន")), (nxt, L(en="Next history", fr="Historique suivant", km="ប្រវត្តិបន្ទាប់"))):
        arrow_l, arrow_r = ("← ", "") if p is prev else ("", " →")
        out.append(f'<a href="{p["slug"]}.html"><small>{arrow_l}{label}{arrow_r}</small><b>{p["h1"]}</b></a>')
    out.append("</nav>")
    out.append(FOOT.format(back=back, back_label=back_label))
    return "\n".join(out), stats


DATA = {}


def entries_note(page):
    base = L(
        en="Nothing on this page has been regenerated: every capture and video is the file the site published at the time, recovered from its Git history. What the site never published is not here. Since 21 November 2026, every change to the project page adds a version here, and the captures, videos and Last changes it replaces are kept.",
        fr="Rien sur cette page n’a été régénéré : chaque capture et chaque vidéo est le fichier que le site publiait à l’époque, retrouvé dans son historique Git. Ce que le site n’a jamais publié n’y figure pas. Depuis le 21 novembre 2026, chaque changement de la page du projet ajoute ici une version, et les captures, vidéos et derniers changements qu’il remplace sont conservés.",
        km="គ្មានអ្វីនៅលើទំព័រនេះត្រូវបានបង្កើតឡើងវិញទេ៖ រូបថតអេក្រង់ និងវីដេអូនីមួយៗ គឺជាឯកសារដែលគេហទំព័របានផ្សាយនៅពេលនោះ ដែលបានយកមកវិញពីប្រវត្តិ Git របស់វា។ អ្វីដែលគេហទំព័រមិនដែលផ្សាយ មិនមាននៅទីនេះទេ។ តាំងពីថ្ងៃទី 21 ខែវិច្ឆិកា ឆ្នាំ 2026 ការផ្លាស់ប្តូរនីមួយៗនៃទំព័រគម្រោង បន្ថែមកំណែមួយនៅទីនេះ ហើយរូបថតអេក្រង់ វីដេអូ និងការផ្លាស់ប្តូរចុងក្រោយ ដែលវាជំនួស ត្រូវបានរក្សាទុក។")
    extra = DATA["pages"].get(page["slug"], {}).get("note")
    return f"<p>{base}</p>" + (f"<p>{L(**extra)}</p>" if extra else "")


def text_for(slug, c):
    pages = DATA["pages"].get(slug, {})
    key = DATA["aliases"].get(c["hash"], c["hash"])
    for src in (pages.get(c["hash"]), pages.get(key), DATA["common"].get(key)):
        if src:
            return {k: src[k] for k in LANGS}, False
    return {k: [esc(c["subject"]), ""] for k in LANGS}, True


def main():
    global DATA
    if git("rev-parse", "--is-shallow-repository").strip() == "true":
        sys.exit("This clone is shallow: fetch the full history first (git fetch --unshallow).")
    DATA = json.load(open(os.path.join(ROOT, "tools", "history", "entries.json"), encoding="utf-8"))
    head_blobs = {}
    for line in git("ls-tree", "-r", "HEAD").splitlines():
        meta, path = line.split("\t")
        head_blobs[path] = meta.split()[2]
    pages = followed_pages()
    index_now = page_order(pages)
    os.makedirs(os.path.join(ROOT, "history"), exist_ok=True)
    summary = []
    for i, page in enumerate(pages):
        commits, versions = history_of(page, head_blobs, index_now)
        for v in versions:
            materialise(v)
            if not v["video"]:
                with open(os.path.join(ROOT, v["src"]), "rb") as f:
                    v["size"] = image_size(f.read(65536))
        entries = []
        for c in reversed(commits):
            media = [v for v in versions if v["commit"] is c and not v["is_poster"]]
            text, auto = text_for(page["slug"], c)
            if auto and not media:
                continue  # a change to the page's frame only (logo, links, site name): not a version of the project
            retired = DATA["pages"].get(page["slug"], {}).get("retired", {}).get(c["hash"])
            entries.append({**c, "text": text, "auto": auto, "media": media, "retired": retired})
        prev_next = (pages[i - 1], pages[(i + 1) % len(pages)])
        doc, stats = build_page(page, entries, versions, prev_next)
        with open(os.path.join(ROOT, "history", page["slug"] + ".html"), "w", encoding="utf-8") as f:
            f.write(doc)
        summary.append((page, stats, entries[0]["date"] if entries else None))
        print(f'{page["slug"]:12} {stats["versions"]:2} versions, {stats["captures"]:3} captures, {stats["kept"]:2} kept, {stats["videos"]} videos')
    write_index(summary)


def write_index(summary):
    out = [HEAD.format(desc="Version history of every followed project page on Chantrea Systems.",
                       t_en="Version history — Chantrea Systems", t_fr="Historique des versions — Chantrea Systems",
                       t_km="ប្រវត្តិកំណែ — Chantrea Systems", back="../#changes",
                       back_label=L(en="Home", fr="Accueil", km="ទំព័រដើម"))]
    out.append('<div class="hero">')
    out.append(f'<div class="kicker">{WORDS["kicker"]}</div>')
    out.append(f'<h1>{L(en="Every version, kept.", fr="Chaque version, gardée.", km="គ្រប់កំណែ ត្រូវបានរក្សាទុក។")}</h1>')
    out.append('<p class="lead" data-l="en">Each followed project has a history page: every version of its page, with the captures and videos it showed at the time, including those replaced since.</p>')
    out.append('<p class="lead" data-l="fr">Chaque projet suivi a sa page d’historique : toutes les versions de sa page, avec les captures et vidéos qu’elle montrait à l’époque, y compris celles remplacées depuis.</p>')
    out.append('<p class="lead" data-l="km">គម្រោងនីមួយៗដែលត្រូវបានតាមដាន មានទំព័រប្រវត្តិ៖ គ្រប់កំណែនៃទំព័ររបស់វា ជាមួយរូបថតអេក្រង់ និងវីដេអូដែលវាបានបង្ហាញនៅពេលនោះ រួមទាំងអ្វីដែលត្រូវបានជំនួសតាំងពីពេលនោះមក។</p>')
    out.append("</div>")
    groups = [("dev", L(en="In development", fr="En développement", km="កំពុងអភិវឌ្ឍ")),
              ("games", L(en="Games", fr="Jeux", km="ហ្គេម")),
              ("projects", L(en="Projects", fr="Projets", km="គម្រោង"))]
    for key, title in groups:
        rows = [s for s in summary if (s[0]["dev"] if key == "dev" else (not s[0]["dev"] and s[0]["kind"] == key))]
        if not rows:
            continue
        out.append(f'<section><div class="kicker">{title}</div><div class="table-wrap"><table class="hist-index">')
        out.append("<tr><th>" + L(en="Page", fr="Page", km="ទំព័រ") + "</th><th>" + L(en="Versions", fr="Versions", km="កំណែ") +
                   "</th><th>" + L(en="Captures", fr="Captures", km="រូបថតអេក្រង់") + "</th><th>" + L(en="Kept", fr="Gardées", km="រក្សាទុក") +
                   "</th><th>" + L(en="Videos", fr="Vidéos", km="វីដេអូ") + "</th><th>" + L(en="Last version", fr="Dernière version", km="កំណែចុងក្រោយ") + "</th></tr>")
        for page, stats, last in rows:
            when = L(**{k: day(last, k) for k in LANGS}) if last else "—"
            out.append(f'<tr><td><a href="{page["slug"]}.html">{page["h1"]}</a></td><td>{stats["versions"]}</td><td>{stats["captures"]}</td><td>{stats["kept"]}</td><td>{stats["videos"]}</td><td>{when}</td></tr>')
        out.append("</table></div></section>")
    out.append(FOOT.format(back="../#changes", back_label=L(en="Home", fr="Accueil", km="ទំព័រដើម")))
    with open(os.path.join(ROOT, "history", "index.html"), "w", encoding="utf-8") as f:
        f.write("\n".join(out))


if __name__ == "__main__":
    main()
