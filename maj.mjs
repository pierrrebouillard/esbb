// Mise a jour automatique du calendrier ESBB
// ------------------------------------------
// Lit les pages de competition du club sur monclubhouse.ffr.fr, y recupere les
// scores et les classements, puis reecrit le bloc de donnees de index.html.
//
// Les pages utilisees sont autorisees par le robots.txt du site (les pages
// /clubs/*/calendrier-resultats et les fiches match y sont interdites).
//
// Principe de prudence : le script ne cree ni ne supprime jamais de rencontre.
// Il ne fait qu'ajouter des scores et corriger des dates sur des rencontres
// deja presentes dans le fichier. En cas d'anomalie il s'arrete sans rien ecrire.

import fs from "node:fs";
import path from "node:path";

const RACINE = path.resolve(process.argv[2] || ".");
const FICHIER = path.join(RACINE, "index.html");
const DIAG = path.join(RACINE, "diagnostic.json");

const CLUB_FFR = "Entente Sp Bruges Blanquefort";

// Identifiants de competition, a revoir une fois par saison
// (ils se lisent sur la page Equipes du club sur monclubhouse).
const COMPETITIONS = [
  {
    nom: "Régionale 3",
    url: "https://monclubhouse.ffr.fr/clubs/entente-sp-bruges-blanquefort/competitions/nouvelle-aquitaine-regionale-3-championnat-territorial/qualification-50143",
  },
  {
    nom: "Fédérale 1 Féminine",
    url: "https://monclubhouse.ffr.fr/clubs/entente-sp-bruges-blanquefort/competitions/federale-1-feminine/qualification-50138",
  },
];

const SAISON = "2026-2027";

/* ------------------------------------------------------------------ outils */

export const sansAccent = (s) =>
  (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

function log(...a) {
  console.log(...a);
}

/* ------------------------------------------- lecture d'une page competition */

async function chargerPayload(url) {
  const rep = await fetch(url, {
    headers: {
      "User-Agent":
        "esbb-calendrier/1.0 (mise a jour hebdomadaire du calendrier du club)",
      "Accept-Language": "fr-FR,fr;q=0.9",
    },
  });
  if (!rep.ok) throw new Error(`HTTP ${rep.status} sur ${url}`);
  const html = await rep.text();

  // Les donnees sont livrees dans des appels self.__next_f.push([1,"...."])
  const morceaux = [];
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\[\s\S])*")\]\)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      morceaux.push(JSON.parse(m[1]));
    } catch {
      /* morceau illisible : on l'ignore */
    }
  }
  const flux = morceaux.join("");
  if (flux.length < 5000)
    throw new Error(`payload trop court (${flux.length} o) sur ${url}`);
  return flux;
}

/* --------------------------------------------------- extraction des equipes
   Chaque equipe expose la liste des identifiants de ses rencontres a domicile
   et a l'exterieur : c'est ce qui permet de savoir qui recoit, sans ambiguite. */

export function extraireEquipes(flux) {
  const equipes = [];
  const re = /"nomEdito":"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(flux)) !== null) {
    const nom = JSON.parse(`"${m[1]}"`);
    const fenetre = flux.slice(m.index, m.index + 3000);
    const loc = fenetre.match(/"RencontresLocales":\[([\d,]*)\]/);
    const ext = fenetre.match(/"RencontresExterieures":\[([\d,]*)\]/);
    if (!loc && !ext) continue;
    const nums = (s) =>
      s && s[1] ? s[1].split(",").filter(Boolean).map(Number) : [];
    const dom = nums(loc);
    const exte = nums(ext);
    if (!dom.length && !exte.length) continue;
    const deja = equipes.find((e) => e.nom === nom);
    if (deja) {
      deja.dom = [...new Set([...deja.dom, ...dom])];
      deja.ext = [...new Set([...deja.ext, ...exte])];
    } else {
      equipes.push({ nom, dom, ext: exte });
    }
  }
  return equipes;
}

/* ------------------------------------------------ extraction des rencontres */

export function extraireRencontres(flux) {
  const out = new Map();
  const re = /"id":(\d{6,}),"ordre":[^{}]*?"dateOfficielle":"([^"]+)"/g;
  let m;
  while ((m = re.exec(flux)) !== null) {
    const id = Number(m[1]);
    const fenetre = flux.slice(m.index, m.index + 1200);
    const eff = fenetre.match(/"dateEffective":"([^"]+)"/);
    const sl = fenetre.match(/"rencontreResultatLocaleFdmd":(null|\d+)/);
    const sv = fenetre.match(/"rencontreResultatVisiteuseFdmd":(null|\d+)/);
    const fin = fenetre.match(/"termine":(null|true|false)/);
    const iso = (eff && eff[1]) || m[2];
    out.set(id, {
      id,
      iso,
      scoreLocal: sl && sl[1] !== "null" ? Number(sl[1]) : null,
      scoreVisiteur: sv && sv[1] !== "null" ? Number(sv[1]) : null,
      termine: fin ? fin[1] === "true" : null,
    });
  }
  return out;
}

/* ------------------------------------------------ extraction du classement */

const CLES = {
  points: ["points", "pointsTerrain", "pointTerrain", "total"],
  joues: ["joues", "nbMatchs", "rencontresJouees", "matchsJoues"],
  gagnes: ["gagnes", "victoires", "nbVictoires"],
  nuls: ["nuls", "nbNuls", "egalites"],
  perdus: ["perdus", "defaites", "nbDefaites"],
  pour: ["pointsMarques", "pointsPour"],
  contre: ["pointsConcedes", "pointsEncaisses", "pointsContre"],
};

function valeur(obj, noms) {
  for (const n of noms) if (typeof obj[n] === "number") return obj[n];
  return 0;
}

export function extraireClassement(flux) {
  const lignes = [];
  const brut = [];
  const re = /"id":(\d+),"position":(\d+),"competitionEquipeId":\{/g;
  let m;
  while ((m = re.exec(flux)) !== null) {
    const fenetre = flux.slice(m.index, m.index + 4000);
    const nom = fenetre.match(/"nomEdito":"((?:[^"\\]|\\.)*)"/);
    const cl = fenetre.match(/"classementId":\{([^{}]*)\}/);
    if (!nom) continue;
    let stats = {};
    if (cl) {
      try {
        stats = JSON.parse("{" + cl[1] + "}");
      } catch {
        /* structure inattendue */
      }
    }
    const club = JSON.parse(`"${nom[1]}"`);
    if (lignes.some((l) => l.club === club)) continue;
    brut.push({ club, position: Number(m[2]), stats });
    lignes.push({
      club,
      position: Number(m[2]),
      points: valeur(stats, CLES.points),
      joues: valeur(stats, CLES.joues),
      gagnes: valeur(stats, CLES.gagnes),
      nuls: valeur(stats, CLES.nuls),
      perdus: valeur(stats, CLES.perdus),
      pour: valeur(stats, CLES.pour),
      contre: valeur(stats, CLES.contre),
    });
  }
  return { lignes, brut };
}

/* --------------------------------------------- lecture du fichier existant */

export function lireBloc(html) {
  const d = html.indexOf("/* @@DONNEES-DEBUT@@");
  const f = html.indexOf("/* @@DONNEES-FIN@@ */");
  if (d < 0 || f < 0) throw new Error("marqueurs @@DONNEES@@ introuvables");
  return { debut: d, fin: f + "/* @@DONNEES-FIN@@ */".length, bloc: html.slice(d, f) };
}

export function evaluerBloc(bloc, constantes) {
  const nettoye = constantes + "\n" + bloc
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*const\s+/gm, "var ");
  const fn = new Function(
    `${nettoye}; return { OFFICIEL: typeof OFFICIEL!=="undefined"?OFFICIEL:null,` +
      ` CLASSEMENTS: typeof CLASSEMENTS!=="undefined"?CLASSEMENTS:null };`
  );
  return fn();
}

/* ----------------------------------------------------- ecriture du fichier */

export function ecrireBloc(officiel, classements) {
  const m = (x) =>
    `    {c:${JSON.stringify(x.c)}, j:${JSON.stringify(x.j)}, date:${JSON.stringify(x.date)}, ` +
    `time:${JSON.stringify(x.time)}, lieu:${JSON.stringify(x.lieu)}, ` +
    `adv:${JSON.stringify(x.adv)}` +
    (x.sp != null ? `, sp:${x.sp}, sc:${x.sc}` : "") +
    `}`;

  let s = "/* @@DONNEES-DEBUT@@  bloc réécrit automatiquement chaque lundi — ne pas éditer à la main */\n";
  s += "const OFFICIEL = {\n";
  s += Object.keys(officiel)
    .sort()
    .reverse()
    .map(
      (saison) =>
        `  ${JSON.stringify(saison)}: [\n` +
        officiel[saison].map(m).join(",\n") +
        "\n  ]"
    )
    .join(",\n");
  s += "\n};\n\n";
  s += "const CLASSEMENTS = {\n";
  s += Object.keys(classements)
    .sort()
    .reverse()
    .map((saison) => {
      const comps = classements[saison];
      return (
        `  ${JSON.stringify(saison)}: {\n` +
        Object.keys(comps)
          .map((c) => {
            const o = comps[c];
            return (
              `    ${JSON.stringify(c)}: { maj:${JSON.stringify(o.maj)}, ` +
              `debut:${JSON.stringify(o.debut)}, lignes:[\n` +
              o.lignes.map((l) => "      " + JSON.stringify(l)).join(",\n") +
              "\n    ]}"
            );
          })
          .join(",\n") +
        "\n  }"
      );
    })
    .join(",\n");
  s += "\n};\n/* @@DONNEES-FIN@@ */";
  return s;
}

/* ------------------------------------------------------------------- main */

const lanceDirectement =
  process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href;
if (!lanceDirectement) { /* importé pour tests : on n'exécute rien */ }
else await principal();

async function principal() {

const html = fs.readFileSync(FICHIER, "utf8");
const { debut, fin, bloc } = lireBloc(html);
// les constantes de compétition sont définies hors du bloc
const constantes = (html.match(/^const (?:CLUB|R3|F1F|F2F|STADE_DEF)\s*=.*$/gm) || [])
  .join("\n")
  .replace(/^const /gm, "var ");
const { OFFICIEL, CLASSEMENTS } = evaluerBloc(bloc, constantes);
if (!OFFICIEL || !CLASSEMENTS) throw new Error("bloc de données illisible");

const matchs = OFFICIEL[SAISON];
if (!Array.isArray(matchs) || matchs.length < 5)
  throw new Error(`saison ${SAISON} absente ou trop courte`);

// dictionnaire nom FFR (sans accents) -> nom utilisé dans le fichier
const dico = new Map();
for (const s of Object.keys(OFFICIEL))
  for (const m of OFFICIEL[s]) dico.set(sansAccent(m.adv), m.adv);
for (const s of Object.keys(CLASSEMENTS))
  for (const c of Object.keys(CLASSEMENTS[s]))
    for (const l of CLASSEMENTS[s][c].lignes) dico.set(sansAccent(l[0]), l[0]);
const nomFichier = (ffr) => dico.get(sansAccent(ffr)) || ffr;

const aujourdhui = new Date().toISOString().slice(0, 10);
const diagnostic = { date: aujourdhui, competitions: {} };
let scoresAjoutes = 0,
  datesCorrigees = 0,
  classementsMaj = 0;

for (const comp of COMPETITIONS) {
  log(`\n--- ${comp.nom}`);
  let flux;
  try {
    flux = await chargerPayload(comp.url);
  } catch (e) {
    log(`  page illisible : ${e.message}`);
    diagnostic.competitions[comp.nom] = { erreur: e.message };
    continue;
  }

  const equipes = extraireEquipes(flux);
  const rencontres = extraireRencontres(flux);
  const { lignes, brut } = extraireClassement(flux);
  log(
    `  ${equipes.length} équipes, ${rencontres.size} rencontres, ${lignes.length} lignes de classement`
  );
  diagnostic.competitions[comp.nom] = {
    equipes: equipes.length,
    rencontres: rencontres.size,
    classementBrut: brut.slice(0, 3),
  };

  const moi = equipes.find((e) => sansAccent(e.nom) === sansAccent(CLUB_FFR));
  if (!moi) {
    log("  club introuvable dans la page, compétition ignorée");
    continue;
  }

  // rencontre -> adversaire + lieu
  const contexte = new Map();
  for (const id of moi.dom) contexte.set(id, { lieu: "dom" });
  for (const id of moi.ext) contexte.set(id, { lieu: "ext" });
  for (const e of equipes) {
    if (e === moi) continue;
    for (const id of [...e.dom, ...e.ext])
      if (contexte.has(id)) contexte.get(id).adv = nomFichier(e.nom);
  }

  for (const [id, ctx] of contexte) {
    const r = rencontres.get(id);
    if (!r || !ctx.adv) continue;
    const cible = matchs.find(
      (m) =>
        m.c === comp.nom &&
        m.lieu === ctx.lieu &&
        sansAccent(m.adv) === sansAccent(ctx.adv)
    );
    if (!cible) continue;

    const d = new Date(r.iso);
    const date = d.toISOString().slice(0, 10);
    const heure = r.iso.slice(11, 16);
    if (date && date !== cible.date) {
      log(`  date modifiée : ${cible.adv} ${cible.date} -> ${date}`);
      cible.date = date;
      datesCorrigees++;
    }
    if (heure && /^\d{2}:\d{2}$/.test(heure) && heure !== cible.time)
      cible.time = heure;

    if (r.scoreLocal != null && r.scoreVisiteur != null) {
      const sp = ctx.lieu === "dom" ? r.scoreLocal : r.scoreVisiteur;
      const sc = ctx.lieu === "dom" ? r.scoreVisiteur : r.scoreLocal;
      if (cible.sp !== sp || cible.sc !== sc) {
        log(`  score : ${cible.adv} -> ${sp}-${sc}`);
        cible.sp = sp;
        cible.sc = sc;
        scoresAjoutes++;
      }
    }
  }

  if (lignes.length >= 4) {
    const cl = (CLASSEMENTS[SAISON] ||= {});
    const ancien = cl[comp.nom];
    cl[comp.nom] = {
      maj: aujourdhui,
      debut: ancien ? ancien.debut : matchs.find((m) => m.c === comp.nom)?.date || aujourdhui,
      lignes: lignes.map((l) => [
        nomFichier(l.club),
        l.points,
        l.joues,
        l.gagnes,
        l.nuls,
        l.perdus,
        l.pour,
        l.contre,
      ]),
    };
    classementsMaj++;
  }
}

// garde-fou : on n'ecrit que si quelque chose a bouge
if (!scoresAjoutes && !datesCorrigees && !classementsMaj) {
  log("\nRien de neuf, fichier inchangé.");
  fs.writeFileSync(DIAG, JSON.stringify(diagnostic, null, 2));
  process.exit(0);
}

const nouveau = html.slice(0, debut) + ecrireBloc(OFFICIEL, CLASSEMENTS) + html.slice(fin);

// verification : la taille ne doit pas s'effondrer
if (nouveau.length < html.length * 0.9)
  throw new Error("le fichier réécrit est anormalement plus court, écriture annulée");

fs.writeFileSync(FICHIER, nouveau);
fs.writeFileSync(DIAG, JSON.stringify(diagnostic, null, 2));
log(
  `\nÉcrit : ${scoresAjoutes} score(s), ${datesCorrigees} date(s), ${classementsMaj} classement(s).`
);
}
