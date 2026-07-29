# Calendrier ESBB

Calendrier, résultats et classement de l'**Entente SP Bruges Blanquefort** (rugby).

**Le site : https://pierrrebouillard.github.io/esbb/**

## Ce que contient le dépôt

| Fichier | Rôle |
|---|---|
| `index.html` | Le site entier. Aucune dépendance externe : logos, blason et styles sont dans le fichier. Il fonctionne même hors connexion. |
| `logo.png` | Icône du site (aperçu lors d'un partage, ajout à l'écran d'accueil). |
| `maj.mjs` | Le programme qui va lire monclubhouse.ffr.fr et met à jour les données. |
| `.github/workflows/mise-a-jour.yml` | Le déclencheur : lance le programme tous les lundis matin. |
| `diagnostic.json` | Écrit à chaque passage. Sert à comprendre ce que le programme a vu si quelque chose cloche. |

## Mise à jour

Elle est automatique. Chaque lundi à 8h (heure de Paris), GitHub exécute
`maj.mjs`, qui relit les pages de compétition du club, récupère les
scores du week-end et les classements, puis réécrit le bloc de données de
`index.html`. S'il y a du changement, il est publié et le site se met à jour
tout seul en une minute.

Pour déclencher une mise à jour sans attendre lundi : onglet **Actions** →
*Mise à jour du calendrier* → **Run workflow**.

### Garde-fous

Le programme ne crée ni ne supprime jamais de rencontre : il se contente
d'ajouter des scores et de corriger des dates sur des matchs déjà présents.
Si une page est illisible, si le fichier réécrit est anormalement court ou si
les repères `@@DONNEES@@` ont disparu, il s'arrête sans rien écrire. En cas
d'échec, GitHub envoie un mail.

### Une fois par saison

Les identifiants de compétition changent chaque été. Ils sont en haut de
`maj.mjs`, dans `COMPETITIONS`. On les relève sur la page *Équipes* du
club sur monclubhouse (les liens s'y terminent par `qualification-XXXXX`).
C'est aussi le moment d'ajouter une équipe qui monte ou qui descend.

## Liens directs

À partager dans le groupe de l'équipe :

- `?equipe=Régionale 3` — le calendrier des seniors
- `?equipe=Fédérale 1 Féminine&vue=rank` — le classement des féminines
- `?vue=list` — la vue date par date
- `?saison=2025-2026` — l'archive de la saison précédente

## Sources

Toutes les données viennent de [monclubhouse.ffr.fr](https://monclubhouse.ffr.fr/clubs/entente-sp-bruges-blanquefort),
le site officiel de la Fédération française de rugby. Le programme n'utilise
que des pages autorisées par le `robots.txt` du site.
