# Format `.cambotrack.json`, version 1

Contrat entre l'éditeur de circuits (`tools/circuit-editor/index.html`) et les jeux
(3D Buggy / Dustline Rally et Cambodia Rally, module `res://custom_tracks/`).
Le schéma JSON de référence est `cambotrack.schema.json`, dans ce dossier.

Un fichier décrit **un** circuit : une ligne centrale déjà exprimée en mètres de jeu
(l'échelle est appliquée par l'éditeur), avec la largeur, la surface et les ouvrages
de chaque point, plus les règles de course (checkpoints, portes, tours). Les jeux ne
contiennent aucun code géographique : ils ne lisent ni `origin`, ni `waypoints`.

## Exemple

```jsonc
{
  "format": "cambotrack",
  "version": 1,
  "id": "angkor-petit-circuit",
  "hash": "9f2c…64 caractères hexadécimaux",
  "name": "Petit Circuit perso",
  "author": "",
  "created": "2026-11-26T14:00:00Z",
  "games": ["3d_buggy", "cambodia_rally"],
  "kind": "loop",
  "laps": 3,
  "scale": 2.5,
  "vertical_scale": 2.5,
  "road_width": 11.0,
  "spacing": 4.0,
  "origin": { "lat": 13.41, "lon": 103.86, "ele": 18.0 },
  "length_real_m": 17750,
  "length_game_m": 7100,
  "elevation": { "source": "copernicus-glo90/open-meteo", "min": 12, "max": 31, "climb_m": 40 },
  "surfaces": ["asphalt", "concrete", "paved", "gravel", "dirt", "sand", "unknown"],
  "points": [[0.0, 0.0, 0.0, 11.0, 0, 0], [0.12, 0.0, -4.0, 11.0, 0, 0]],
  "checkpoints": [180, 410, 655],
  "gates": [120, 300],
  "waypoints": [[13.41, 103.86]],
  "allowed_classes": ["primary", "secondary", "tertiary", "unclassified", "residential", "track"],
  "attribution": "© OpenStreetMap contributors (ODbL 1.0) ; relief : Copernicus DEM GLO-90 via Open-Meteo"
}
```

## Champs

| Champ | Type | Obligatoire | Rôle |
|---|---|---|---|
| `format` | `"cambotrack"` | oui | Identifie le fichier. |
| `version` | entier | oui | Version majeure du format : `1`. Un jeu refuse toute valeur supérieure à celle qu'il connaît. |
| `id` | chaîne `[a-z0-9-]`, 1 à 64 caractères, sans tiret au début ni à la fin | oui | Identifiant stable : nom du fichier (`<id>.cambotrack.json`) et clé du catalogue. |
| `hash` | 64 caractères hexadécimaux minuscules | oui | SHA-256 de la forme canonique (voir plus bas). Identité du circuit en multijoueur, clé du cache. |
| `name` | chaîne, 1 à 80 caractères | oui | Nom affiché. |
| `author` | chaîne, 0 à 60 caractères | non | Auteur affiché. |
| `created` | date ISO 8601 UTC | non | Date de création ou de dernière publication. |
| `games` | tableau de `"3d_buggy"` / `"cambodia_rally"` | non | Jeux visés. Absent ou vide : les deux. |
| `kind` | `"loop"` ou `"stage"` | oui | Boucle fermée, ou spéciale d'un point A à un point B. |
| `laps` | entier de 1 à 20 | boucle seulement | Nombre de tours. Absent : 1. Une spéciale n'en a pas, ou `1` : les jeux refusent toute autre valeur sur une spéciale. |
| `scale` | nombre de 1 à 10, 3 décimales au plus | oui | Mètres réels par mètre de jeu, à l'horizontale. |
| `vertical_scale` | nombre de 0,5 à 50, 3 décimales au plus | oui | Mètres réels par mètre de jeu, à la verticale. Égal à `scale`, il conserve les pentes réelles. |
| `road_width` | nombre de 3 à 30, 2 décimales au plus | oui | Largeur de base, en mètres de jeu. |
| `spacing` | nombre de 1 à 20, 2 décimales au plus | oui | Distance visée entre deux points, en mètres de jeu. |
| `origin` | `{lat, lon, ele}` | non | Point de départ sur la Terre (WGS84, altitude en mètres) : il vaut `(0, 0, 0)` dans le jeu. Sert à rouvrir le circuit dans l'éditeur. |
| `length_real_m`, `length_game_m` | nombres | non | Longueur d'un tour (boucle) ou de la spéciale. Informatif. |
| `elevation` | `{source, min, max, climb_m}` ou `null` | non | Origine du relief, altitudes réelles extrêmes, dénivelé positif réel. `null` : circuit plat. |
| `surfaces` | tableau de 1 à 32 noms | oui | Table des surfaces ; les points y renvoient par indice. |
| `points` | tableau de 8 à 20 000 points | oui | La ligne centrale. Voir plus bas. |
| `checkpoints` | tableau d'indices de points | oui (peut être vide) | Checkpoints, dans l'ordre de la course. |
| `gates` | tableau d'indices de points | non | Portes bonus. Absent : le jeu en place lui-même. Vide : aucune. Les deux cas n'ont pas le même hash. |
| `waypoints` | tableau de `[lat, lon]` | non | Clics de l'éditeur, pour reprendre l'édition. |
| `allowed_classes` | tableau de classes `highway` | non | Classes de routes autorisées au routage dans l'éditeur. |
| `attribution` | chaîne, 0 à 300 caractères | non | Mention des sources, affichée par les jeux à l'écran de chargement. |
| `scenery` | objet | non | Le décor du lieu réel, lu par l'éditeur (bâtiments, eau, couverture du sol). Voir « Décor ». Hors du hash. |
| `objects` | objet | non | Les objets posés à la main sur la carte, pris dans la bibliothèque des objets du jeu. Voir « Objets posés ». Hors du hash. |
| `photos` | tableau de 0 à 24 photos | non | Photos des lieux du parcours, pour qui habille le circuit (pas pour être affichées). Voir plus bas. Hors du hash. |

Un champ inconnu est **ignoré** par les jeux (compatibilité ascendante). L'éditeur
conserve les champs qu'il connaît seulement. Il ajoute un champ `editor` (ses
réglages : lissage, pistes rétrécies, largeur des ponts, espacement des
checkpoints, portes automatiques, lissage du relief, distance admise pour les photos) pour les retrouver à la réouverture : les jeux
ne le lisent pas et il n'entre pas dans le hash.

## Géométrie

- **Axes** : `x` vers l'est, `y` vers le haut, `z` vers le sud. Le nord est `−z`,
  l'avant de Godot. Unités : mètres de jeu, arrondis au centimètre (2 décimales
  au plus, largeur comprise).
- **Point** : `[x, y, z, largeur, indice_surface, drapeaux]`.
  - `largeur` : largeur de la route à ce point, en mètres de jeu (3 à 30).
  - `indice_surface` : indice dans `surfaces`.
  - `drapeaux` : champ de bits. bit 0 (`1`) = pont, bit 1 (`2`) = tunnel. Les
    autres bits sont réservés et ignorés.
- Les points sont **dans le sens de la course**. Le départ est toujours le point 0,
  qui vaut `[0, 0, 0, …]`.
- **Boucle** : fermée implicitement, le premier point n'est pas répété. Le segment
  de fermeture (dernier point → point 0) est un segment comme les autres : il
  suit la règle d'écart ci-dessous, et l'éditeur lui donne le même pas qu'aux
  autres (la boucle est découpée en pas égaux le long de la courbe). L'arrivée
  est la ligne de départ.
- **Spéciale** : l'arrivée est le dernier point.
- **Orientation** (lacet) pour une direction `(dx, dz)` : `atan2(-dx, -dz)`.
- **Écart entre deux points consécutifs** (à l'horizontale, fermeture comprise) :
  de 0,5 à 50 m de jeu. La **pente** entre deux points consécutifs ne dépasse pas
  60 % (`|dy| ≤ 0,6 × distance horizontale`).
- **Longueur** d'un tour ou de la spéciale : au moins 400 m de jeu.

## Surfaces

Noms reconnus par les jeux :

| Nom | Dans le jeu |
|---|---|
| `asphalt`, `concrete`, `paved` | route revêtue (asphalte) |
| `gravel` | gravier |
| `dirt`, `unknown` | piste de terre |
| `sand` | sable |
| `mud` | boue |

Un nom que le jeu ne connaît pas est traité comme `dirt`.

## Checkpoints et portes

- `checkpoints` : indices de points **strictement croissants**. Le départ et
  l'arrivée en sont exclus : de `1` à `n − 1` pour une boucle, de `1` à `n − 2`
  pour une spéciale (`n` = nombre de points). Dans une course à plusieurs tours,
  ils valent pour chaque tour, et la ligne de départ compte comme un checkpoint
  de plus entre deux tours.
- `gates` : mêmes règles. Ce sont les portes bonus de Cambodia Rally (elles
  donnent des points sans changer le classement) ; l'éditeur les place sur les
  lignes droites.
- Au plus 200 checkpoints et 400 portes.

## Photos

`photos` est facultatif. Les photos **ne sont pas faites pour être affichées** : elles
décrivent les lieux du parcours à qui habille le circuit (décor, bâtiments, végétation),
en petite taille pour être lues vite. Chaque photo a été prise à moins d'une distance
choisie dans l'éditeur (100 m réels par défaut) du parcours ; elle est rangée à sa
place, dans le repère des points. Les photos **n'entrent pas dans le hash** : deux
fichiers de même hash ont la même route, pas forcément les mêmes photos. Un jeu
qui ne connaît pas ce champ l'ignore, comme tout champ inconnu.

Les photos prises au même endroit forment un **lieu** (`spot`, numéroté de 1 le long
du parcours). Dans un lieu, chaque photo a un **rôle** (`view`) : `front` la route
qui vient, `left` et `right` ses deux côtés pour qui roule dans le sens du circuit,
`extra` ce qui décrit davantage l'endroit. Par défaut l'éditeur les donne dans l'ordre
de prise de vue (devant, gauche, droite, puis en plus) ; on peut les changer. Le
tableau est rangé lieu par lieu, dans l'ordre `front`, `left`, `right`, `extra`.

```json
{"name":"20261125_172646.jpg","spot":1,"view":"front","lat":13.416314,"lon":103.853748,"ele":23.4,
 "taken":"2026-11-25T17:26:46","bearing":214.5,
 "point":57,"at_m":228.3,"side":"left","offset_m":8.02,"x":-13.75,"z":-221.9,
 "w":320,"h":240,"image":"data:image/jpeg;base64,/9j/4AAQ…"}
```

| Champ | Type | Obligatoire | Rôle |
|---|---|---|---|
| `name` | chaîne, 1 à 120 caractères | oui | Nom du fichier d'origine. Informatif. |
| `spot` | entier de 1 à 24 | non | Le lieu : les photos prises à moins de 30 m réels de la première photo d'un lieu en sont. Numéroté le long du parcours. Absent des fichiers écrits avant le 27 novembre 2026 au soir. |
| `view` | `"front"`, `"left"`, `"right"` ou `"extra"` | non | Ce que montre la photo à ce lieu (voir plus haut). Absent comme `spot`. |
| `lat`, `lon` | nombres, 6 décimales au plus | oui | Où la photo a été prise (WGS84), lu dans ses métadonnées. |
| `ele` | nombre, en mètres | non | Altitude lue dans les métadonnées. |
| `taken` | `AAAA-MM-JJTHH:MM:SS` | non | Date de prise de vue, à l'heure de l'appareil (sans fuseau). |
| `bearing` | nombre de 0 à 360 exclu | non | Direction dans laquelle l'appareil regardait, en degrés depuis le nord. |
| `point` | indice de point | oui | Le point du parcours le plus proche de la photo. |
| `at_m` | nombre | oui | Distance de ce point depuis le départ, en mètres de jeu. Informatif. |
| `side` | `"left"` ou `"right"` | oui | Côté de la route où la photo a été prise, pour qui roule dans le sens du parcours. |
| `offset_m` | nombre, 2 décimales au plus | oui | Distance de la photo à ce point, en mètres de jeu. |
| `x`, `z` | nombres, 2 décimales au plus | oui | La place de la photo dans le repère des points (`+x` est, `+z` sud), en mètres de jeu. |
| `w`, `h` | entiers de 1 à 4096 | oui | Taille de l'image en pixels. |
| `image` | URI `data:image/jpeg;base64,…` de 400 000 caractères au plus | oui | L'image, réduite par l'éditeur (320 pixels au plus grand côté, 512 avant le 27 novembre 2026 au soir) et réencodée : elle ne porte plus aucune métadonnée. |

Qui lit le fichier écarte une photo qu'il ne peut pas utiliser (image qui n'est
pas un JPEG en `data:`, indice hors du parcours, `spot` ou `view` qui n'en est pas
un…) sans refuser le circuit.

`tools/circuit-editor/photos-brief.mjs` sort les photos d'un fichier en images
séparées avec une fiche par lieu (`brief.md`), pour qui habille le circuit.

## Décor

`scenery` est facultatif. L'éditeur l'écrit à partir des données d'**Overture Maps**
(bâtiments d'OpenStreetMap et de Microsoft, eau et usage du sol d'OpenStreetMap,
couverture du sol d'ESA WorldCover) lues autour du parcours, sans autre aide : c'est
le décor du lieu réel. Un jeu qui le connaît construit ce décor au lieu du sien ; un jeu
qui ne le connaît pas l'ignore. Le décor **n'entre pas dans le hash** : deux fichiers de
même hash ont la même route, pas forcément le même décor (un jeu qui garde un circuit
par son hash le remplace quand `scenery.made` diffère).

```json
"scenery": {"v": 1, "made": "2026-11-27T20:40:00Z",
  "source": "Overture Maps 2026-11-18.0 : OpenStreetMap (ODbL), Microsoft ML Buildings (ODbL), ESA WorldCover 2021 (CC BY 4.0)",
  "cover": {"cell": 16, "x0": -480, "z0": -400, "w": 64, "h": 58, "rle": "12u3c.4f…"},
  "buildings": [[12.4, -30.1, 14.2, 7.5, 104, 6, 1], …],
  "water": [{"kind": "pond", "ring": [[30.5, -80.2], [41.0, -79.8], …]}, …]}
```

| Champ | Type | Rôle |
|---|---|---|
| `v` | `1` | Version du décor. Un jeu ignore un décor d'une version qu'il ne connaît pas. |
| `made` | date ISO 8601 UTC | Quand le décor a été lu. |
| `source` | chaîne | Les sources et leurs licences, à afficher avec l'`attribution`. |
| `cover` | objet | La couverture du sol sur une grille alignée sur les axes, en mètres de jeu : `cell` le côté d'une case, `x0`, `z0` le coin (x et z les plus petits), `w` × `h` cases rangées par lignes de z croissant, x croissant dans une ligne. `rle` : la suite des classes, chaque lettre précédée de son nombre de répétitions quand il dépasse 1. Lettres : `u` ville ou village bâti, `c` cultures (rizières), `f` forêt, `g` herbe, `s` broussaille, `b` sol nu, `w` zone humide, `m` mangrove, `a` eau, `.` inconnu. Elle couvre le parcours avec 400 m réels de marge. |
| `buildings` | tableau | Les bâtiments à moins de 150 m réels du parcours et pas sur la route : `[x, z, longueur, largeur, angle, hauteur, sorte]`. `x`, `z` : le centre, en mètres de jeu (2 décimales). `longueur` ≥ `largeur` : le rectangle qui contient l'emprise, en **mètres réels** (1 décimale). `angle` : direction du grand côté, en degrés de 0 à 179, comptés de l'est vers le nord. `hauteur` : en mètres réels, 0 si inconnue. `sorte` : 0 inconnue, 1 habitation, 2 commerce, 3 bâtiment public, 4 culte, 5 école, 6 industrie ou entrepôt, 7 hôtel. Au plus 8 000, les plus proches du parcours d'abord. |
| `water` | tableau | Les plans d'eau surfaciques (étangs, lacs, rivières larges, bassins) qui touchent la zone de `cover` : `kind` (`pond`, `lake`, `river`, `reservoir`, `canal`, `water`), `ring` le contour extérieur fermé implicitement, en mètres de jeu (2 décimales), simplifié à 0,5 m de jeu près et coupé au cadre de `cover`. |

Les positions sont dans le repère des points (`+x` est, `+z` sud, à l'échelle du
circuit). Les tailles des bâtiments restent en mètres réels : un jeu choisit ses propres
modèles et leur espacement à son échelle.

## Objets posés

`objects` est facultatif. Ce sont les objets que l'auteur a choisis dans la
**bibliothèque des objets** (`objects-library.js`, à côté de l'éditeur : tous les objets
de décor de 3D Buggy, avec leur taille et une vignette, sortis du jeu par
`tools/object_library.gd`) et posés lui-même sur la carte. Le jeu les met **exactement
là**, au sol (ou sur la route, si l'auteur les y a mis), tournés comme indiqué, avec
leurs collisions ; la végétation et le décor du jeu leur laissent la place. Ils
**n'entrent pas dans le hash** (c'est de l'habillage, comme `scenery`) : un jeu qui garde
un circuit par son hash le remplace quand `objects.made` diffère. Relire le décor du
lieu réel (`scenery`) ne touche pas aux objets posés.

```json
"objects": {"v": 1, "made": "2026-11-28T01:10:00Z",
  "items": [["palm_a", 12.5, -30.25, 90, 1], ["gable_house_a", 40.1, 12.0, 180, 1.2]]}
```

| Champ | Type | Rôle |
|---|---|---|
| `v` | `1` | Version. Un jeu ignore des objets d'une version qu'il ne connaît pas. |
| `made` | date ISO 8601 UTC | La dernière modification des objets. |
| `items` | tableau de 0 à 2 000 objets | `[sorte, x, z, cap, taille]`. |

- `sorte` : l'identifiant de l'objet dans la bibliothèque, `[a-z0-9_]`, 1 à 48
  caractères. Un jeu qui ne connaît pas une sorte saute cet objet, sans refuser le
  circuit.
- `x`, `z` : la place de l'objet (l'origine du modèle, au sol), dans le repère des
  points (`+x` est, `+z` sud), en mètres de jeu, 2 décimales au plus, `|x|` et
  `|z|` ≤ 60 000.
- `cap` : la direction vers laquelle regarde la **face avant** de l'objet (l'axe `+z`
  du modèle), en degrés depuis le nord dans le sens des aiguilles d'une montre :
  `0` nord (`−z`), `90` est (`+x`), `180` sud, `270` ouest. De 0 à 360 exclu,
  1 décimale au plus. Dans Godot : `Basis(Vector3.UP, PI − deg_to_rad(cap))`.
- `taille` : facteur de taille, de 0,5 à 2, 2 décimales au plus (`1` : la taille du
  jeu).

Qui lit le fichier écarte un objet malformé (sorte qui n'en est pas une, nombre
non fini ou hors des bornes) sans refuser le circuit.

## Hash

`hash` est le SHA-256 (hexadécimal, minuscules) du texte canonique ci-dessous,
encodé en UTF-8. Il couvre la géométrie et les règles, pas l'habillage (`id`, `name`,
`author`, `created`, `games`, `origin`, longueurs, `elevation`, `waypoints`,
`allowed_classes`, `attribution`). Deux fichiers de même hash donnent le même
circuit sur tous les téléphones.

Chaque ligne se termine par `\n` (y compris la dernière) :

```
cambotrack/1
kind=<kind>
laps=<laps, ou 1>
scale=<q3(scale)>
vertical_scale=<q3(vertical_scale)>
road_width=<q2(road_width)>
spacing=<q2(spacing)>
surfaces=<noms séparés par des virgules>
points=<nombre de points>
<x>,<y>,<z>,<largeur>,<indice_surface>,<drapeaux>;…   (un bloc par point, séparés par « ; », sans « ; » final)
checkpoints=<indices séparés par des virgules>
gates=<indices séparés par des virgules ; rien si la liste est vide ; « auto » si le champ est absent>
```

- `q2(v) = floor(v × 100 + 0,5)` : un entier, en centimètres. `x`, `y`, `z` et
  `largeur` sont écrits avec `q2`.
- `q3(v) = floor(v × 1000 + 0,5)`.
- Les entiers sont écrits en décimal, sans zéro inutile ; zéro s'écrit `0`
  (jamais `-0`).
- `indice_surface` et `drapeaux` sont écrits tels quels.
- `gates=auto` (champ absent : le jeu place ses portes) et `gates=` (liste vide :
  aucune porte) sont deux circuits différents, de hash différent.
- Les nombres du fichier ont au plus autant de décimales que leur quantification
  en garde (2 pour `q2`, 3 pour `q3`) : aucun n'est alors à la limite entre deux
  entiers, et le hash ne dépend pas de la bibliothèque qui lit le JSON.

Un jeu recalcule le hash à la lecture et refuse un fichier dont le hash ne
correspond pas.

## Limites vérifiées par les jeux

Une donnée venue du réseau n'est jamais fiable. Avant toute construction :

- fichier de 4 Mio au plus (4 194 304 octets), JSON valide, objet à la racine ;
- `version` : entier ; supérieur à 1, refus avec un message clair ;
- 8 à 20 000 points ; chaque point est un tableau d'au moins 6 nombres finis ;
- `|x|` et `|z|` ≤ 60 000 ; `|y|` ≤ 3 000 ; largeur de 3 à 30 ;
- indices de surface dans la table ; drapeaux entiers de 0 à 255 ;
- checkpoints et portes strictement croissants et dans les bornes ;
- écarts, pentes et longueur minimale de la section Géométrie ;
- `laps × longueur` ≤ 300 km de jeu ;
- hash exact.

## Catalogue `tracks/index.json`

```json
{"format": "cambotrack-catalog", "version": 1, "updated": "2026-11-26T14:00:00Z", "tracks": [
  {"id": "angkor-petit-circuit", "name": "Petit Circuit perso", "file": "angkor-petit-circuit.cambotrack.json",
   "hash": "9f2c…", "kind": "loop", "laps": 3, "length_game_m": 7100, "climb_m": 40,
   "games": ["3d_buggy", "cambodia_rally"], "author": "", "updated": "2026-11-26T14:00:00Z",
   "bbox": [13.40, 103.83, 13.47, 103.90]}]}
```

- `file` est relatif au dossier `tracks/`. Les jeux n'acceptent qu'un nom de la
  forme `<id>.cambotrack.json`.
- `bbox` : `[sud, ouest, nord, est]` en degrés.
- `climb_m` : dénivelé positif réel d'un tour, `0` pour un circuit plat.
- Les jeux lisent au plus 500 entrées et 1 Mio.

## Où les jeux lisent le catalogue

Voir `README.md` (section Publication) : l'URL choisie, les délais mesurés et
l'URL de secours.
