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

L'outil tient dans **un seul fichier**, [`index.html`](index.html), plus la bibliothèque
des objets du jeu qu'il charge à côté de lui ([`objects-library.js`](objects-library.js),
voir [Les objets posés](#les-objets-posés)) : pas de framework, pas d'étape de compilation. Il est prévu pour un **navigateur d'ordinateur** (souris,
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

## L'écran

- **La barre du haut** : les menus **Fichier** (nouveau, ouvrir, Mes circuits, garder,
  télécharger, copier, envoyer, ajouter des photos), **Édition** (annuler, rétablir, les
  outils, boucle ou spéciale, inverser le sens, tout effacer), **Affichage** (voir tout le
  circuit, charger les routes, le fond plan, satellite ou relief, masquer le panneau, aller
  à une étape) et **Aide** (pour commencer, raccourcis, mode d'emploi, format). À côté : le
  **nom du circuit** (le même que dans Réglages), **Garder** et **Télécharger**.
- **Commandes** (<kbd>Ctrl</kbd>+<kbd>K</kbd>) : taper ce qu'on veut faire (« satellite »,
  « photos », « télécharger »…), Entrée. Toutes les commandes des menus y sont.
- **Les étapes** du panneau sont numérotées, de 1 Tracé à 6 Envoi ; une étape faite est
  cochée (le tracé roule, le circuit a un nom, le relief est chargé, des photos ou des
  objets sont là). Les explications longues sont repliées sous « En savoir plus ».
- **Pour commencer** : sur une carte vide, une carte d'accueil donne les trois gestes
  (aller au lieu, charger les routes, cliquer sur les routes) et les autres départs (des
  photos, un fichier, Mes circuits). Elle part dès que les routes sont là ; le menu Aide la
  rappelle.
- **Clic droit sur la carte** : ce qu'on peut faire à cet endroit (poser l'objet choisi, un
  point de passage, l'insérer dans le tracé, centrer, charger les routes autour, copier les
  coordonnées). Sur un point ou un objet, le clic droit le supprime, comme avant.
- **Sur la carte** : une fois les routes chargées, une ligne dit où cliquer (le départ, puis
  plus loin) et une légende donne le sens des couleurs (grande route, petite route, piste,
  le tracé). Dans « Mes circuits », chaque circuit gardé a le dessin de son tracé.
- **Points de passage** (étape Tracé) : la liste des points, chacun à sa distance du départ
  en mètres de jeu ; « Voir » y amène la carte, « Retirer » l'enlève (Ctrl+Z le remet).
- **D'une étape à l'autre** : au pied de chaque étape, « Suivant » et le retour à la
  précédente. L'étape Envoi dit d'abord si le circuit est prêt (son nom, sa longueur, ses
  objets et photos) ou ce qui manque, avec le bouton pour y aller.
- **Annuler sans chercher** : un message qui dit ce qu'« Annuler » reprendrait (tracé effacé,
  objets posés ou retirés) porte le bouton lui-même. La barre dit quand le brouillon a été
  gardé dans le navigateur.
- **Réglages** : le nom, les tours, l'échelle, les jeux, le décor et l'auteur sont en vue ;
  l'identifiant, les largeurs, l'espacement, les checkpoints, le lissage et les options sont
  sous « Réglages avancés » (ouverts d'eux-mêmes si l'identifiant est faux).
- **Objets** : les derniers choisis sont en tête (« Utilisés récemment », gardés dans le
  navigateur) ; l'écart ne se demande que pour une ligne.
- **Raccourcis** (<kbd>?</kbd> les montre tous) : <kbd>Ctrl</kbd>+<kbd>S</kbd> garder,
  <kbd>Ctrl</kbd>+<kbd>Maj</kbd>+<kbd>S</kbd> télécharger, <kbd>Ctrl</kbd>+<kbd>O</kbd>
  ouvrir, <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd> annuler, rétablir ;
  <kbd>A</kbd> ajouter, <kbd>M</kbd> modifier, <kbd>F</kbd> voir tout le circuit,
  <kbd>L</kbd> charger les routes, <kbd>P</kbd> masquer le panneau, <kbd>1</kbd> à
  <kbd>6</kbd> les étapes ; pour les objets <kbd>R</kbd>, <kbd>Suppr</kbd>, <kbd>Échap</kbd>.

## En trois étapes

### 1. Tracer

1. Cadrer la carte sur la zone voulue : la recherche (taper un lieu, puis **Entrée**),
   le bouton « Lieux » (Angkor, Siem Reap, Kampot, Bokor, Kep, Phnom Penh) ou la souris.
2. « **Charger les routes de la zone** » : les routes de la vue apparaissent en surimpression.
   Chaque chargement s'ajoute aux précédents ; un cadre en pointillé montre ce qui est déjà
   chargé. Au-delà d'environ 1 500 km², l'éditeur demande de zoomer. Une zone déjà chargée
   lors d'une visite précédente revient aussitôt, sans attendre le serveur
   ([Les routes gardées](#les-routes-gardées)).
3. Outil « **Ajouter** » : un clic sur une route pose un point de passage, recalé sur la
   route la plus proche (à moins de 20 pixels). Entre deux points, le tracé prend le plus
   court chemin par les routes. Pour l'obliger à passer ailleurs, ajouter un point.
4. Corriger :
   - **déplacer** un point en le faisant glisser (il se recale) ;
   - **insérer** un point : outil « Modifier », puis un clic sur le tracé ;
   - **supprimer** un point : clic droit dessus (ou un clic, puis « Supprimer ce point ») ;
   - **annuler / rétablir** : Ctrl+Z / Ctrl+Y, ou les flèches sous la carte ;
   - **inverser** le sens, **tout effacer** : les deux derniers boutons.

   Le tracé en cours est gardé à chaque changement (dans le navigateur, sur cet
   ordinateur). On peut fermer l'éditeur : à l'ouverture suivante il propose de le
   **reprendre**, avec ses réglages et son relief ([Le tracé en cours](#le-tracé-en-cours)).
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
7. Onglet « Relief » : relief réel ou circuit plat, échelle verticale, lissage du relief,
   profil d'altitude et dénivelé positif ([Le lissage du relief](#le-lissage-du-relief)).
   Le profil montre la carte : l'endroit survolé y apparaît en orange, avec sa distance et
   son altitude, et un clic y amène la carte.

8. Onglet « Photos » : des photos prises le long du parcours ([Les photos](#les-photos)).

### 2. Envoyer

Onglet « Envoi » :

- « **Envoyer au jeu** » écrit `tracks/<identifiant>.cambotrack.json` sur la branche `main`
  du site, puis met à jour le catalogue `tracks/index.json`. Il faut un jeton GitHub
  ([voir plus bas](#jeton-github)). L'éditeur affiche ensuite les adresses du circuit et du
  catalogue.
- « **Télécharger** » enregistre le fichier, « **Copier** » le met dans le presse-papiers.
- « **Mes circuits** » : la liste des circuits gardés sur cet ordinateur. « Garder ce
  circuit » y range le tracé en cours, et tout circuit téléchargé, copié ou envoyé y entre
  de lui-même ; un clic le rouvre, « Nouveau circuit » repart d'un tracé et d'un nom vides
  ([Mes circuits](#mes-circuits)).
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
| Relief | Une altitude tous les 30 m réels environ, lissée sur 90 m (ou sur 300 ou 600 m après retrait des bosses et des creux plus étroits, selon « Lissage du relief »), puis pentes limitées à 30 % (le format en tolère 60). `elevation: null` et tous les `y` à zéro si le relief est décoché. |
| Nombres du hash | `scale` et `vertical_scale` sont écrits arrondis au millième, `road_width` et `spacing` au centième, comme les points le sont au centimètre : aucune valeur du fichier n'est à cheval sur un arrondi du hash. |
| Demi-tours | Un aller-retour de moins de 30 m à un point de passage (point posé juste à côté d'un carrefour) est retiré de l'export, et signalé. |
| Champ `editor` | Les réglages propres à l'éditeur (lissage, options de largeur, checkpoints, portes, et `relief_smooth_m` quand le lissage du relief n'est pas « Normal ») sont rangés dans un champ `editor`, pour « Ouvrir ». Les jeux l'ignorent, comme tout champ inconnu. |

Pour vérifier un fichier à la main :

```sh
node tools/circuit-editor/test/validate.mjs tracks/mon-circuit.cambotrack.json
```

## Le tracé en cours

À chaque changement, l'éditeur range le dessin dans le `localStorage` du navigateur, sous
la clé `circuit-editor.draft` : les points de passage, les champs du formulaire, le cadre
du parcours et les altitudes déjà reçues pour lui. Jamais le jeton GitHub.

- À l'ouverture, s'il trouve un dessin, il affiche « Un tracé en cours a été retrouvé »
  avec son nom, son nombre de points et sa date. « **Reprendre** » remet le formulaire et
  les points, reprend les routes sur lesquelles il a été dessiné
  ([Les routes gardées](#les-routes-gardées) ; à défaut une demande à Overpass pour le cadre
  du parcours, comme « Ouvrir… ») et recalcule le tracé ; les altitudes gardées ne sont pas
  redemandées à Open-Meteo. Si la carte n'a pas changé, le circuit repris a le même hash
  qu'avant.
- « **Ignorer** » referme la proposition. Le dessin reste gardé jusqu'à ce qu'un nouveau
  tracé prenne sa place, c'est-à-dire dès le premier point posé.
- « Tout effacer » l'oublie (« Annuler » le fait revenir, et il est gardé de nouveau).
- Le navigateur ne demande plus confirmation à la fermeture, sauf s'il n'a pas pu garder le
  dessin (navigation privée).

Le dessin gardé appartient au navigateur et à l'adresse de la page : la copie installée
et la page ouverte depuis un dossier (`file://`) partagent le même, la page publiée sur le
site a le sien. Pour passer un circuit d'un ordinateur à un autre, « Télécharger » puis
« Ouvrir… ».

## Les photos

Les photos **ne sont pas affichées dans le jeu**. Elles décrivent les lieux du parcours à
qui habillera le circuit : ce qu'on voit devant, à gauche, à droite. Elles sont donc
gardées petites (320 pixels au plus grand côté, 10 à 20 ko pour une photo de téléphone),
assez pour décrire un endroit et vite lues.

L'onglet « Photos » importe des photos qui portent leur position GPS dans leurs
métadonnées (Exif), comme celles d'un téléphone dont la localisation de l'appareil photo
est activée. « Ajouter des photos… » ou un dépôt de fichiers sur la carte ; plusieurs à la
fois, ou une archive `.zip`.

Deux formats sont lus : le **JPEG** et le **HEIC** (les photos « haute efficacité » des
Samsung et des iPhone). Le navigateur d'un ordinateur n'affiche pas le HEIC : l'éditeur lit
lui-même sa position, puis charge un décodeur (libheif, 2 Mo, la première fois qu'il en
faut un) pour en tirer l'image réduite. Compter environ une seconde et demie par photo de
12 mégapixels, et une connexion pour ce premier chargement.

**On peut commencer par les photos.** Sans tracé, l'éditeur prend toutes celles qui ont une
position, centre la carte sur elles, charge les routes autour (500 m de marge : celles déjà
chargées ou gardées sur l'ordinateur, sinon une requête Overpass) et propose un tracé qui
passe par chaque lieu, dans l'ordre de prise de vue : un point de passage sur la route la
plus proche de chaque lieu (à moins de l'écart admis). Il reste à l'adapter : type de
circuit (boucle ou spéciale), points à déplacer ou à ajouter, échelle. Un seul « Annuler »
retire les photos et le tracé proposé.

Essayé le 27 novembre 2026 avec un album Google Photos de 23 photos HEIC prises autour d'un
étang de Kampot : 43 s en tout (lecture, décodage, routes), 7 lieux, une boucle de 679 m
réels autour de l'étang, refermée par la rue voisine (voir « Pas de demi-tour » plus bas).
Seule retouche : l'échelle, car un tour de 679 m réels fait moins des 400 m de jeu demandés
à l'échelle 2,5 ; à 1,25, 525 m de jeu. 3D Buggy construit ce fichier en 0,14 s et son pilote
automatique en boucle les trois tours en 90 s.

**Depuis un album Google Photos** : sur photos.google.com, ouvrir l'album, menu ⋮ puis
« Tout télécharger » ; Google donne un `.zip` des photos d'origine, à donner tel quel à
l'éditeur. Vérifié le 27 novembre 2026 sur un album de 23 photos HEIC d'un Samsung : les
positions GPS et les dates y sont (le bloc de métadonnées est placé après l'image, l'éditeur
le trouve où qu'il soit). Les dossiers de l'archive sont parcourus, ce qui n'est pas un JPEG est refusé
avec sa raison. (L'accès direct par l'API de Google n'est pas possible pour cet usage :
Google retire la position des photos qu'il donne aux applications, « all the Exif metadata
except the location metadata », et ne laisse plus lire les albums existants depuis le
31 mars 2025.)

### Lieux et rôles

Les photos prises au même endroit (à moins de 30 m de la première) forment un **lieu**,
numéroté le long du parcours. À chaque lieu, dans l'ordre de prise de vue (date de
l'Exif, puis nom du fichier) :

1. **devant** : la route qui vient, dans le sens du circuit ;
2. **à gauche** ;
3. **à droite** ;
4. les suivantes sont **en plus**, pour mieux décrire l'endroit.

La liste de l'onglet suit les lieux ; chaque photo a un menu pour changer son rôle (les
autres photos du lieu prennent alors les rôles restants, dans l'ordre). Si l'appareil a
noté sa direction (boussole), l'éditeur la compare à la route et prévient quand elle
contredit le rôle : « D'après la boussole de l'appareil, elle regarde à gauche (−57° par
rapport à la route) ». « Annuler » défait un changement de rôle.

### Le tri

Chaque photo est comparée au **tracé du circuit** :

| Cas | Ce qui se passe |
|---|---|
| Prise à moins de l'**écart admis** du parcours (100 m réels par défaut, réglable de 5 à 2 000 m) | **Acceptée.** Elle est écrite dans le fichier, à sa place au bord de la route (point le plus proche, côté gauche ou droit, distance). La première photo d'un **nouveau lieu** fait de la route la plus proche un **point de passage**, inséré dans le tronçon le plus proche ; si un point de passage est déjà à moins de 10 m, rien n'est ajouté. |
| Prise plus loin | **Gardée**, en rouge sur la carte et dans la liste (« à 1 175 m du parcours : elle ne sera pas dans le fichier »), sans point de passage : au tracé d'aller la chercher, ou à la corbeille de la retirer. |
| Sans position, ou position nulle (l'appareil n'avait pas capté les satellites) | Refusée, avec la raison. |
| Pas un JPEG, image illisible, déjà importée, plus de 24 photos | Refusée, avec la raison. |

Il faut donc tracer le circuit avant d'importer les photos. Un import se défait d'un
« Annuler » (photos et points de passage ensemble). Une photo acceptée reste dans la
liste ; si le tracé change ensuite et s'en éloigne au-delà de l'écart admis, elle est
signalée en rouge et laissée hors du fichier. La corbeille retire une photo ; son point de
passage reste.

Dans le fichier (champ `photos`, [`FORMAT.md`](FORMAT.md)), chaque photo garde son lieu
et son rôle, sa position, son altitude, sa date et sa direction de prise de vue, sa place
dans le repère du circuit, et l'image réduite, réencodée en JPEG : **aucune autre
métadonnée** de la photo d'origine n'y passe. Les photos n'entrent pas dans le hash : la
route reste la même. **Un circuit envoyé au jeu est public, ses photos aussi.** Les jeux
ignorent ce champ (le circuit se joue comme avant, vérifié avec 3D Buggy le 27 novembre 2026).

Les images sont gardées sur l'ordinateur (IndexedDB, table `photos`, les 200 plus
récentes) pour que le tracé en cours et « Mes circuits » retrouvent leurs photos ; « Ouvrir… »
les relit dans le fichier.

### Lire les photos d'un circuit

```sh
node tools/circuit-editor/photos-brief.mjs mon-circuit.cambotrack.json [dossier]
```

écrit une image par photo (`lieu-01-devant.jpg`, `lieu-01-gauche.jpg`…) et une fiche
`brief.md` : pour chaque lieu, sa distance depuis le départ, sa position, et pour chaque
photo son rôle, le côté de la route, ce que dit la boussole. Le dossier par défaut est
`mon-circuit.photos/` à côté du fichier.

## Le décor du lieu réel

À l'export (« Télécharger », « Copier », « Envoyer au jeu »), l'éditeur lit autour du
parcours le décor du lieu réel et l'écrit dans le fichier (champ `scenery`,
[`FORMAT.md`](FORMAT.md), « Décor »), sans aucune autre aide :

- les **bâtiments** à moins de 150 m réels du parcours et pas sur la route, chacun en un
  rectangle (centre, longueur, largeur, orientation), avec sa hauteur et sa sorte quand
  elles sont connues (habitation, commerce, culte, école, hôtel…) ;
- l'**eau** : étangs, lacs, rivières larges, avec leur contour ;
- la **couverture du sol** sur une grille, 400 m réels autour du parcours : bâti,
  cultures, forêt, herbe, broussaille, sol nu, zone humide, mangrove, eau.

Les données viennent d'**Overture Maps** (version 2026-11-18.0) : les bâtiments
d'OpenStreetMap et de Microsoft (beaucoup plus complets qu'OpenStreetMap seul au
Cambodge : 237 bâtiments autour de l'étang de Kampot, contre 28 dans OpenStreetMap),
l'eau et l'usage du sol d'OpenStreetMap, la couverture du sol d'ESA WorldCover. Overture
les publie en deux archives (`buildings.pmtiles`, 181 Go, et `base.pmtiles`) que
l'éditeur lit par petits morceaux (requêtes HTTP « Range ») : pour un circuit de ville,
deux tuiles et un demi-mégaoctet, en deux secondes. Les tuiles lues restent en mémoire
tant que la page est ouverte.

Le décor apparaît sur la carte (bâtiments en brun, eau en bleu) et la ligne d'export le
résume : « Décor : 237 bâtiments, 5 plans d'eau, sol : bâti 66 %, eau 26 %… ». La case
« Décor du lieu réel » (onglet Réglages) le retire du fichier. Si Overture ne répond pas,
le fichier part sans décor et la ligne d'export le dit. Au-delà de 160 tuiles (un très
long circuit), le décor est laissé de côté.

Le décor n'entre pas dans le hash. Un jeu qui ne le connaît pas construit son décor
habituel. 3D Buggy le construit (bâtiments, eau, sol) : voir `docs/CUSTOM_TRACKS.md` du jeu.

## Les objets posés

L'onglet **Objets** tient la **bibliothèque de tous les objets de décor de 3D Buggy** :
379 objets, avec une vignette, un nom en français et leur taille dans le jeu (arbres,
herbes et rochers, maisons khmères et compartiments de Kampot, étals, gens, motos et
tuk-tuks, animaux, panneaux, rizières, bateaux, obstacles, services publics (commissariat, école, centre de santé, poste), commerces (station-service, banque, supérette, pharmacie, café, maison d'hôtes, réparateur de motos), route et réseaux (poteaux électriques, antenne relais, feux, panneaux stop et de limitation), lieux de culte (vihear, grand portail et kot d'une pagode, sala, stoupas familiaux, Bouddha et autel de Neak Ta de bord de route, temple chinois, mosquée cham, banian sacré), fêtes et vie de la rue (tente de mariage, tour de sono, marché de nuit, chariots de jus de canne et de grillades, bar karaoké, terrain de volley, montagne de sable du Nouvel An), village, rivière et côte (four à briques, rizerie, carrelet, maison flottante, marché aux crabes, paillotes à hamacs de Kep, cuisine de sucre de palme), la rue et ses véhicules (portique « Bienvenue », monument de rond-point, villa et maisons de borey, bijouterie-changeur, coin des motodops, cyclo, pick-up surchargé, camion-benne de latérite), grands bâtiments de ville (hôtel, immeubles de chambres, compartiment moderne haut, marché couvert, bâtiment administratif), monuments d'Angkor, de
Kampot et de Bokor, monuments des paysages…). Le champ « Chercher » trouve un objet par son
nom, sans tenir compte des accents ni des majuscules ; « Famille » ne montre qu'un groupe.
La liste complète commence par le Cambodge (maisons khmères, la rue, les commerces, les
services, les lieux de culte, les fêtes, la vie du village, puis la campagne, Angkor et
Kampot) ; les objets des autres paysages du jeu (pins, cactus…) viennent après.

- **Poser** : un clic sur un objet de la bibliothèque, puis un clic sur la carte, autant de
  fois qu'il faut ; <kbd>Échap</kbd> arrête. Tant qu'un objet est choisi, son emprise suit
  le pointeur en pointillé orange. Un objet posé à moins de 300 m réels du parcours regarde
  la route ; plus loin, il prend l'orientation du dernier objet ; <kbd>R</kbd> pendant la
  pose le tourne à la main (et la route ne décide plus, jusqu'à ce qu'on arrête la pose).
- **Poser en ligne** : « En ligne » pose une rangée droite entre deux clics ; « Le long du
  tracé » pose une rangée qui suit le parcours entre deux clics, à la distance et du côté du
  premier clic, chaque objet face à la route (sur la route même : dans le sens de la
  course), et passe le départ d'une boucle sans revenir en arrière. « Écart » : les mètres
  réels entre deux objets (vide : selon la taille de l'objet). Les objets à venir
  s'affichent en pointillé avant le second clic ; une rangée s'annule d'un seul Ctrl+Z
  (400 objets au plus par rangée). Pour des palmiers le long d'une avenue, des lampadaires,
  une clôture, des poteaux électriques.
- **Sur la carte**, chaque objet a sa vignette dans un rond, son emprise au sol à sa
  vraie taille (un mètre de jeu vaut l'échelle du circuit en mètres réels : une pagode de
  22 m fait 54 m sur la carte à l'échelle 2,5), et une flèche vers sa face avant. Vert :
  un petit objet ; violet : une construction ; orange : l'objet choisi.
- **Modifier** : glisser une vignette déplace l'objet ; un clic le choisit ; l'onglet
  donne alors son orientation (curseur, « Tourner de 90° », « Face à la route »), sa taille
  (de × 0,5 à × 2), « Dupliquer » (une copie juste à côté) et « Supprimer ». <kbd>R</kbd>
  tourne de 15° (<kbd>Maj</kbd>+<kbd>R</kbd> dans l'autre sens), <kbd>Suppr</kbd> ou un clic
  droit supprime. Ctrl+Z et Ctrl+Y annulent et rétablissent, comme pour le tracé.
- La liste « Objets posés » les compte par sorte ; un clic montre le suivant sur la carte.

Les objets sont gardés avec le tracé en cours et dans « Mes circuits », et écrits dans le
fichier (champ `objects`, [`FORMAT.md`](FORMAT.md), « Objets posés ») dans le repère des
points : l'éditeur, lui, les garde sur la Terre, si bien qu'ils restent en place quand le
départ du circuit change. « Ouvrir… » les remet où ils étaient. Ils n'entrent pas dans le
hash. 3D Buggy les construit exactement là, au sol, avec leurs collisions, et sa végétation
et son décor leur laissent la place (voir `docs/CUSTOM_TRACKS.md` du jeu).

La bibliothèque vient du jeu lui-même : dans le dépôt de 3D Buggy,
`godot --path . -s tools/object_library.gd -- <ce dossier>/objects-library.js` (avec un
écran : les vignettes sont rendues par le moteur) la réécrit en une quarantaine de
secondes. La liste des objets possibles est `custom_tracks/custom_objects.gd` : tout le
décor du jeu, sauf le mobilier de course (arches, portes, tremplins, chevrons, panneaux de
pub du moteur) et les pièces qui n'ont de sens que posées en ligne par les règles d'une
étape (murs d'enceinte, ponts, digue). À relancer quand un objet est ajouté au jeu. Sans ce
fichier, l'onglet le dit et les objets déjà posés restent dans le fichier.

## Mes circuits

L'onglet « Envoi » garde une liste de circuits sur l'ordinateur, dans la même base
IndexedDB que les routes (`circuit-editor`, table `circuits`). Chaque circuit y est rangé
sous son identifiant, avec ce qu'il faut pour le retrouver tel quel : points de passage,
réglages, zones de ses routes, altitudes reçues.

- « **Garder ce circuit** » range le tracé en cours (il lui faut un nom). Un tracé
  incomplet se garde aussi. Un circuit **téléchargé, copié ou envoyé** entre dans la liste
  sans qu'on le demande. Garder sous un identifiant déjà pris remplace l'ancien.
- Un **clic sur un circuit** le rouvre : le formulaire, les points, les routes gardées et le
  relief reviennent sans rien demander à Overpass ni à Open-Meteo, et le circuit a le même
  hash. Si le tracé en cours n'est pas dans la liste tel qu'il est, l'éditeur demande
  d'abord confirmation, car il va être remplacé.
- La **corbeille** retire un circuit de la liste, après confirmation. Les fichiers déjà
  téléchargés ou envoyés ne sont pas touchés.
- « **Nouveau circuit** » vide le tracé, le nom et l'identifiant ; la carte, les routes
  chargées et les autres réglages restent.

Après « Ouvrir… », « Reprendre » ou un clic dans la liste, l'identifiant continue de suivre
le nom tant qu'il en est la forme simplifiée : renommer un circuit pour en faire un autre
lui donne donc un autre identifiant, et ne remplace pas le premier dans les jeux. Un
identifiant tapé à la main, lui, ne bouge plus.

## Les routes gardées

Les réponses d'Overpass sont gardées sur l'ordinateur, dans la base IndexedDB
`circuit-editor` du navigateur : une par zone chargée, les 24 plus récentes. Elles servent
à ne pas redemander à un serveur bénévole, qui met de dix secondes à une minute à répondre,
ce que l'on a déjà.

| Geste | Ce qui se passe |
|---|---|
| « Reprendre » un tracé en cours | Toutes les zones sur lesquelles il a été dessiné reviennent de l'ordinateur, quel que soit leur âge : la carte est celle qu'on a quittée. Si l'une manque, les routes du cadre du parcours sont demandées à Overpass. |
| « Ouvrir… » un fichier | Si une zone gardée depuis moins de 30 jours contient le parcours, elle sert ; sinon Overpass. |
| « Charger les routes de la zone » | Si une zone gardée depuis moins de 30 jours contient la vue et n'a pas encore été chargée pendant cette visite, elle sert, et l'éditeur dit de quel jour elle date. Un nouveau clic interroge OpenStreetMap. |

Mesuré le 27 novembre 2026 sur le tour de la colline de Kep, la page ouverte depuis le
disque : reprendre le tracé prend 0,4 s avec les routes gardées, contre 34 s en les
demandant à Overpass ; aucune requête ne part, et le circuit a le même hash.

L'onglet « Tracé » dit combien de zones sont gardées, et « Les oublier » les efface toutes.
Redemander une zone ajoute les routes nouvelles ; celles qui sont déjà sur la carte n'y sont
pas remplacées pendant la visite, la réponse fraîche servira à la suivante. Comme le tracé
en cours, ces routes appartiennent au navigateur et à l'adresse de la page.

## Le lissage du relief

Le relief vient d'un modèle de surface dont une case fait 90 m : le long d'une route, il
donne aussi le versant d'à côté, la cime des arbres, les toits, et le niveau de l'eau sous
un pont. « Lissage du relief » (onglet « Relief ») choisit ce que l'éditeur en garde.

| Choix | Ce qui est fait |
|---|---|
| **Normal (90 m)** | Moyenne glissante sur 90 m. C'est le réglage de toujours : un fichier fait avec lui est identique, hash compris, à ce qu'il était. |
| **Fort (300 m)** | Les bosses de moins de 300 m de long sont retirées, puis les creux de moins de 300 m, puis moyenne sur 300 m. |
| **Très fort (600 m)** | La même chose sur 600 m. |

Les bosses passent avant les creux parce qu'un modèle de surface se trompe vers le haut, et
pour que deux fausses bosses voisines ne soient pas prises pour une colline. Ce qui est plus
long que la fenêtre reste en place ; une vraie côte perd à son sommet ce que la route gagne
sur la dernière demi-fenêtre (6 m pour une colline de 60 m longue de 1,5 km, en « Fort »).

Mesuré le 27 novembre 2026 sur de vraies réponses d'Open-Meteo :

| Parcours | Normal | Fort | Très fort |
|---|---|---|---|
| Tour de la colline de Kep, 20,9 km de routes au niveau de la mer ou presque | 198 m de dénivelé positif ; 33 m à la pointe de Kep, où la route longe la mer au pied du versant | 44 m ; 9 m à la pointe | 32 m ; 7 m à la pointe |
| Montée au Bokor par les pistes, 17,5 km, d'environ 50 m à 1 000 m | 1 318 m de dénivelé positif | 1 055 m | 1 012 m |

Les altitudes de Kep sont dans `test/fixtures/kep-loop.elevations.json`, et un test vérifie
ces chiffres. Le choix est écrit dans le champ `editor` du fichier, pour « Ouvrir… ».

## Services utilisés

L'éditeur n'a pas de serveur à lui. Il parle depuis le navigateur à des services publics,
chacun avec ses conditions.

| Service | Usage | Conditions |
|---|---|---|
| **OpenStreetMap** (données) | Les routes, donc tout circuit publié. | Licence [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Mention obligatoire : « © OpenStreetMap contributors ». Elle est affichée sur la carte et écrite dans le champ `attribution` de chaque circuit, que les jeux montrent à l'écran de chargement. Un circuit est une donnée dérivée d'OSM : il reste sous ODbL. |
| **Tuiles OSM** `tile.openstreetmap.org` | Fond « Plan ». | [Politique d'usage des tuiles](https://operations.osmfoundation.org/policies/tiles/) : usage interactif modéré, mention visible. |
| **Esri World Imagery** | Fond « Satellite ». | Conditions d'Esri ; mention affichée sur la carte. Sert à regarder, pas à tracer : les routes viennent d'OSM. |
| **OpenTopoMap** | Fond « Relief ». | Tuiles sous CC-BY-SA, mention affichée. |
| **Overpass API** | « Charger les routes de la zone ». | Service bénévole : une requête par clic, zone bornée à 1 500 km², jamais de requête automatique, et ce qui a déjà été reçu est gardé sur l'ordinateur plutôt que redemandé. Voir les serveurs plus bas. |
| **Nominatim** `nominatim.openstreetmap.org` | La recherche de lieu. | [Politique d'usage](https://operations.osmfoundation.org/policies/nominatim/) : une requête par seconde au plus, pas d'autocomplétion. L'éditeur ne cherche que sur **Entrée**, et jamais plus d'une fois par seconde. |
| **Open-Meteo** `api.open-meteo.com/v1/elevation` | Le relief (Copernicus DEM GLO-90). | Voir l'encadré. 100 coordonnées par requête au plus, et **600 altitudes par minute** pour une même connexion : chaque coordonnée compte pour un appel (en-têtes `x-ratelimit-*`, mesuré le 27 novembre 2026). L'éditeur envoie les requêtes l'une après l'autre, ne redemande jamais une altitude déjà reçue (gardées sur l'ordinateur d'une visite à l'autre), et quand l'API répond 429 il attend le délai qu'elle indique (`retry-after`). |
| **cdnjs** | Leaflet 1.9.4. | Fichiers épinglés par leur empreinte SRI (ci-dessous). |
| **Overture Maps** `tiles.overturemaps.org` | Le décor du lieu réel, à l'export (bâtiments, eau, sol). | Données ODbL (OpenStreetMap, Microsoft ML Buildings) et CC BY 4.0 (ESA WorldCover) : la mention est écrite dans `scenery.source`. Archives publiques lues par requêtes « Range », sans clé. |
| **jsDelivr** | Le décodeur des photos HEIC, libheif-js 1.23.5 (libheif en WebAssembly, LGPL-3.0, 2 Mo). | Chargé seulement quand une photo HEIC est importée, épinglé par son empreinte SRI (ci-dessous). |
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

Revérifié le 27 novembre 2026 au soir sur Kampot : `overpass-api.de` répond 200 à un
navigateur (mais 406 à `curl` sans en-tête `User-Agent` de navigateur) et une fois 502
depuis l'éditeur, `maps.mail.ru` répond (200 en 11 s, un 504), **`overpass.openstreetmap.fr`
refuse désormais** (403 « This service is only available to white-listed usages », sans
en-tête CORS : le navigateur n'y voit qu'une erreur de connexion). `overpass.private.coffee`
et `overpass.kumi.systems` ne répondent toujours pas. Le troisième serveur reste dans la
liste en attendant mieux ; quand les deux premiers échouent, le message « Connexion
impossible » vient de lui.

### Leaflet, le décodeur HEIC et leurs empreintes SRI

```
https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js
  sha512-puJW3E/qXDqYp9IfhAI54BJEaWIfloJ7JWs7OeD5i6ruC9JZL1gERT1wjtwXFlh7CjE7ZJ+/vcRZRkIYIb6p4g==
https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css
  sha512-h9FcoyWjHcOcmEVkxOfTLnmZFWIH0iZhZT1H2TbOq55xssQGEJHEaIm+PgoUaZbRvQTNTluNOEfb1ZRy6D3BOw==
```

Elles ont été calculées sur les fichiers téléchargés
(`openssl dgst -sha512 -binary leaflet.min.js | openssl base64 -A`) et sont égales à celles
que publie cdnjs (`https://api.cdnjs.com/libraries/leaflet/1.9.4?fields=sri`).

Le décodeur HEIC, chargé par la page seulement quand il sert :

```
https://cdn.jsdelivr.net/npm/libheif-js@1.23.5/libheif-wasm/libheif-bundle.js
  sha512-mvcRkE7mf1NkKszQkZ4N7sEeGMKFJcOe/3/j0Cddu+I6CdUx5P+32P1yjL7G12xd0gio1uqlc6Riye9+65NhDg==
```

calculée de même sur le fichier téléchargé, dont le sha256 est celui que publie jsDelivr
(`https://data.jsdelivr.com/v1/packages/npm/libheif-js@1.23.5`). Le test de
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
node --test tools/circuit-editor/test/                 # 131 tests, sans dépendance (essayé avec Node 26)
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
| `graph.test.mjs` | Pas de demi-tour à un point de passage (un étang dont le tour revenait sur ses pas, une impasse, un carrefour, deux points sur un segment) ; la lecture d'Overpass, la fusion par identifiant OSM, les classes exclues, l'index en grille contre un parcours complet, Dijkstra contre une version naïve, les longueurs partielles, deux points sur le même segment, les classes interdites, le cache des tronçons. |
| `export.test.mjs` | La fermeture de la boucle, la régularité de l'espacement, les longueurs, le schéma, les règles du format (indices croissants et bornés, écarts, pentes, point 0 à l'origine), largeurs et surfaces, checkpoints, portes, relief, lissage du relief (cas construit, et vraies altitudes de Kep), limite de 20 000 points, avertissements, réouverture à hash identique, catalogue. |
| `photos.test.mjs` | La lecture de la position GPS dans l'Exif (les deux ordres d'octets, les quatre hémisphères, altitude, date, direction, bloc après un premier segment, minutes absentes), les refus (sans Exif, sans GPS, position nulle, pas un JPEG), un fichier coupé à chaque octet ou abîmé octet par octet sans jamais planter ; la place d'une photo au bord du parcours, le côté selon le sens, l'écart admis, la limite de 24, le hash inchangé, la relecture d'un fichier, le tracé en cours sans les images ; les lieux et les rôles (ordre de prise de vue, choix à la main, relecture), l'angle de la boussole avec la route ; les archives zip (écrite par le `zipfile` de Python, ZIP64, coupée ou abîmée sans planter) ; la position d'une photo HEIC, métadonnées avant ou après l'image, et un HEIC abîmé octet par octet sans planter ; la fiche de `photos-brief.mjs`. |
| `scenery.test.mjs` | Le décor : les identifiants de tuile PMTiles contre le code de la spécification, une archive avec et sans répertoire feuille, les tuiles vectorielles (propriétés de chaque type, anneaux fermés, tuile coupée refusée), le plus petit rectangle d'un bâtiment, le décor d'une boucle (bâtiments gardés ou écartés, un bâtiment coupé par deux tuiles recollé, couverture par ordre d'affichage, usage bâti, étang et son île), la vérification d'un décor abîmé. |
| `objects.test.mjs` | Les objets posés : leur place dans le repère des points (arrondis, cap, taille), les objets refusés, ce que la vérification du champ refuse, la réouverture au même endroit, l'emprise et la flèche selon le cap (contre la rotation de Godot), le tracé en cours, la bibliothèque (identifiants valides et uniques, familles nommées, vignettes dans l'ordre, pas de mobilier de course), un circuit avec objets : même hash que sans, schéma, écriture et relecture, champ abîmé signalé sans rendre le fichier illisible. |
| `draft.test.mjs` | Le tracé en cours : il revient tel qu'il a été écrit, avec les zones de ses routes ; ce qui n'en est pas un est refusé, ce qui est inutilisable est écarté. Les cadres : leur clé, et si l'un contient l'autre. |
| `petit-circuit.test.mjs` | **Recette** : les points de passage du Petit Circuit des jeux, recalés et routés sur la carte d'aujourd'hui, donnent 7 089 m de jeu pour un tour à l'échelle 2,5, soit −0,15 % par rapport aux 7,1 km du circuit existant (tolérance : 3 %). Aucun point n'a dû être déplacé ; le plus éloigné de sa route en est à 50 m. |
| `property.test.mjs` | 160 parcours tirés au hasard sur les routes d'Angkor, avec des réglages et un relief au hasard (tirage à graine fixe) : tout fichier que le code accepte d'exporter respecte le schéma et les règles. |
| `fixtures.test.mjs` | Les fichiers d'exemple sont bien ceux que le code produit, le validateur de schéma refuse ce qu'il doit, la page n'appelle que Leaflet avec les bonnes empreintes et la bibliothèque des objets à côté d'elle, aucun jeton dans le dossier. |
| `e2e_playwright.py` | Dans un navigateur : charger les routes (avec un serveur Overpass en panne), poser quatre points, annuler, insérer, supprimer, déplacer, télécharger et valider le fichier, pointer le profil d'altitude et voir l'endroit sur la carte, changer le lissage du relief, l'envoyer à une API GitHub simulée (avec un conflit sur le catalogue), le rouvrir avec les routes gardées puis sans ; recharger une zone déjà gardée ; garder deux circuits dans « Mes circuits », passer de l'un à l'autre, en retirer un ; importer cinq fichiers (une photo près du parcours, une loin gardée en rouge, une sans position, une image PNG, un doublon), annuler l'import, resserrer l'écart admis, déposer une photo sur la carte, retrouver les photos après « Reprendre » et « Ouvrir… », importer un album en `.zip`, changer le rôle d'une photo et l'annuler, chercher un objet dans la bibliothèque, en poser deux sur la carte, les tourner, les agrandir, les déplacer, les supprimer, annuler, et les retrouver dans le fichier puis après « Ouvrir… », réduire une photo de 1 600 × 1 200 à 320 × 240, décoder deux photos HEIC avec le vrai décodeur chargé depuis jsDelivr (une seule fois), lire le décor depuis deux archives Overture simulées (requêtes « Range »), le retirer, l'export quand Overture est en panne ; commencer par un album sans aucun tracé (routes chargées autour des photos, tracé proposé par leurs lieux, un seul « Annuler ») ; les menus de la barre, la recherche de commandes (Ctrl+K), la feuille des raccourcis, le nom dans la barre, les étapes cochées, masquer le panneau (P), garder avec Ctrl+S ; laisser un tracé, le reprendre à la visite suivante sans redemander ni ses routes ni ses altitudes, puis une fois les routes oubliées, l'ignorer, l'effacer ; le redessiner à une autre visite sans redemander ses altitudes ; l'attente quand Open-Meteo a donné ses 600 altitudes de la minute. |

Dans `test/fixtures/` :

- `angkor-wat.overpass.json`, `angkor-petit-circuit.overpass.json.gz` : de vraies réponses
  d'Overpass, enregistrées le 26 novembre 2026 ;
- `open-meteo-sample-stage.json` : les vraies altitudes de la spéciale d'exemple ;
- `photo-base.jpg` et les `photo-*.jpg` : une petite image dessinée pour les tests, et la même avec une position GPS écrite
  par `make-fixtures.mjs` (près du parcours d'essai, loin, sans position) ;
- `photos-album.zip` : une archive écrite par le `zipfile` de Python (un dossier, deux photos,
  une copie sous un nom accentué, une image PNG), comme celle de « Tout télécharger » de
  Google Photos ; `make_album_zip.py` la réécrit ;
- `overture-buildings.pmtiles` et `overture-base.pmtiles` : deux petites archives inventées
  autour de la boucle d'essai (une maison tous les 60 m, des cultures, une forêt, un étang),
  écrites par `make-fixtures.mjs` ;
- `photo-near-2.heic` et `photo-near-2-late.heic` : `photo-near-2.jpg` encodée en HEIC par
  `heif-enc` (libheif), métadonnées avant l'image comme l'écrit un téléphone, puis après
  l'image comme dans un album téléchargé de Google Photos ; `make_heic_fixtures.py` les réécrit ;
- `kep-loop.elevations.json` : les vraies altitudes d'un tour de la colline de Kep, une tous
  les 30 m, enregistrées le 27 novembre 2026 ;
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
- **Le tracé en cours et « Mes circuits » sont gardés dans le navigateur de cet
  ordinateur** ([Le tracé en cours](#le-tracé-en-cours), [Mes circuits](#mes-circuits)) :
  ils ne suivent pas sur un autre ordinateur, et l'historique d'annulation ne survit pas à
  la fermeture. Un fichier téléchargé se rouvre partout avec « Ouvrir… ».
- **Le routage ne connaît que la longueur**, plus une seule règle (ci-dessous). Ni sens
  uniques, ni accès privés (`access=no`), ni préférence pour les grandes routes : au besoin,
  ajouter des points.
- **Pas de demi-tour à un point de passage.** Repartir d'un point de passage par où l'on
  est arrivé coûte 500 m de plus au routage : le tracé ne fait demi-tour que si aucun autre
  chemin n'est plus court d'autant (une impasse, par exemple). La boucle tient compte aussi
  du sens de départ pour se refermer. Un point à moins de 30 m d'un carrefour n'a pas de
  sens d'arrivée : le petit aller-retour qu'il fait est retiré à l'export, comme avant. Sans
  cette règle, autour de l'étang de Kampot, la boucle revenait sur ses 334 m plutôt que
  d'en faire 345 par la rue voisine. Les fichiers déjà faits (Petit Circuit, exemples)
  donnent le même tracé qu'avant.
- **La carte change.** Un circuit rouvert plus tard peut suivre un autre chemin si OSM a
  été modifié ; un point qui ne retrouve pas de route à moins de 40 m est signalé en rouge.
- **Relief de surface** : bosses dues au versant voisin, aux arbres et aux bâtiments, creux
  sous les ponts. « Lissage du relief » sur « Fort » retire ce qui fait moins de 300 m de long ;
  une forêt continue ou un versant longé sur un kilomètre restent dans le profil. Les tunnels
  ne sont pas pris en compte.
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
  sur cet ordinateur (IndexedDB `circuit-editor`, table `elevations`, 300 000 au plus) :
  retoucher le tracé, le redessiner un autre jour ou faire un autre circuit sur les mêmes
  routes ne redemande que le terrain nouveau. Le terrain ne bouge pas : elles n'expirent pas.
- **Overpass peut être lent ou saturé** ; l'éditeur change de serveur et le dit. Pour une zone
  déjà chargée un jour sur cet ordinateur, il n'en dépend plus
  ([Les routes gardées](#les-routes-gardées)).
- **L'envoi à GitHub n'a été essayé que contre une API simulée**, faute de jeton pendant le
  développement (les en-têtes CORS et la forme des réponses ont été contrôlés sur l'API
  réelle, sans authentification). Le premier envoi réel est à surveiller.
- **Le délai d'une mise à jour du catalogue n'est pas mesuré** ; celui d'une première
  publication l'est (section Publication).
- **Pas de suppression** : retirer un circuit publié se fait à la main, dans le dépôt
  (son fichier et sa ligne de `tracks/index.json`).
- La largeur indiquée par la carte n'est utilisée que pour les ponts.
