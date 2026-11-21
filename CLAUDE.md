# Chantrea Systems — stefan-cambodia.github.io

Site statique (HTML, CSS, JavaScript sans compilation) servi par GitHub Pages depuis `main`.
Trois langues partout : anglais, français, khmer (`data-l="en|fr|km"` sur les pages, `copy` dans `index.html`).

## Historique des projets suivis — règle permanente (depuis le 21 novembre 2026)

Stefan veut garder l'historique de chaque projet suivi. Une page de `games/` ou `projects/` est suivie
quand elle a une section Derniers changements (`class="changes"`). Chacune a sa page d'historique,
`history/<slug>.html`, générée par `tools/history/build.py` à partir de l'historique Git du site ;
`history/index.html` les liste toutes.

À chaque modification d'une page suivie (texte, captures, vidéos, Derniers changements) :

1. **Ne jamais régénérer** une capture ou une vidéo d'une version antérieure : pas de nouvelle capture
   d'une ancienne version, pas de reconstruction d'un ancien build. Ce que le site n'a pas publié à
   l'époque n'apparaît pas dans l'historique, et c'est voulu.
2. Remplacer ou supprimer une capture ou une vidéo se fait normalement dans `assets/screenshots/<slug>/`
   ou `assets/videos/<slug>/` : l'ancienne version reste dans Git, et le script la recopie à l'identique
   dans `assets/history/<slug>/<date>-<commit>/`. Ne jamais toucher à `assets/history/`, ni réécrire
   l'historique Git (pas de rebase ni de force-push sur `main`, pas de `filter-repo` ni de migration LFS
   sur les captures) : c'est la source de l'historique.
3. Quand les Derniers changements d'une page sont rafraîchis, les résumés qui quittent la page sont
   recopiés mot pour mot, dans les trois langues, dans `tools/history/entries.json`, sous
   `pages.<slug>.retired.<hash court du commit qui les retire>` (voir l'exemple d'`angkor`).
4. Après le commit de la page :
   - écrire dans `tools/history/entries.json` le texte de cette version : `pages.<slug>.<hash court>`,
     avec un titre et un résumé en `en`, `fr` et `km` (les faits viennent du dépôt du projet) ;
   - lancer `python3 tools/history/build.py` (historique Git complet requis, pas de clone superficiel) ;
   - vérifier la page d'historique, puis committer `history/`, `assets/history/` et `entries.json`
     dans un commit séparé, intitulé `History: …`.
   Un commit qui change des captures sans texte dans `entries.json` apparaît quand même, avec son sujet
   en anglais : rien n'est perdu, mais le résumé manque.
5. Une nouvelle page suivie (nouvelle section Derniers changements) obtient son historique au prochain
   lancement du script ; lui ajouter un bouton « History » dans le bandeau et le lien `changes-more`
   sous ses Derniers changements, comme les autres pages.

## Section « En développement » de l'accueil

La section `#dev` présente les projets encore en chantier, suivis version par version (pour l'instant :
Angkor World Engine, dépôt `angkor`). Pour y mettre un projet : une `article.dev-card` avec `data-repo` et
`data-dev` au nom exact du dépôt (cela le retire de la grille Projets et affiche la date de son dernier
envoi, lue sur GitHub), ses textes dans `copy` en trois langues, et sur sa page le surtitre et les liens
de retour vers `#dev`. Suivre un projet, c'est tenir sa page et ses Derniers changements à jour avec son
dépôt, en appliquant la règle d'historique ci-dessus.
