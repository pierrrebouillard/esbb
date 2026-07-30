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
//
// Tout vient de la page de POULE, verifie sur la saison 2025-2026 :
//   - l'adresse racine ......... porte le classement complet
//   - .../calendrier-resultats . porte les 18 journees et les scores
//   - .../classement ........... est chargee par le navigateur : elle ne contient rien
//   - la fiche club ............ ne donne que le nombre de points, sans le detail
const COMPETITIONS = [
  {
    nom: "Régionale 3",
    poule: "https://monclubhouse.ffr.fr/regionales/nouvelle-aquitaine/nouvelle-aquitaine-regionale-3-championnat-territorial/qualification-50143/73076",
  },
  {
    nom: "Fédérale 1 Féminine",
    poule: "https://monclubhouse.ffr.fr/nationales/federale-1-feminine/qualification-50138/73056",
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
   On avance depuis une accolade ouvrante en comptant les accolades, tout en
   sautant le contenu des chaines de caracteres. */

function balancer(flux, deb) {
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

/* On part d'une cle connue et on remonte d'accolade en accolade jusqu'a
   trouver l'objet qui contient reellement toutes les cles attendues.
   L'ordre des cles change d'une page a l'autre : sur la fiche club, la cle
   d'ancrage n'est pas la premiere de son objet, et remonter d'une seule
   accolade tomberait sur un sous-objet. */

function objetEnglobant(flux, position, cles) {
  let deb = position + 1;
  for (let essai = 0; essai < 40; essai++) {
    deb = flux.lastIndexOf("{", deb - 1);
    if (deb < 0) return null;
    const r = balancer(flux, deb);
    if (!r || r.fin <= position) continue; // objet referme avant la cle : trop court
    if (r.obj && cles.every((c) => c in r.obj)) return r;
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
    const r = objetEnglobant(flux, i, ["listTitle", "listData"]);
    p = Math.max(r ? r.fin : 0, i + 1);
    const o = r && r.obj;
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

/* Noms de champs relevés sur une saison réellement jouée
   (poule 2025-2026 de Régionale 3, classement final) :
     pointTerrain, joues, gagnes, nuls, perdus,
     pointsDeMarqueAcquis, pointsDeMarqueConcedes, bonusOffensif, bonusDefensif
   Les autres noms sont gardés en secours au cas où la FFR change sa structure. */
const CLES = {
  points: ["pointTerrain", "points", "total"],
  joues: ["joues", "nbMatchs", "rencontresJouees", "matchsJoues"],
  gagnes: ["gagnes", "victoires", "nbVictoires"],
  nuls: ["nuls", "nbNuls", "egalites"],
  perdus: ["perdus", "defaites", "nbDefaites"],
  pour: ["pointsDeMarqueAcquis", "pointsMarques", "pointsPour"],
  contre: ["pointsDeMarqueConcedes", "pointsConcedes", "pointsEncaisses", "pointsContre"],
};
const valeur = (o, noms) => {
  for (const n of noms) if (typeof o[n] === "number") return o[n];
  return 0;
};

/* L'ordre des cles varie selon le type de page (fiche club ou page de poule).
   On isole donc l'objet entier par equilibrage d'accolades, puis on lit par nom. */
export function extraireClassement(flux) {
  const lignes = [];
  const brut = [];
  const vus = new Set();
  let p = 0;
  while (true) {
    const i = flux.indexOf('"classementId":{', p);
    if (i < 0) break;
    const r = objetEnglobant(flux, i, ["classementId", "competitionEquipeId"]);
    p = Math.max(r ? r.fin : 0, i + 1);
    const o = r && r.obj;
    if (!o) continue;
    const club = (o.competitionEquipeId || {}).nomEdito;
    if (!club || vus.has(club)) continue;
    vus.add(club);
    const st = o.classementId || {};
    brut.push({ club, position: o.position ?? null, stats: st });
    lignes.push({
      club,
      position: o.position ?? 0,
      points: Math.round(valeur(st, CLES.points)),
      joues: valeur(st, CLES.joues),
      gagnes: valeur(st, CLES.gagnes),
      nuls: valeur(st, CLES.nuls),
      perdus: valeur(st, CLES.perdus),
      pour: valeur(st, CLES.pour),
      contre: valeur(st, CLES.contre),
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
      const flux = await chargerFlux(comp.poule + "/calendrier-resultats");
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

    /* ---------- 2. la page de poule : le classement ---------- */
    try {
      const flux = await chargerFlux(comp.poule);
      const { lignes, brut } = extraireClassement(flux);
      info.classement = lignes.length;
      info.classementBrut = brut.slice(0, 2);
      /* alerte si la FFR ne sert plus que les points, sans le detail */
      info.detailClassement = lignes.some((l) => l.joues > 0);
      log(`  classement : ${lignes.length} lignes${lignes.length && !info.detailClassement ? " (points seuls, sans détail)" : ""}`);
      if (lignes.length >= 4) {
        const cl = (CLASSEMENTS[SAISON] ||= {});
        const ancien = cl[comp.nom];
        const table = lignes.map((l) => [nomFichier(l.club), l.points, l.joues, l.gagnes, l.nuls, l.perdus, l.pour, l.contre]);
        const change = JSON.stringify((ancien || {}).lignes || []) !== JSON.stringify(table);
        cl[comp.nom] = {
          maj: change || !ancien ? aujourdhui : ancien.maj,
          debut: ancien ? ancien.debut : (matchs.find((m) => m.c === comp.nom) || {}).date || aujourdhui,
          lignes: table,
        };
        if (change) classements++;
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
