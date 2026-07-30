// Mise a jour automatique du calendrier ESBB
// ------------------------------------------
// Deux sources, toutes deux autorisees par le robots.txt de monclubhouse :
//   - la page de POULE : toutes les rencontres, journee par journee, avec les scores
//   - la fiche CLUB de la competition : le classement
// (les pages /clubs/*/calendrier-resultats et les fiches match y sont interdites)
//
// Principe de prudence : le script ne cree ni ne supprime jamais de rencontre
// dans le calendrier de l'ESBB. Il ne fait qu'ajouter des scores et corriger
// des dates. En cas d'anomalie il s'arrete sans rien ecrire.

import fs from "node:fs";
import path from "node:path";

const RACINE = path.resolve(process.argv[2] || ".");
const FICHIER = path.join(RACINE, "index.html");
const DIAG = path.join(RACINE, "diagnostic.json");

const CLUB_FFR = "Entente Sp Bruges Blanquefort";
const SAISON = "2026-2027";

// Identifiants a revoir une fois par saison.
// Ils se lisent sur https://monclubhouse.ffr.fr/clubs/entente-sp-bruges-blanquefort/equipes
// (liens en qualification-XXXXX), et l'identifiant de poule apparait dans la page
// de la competition, cle "pouleId".
const COMPETITIONS = [
  {
    nom: "Régionale 3",
    club: "https://monclubhouse.ffr.fr/clubs/entente-sp-bruges-blanquefort/competitions/nouvelle-aquitaine-regionale-3-championnat-territorial/qualification-50143",
    poule: "https://monclubhouse.ffr.fr/regionales/nouvelle-aquitaine/nouvelle-aquitaine-regionale-3-championnat-territorial/qualification-50143/73076/calendrier-resultats",
  },
  {
    nom: "Fédérale 1 Féminine",
    club: "https://monclubhouse.ffr.fr/clubs/entente-sp-bruges-blanquefort/competitions/federale-1-feminine/qualification-50138",
    poule: "https://monclubhouse.ffr.fr/nationales/federale-1-feminine/qualification-50138/73056/calendrier-resultats",
  },
];

/* ------------------------------------------------------------------ outils */

export const sansAccent = (s) =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

const log = (...a) => console.log(...a);

/* ------------------------------------------------- lecture d'une page FFR
   Les donnees arrivent dans des appels self.__next_f.push([1,"...."]) :
   on recolle les morceaux pour obtenir un flux ou lire du JSON. */

async function chargerFlux(url) {
  const rep = await fetch(url, {
    headers: {
      "User-Agent": "esbb-calendrier/2.0 (mise a jour hebdomadaire du calendrier du club)",
      "Accept-Language": "fr-FR,fr;q=0.9",
    },
  });
  if (!rep.ok) throw new Error(`HTTP ${rep.status}`);
  const html = await rep.text();
  const morceaux = [];
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\[\s\S])*")\]\)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    try { morceaux.push(JSON.parse(m[1])); } catch { /* morceau illisible */ }
  }
  const flux = morceaux.join("");
  if (flux.length < 5000) throw new Error(`flux trop court (${flux.length} o)`);
  return flux;
}

/* --------------------------- extraction d'un objet JSON par equilibrage
   On part d'une cle connue, on remonte a l'accolade ouvrante, puis on avance
   en comptant les accolades tout en sautant le contenu des chaines. */

function objetAutour(flux, position) {
  const deb = flux.lastIndexOf("{", position);
  if (deb < 0) return null;
  let prof = 0;
  for (let k = deb; k < flux.length; k++) {
    const c = flux[k];
    if (c === '"') {
      k++;
      while (k < flux.length && !(flux[k] === '"' && flux[k - 1] !== "\\")) k++;
      continue;
    }
    if (c === "{") prof++;
    else if (c === "}") {
      prof--;
      if (prof === 0) {
        try { return { obj: JSON.parse(flux.slice(deb, k + 1)), fin: k }; }
        catch { return { obj: null, fin: k }; }
      }
    }
  }
  return null;
}

/* --------------------------------- toutes les rencontres de la poule
   La page de poule livre un objet par journee :
   { listTitle:"Journee N", listData:[ { dateEffective, scores, equipes } ] } */

export function extraireJournees(flux) {
  const brut = [];
  let p = 0;
  while (true) {
    const i = flux.indexOf('"listTitle":"Journ', p);
    if (i < 0) break;
    const r = objetAutour(flux, i);
    if (!r) break;
    p = r.fin;
    const o = r.obj;
    if (!o) continue;
    const num = String(o.listTitle || "").match(/(\d+)/);
    if (!num) continue;
    const matchs = (o.listData || [])
      .map((x) => {
        const loc = x.competitionEquipeLocaleId || {};
        const vis = x.competitionEquipeVisiteuseId || {};
        const sl = x.rencontreResultatLocaleFdmd;
        const sv = x.rencontreResultatVisiteuseFdmd;
        return [
          String(x.dateEffective || x.dateOfficielle || "").slice(0, 16),
          loc.nomEdito || "",
          vis.nomEdito || "",
          typeof sl === "number" ? sl : null,
          typeof sv === "number" ? sv : null,
        ];
      })
      .filter((m) => m[0] && m[1] && m[2]);
    if (matchs.length) brut.push({ j: "J" + num[1], matchs });
  }
  // une journee peut apparaitre plusieurs fois dans le flux : on garde la plus fournie
  const parJ = new Map();
  for (const x of brut) {
    const a = parJ.get(x.j);
    if (!a || x.matchs.length > a.matchs.length) parJ.set(x.j, x);
  }
  return [...parJ.values()].sort((a, b) => +a.j.slice(1) - +b.j.slice(1));
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
const valeur = (o, noms) => {
  for (const n of noms) if (typeof o[n] === "number") return o[n];
  return 0;
};

export function extraireClassement(flux) {
  const lignes = [];
  const brut = [];
  const re = /"id":(\d+),"position":(\d+),"competitionEquipeId":\{/g;
  let m;
  while ((m = re.exec(flux)) !== null) {
    const fen = flux.slice(m.index, m.index + 4000);
    const nom = fen.match(/"nomEdito":"((?:[^"\\]|\\.)*)"/);
    const cl = fen.match(/"classementId":\{([^{}]*)\}/);
    if (!nom) continue;
    let stats = {};
    if (cl) { try { stats = JSON.parse("{" + cl[1] + "}"); } catch { /* structure inattendue */ } }
    const club = JSON.parse(`"${nom[1]}"`);
    if (lignes.some((l) => l.club === club)) continue;
    brut.push({ club, position: Number(m[2]), stats });
    lignes.push({
      club, position: Number(m[2]),
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

const MARQUE_DEB = "/* @@DONNEES-DEBUT@@";
const MARQUE_FIN = "/* @@DONNEES-FIN@@ */";

export function lireBloc(html) {
  const d = html.indexOf(MARQUE_DEB);
  const f = html.indexOf(MARQUE_FIN);
  if (d < 0 || f < 0) throw new Error("marqueurs @@DONNEES@@ introuvables");
  return { debut: d, fin: f + MARQUE_FIN.length, bloc: html.slice(d, f) };
}

export function evaluerBloc(bloc, constantes) {
  const nettoye = constantes + "\n" + bloc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*const\s+/gm, "var ");
  const fn = new Function(
    `${nettoye}; return {
       OFFICIEL: typeof OFFICIEL!=="undefined"?OFFICIEL:null,
       CLASSEMENTS: typeof CLASSEMENTS!=="undefined"?CLASSEMENTS:null,
       JOURNEES: typeof JOURNEES!=="undefined"?JOURNEES:{} };`
  );
  return fn();
}

/* ----------------------------------------------------- ecriture du fichier */

export function ecrireBloc(officiel, journees, classements) {
  const saisons = (o) => Object.keys(o).sort().reverse();

  const unMatch = (x) =>
    `    {c:${JSON.stringify(x.c)}, j:${JSON.stringify(x.j)}, date:${JSON.stringify(x.date)}, ` +
    `time:${JSON.stringify(x.time)}, lieu:${JSON.stringify(x.lieu)}, adv:${JSON.stringify(x.adv)}` +
    (x.sp != null ? `, sp:${x.sp}, sc:${x.sc}` : "") + `}`;

  let s = MARQUE_DEB + "  bloc réécrit automatiquement chaque lundi — ne pas éditer à la main */\n";

  s += "const OFFICIEL = {\n";
  s += saisons(officiel)
    .map((sa) => `  ${JSON.stringify(sa)}: [\n` + officiel[sa].map(unMatch).join(",\n") + "\n  ]")
    .join(",\n");
  s += "\n};\n\n";

  s += "/* Résultats de toute la poule, journée par journée (rempli chaque lundi) */\n";
  s += "const JOURNEES = {\n";
  s += saisons(journees)
    .map((sa) => {
      const comps = journees[sa];
      return `  ${JSON.stringify(sa)}: {\n` + Object.keys(comps).map((c) => {
        const o = comps[c];
        return `    ${JSON.stringify(c)}: { maj:${JSON.stringify(o.maj)}, journees:[\n` +
          o.journees.map((x) =>
            `      {j:${JSON.stringify(x.j)}, matchs:[` +
            x.matchs.map((m) => JSON.stringify(m)).join(",") + `]}`).join(",\n") +
          "\n    ]}";
      }).join(",\n") + "\n  }";
    })
    .join(",\n");
  s += "\n};\n\n";

  s += "const CLASSEMENTS = {\n";
  s += saisons(classements)
    .map((sa) => {
      const comps = classements[sa];
      return `  ${JSON.stringify(sa)}: {\n` + Object.keys(comps).map((c) => {
        const o = comps[c];
        return `    ${JSON.stringify(c)}: { maj:${JSON.stringify(o.maj)}, debut:${JSON.stringify(o.debut)}, lignes:[\n` +
          o.lignes.map((l) => "      " + JSON.stringify(l)).join(",\n") + "\n    ]}";
      }).join(",\n") + "\n  }";
    })
    .join(",\n");
  s += "\n};\n" + MARQUE_FIN;
  return s;
}

/* ------------------------------------------------------------------- main */

const lanceDirectement =
  process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href;
if (lanceDirectement) await principal();

async function principal() {
  const html = fs.readFileSync(FICHIER, "utf8");
  const { debut, fin, bloc } = lireBloc(html);
  const constantes = (html.match(/^const (?:CLUB|R3|F1F|F2F|STADE_DEF)\s*=.*$/gm) || [])
    .join("\n").replace(/^const /gm, "var ");
  const { OFFICIEL, CLASSEMENTS, JOURNEES } = evaluerBloc(bloc, constantes);
  if (!OFFICIEL || !CLASSEMENTS) throw new Error("bloc de données illisible");

  const matchs = OFFICIEL[SAISON];
  if (!Array.isArray(matchs) || matchs.length < 5)
    throw new Error(`saison ${SAISON} absente ou trop courte`);

  // dictionnaire nom FFR (sans accents) -> nom utilise dans le fichier,
  // pour que logos et stades continuent de se rattacher
  const dico = new Map();
  for (const sa of Object.keys(OFFICIEL)) for (const m of OFFICIEL[sa]) dico.set(sansAccent(m.adv), m.adv);
  for (const sa of Object.keys(CLASSEMENTS))
    for (const c of Object.keys(CLASSEMENTS[sa]))
      for (const l of CLASSEMENTS[sa][c].lignes) dico.set(sansAccent(l[0]), l[0]);
  dico.set(sansAccent(CLUB_FFR), "Entente SP Bruges Blanquefort");
  const nomFichier = (ffr) => dico.get(sansAccent(ffr)) || ffr;

  const aujourdhui = new Date().toISOString().slice(0, 10);
  const diagnostic = { date: aujourdhui, competitions: {} };
  let scores = 0, dates = 0, classements = 0, poules = 0;

  for (const comp of COMPETITIONS) {
    log(`\n--- ${comp.nom}`);
    const info = {};
    diagnostic.competitions[comp.nom] = info;

    /* ---------- 1. la poule : toutes les rencontres ---------- */
    let journees = [];
    try {
      const flux = await chargerFlux(comp.poule);
      journees = extraireJournees(flux).map((x) => ({
        j: x.j,
        matchs: x.matchs.map((m) => [m[0], nomFichier(m[1]), nomFichier(m[2]), m[3], m[4]]),
      }));
      info.journees = journees.length;
      info.rencontres = journees.reduce((a, x) => a + x.matchs.length, 0);
      log(`  poule : ${info.journees} journées, ${info.rencontres} rencontres`);
    } catch (e) {
      info.erreurPoule = e.message;
      log(`  poule illisible : ${e.message}`);
    }

    if (journees.length >= 2) {
      const jn = (JOURNEES[SAISON] ||= {});
      const avant = JSON.stringify((jn[comp.nom] || {}).journees || []);
      jn[comp.nom] = { maj: aujourdhui, journees };
      if (JSON.stringify(journees) !== avant) poules++;

      /* les scores de l'ESBB se lisent dans les memes donnees */
      const moi = sansAccent(CLUB_FFR);
      for (const x of journees) {
        for (const [iso, dom, ext, sd, se] of x.matchs) {
          const estDom = sansAccent(dom) === moi;
          const estExt = sansAccent(ext) === moi;
          if (!estDom && !estExt) continue;
          const adv = estDom ? ext : dom;
          const cible = matchs.find(
            (m) => m.c === comp.nom && m.lieu === (estDom ? "dom" : "ext") &&
                   sansAccent(m.adv) === sansAccent(adv)
          );
          if (!cible) continue;

          const jour = iso.slice(0, 10);
          const heure = iso.slice(11, 16);
          if (jour && jour !== cible.date) {
            log(`  date modifiée : ${cible.adv} ${cible.date} -> ${jour}`);
            cible.date = jour; dates++;
          }
          if (/^\d{2}:\d{2}$/.test(heure) && heure !== cible.time) cible.time = heure;
          if (!cible.j && x.j) cible.j = x.j;

          if (sd != null && se != null) {
            const sp = estDom ? sd : se;
            const sc = estDom ? se : sd;
            if (cible.sp !== sp || cible.sc !== sc) {
              log(`  score : ${cible.adv} -> ${sp}-${sc}`);
              cible.sp = sp; cible.sc = sc; scores++;
            }
          }
        }
      }
    }

    /* ---------- 2. la fiche club : le classement ---------- */
    try {
      const flux = await chargerFlux(comp.club);
      const { lignes, brut } = extraireClassement(flux);
      info.classement = lignes.length;
      info.classementBrut = brut.slice(0, 3);
      log(`  classement : ${lignes.length} lignes`);
      if (lignes.length >= 4) {
        const cl = (CLASSEMENTS[SAISON] ||= {});
        const ancien = cl[comp.nom];
        cl[comp.nom] = {
          maj: aujourdhui,
          debut: ancien ? ancien.debut : (matchs.find((m) => m.c === comp.nom) || {}).date || aujourdhui,
          lignes: lignes.map((l) => [nomFichier(l.club), l.points, l.joues, l.gagnes, l.nuls, l.perdus, l.pour, l.contre]),
        };
        classements++;
      }
    } catch (e) {
      info.erreurClassement = e.message;
      log(`  classement illisible : ${e.message}`);
    }
  }

  fs.writeFileSync(DIAG, JSON.stringify(diagnostic, null, 2));

  if (!scores && !dates && !classements && !poules) {
    log("\nRien de neuf, fichier inchangé.");
    return;
  }

  const nouveau = html.slice(0, debut) + ecrireBloc(OFFICIEL, JOURNEES, CLASSEMENTS) + html.slice(fin);
  if (nouveau.length < html.length * 0.9)
    throw new Error("le fichier réécrit est anormalement plus court, écriture annulée");

  fs.writeFileSync(FICHIER, nouveau);
  log(`\nÉcrit : ${scores} score(s), ${dates} date(s), ${classements} classement(s), ${poules} poule(s).`);
}
