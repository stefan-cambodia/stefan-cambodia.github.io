# Éditeur de circuits

Un outil pour dessiner un circuit sur les routes d'OpenStreetMap et l'envoyer à
**3D Buggy / Dustline Rally** et à **Cambodia Rally**. On clique des points de passage,
le tracé suit les routes entre eux, et l'éditeur écrit un fichier `.cambotrack.json`
que les deux jeux savent lire (format : [`FORMAT.md`](FORMAT.md), schéma :
[`cambotrack.schema.json`](cambotrack.schema.json)).

> **Où en sont les jeux (27 novembre 2026).** Seul 3D Buggy lit les circuits : l'écran
> « Circuits perso » est dans sa branche `main`. Cambodia Rally garde le sien sur une
> branche non fusionnée, par décision de Stefan (pas maintenant, peut-être jamais). Le
> format reste commun aux deux jeux, et la case « Cambodia Rally » des réglages n'écrit
> que le champ `games` du fichier.

L'outil tient dans **un seul fichier**, [`index.html`](index.html) : pas de framework,
pas d'étape de compilation. Il est prévu pour un **navigateur d'ordinateur** (souris,
clavier, grand écran).

- En ligne, une fois publié : `https://stefan-cambodia.github.io/tools/circuit-editor/`
- Comme un programme de l'ordinateur : `tools/circuit-editor/editeur-circuits.sh --install`
  l'installe pour l'utilisateur. Il copie la page dans `~/.local/share/editeur-circuits/`,
  crée la commande `editeur-circuits` (`~/.local/bin/editeur-circuits`) et l'entrée
  « Éditeur de circuits » du menu des applications. La commande ouvre l'éditeur dans une
  fenêtre à lui (le mode application de Chrome ou de Chromium, sinon un onglet du navigateur
  par défaut). La copie installée ne dépend plus du dépôt : relancer `--install` depuis un
  dossier plus récent la met à jour, `--where` dit d'où elle vient, `--uninstall` retire
  tout. Sans installation, `editeur-circuits.sh` ouvre la page du dossier où il se trouve.
- À la main : ouvrir `index.html` dans un navigateur (`file://`), ou `python3 -m http.server`
  à la racine du dépôt puis `http://localhost:8000/tools/circuit-editor/`.

## En trois étapes

### 1. Tracer

1. Cadrer la carte sur la zone voulue : la recherche (taper un lieu, puis **Entrée**),
   le bouton « Lieux » (Angkor, Siem Reap, Kampot, Bokor, Kep, Phnom Penh) ou la souris.
2. « **Charger les routes de la zone** » : les routes de la vue apparaissent en surimpression.
   Chaque chargement s'ajoute aux précédents ; un cadre en pointillé montre ce qui est déjà
   chargé. Au-delà d'environ 1 500 km², l'éditeur demande de zoomer.
3. Outil « **Ajouter** » : un clic sur une route pose un point de passage, recalé sur la
   route la plus proche (à moins de 20 pixels). Entre deux points, le tracé prend le plus
   court chemin par les routes. Pour l'obliger à passer ailleurs, ajouter un point.
4. Corriger :
   - **déplacer** un point en le faisant glisser (il se recale) ;
   - **insérer** un point : outil « Modifier », puis un clic sur le tracé ;
   - **supprimer** un point : clic droit dessus (ou un clic, puis « Supprimer ce point ») ;
   - **annuler / rétablir** : Ctrl+Z / Ctrl+Y, ou les flèches sous la carte ;
   - **inverser** le sens, **tout effacer** : les deux derniers boutons.
5. Onglet « Tracé » : **Boucle** ou **Spéciale** (d'un point A à un point B), et
   « Autoriser les pistes ». On y lit la longueur réelle, la longueur de jeu, le temps
   estimé (17,75 m de jeu par seconde, la vitesse de référence des jeux), le nombre de
   checkpoints et de portes bonus, et les avertissements :
   - la même route empruntée deux fois ;
   - le tracé qui se croise ;
   - une épingle de moins de 8 m de rayon (en mètres de jeu, après lissage) ;
   - moins de 1,5 km ou plus de 40 km de jeu.

   Un tronçon sans chemin est dessiné en **pointillé rouge**, avec la raison : routes non
   chargées entre les deux points, ou classe de route non autorisée.
6. Onglet « Réglages » : nom, identifiant (le nom du fichier publié), auteur, jeux visés,
   tours, échelle (2,5 par défaut), largeur, espacement des points, checkpoints, portes
   bonus, rayon de lissage.
7. Onglet « Relief » : relief réel ou circuit plat, échelle verticale, profil d'altitude et
   dénivelé positif.

### 2. Envoyer

Onglet « Envoi » :

- « **Envoyer au jeu** » écrit `tracks/<identifiant>.cambotrack.json` sur la branche `main`
  du site, puis met à jour le catalogue `tracks/index.json`. Il faut un jeton GitHub
  ([voir plus bas](#jeton-github)). L'éditeur affiche ensuite les adresses du circuit et du
  catalogue.
- « **Télécharger** » enregistre le fichier, « **Copier** » le met dans le presse-papiers.
- « **Ouvrir…** » recharge un fichier `.cambotrack.json` pour le modifier : son tracé est
  redessiné à partir de ses points, les routes de sa zone sont chargées, et le parcours est
  recalculé depuis ses points de passage. Si la carte n'a pas changé entre-temps, le circuit
  ressort identique, hash compris.

Renvoyer un circuit avec le même identifiant **remplace** le précédent.

### 3. Jouer

Dans le jeu : « **Circuits perso → Actualiser** ». Le nouveau circuit peut mettre quelques
minutes à apparaître ([Publication](#publication)).

## Jeton GitHub

« Envoyer au jeu » écrit dans le dépôt du site au nom de la personne qui tient le jeton. Il
faut un jeton à **accès fin**, limité à ce seul dépôt :

1. Sur GitHub : *Settings → Developer settings → Personal access tokens → Fine-grained
   tokens → Generate new token*.
2. *Resource owner* : `stefan-cambodia`. Donner un nom et une date d'expiration.
3. *Repository access* : « Only select repositories », et seulement
   `stefan-cambodia/stefan-cambodia.github.io`.
4. *Permissions → Repository permissions → Contents* : « **Read and write** ». Rien d'autre
   (GitHub ajoute de lui-même « Metadata : Read-only »).
5. *Generate token*, copier le jeton (il commence par `github_pat_`) et le coller dans
   l'onglet « Envoi » de l'éditeur.

Ce que l'éditeur fait du jeton :

- il ne part que vers `api.github.com`, dans l'en-tête `Authorization` ;
- il n'est **jamais** écrit dans un circuit, dans le catalogue ni dans un fichier ;
- il n'est gardé d'une visite à l'autre que si la case « Mémoriser le jeton sur cet
  appareil » est cochée (dans le `localStorage` du navigateur) ; la décocher l'efface
  aussitôt.

Un jeton perdu ou montré par erreur se révoque sur la même page de GitHub. Le dépôt et la
branche visés sont des constantes en tête du script d'interface de `index.html`
(`GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BRANCH`, `TRACKS_DIR`).

## Ce que contient le fichier

Le format et toutes ses règles sont dans [`FORMAT.md`](FORMAT.md). Voici les choix de
l'éditeur là où le format laisse la main.

| Sujet | Choix |
|---|---|
| Routes chargées | `way[highway]`, sans `footway`, `steps`, `pedestrian`, `construction`, `proposed`, `abandoned`, ni les surfaces (`area=yes`). |
| Classes du routage | `trunk`, `primary`, `secondary`, `tertiary`, leurs `_link`, `unclassified`, `residential`, et `track` si « Autoriser les pistes » est coché. La liste est écrite dans `allowed_classes`. |
| Routage | Le plus court chemin (Dijkstra), sans préférence de classe ; les sens uniques sont ignorés. |
| Projection | Plan tangent local centré sur le départ, calculé par les coordonnées ECEF de WGS84 (et son inverse pour « Ouvrir »). |
| Lissage | Moyenne glissante sur le tracé rééchantillonné tous les mètres réels ; le rayon est en mètres de jeu (15 par défaut : un angle droit donne un virage d'environ 10 m de rayon). Extrémités fixes pour une spéciale, fenêtre circulaire pour une boucle. |
| Points | Un point tous les `spacing` mètres de jeu le long de la courbe ; la boucle est divisée en pas égaux, fermeture comprise. Au-delà de 20 000 points, l'espacement est relevé et l'éditeur le dit. |
| Largeur | Largeur de base (11 m) ; 8 m sur les pistes si l'option est cochée ; sur un pont dont la carte donne la largeur, `clamp(1,4 × largeur, 6, largeur de base)`. La largeur varie d'au plus 25 cm par mètre de jeu. |
| Surface | `surface=` d'OSM ramené à la table `asphalt, concrete, paved, gravel, dirt, sand, unknown`. Sans indication : `asphalt` de `trunk` à `tertiary`, `dirt` pour une piste, `unknown` ailleurs. |
| Ouvrages | `bridge=*` donne le drapeau 1, `tunnel=*` le drapeau 2 (sauf valeur `no`). |
| Checkpoints | À intervalles égaux : un tous les 1 000 m de jeu jusqu'à 12 km, un tous les 2 000 m au-delà (ou la valeur saisie) ; jamais à moins de 150 m du départ ou de l'arrivée ; 200 au plus. |
| Portes bonus | Environ une par kilomètre, seulement là où la courbure reste sous 1/300 m⁻¹ sur 60 m de part et d'autre, à 600 m au moins de la précédente et à 150 m au moins d'un checkpoint, du départ et de l'arrivée. Case décochée : `"gates": []`. |
| Relief | Une altitude tous les 30 m réels environ, lissée sur 90 m, puis pentes limitées à 30 % (le format en tolère 60). `elevation: null` et tous les `y` à zéro si le relief est décoché. |
| Nombres du hash | `scale` et `vertical_scale` sont écrits arrondis au millième, `road_width` et `spacing` au centième, comme les points le sont au centimètre : aucune valeur du fichier n'est à cheval sur un arrondi du hash. |
| Demi-tours | Un aller-retour de moins de 30 m à un point de passage (point posé juste à côté d'un carrefour) est retiré de l'export, et signalé. |
| Champ `editor` | Les réglages propres à l'éditeur (lissage, options de largeur, checkpoints, portes) sont rangés dans un champ `editor`, pour « Ouvrir ». Les jeux l'ignorent, comme tout champ inconnu. |

Pour vérifier un fichier à la main :

```sh
node tools/circuit-editor/test/validate.mjs tracks/mon-circuit.cambotrack.json
```

## Services utilisés

L'éditeur n'a pas de serveur à lui. Il parle depuis le navigateur à des services publics,
chacun avec ses conditions.

| Service | Usage | Conditions |
|---|---|---|
| **OpenStreetMap** (données) | Les routes, donc tout circuit publié. | Licence [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Mention obligatoire : « © OpenStreetMap contributors ». Elle est affichée sur la carte et écrite dans le champ `attribution` de chaque circuit, que les jeux montrent à l'écran de chargement. Un circuit est une donnée dérivée d'OSM : il reste sous ODbL. |
| **Tuiles OSM** `tile.openstreetmap.org` | Fond « Plan ». | [Politique d'usage des tuiles](https://operations.osmfoundation.org/policies/tiles/) : usage interactif modéré, mention visible. |
| **Esri World Imagery** | Fond « Satellite ». | Conditions d'Esri ; mention affichée sur la carte. Sert à regarder, pas à tracer : les routes viennent d'OSM. |
| **OpenTopoMap** | Fond « Relief ». | Tuiles sous CC-BY-SA, mention affichée. |
| **Overpass API** | « Charger les routes de la zone ». | Service bénévole : une requête par clic, zone bornée à 1 500 km², jamais de requête automatique. Voir les serveurs plus bas. |
| **Nominatim** `nominatim.openstreetmap.org` | La recherche de lieu. | [Politique d'usage](https://operations.osmfoundation.org/policies/nominatim/) : une requête par seconde au plus, pas d'autocomplétion. L'éditeur ne cherche que sur **Entrée**, et jamais plus d'une fois par seconde. |
| **Open-Meteo** `api.open-meteo.com/v1/elevation` | Le relief (Copernicus DEM GLO-90). | Voir l'encadré. 100 coordonnées par requête au plus, et **600 altitudes par minute** pour une même connexion : chaque coordonnée compte pour un appel (en-têtes `x-ratelimit-*`, mesuré le 27 novembre 2026). L'éditeur envoie les requêtes l'une après l'autre, ne redemande jamais une altitude déjà reçue, et quand l'API répond 429 il attend le délai qu'elle indique (`retry-after`). |
| **cdnjs** | Leaflet 1.9.4. | Fichiers épinglés par leur empreinte SRI (ci-dessous). |
| **API GitHub** | « Envoyer au jeu ». | Seulement avec le jeton de l'utilisateur, seulement sur `tracks/` du dépôt du site. |

> **Open-Meteo est gratuit pour un usage non commercial.** Les deux jeux sont gratuits
> aujourd'hui. Si l'un d'eux devenait payant, ce point serait à revoir : offre commerciale
> d'Open-Meteo, ou une autre source de relief.

Le relief vient d'un modèle de **surface** à 90 m (Copernicus GLO-90), servi au mètre près :
la canopée et les bâtiments y font des bosses qui n'existent pas sur la route. À Angkor, le
Petit Circuit, plat en réalité, y gagne ainsi environ 270 m de dénivelé positif. L'éditeur
le dit dans l'onglet « Relief ».

### Serveurs Overpass

L'éditeur interroge les serveurs dans cet ordre et passe au suivant sur une erreur, un
refus (429, 502, 503, 504) ou une attente de plus de 25 s (75 s pour le dernier). Il
recommence ensuite par celui qui a répondu.

Vérifié le 26 novembre 2026, avec de vraies requêtes `way[highway]` sur Angkor
(`curl`, en-tête `Origin` pour lire les en-têtes CORS, puis depuis un navigateur) :

| Serveur | Résultat |
|---|---|
| `https://overpass-api.de/api/interpreter` (instance principale) | Répond 200 avec `access-control-allow-origin: *` et les bonnes données, mais lentement ce jour-là (57 s et 107 s) ; deux fois 502 « server at capacity » ; une fois sans réponse en 45 s depuis le navigateur. |
| `https://maps.mail.ru/osm/tools/overpass/api/interpreter` | 200 avec `access-control-allow-origin: *`, en 7 à 27 s ; un 504 isolé. C'est lui qui a servi le navigateur quand le premier tardait. |
| `https://overpass.openstreetmap.fr/api/interpreter` | 200 avec `access-control-allow-origin: *`, en 5 et 23 s. |

Les trois ont renvoyé les mêmes données. Écartés : `overpass.private.coffee` et
`overpass.kumi.systems` (aucune réponse en 40 s), `overpass.osm.ch` (ne couvre que la Suisse).

### Leaflet et ses empreintes SRI

```
https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js
  sha512-puJW3E/qXDqYp9IfhAI54BJEaWIfloJ7JWs7OeD5i6ruC9JZL1gERT1wjtwXFlh7CjE7ZJ+/vcRZRkIYIb6p4g==
https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css
  sha512-h9FcoyWjHcOcmEVkxOfTLnmZFWIH0iZhZT1H2TbOq55xssQGEJHEaIm+PgoUaZbRvQTNTluNOEfb1ZRy6D3BOw==
```

Elles ont été calculées sur les fichiers téléchargés
(`openssl dgst -sha512 -binary leaflet.min.js | openssl base64 -A`) et sont égales à celles
que publie cdnjs (`https://api.cdnjs.com/libraries/leaflet/1.9.4?fields=sri`). Le test de
bout en bout charge la page dans un navigateur, qui refuserait un fichier dont l'empreinte
ne correspond pas.

## Publication

« Envoyer au jeu » fait un commit sur `main`. Le fichier est alors lisible à deux adresses.

| | `raw.githubusercontent.com/stefan-cambodia/stefan-cambodia.github.io/main/tracks/…` | `stefan-cambodia.github.io/tracks/…` |
|---|---|---|
| Disponible | dès le commit | après la construction de GitHub Pages |
| `cache-control` | `max-age=300` | `max-age=600` |
| `access-control-allow-origin` | `*` | `*` |
| `ETag`, requête conditionnelle | oui : `If-None-Match` répond 304 | oui : `If-None-Match` répond 304 |

**Choix** : les jeux lisent d'abord
`https://raw.githubusercontent.com/stefan-cambodia/stefan-cambodia.github.io/main/tracks/index.json`,
et se rabattent sur `https://stefan-cambodia.github.io/tracks/index.json` si la première
adresse ne répond pas. Les circuits se lisent au même endroit que le catalogue qui les cite.
Raison : la première adresse n'attend pas la construction du site et son cache est deux
fois plus court.

**Une chaîne de requête ne contourne pas le cache.** Sur les deux hôtes, une adresse
suivie de `?cb=…` reçoit la même réponse en cache que l'adresse nue : même requête à
l'origine (`x-github-request-id` identique), `x-cache: HIT`, et sur Pages un `age` qui
continue de croître. Vérifié le 26 novembre 2026 sur des fichiers existants, cache froid,
dans les deux ordres. Les jeux n'ont donc rien à gagner à ajouter un paramètre : après un
envoi, il faut attendre que l'entrée du cache expire. Une réponse 404 (fichier pas encore
publié) est elle aussi servie depuis le cache.

**Mesuré pour une première publication** (27 novembre 2026) : le catalogue est arrivé sur
`main` à 05:13:21 UTC, et les deux adresses, qui répondaient 404 juste avant, l'ont montré
moins d'une minute après (vu au contrôle de 05:14:11, un contrôle toutes les 10 s),
construction de GitHub Pages comprise.

**Reste à mesurer : la mise à jour d'un catalogue déjà publié**, le cas de chaque « Envoyer
au jeu » à partir de maintenant. Le cache peut y retenir l'ancienne version : d'après les
en-têtes, au plus 5 minutes sur la première adresse et 10 minutes plus la construction sur
la seconde. Pour mesurer, au prochain envoi :

```sh
# À lancer AVANT l'envoi : le script garde les caches chauds, comme un téléphone
# qui viendrait de lire le catalogue. --expect-substring : le hash du circuit envoyé.
node tools/circuit-editor/measure-publish-delay.mjs tracks/index.json --expect-substring=<hash>

# Ce que chaque hôte met en cache aujourd'hui, et la preuve pour « ?cb= » :
node tools/circuit-editor/measure-publish-delay.mjs tracks/index.json --once
```

Le script interroge les deux adresses, avec et sans `?cb=`, et affiche quand chacune montre
le nouveau contenu. `--since=<date ISO de l'envoi>` compte les délais depuis l'envoi plutôt
que depuis le lancement.

## Tests

```sh
node --test tools/circuit-editor/test/                 # 76 tests, sans dépendance (essayé avec Node 26)
python3 tools/circuit-editor/test/e2e_playwright.py    # un navigateur, réseau simulé
node tools/circuit-editor/test/make-fixtures.mjs       # réécrit les fichiers d'exemple
```

Les fonctions de calcul (graphe, routage, rééchantillonnage, relief, export, hash) sont
dans le bloc `core` de `index.html` : du code pur, sans DOM ni réseau. Les tests Node
extraient ce bloc et l'évaluent dans un contexte `node:vm` vide.

| Fichier | Ce qu'il vérifie |
|---|---|
| `hash.test.mjs` | Le SHA-256 en JavaScript pur contre `node:crypto`, la forme canonique écrite à la main sur un petit circuit, ce que le hash couvre ou non. |
| `geodesy.test.mjs` | WGS84, ECEF, le plan tangent et son inverse. |
| `graph.test.mjs` | La lecture d'Overpass, la fusion par identifiant OSM, les classes exclues, l'index en grille contre un parcours complet, Dijkstra contre une version naïve, les longueurs partielles, deux points sur le même segment, les classes interdites, le cache des tronçons. |
| `export.test.mjs` | La fermeture de la boucle, la régularité de l'espacement, les longueurs, le schéma, les règles du format (indices croissants et bornés, écarts, pentes, point 0 à l'origine), largeurs et surfaces, checkpoints, portes, relief, limite de 20 000 points, avertissements, réouverture à hash identique, catalogue. |
| `petit-circuit.test.mjs` | **Recette** : les points de passage du Petit Circuit des jeux, recalés et routés sur la carte d'aujourd'hui, donnent 7 089 m de jeu pour un tour à l'échelle 2,5, soit −0,15 % par rapport aux 7,1 km du circuit existant (tolérance : 3 %). Aucun point n'a dû être déplacé ; le plus éloigné de sa route en est à 50 m. |
| `property.test.mjs` | 160 parcours tirés au hasard sur les routes d'Angkor, avec des réglages et un relief au hasard (tirage à graine fixe) : tout fichier que le code accepte d'exporter respecte le schéma et les règles. |
| `fixtures.test.mjs` | Les fichiers d'exemple sont bien ceux que le code produit, le validateur de schéma refuse ce qu'il doit, la page n'appelle que Leaflet avec les bonnes empreintes, aucun jeton dans le dossier. |
| `e2e_playwright.py` | Dans un navigateur : charger les routes (avec un serveur Overpass en panne), poser quatre points, annuler, insérer, supprimer, déplacer, télécharger et valider le fichier, l'envoyer à une API GitHub simulée (avec un conflit sur le catalogue), le rouvrir. |

Dans `test/fixtures/` :

- `angkor-wat.overpass.json`, `angkor-petit-circuit.overpass.json.gz` : de vraies réponses
  d'Overpass, enregistrées le 26 novembre 2026 ;
- `open-meteo-sample-stage.json` : les vraies altitudes de la spéciale d'exemple ;
- `sample-loop.cambotrack.json`, `sample-stage.cambotrack.json` : deux circuits exportés par
  le code (une boucle plate à l'échelle 1,25 avec une piste, une spéciale avec relief), pour
  recouper le hash côté jeu ;
- `hash-vector.cambotrack.json` et `hash-vector.canonical.txt` : un circuit de douze points,
  accepté par les jeux, et son texte canonique, vérifiables à la main.

Le test de bout en bout essaie WebKit, puis le Chrome de la machine, puis le Chromium de
Playwright, et dit lequel a tourné. Leaflet y est chargé pour de bon depuis cdnjs ; tout le
reste du réseau est simulé.

## Limites connues

- **Navigateur d'ordinateur.** L'outil est conçu pour la souris et un grand écran.
- **Rien n'est enregistré en cours de route.** Recharger la page perd le tracé (le
  navigateur demande confirmation). Un circuit téléchargé ou envoyé se rouvre avec « Ouvrir… ».
- **Le routage ne connaît que la longueur.** Ni sens uniques, ni accès privés
  (`access=no`), ni préférence pour les grandes routes : au besoin, ajouter des points.
- **La carte change.** Un circuit rouvert plus tard peut suivre un autre chemin si OSM a
  été modifié ; un point qui ne retrouve pas de route à moins de 40 m est signalé en rouge.
- **Relief de surface** : bosses dues aux arbres et aux bâtiments, pas de prise en compte
  des ponts et des tunnels. Le lissage et la limite de pente les atténuent sans les enlever.
- **Les virages très serrés restent serrés.** Une moyenne glissante arrondit un angle droit,
  pas une épingle à 150° : l'avertissement « épingle » est là pour cela. Un demi-tour sur
  place (un aller-retour de plus de 30 m sur la même route) donne un rebroussement que
  l'éditeur signale, et qu'il refuse d'exporter quand deux points se retrouvent à moins de
  50 cm l'un de l'autre.
- **Le relief d'un long circuit se fait attendre.** L'éditeur demande une altitude tous les
  30 m réels et Open-Meteo en donne 600 par minute : jusqu'à 18 km de vraies routes
  (7,2 km de jeu à l'échelle 2,5), le relief arrive en quelques secondes ; au-delà, il faut
  compter une minute par tranche de 18 km, soit cinq minutes pour 100 km réels. L'onglet
  « Relief » annonce l'attente et le temps restant. Les altitudes déjà reçues sont gardées
  tant que la page reste ouverte : retoucher le tracé ne redemande que le terrain nouveau.
- **Overpass peut être lent ou saturé** ; l'éditeur change de serveur et le dit, mais ne
  peut pas faire mieux.
- **L'envoi à GitHub n'a été essayé que contre une API simulée**, faute de jeton pendant le
  développement (les en-têtes CORS et la forme des réponses ont été contrôlés sur l'API
  réelle, sans authentification). Le premier envoi réel est à surveiller.
- **Le délai d'une mise à jour du catalogue n'est pas mesuré** ; celui d'une première
  publication l'est (section Publication).
- **Pas de suppression** : retirer un circuit publié se fait à la main, dans le dépôt
  (son fichier et sa ligne de `tracks/index.json`).
- La largeur indiquée par la carte n'est utilisée que pour les ponts.
