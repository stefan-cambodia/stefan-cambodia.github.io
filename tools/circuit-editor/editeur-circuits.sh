#!/bin/sh
# Opens the circuit editor of this folder as an application of the computer: a
# window of its own (the app mode of Chrome or Chromium), or else a tab of the
# default browser. Nothing is installed and no server is started: the page is
# read from this folder (file://), and it talks to the map services by itself.
#
#   editeur-circuits.sh              open the editor
#   editeur-circuits.sh --install    add « Éditeur de circuits » to the applications menu
#   editeur-circuits.sh --uninstall  take it out of the menu
#
# The menu entry holds the path of this folder: run --install again if it moves.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
PAGE="$HERE/index.html"
DATA=${XDG_DATA_HOME:-$HOME/.local/share}
ENTRY="$DATA/applications/editeur-circuits.desktop"
ICON="$DATA/icons/hicolor/scalable/apps/editeur-circuits.svg"

case "${1:-}" in
--install)
	mkdir -p "$(dirname "$ENTRY")" "$(dirname "$ICON")"
	# The page's own icon (the favicon of index.html).
	cat > "$ICON" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#0b7285"/><path d="M8 22c0-9 3-13 8-13s8 3 8 7-3 6-6 6-4-2-4-4" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="8" cy="23" r="3" fill="#fcc419"/></svg>
SVG
	cat > "$ENTRY" <<EOF
[Desktop Entry]
Type=Application
Name=Éditeur de circuits
GenericName=Circuits pour 3D Buggy et Cambodia Rally
Comment=Dessiner un circuit sur les routes d'OpenStreetMap et l'envoyer aux jeux
Exec="$HERE/editeur-circuits.sh"
Icon=editeur-circuits
Terminal=false
Categories=Game;Utility;
EOF
	command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$(dirname "$ENTRY")" >/dev/null 2>&1 || true
	echo "« Éditeur de circuits » est dans le menu des applications ($ENTRY)."
	exit 0 ;;
--uninstall)
	rm -f "$ENTRY" "$ICON"
	echo "« Éditeur de circuits » n'est plus dans le menu des applications."
	exit 0 ;;
"") ;;
*)
	echo "usage : editeur-circuits.sh [--install | --uninstall]" >&2
	exit 2 ;;
esac

if [ ! -f "$PAGE" ]; then
	echo "index.html manque à côté de ce script ($HERE)." >&2
	exit 1
fi
# A file:// address, with what a path may hold (spaces, accents) escaped.
if command -v python3 >/dev/null 2>&1; then
	URL=$(python3 -I -c 'import pathlib, sys; print(pathlib.Path(sys.argv[1]).as_uri())' "$PAGE")
else
	URL="file://$PAGE"
fi
for browser in google-chrome-stable google-chrome chromium chromium-browser; do
	if command -v "$browser" >/dev/null 2>&1; then
		exec "$browser" --app="$URL" --window-size=1500,950 >/dev/null 2>&1
	fi
done
if command -v xdg-open >/dev/null 2>&1; then
	exec xdg-open "$URL"
fi
echo "Aucun navigateur trouvé : ouvrez $URL dans un navigateur d'ordinateur." >&2
exit 1
