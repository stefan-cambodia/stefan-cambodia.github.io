# Feuille de route de l'éditeur de circuits

Ce qui est fait, ce qui vient ensuite, dans l'ordre. Le point de départ est la mission du
26 novembre 2026 (« Partie A : l'éditeur web ») ; tout ce qu'elle demandait à l'éditeur
est fait. La suite vient des demandes de Stefan depuis, et des limites écrites dans
[`README.md`](README.md) (« Limites connues »). Une étape marquée **attend Stefan** ne peut
pas avancer sans lui : un jeton, un accord pour fusionner ou publier, un essai sur le
téléphone.

## Fait

| Étape | Contenu | Où |
|---|---|---|
| 1 | Carte (OSM, satellite, relief), recherche de lieux, préréglages | `main` du site (PR #1), 27 nov. |
| 2 | Routes d'Overpass (serveur de secours), routage sur les vraies routes, boucle ou spéciale, annuler / rétablir | idem |
| 3 | Relief Open-Meteo, profil, dénivelé ; export `.cambotrack.json` avec son hash ; « Envoyer au jeu » par l'API GitHub | idem |
| 4 | Recette : le Petit Circuit refait à −0,15 % de sa longueur | idem |
| 5 | Programme de l'ordinateur (`editeur-circuits`), tracé en cours gardé, lissage du relief | branche `editor/resume` |
| 6 | Routes gardées sur l'ordinateur, profil relié à la carte, « Mes circuits » | idem |
| 7 | Photos (JPEG, HEIC, album Google Photos en `.zip`), lieux et rôles, tracé proposé à partir des photos, pas de demi-tour aux points de passage | idem |
| 8 | Décor du lieu réel (Overture Maps : bâtiments, eau, sol) écrit dans le fichier | idem |
| 9 | **Bibliothèque des objets** : les 379 objets de décor du jeu (59 de plus le 28 nov. : lieux de culte, fêtes, village et rivière, la rue, les grands bâtiments de ville), avec vignettes, recherche et familles ; pose à la main sur la carte, orientation, taille, déplacement, duplication, suppression ; champ `objects` du format | idem, 28 nov. ; le jeu les construit (`main` de 3D Buggy, PR #20) |
| 13 | **Poser en ligne** : une rangée droite entre deux clics, ou le long du tracé à la même distance, chaque objet face à la route ; l'objet à venir suit le pointeur ; R le tourne pendant la pose | idem, 28 nov. |
| 11 a | **Éditeur publié** : `editor/resume` fusionnée dans `main` du site (PR #2) ; la page en ligne est celle de l'ordinateur (photos, décor, objets, altitudes gardées) | `main` du site, 28 nov. |
| 12 a | **Le décor et les objets dans le jeu** : `feature/custom-scenery` fusionnée dans `main` de 3D Buggy (PR #20) | `main` de 3D Buggy, 28 nov. |

## À faire, dans l'ordre

| Étape | Contenu | Terminé quand | Attend |
|---|---|---|---|
| 10 | **Premier envoi réel** au catalogue avec « Envoyer au jeu », et le délai de mise à jour d'un catalogue déjà publié (`measure-publish-delay.mjs`, lancé avant l'envoi) | un circuit envoyé depuis l'éditeur apparaît dans « Circuits perso » du jeu ; le délai est écrit dans le README (section Publication) | **Stefan** : un jeton GitHub fine-grained (Contents, lecture et écriture, ce seul dépôt) |
| 11 b | **La page 3D Buggy du site** dit que l'écran « Circuits perso » existe (page suivie : règle d'historique du `CLAUDE.md` du site) | l'historique de la page 3D Buggy est régénéré | **Stefan** : accord pour changer la page publiée |
| 12 b | **Sur le téléphone** : APK de `main`, un circuit avec décor et objets couru sur le Galaxy A56 | le circuit se construit et se court, images par seconde mesurées depuis l'état thermique 0 | **Stefan** : téléphone libre |
| 14 | **Objets sur la route** : tremplins et portes posés à la main, qui touchent la course (aujourd'hui le jeu les place lui-même ; ils sont hors de la bibliothèque) | un tremplin posé dans l'éditeur se saute dans le jeu ; le format dit s'il entre dans le hash | décision de Stefan (le hash change avec eux) |
| 15 | **Retirer un circuit publié** depuis l'éditeur (son fichier et sa ligne du catalogue), avec confirmation | le circuit disparaît du catalogue, le jeu ne le propose plus au téléchargement | jeton, comme l'étape 10 |

## Laissé de côté, sauf demande

- Préférer les grandes routes au routage : un pilote de rallye veut peut-être les pistes.
- Les tunnels dans le relief, les sens uniques, les accès privés.
- Un éditeur 3D, l'éditeur sur téléphone : hors du périmètre de départ (l'éditeur est fait
  pour un ordinateur).
- Cambodia Rally : il ne reçoit pas les circuits perso pour l'instant (décision du
  27 novembre 2026), et donc pas non plus les objets posés.
