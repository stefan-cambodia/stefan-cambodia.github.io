#!/bin/sh
# The circuit editor as a program of the computer. It opens the page that sits
# next to this script in a window of its own (the app mode of Chrome or
# Chromium), or else in a tab of the default browser. No server is started: the
# page is read from the disk (file://) and talks to the map services by itself.
#
#   editeur-circuits.sh              open the editor
#   editeur-circuits.sh --install    install it for this user: a copy of the page,
#                                    the command `editeur-circuits` and an entry
#                                    « Éditeur de circuits » in the applications menu
#   editeur-circuits.sh --uninstall  take all of that away
#   editeur-circuits.sh --where      say what is installed, and where
#
# The installed copy stands on its own: the folder it came from can move, change
# branch or go. Run --install again from a newer folder to bring it up to date.
set -eu
SELF=$(readlink -f "$0")
HERE=$(dirname "$SELF")
PAGE="$HERE/index.html"
DATA=${XDG_DATA_HOME:-$HOME/.local/share}
APP="$DATA/editeur-circuits"
BIN="$HOME/.local/bin/editeur-circuits"
ENTRY="$DATA/applications/editeur-circuits.desktop"
ICON="$DATA/icons/hicolor/scalable/apps/editeur-circuits.svg"

case "${1:-}" in
--install)
	if [ ! -f "$PAGE" ]; then
		echo "index.html manque à côté de ce script ($HERE)." >&2
		exit 1
	fi
	mkdir -p "$APP" "$(dirname "$BIN")" "$(dirname "$ENTRY")" "$(dirname "$ICON")"
	if [ "$HERE" != "$APP" ]; then
		cp "$PAGE" "$APP/index.html"
		cp "$SELF" "$APP/editeur-circuits.sh"
		chmod +x "$APP/editeur-circuits.sh"
		# Where this copy comes from, for whoever wonders which version runs.
		{
			echo "Copié depuis : $HERE"
			echo "Le : $(date '+%Y-%m-%d %H:%M')"
			if command -v git >/dev/null 2>&1 && git -C "$HERE" rev-parse --git-dir >/dev/null 2>&1; then
				echo "Commit : $(git -C "$HERE" log -1 --format='%h %s' 2>/dev/null)"
				[ -z "$(git -C "$HERE" status --porcelain -- . 2>/dev/null)" ] || echo "Avec des modifications non commitées."
			fi
		} > "$APP/ORIGINE.txt"
	fi
	ln -sf "$APP/editeur-circuits.sh" "$BIN"
	# The page's own icon (the favicon of index.html).
	cat > "$ICON" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#0b7285"/><path d="M8 22c0-9 3-13 8-13s8 3 8 7-3 6-6 6-4-2-4-4" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="8" cy="23" r="3" fill="#fcc419"/></svg>
SVG
	cat > "$ENTRY" <<EOF
[Desktop Entry]
Type=Application
Name=Éditeur de circuits
GenericName=Circuits pour 3D Buggy
Comment=Dessiner un circuit sur les routes d'OpenStreetMap et l'envoyer au jeu
Exec="$APP/editeur-circuits.sh"
Icon=editeur-circuits
Terminal=false
Categories=Game;
EOF
	command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$(dirname "$ENTRY")" >/dev/null 2>&1 || true
	echo "Éditeur de circuits installé."
	echo "  Programme : $BIN"
	echo "  Page      : $APP/index.html"
	echo "  Menu      : « Éditeur de circuits »"
	case ":$PATH:" in
	*":$(dirname "$BIN"):"*) echo "  Dans un terminal : editeur-circuits" ;;
	*) echo "  $(dirname "$BIN") n'est pas dans le PATH : lancez-le par son chemin complet." ;;
	esac
	exit 0 ;;
--uninstall)
	# Only what --install put there.
	if [ -L "$BIN" ] && [ "$(readlink "$BIN")" = "$APP/editeur-circuits.sh" ]; then rm -f "$BIN"; fi
	rm -f "$ENTRY" "$ICON" "$APP/index.html" "$APP/ORIGINE.txt"
	if [ "$HERE" = "$APP" ]; then rm -f "$SELF"; else rm -f "$APP/editeur-circuits.sh"; fi
	rmdir "$APP" 2>/dev/null || true
	echo "Éditeur de circuits désinstallé (les tracés gardés par le navigateur ne sont pas touchés)."
	exit 0 ;;
--where)
	if [ -f "$APP/index.html" ]; then
		echo "Programme : $BIN"
		echo "Page      : $APP/index.html"
		[ ! -f "$APP/ORIGINE.txt" ] || sed 's/^/  /' "$APP/ORIGINE.txt"
	else
		echo "Pas installé. Cette copie : $SELF"
	fi
	exit 0 ;;
"") ;;
*)
	echo "usage : editeur-circuits [--install | --uninstall | --where]" >&2
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
