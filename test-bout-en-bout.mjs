// Repetition generale hors ligne : on rejoue une mise a jour complete
// (lecture des pages -> extraction -> reecriture du bloc de donnees) en
// servant des pages factices batties comme les vraies.
// Lancement : node test-bout-en-bout.mjs

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const TMP = "/tmp/esbb-essai";
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
fs.copyFileSync("index.html", path.join(TMP, "index.html"));
const avant = fs.readFileSync(path.join(TMP, "index.html"), "utf8");

/* ---------- pages factices, au format RSC de monclubhouse ---------- */

const page = (charge) => {
  const morceaux = [charge.slice(0, Math.floor(charge.length / 2)), charge.slice(Math.floor(charge.length / 2))];
  return "<!DOCTYPE html><html><body><script>" +
    morceaux.map((m) => `self.__next_f.push([1,${JSON.stringify(m)}])`).join(";") +
    "</script></body></html>";
};

const rencontre = (d, a, b, sa, sb) =>
  `{"__typename":"Rencontre","dateEffective":"${d}",` +
  `"competitionEquipeLocaleId":{"__typename":"CompetitionEquipe","nomEdito":${JSON.stringify(a)}},` +
  `"competitionEquipeVisiteuseId":{"__typename":"CompetitionEquipe","nomEdito":${JSON.stringify(b)}},` +
  `"rencontreResultatLocaleFdmd":${sa},"rencontreResultatVisiteuseFdmd":${sb}}`;

const ESBB = "Entente Sp Bruges Blanquefort"; // orthographe FFR, sans les majuscules du fichier

const poule = (journees) =>
  page("2:" + journees.map((j) =>
    `{"listTitle":"Journée ${j.n}","listData":[${j.m.map((m) => rencontre(...m)).join(",")}]}`
  ).join(",") + " padding ".repeat(700));

const ligne = (pos, club, st) =>
  `{"__typename":"CompetitionClassement","id":9${pos},` +
  `"competitionEquipeId":{"nomEdito":${JSON.stringify(club)},"__typename":"CompetitionEquipe"},` +
  `"classementId":${JSON.stringify(st)},"position":${pos}}`;

const st = (pt, j, g, n, p, a, c) => ({
  id: 1000 + pos_id++, regulationPointsTerrain: null, pointTerrain: pt,
  joues: j, gagnes: g, nuls: n, perdus: p,
  pointsDeMarqueAcquis: a, pointsDeMarqueConcedes: c,
  goalAverage: a - c, essaiMarques: null, essaiConcedes: null,
  bonusOffensif: 0, bonusDefensif: 0,
});
let pos_id = 0;

const fiche = (lignes) => page("3:" + lignes.map((l) => ligne(...l)).join(",") + " padding ".repeat(700));

/* Regionale 3 : J1 jouee (date decalee d'un jour + score), J2 a venir. */
const POULE_R3 = poule([
  { n: 1, m: [
      ["2026-09-19T15:30", "SC Saint Aubin", ESBB, 12, 30],
      ["2026-09-20T15:00", "RC Cubzaguais", "Amicale Sportive Eymetoise", 24, 17],
  ] },
  { n: 2, m: [
      ["2026-09-27T15:00", ESBB, "RC Cubzaguais", null, null],
      ["2026-09-27T15:00", "SC Saint Aubin", "US Roquentin Laroque Timbaut", null, null],
  ] },
]);
const FICHE_R3 = fiche([
  [1, ESBB, st(5, 1, 1, 0, 0, 30, 12)],
  [2, "RC Cubzaguais", st(4, 1, 1, 0, 0, 24, 17)],
  [3, "Amicale Sportive Eymetoise", st(1, 1, 0, 0, 1, 17, 24)],
  [4, "SC Saint Aubin", st(0, 1, 0, 0, 1, 12, 30)],
  [5, "US Roquentin Laroque Timbaut", st(0, 0, 0, 0, 0, 0, 0)],
]);

/* Federale 1 Feminine : page de poule en panne, classement disponible. */
const FICHE_F1F = fiche([
  [1, ESBB, st(4, 1, 1, 0, 0, 22, 5)],
  [2, "Stade Bordelais", st(1, 1, 0, 0, 1, 5, 22)],
  [3, "Anglet ORC", st(0, 0, 0, 0, 0, 0, 0)],
  [4, "US Dax", st(0, 0, 0, 0, 0, 0, 0)],
]);

/* L'ordre compte : les adresses les plus precises d'abord (le nom de la
   page racine est contenu dans celui de la page calendrier). */
const PAGES = new Map([
  ["qualification-50143/73076/calendrier-resultats", POULE_R3],
  ["qualification-50143/73076", FICHE_R3],
  ["qualification-50138/73056/calendrier-resultats", "<html></html>"], // poule en panne
  ["qualification-50138/73056", FICHE_F1F],
]);

const stub = `
globalThis.fetch = async (url) => {
  const table = new Map(${JSON.stringify([...PAGES])});
  for (const [motif, corps] of table)
    if (String(url).includes(motif)) return { ok: true, status: 200, text: async () => corps };
  return { ok: false, status: 404, text: async () => "" };
};
`;
fs.writeFileSync(path.join(TMP, "stub.mjs"), stub);

/* ---------- on lance la mise a jour ---------- */

const sortie = execFileSync(
  process.execPath,
  ["--import", path.join(TMP, "stub.mjs"), "maj.mjs", TMP],
  { encoding: "utf8", timeout: 60000 }
);
console.log(sortie.trim());

/* ---------- verifications ---------- */

let echecs = 0;
const verifie = (nom, obtenu, attendu) => {
  const ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (!ok) echecs++;
  console.log(`${ok ? "ok  " : "ECHEC"} ${nom}${ok ? "" : `\n      obtenu  ${JSON.stringify(obtenu)}\n      attendu ${JSON.stringify(attendu)}`}`);
};

const apres = fs.readFileSync(path.join(TMP, "index.html"), "utf8");
verifie("le fichier a été réécrit", apres !== avant, true);
verifie("taille conservée (±10 %)", apres.length > avant.length * 0.9, true);

const M = await import("./maj.mjs");
const constantes = (apres.match(/^const (?:CLUB|R3|F1F|F2F|STADE_DEF)\s*=.*$/gm) || [])
  .join("\n").replace(/^const /gm, "var ");
const { OFFICIEL, CLASSEMENTS, JOURNEES } = M.evaluerBloc(M.lireBloc(apres).bloc, constantes);

verifie("32 matchs conservés", OFFICIEL["2026-2027"].length, 32);
verifie("18 matchs 2025-2026 conservés", OFFICIEL["2025-2026"].length, 18);

const j1 = OFFICIEL["2026-2027"].find((m) => m.c === "Régionale 3" && m.adv === "SC Saint Aubin" && m.lieu === "ext");
verifie("J1 : score dans le bon sens (30-12 vu de l'ESBB)", [j1.sp, j1.sc], [30, 12]);
verifie("J1 : date corrigée", j1.date, "2026-09-19");
verifie("J1 : heure corrigée", j1.time, "15:30");

const j2 = OFFICIEL["2026-2027"].find((m) => m.c === "Régionale 3" && m.adv === "RC Cubzaguais" && m.lieu === "dom");
verifie("J2 : toujours sans score", [j2.sp, j2.sc], [undefined, undefined]);

verifie("journées enregistrées", JOURNEES["2026-2027"]["Régionale 3"].journees.map((x) => x.j), ["J1", "J2"]);
verifie("autres matchs de la poule présents",
  JOURNEES["2026-2027"]["Régionale 3"].journees[0].matchs.length, 2);
verifie("nom de club harmonisé avec le fichier",
  JOURNEES["2026-2027"]["Régionale 3"].journees[0].matchs[0][2], "Entente SP Bruges Blanquefort");

const cl = CLASSEMENTS["2026-2027"]["Régionale 3"];
verifie("classement R3 : 5 lignes", cl.lignes.length, 5);
verifie("classement R3 : ESBB en tête",
  cl.lignes[0], ["Entente SP Bruges Blanquefort", 5, 1, 1, 0, 0, 30, 12]);
verifie("classement F1F : 4 lignes", CLASSEMENTS["2026-2027"]["Fédérale 1 Féminine"].lignes.length, 4);

const diag = JSON.parse(fs.readFileSync(path.join(TMP, "diagnostic.json"), "utf8"));
verifie("diagnostic : poule F1F signalée en erreur",
  typeof diag.competitions["Fédérale 1 Féminine"].erreurPoule, "string");
verifie("diagnostic : classements comptés",
  [diag.competitions["Régionale 3"].classement, diag.competitions["Fédérale 1 Féminine"].classement], [5, 4]);
verifie("diagnostic : détail du classement présent",
  diag.competitions["Régionale 3"].detailClassement, true);

/* ---------- deuxieme passage : rien de neuf, rien a ecrire ---------- */
const empreinte = fs.statSync(path.join(TMP, "index.html")).size;
const sortie2 = execFileSync(
  process.execPath,
  ["--import", path.join(TMP, "stub.mjs"), "maj.mjs", TMP],
  { encoding: "utf8", timeout: 60000 }
);
verifie("2e passage : rien de neuf", /Rien de neuf/.test(sortie2), true);
verifie("2e passage : fichier intact", fs.statSync(path.join(TMP, "index.html")).size, empreinte);

/* ---------- garde-fou : page vide -> on n'ecrit rien ---------- */
fs.writeFileSync(path.join(TMP, "stub.mjs"),
  `globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => "<html></html>" });`);
const sortie3 = execFileSync(
  process.execPath,
  ["--import", path.join(TMP, "stub.mjs"), "maj.mjs", TMP],
  { encoding: "utf8", timeout: 60000 }
);
verifie("pages vides : rien de neuf", /Rien de neuf/.test(sortie3), true);
verifie("pages vides : fichier intact", fs.statSync(path.join(TMP, "index.html")).size, empreinte);

console.log(echecs ? `\n${echecs} echec(s)` : "\nTout est bon.");
process.exit(echecs ? 1 : 0);
