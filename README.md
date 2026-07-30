# Calendrier ESBB

Calendrier, résultats et classement de l'**Entente SP Bruges Blanquefort** (rugby).

**Le site : https://esbb-rugby.github.io/**

## Ce que contient le dépôt

| Fichier | Rôle |
|---|---|
| `index.html` | Le site entier. Aucune dépendance externe : logos, blason et styles sont dans le fichier. Il fonctionne même hors connexion. |
| `logo.png` | Icône du site (aperçu lors d'un partage, ajout à l'écran d'accueil). |
| `maj.mjs` | Le programme qui va lire monclubhouse.ffr.fr et met à jour les données. |
| `.github/workflows/mise-a-jour.yml` | Le déclencheur : lance le programme tous les lundis matin. |
| `diagnostic.json` | Écrit à chaque passage. Sert à comprendre ce que le programme a vu si quelque chose cloche. |
| `test-classement.mjs`, `test-bout-en-bout.mjs` | Essais hors ligne, à lancer avant de toucher à `maj.mjs`. |

## Mise à jour

Elle est automatique. Chaque lundi à 8h (heure de Paris), GitHub exécute
`maj.mjs`, qui relit les pages de poule sur monclubhouse, récupère les
scores du week-end et les classements, puis réécrit le bloc de données de
`index.html`. S'il y a du changement, il est publié et le site se met à jour
tout seul en une minute.

Pour déclencher une mise à jour sans attendre lundi : onglet **Actions** →
*Mise à jour du calendrier* → **Run workflow**.

### Où sont les données, exactement

Pour chaque compétition, tout vient de la page de **poule** (vérifié sur la
saison 2025-2026, qui est jouée) :

| Adresse | Ce qu'on y trouve |
|---|---|
| `.../qualification-XXXXX/POULE` | le classement complet : points, joués, V/N/D, points pour et contre |
| `.../qualification-XXXXX/POULE/calendrier-resultats` | les journées, les rencontres et les scores |
| `.../qualification-XXXXX/POULE/classement` | **rien** : cette page est remplie par le navigateur |
| la fiche club de la compétition | **le nombre de points seulement**, sans le détail |

Les chiffres portent les noms `pointTerrain`, `joues`, `gagnes`, `nuls`,
`perdus`, `pointsDeMarqueAcquis`, `pointsDeMarqueConcedes`. Si la FFR les
renommait, `diagnostic.json` garde une copie brute de deux lignes de
classement : il suffit d'y lire les nouveaux noms et de les ajouter dans
`CLES`, en haut de `maj.mjs`.

`diagnostic.json` porte aussi `detailClassement`. À `false` alors que des
matchs sont joués, cela veut dire que le classement est arrivé sans son
détail : le tableau n'affichera que les points.

### Garde-fous

Le programme ne crée ni ne supprime jamais de rencontre : il se contente
d'ajouter des scores et de corriger des dates sur des matchs déjà présents.
Si une page est illisible, si le fichier réécrit est anormalement court ou si
les repères `@@DONNEES@@` ont disparu, il s'arrête sans rien écrire. En cas
d'échec, GitHub envoie un mail.

Avant toute modification de `maj.mjs` :

```
node test-classement.mjs     # lecture du classement, dans les deux ordres de clés
node test-bout-en-bout.mjs   # une mise à jour complète, sur des pages factices
```

Le second rejoue un passage entier sans toucher au dépôt : il vérifie que les
scores tombent dans le bon sens, que les 32 rencontres sont conservées, et
qu'un deuxième passage sans nouveauté n'écrit rien.

### Une fois par saison

Les identifiants de compétition changent chaque été. Ils sont en haut de
`maj.mjs`, dans `COMPETITIONS`. On les relève sur la page *Équipes* du
club sur monclubhouse (les liens s'y terminent par `qualification-XXXXX`) ;
le numéro de poule se lit ensuite dans l'adresse de la page de la
compétition. C'est aussi le moment d'ajouter une équipe qui monte ou qui
descend.

## Liens directs

À partager dans le groupe de l'équipe :

- `?equipe=Régionale 3` — le calendrier des seniors
- `?equipe=Fédérale 1 Féminine&vue=rank` — le classement des féminines
- `?vue=jour` — tous les résultats de la poule, journée par journée
- `?vue=list` — la vue date par date
- `?saison=2025-2026` — l'archive de la saison précédente

## Sources

Toutes les données viennent de [monclubhouse.ffr.fr](https://monclubhouse.ffr.fr/clubs/entente-sp-bruges-blanquefort),
le site officiel de la Fédération française de rugby. Le programme n'utilise
que des pages autorisées par le `robots.txt` du site.
