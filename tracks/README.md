# Circuits perso

Ce dossier contient les circuits dessinés avec l'éditeur
[`tools/circuit-editor/`](../tools/circuit-editor/) pour 3D Buggy / Dustline Rally et
Cambodia Rally.

- `index.json` : le catalogue que les jeux lisent (« Circuits perso → Actualiser »).
- `<id>.cambotrack.json` : un fichier par circuit.

Le format des deux est décrit dans
[`tools/circuit-editor/FORMAT.md`](../tools/circuit-editor/FORMAT.md).

Ces fichiers sont écrits par l'éditeur (bouton « Envoyer au jeu ») : mieux vaut ne pas
les modifier à la main, car chaque circuit porte un hash que les jeux recalculent, et le
catalogue doit citer le même. Pour retirer un circuit, supprimer son fichier **et** sa
ligne dans `index.json`.

Données cartographiques © les contributeurs d'OpenStreetMap, sous licence ODbL 1.0 ;
relief : Copernicus DEM GLO-90 via Open-Meteo.
