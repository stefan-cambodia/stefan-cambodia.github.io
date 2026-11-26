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
| `laps` | entier de 1 à 20 | boucle seulement | Nombre de tours. Absent : 1. Une spéciale n'en a pas (ou `1`). |
| `scale` | nombre de 1 à 10 | oui | Mètres réels par mètre de jeu, à l'horizontale. |
| `vertical_scale` | nombre de 0,5 à 50 | oui | Mètres réels par mètre de jeu, à la verticale. Égal à `scale`, il conserve les pentes réelles. |
| `road_width` | nombre de 3 à 30 | oui | Largeur de base, en mètres de jeu. |
| `spacing` | nombre de 1 à 20 | oui | Distance visée entre deux points, en mètres de jeu. |
| `origin` | `{lat, lon, ele}` | non | Point de départ sur la Terre (WGS84, altitude en mètres) : il vaut `(0, 0, 0)` dans le jeu. Sert à rouvrir le circuit dans l'éditeur. |
| `length_real_m`, `length_game_m` | nombres | non | Longueur d'un tour (boucle) ou de la spéciale. Informatif. |
| `elevation` | `{source, min, max, climb_m}` ou `null` | non | Origine du relief, altitudes réelles extrêmes, dénivelé positif réel. `null` : circuit plat. |
| `surfaces` | tableau de 1 à 32 noms | oui | Table des surfaces ; les points y renvoient par indice. |
| `points` | tableau de 8 à 20 000 points | oui | La ligne centrale. Voir plus bas. |
| `checkpoints` | tableau d'indices de points | oui (peut être vide) | Checkpoints, dans l'ordre de la course. |
| `gates` | tableau d'indices de points | non | Portes bonus. Absent : le jeu en place lui-même. Vide : aucune. |
| `waypoints` | tableau de `[lat, lon]` | non | Clics de l'éditeur, pour reprendre l'édition. |
| `allowed_classes` | tableau de classes `highway` | non | Classes de routes autorisées au routage dans l'éditeur. |
| `attribution` | chaîne, 0 à 300 caractères | non | Mention des sources, affichée par les jeux à l'écran de chargement. |

Un champ inconnu est **ignoré** par les jeux (compatibilité ascendante). L'éditeur
conserve les champs qu'il connaît seulement.

## Géométrie

- **Axes** : `x` vers l'est, `y` vers le haut, `z` vers le sud. Le nord est `−z`,
  l'avant de Godot. Unités : mètres de jeu, arrondis au centimètre.
- **Point** : `[x, y, z, largeur, indice_surface, drapeaux]`.
  - `largeur` : largeur de la route à ce point, en mètres de jeu (3 à 30).
  - `indice_surface` : indice dans `surfaces`.
  - `drapeaux` : champ de bits. bit 0 (`1`) = pont, bit 1 (`2`) = tunnel. Les
    autres bits sont réservés et ignorés.
- Les points sont **dans le sens de la course**. Le départ est toujours le point 0,
  qui vaut `[0, 0, 0, …]`.
- **Boucle** : fermée implicitement, le premier point n'est pas répété. Le segment
  de fermeture (dernier point → point 0) a la même longueur que les autres.
  L'arrivée est la ligne de départ.
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
gates=<indices séparés par des virgules, vide si le champ est absent ou vide>
```

- `q2(v) = floor(v × 100 + 0,5)` : un entier, en centimètres. `x`, `y`, `z` et
  `largeur` sont écrits avec `q2`.
- `q3(v) = floor(v × 1000 + 0,5)`.
- Les entiers sont écrits en décimal, sans zéro inutile ; zéro s'écrit `0`
  (jamais `-0`).
- `indice_surface` et `drapeaux` sont écrits tels quels.

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
