// Test hors ligne du lecteur de classement, avec des donnees reelles
// relevees sur la poule 2025-2026 de Regionale 3 (classement final).
// Lancement : node test-classement.mjs

import { extraireClassement, extraireJournees } from "./maj.mjs";

/* Objet tel qu'il apparait sur la page de POULE : position, puis classementId,
   puis competitionEquipeId. */
const ordrePoule = (pos, club, st) =>
  `{"__typename":"CompetitionClassement","position":${pos},"classementId":${JSON.stringify(st)},` +
  `"competitionEquipeId":{"__typename":"CompetitionEquipe","id":${1000 + pos},"nomEdito":${JSON.stringify(club)},` +
  `"structureId":{"nom":"club \\"test\\" {rugby}"}}}`;

/* Objet tel qu'il apparait sur la FICHE CLUB : l'ordre des cles est different. */
const ordreClub = (pos, club, st) =>
  `{"__typename":"CompetitionClassement","id":9${pos},` +
  `"competitionEquipeId":{"nomEdito":${JSON.stringify(club)},"__typename":"CompetitionEquipe"},` +
  `"classementId":${JSON.stringify(st)},"position":${pos}}`;

const st = (pointTerrain, joues, gagnes, nuls, perdus, acquis, concedes) => ({
  id: 82465810 + joues,
  regulationPointsTerrain: null,
  pointTerrain,
  joues,
  gagnes,
  nuls,
  perdus,
  pointsDeMarqueAcquis: acquis,
  pointsDeMarqueConcedes: concedes,
  goalAverage: acquis - concedes,
  essaiMarques: null,
  essaiConcedes: null,
  bonusOffensif: 14,
  bonusDefensif: 0,
});

/* Classement final reel de la poule 2025-2026 (extraits verifies). */
const REEL = [
  [1, "SA St Maixentais", st(88.82, 18, 17, 0, 0, 821, 138)],
  [7, "Entente Sp Bruges Blanquefort", st(42, 18, 8, 1, 9, 386, 428)],
];

let echecs = 0;
const verifie = (nom, obtenu, attendu) => {
  const ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (!ok) echecs++;
  console.log(`${ok ? "ok  " : "ECHEC"} ${nom}${ok ? "" : `\n      obtenu  ${JSON.stringify(obtenu)}\n      attendu ${JSON.stringify(attendu)}`}`);
};

/* --- 1. ordre « page de poule » -------------------------------------- */
{
  const flux = "bla bla" + REEL.map((r) => ordrePoule(...r)).join(",") + "fin";
  const { lignes } = extraireClassement(flux);
  verifie("poule : 2 lignes", lignes.length, 2);
  verifie("poule : 1er", lignes[0], {
    club: "SA St Maixentais", position: 1, points: 89,
    joues: 18, gagnes: 17, nuls: 0, perdus: 0, pour: 821, contre: 138,
  });
  verifie("poule : ESBB", lignes[1], {
    club: "Entente Sp Bruges Blanquefort", position: 7, points: 42,
    joues: 18, gagnes: 8, nuls: 1, perdus: 9, pour: 386, contre: 428,
  });
}

/* --- 2. ordre « fiche club » (les cles ne sont pas dans le meme ordre) - */
{
  const flux = REEL.map((r) => ordreClub(...r)).join(";");
  const { lignes } = extraireClassement(flux);
  verifie("club : 2 lignes", lignes.length, 2);
  verifie("club : ESBB pour/contre", [lignes[1].pour, lignes[1].contre], [386, 428]);
  verifie("club : ESBB points arrondis", lignes[1].points, 42);
}

/* --- 3. doublons : le meme club revient plusieurs fois dans le flux ---- */
{
  const flux = [...REEL, ...REEL].map((r) => ordrePoule(...r)).join(",");
  const { lignes } = extraireClassement(flux);
  verifie("doublons ecartes", lignes.length, 2);
}

/* --- 4. anciens noms de champs gardes en secours ----------------------- */
{
  const vieux = {
    points: 42, matchsJoues: 18, victoires: 8, egalites: 1, defaites: 9,
    pointsMarques: 386, pointsConcedes: 428,
  };
  const flux = ordrePoule(7, "Entente Sp Bruges Blanquefort", vieux);
  const { lignes } = extraireClassement(flux);
  verifie("secours anciens noms", lignes[0], {
    club: "Entente Sp Bruges Blanquefort", position: 7, points: 42,
    joues: 18, gagnes: 8, nuls: 1, perdus: 9, pour: 386, contre: 428,
  });
}

/* --- 5. champ manquant : on renvoie 0, on ne plante pas ---------------- */
{
  const flux = ordrePoule(3, "Stade Test", { pointTerrain: 12, joues: 4 });
  const { lignes } = extraireClassement(flux);
  verifie("champ manquant", [lignes[0].points, lignes[0].pour, lignes[0].gagnes], [12, 0, 0]);
}

/* --- 6. rencontres de la poule ---------------------------------------- */
{
  const rencontre = (d, a, b, sa, sb) =>
    `{"dateEffective":"${d}","competitionEquipeLocaleId":{"nomEdito":"${a}"},` +
    `"competitionEquipeVisiteuseId":{"nomEdito":"${b}"},` +
    `"rencontreResultatLocaleFdmd":${sa},"rencontreResultatVisiteuseFdmd":${sb}}`;
  const flux =
    `{"listTitle":"Journée 1","listData":[${rencontre("2025-09-14T15:00", "A", "B", 22, 10)}]}` +
    `{"listTitle":"Journée 2","listData":[${rencontre("2025-09-21T15:00", "B", "A", null, null)}]}`;
  const j = extraireJournees(flux);
  verifie("journees : 2", j.map((x) => x.j), ["J1", "J2"]);
  verifie("journees : score J1", j[0].matchs[0], ["2025-09-14T15:00", "A", "B", 22, 10]);
  verifie("journees : J2 sans score", j[1].matchs[0].slice(3), [null, null]);
}

console.log(echecs ? `\n${echecs} echec(s)` : "\nTout est bon.");
process.exit(echecs ? 1 : 0);
