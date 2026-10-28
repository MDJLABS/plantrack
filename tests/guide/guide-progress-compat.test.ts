// tests/guide/guide-progress-compat.test.ts — RÉTRO-COMPATIBILITÉ de `chargerProgression`
// (`guide-progress.ts`) avec une `GuideProgress` persistée AVANT le lot « curseur animé ».
//
// `motifs` (motif d'un "ko") et `joues` (gestes déjà joués) sont arrivés APRÈS que des
// progressions aient déjà été écrites dans localStorage par de vraies visites — une
// progression ancienne ne porte ni l'un ni l'autre. `chargerProgression` doit la recharger
// EXACTEMENT comme avant (même index repris, mêmes verdicts), et ne jamais lever en
// l'absence de ces deux champs : `corpsEnvoi`/`noterMotif`/`marquerJoue` (lus ailleurs)
// doivent voir `{}`/`[]`, jamais `undefined` propagé jusqu'à planter un `.includes()`.
//
// Pur, aucun DOM — un double minimal de `Storage` suffit.
//
// EXÉCUTION :
//   node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
//     --import ./tests/guide/support/register.mjs tests/guide/guide-progress-compat.test.ts

import assert from "node:assert/strict";
import {
  chargerProgression, marquerJoue, noterMotif, type Storage,
} from "../../.claude/hooks/plantrack_guide/lib/guide/guide-progress";

let passed = 0;
function step(n: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log("ok -", n);
  } catch (e) {
    console.error("FAIL -", n, "\n", e);
    process.exitCode = 1;
  }
}

/** Double minimal de `Storage` — un seul enregistrement, posé directement (pas via
 *  `sauverProgression`) pour simuler EXACTEMENT une forme antérieure à ce lot. */
function storageAvec(cle: string, valeur: string): Storage {
  const table = new Map([[cle, valeur]]);
  return {
    getItem: (k) => table.get(k) ?? null,
    setItem: (k, v) => table.set(k, v),
    removeItem: (k) => table.delete(k),
  };
}

const ETAPES = ["a1", "a2", "a3"];

step("progression ANCIENNE (sans motifs ni joues) → rechargée avec motifs:{} et joues:[]", () => {
  const ancienne = { scenarioId: "s", index: 1, verdicts: { a1: "ok" } };
  const storage = storageAvec("mdj_guide_s", JSON.stringify(ancienne));
  const p = chargerProgression("s", storage, ETAPES);
  assert.deepEqual(p.motifs, {});
  assert.deepEqual(p.joues, []);
});

step("progression ANCIENNE : index et verdicts repris à l'identique (rétro-compatibilité)", () => {
  const ancienne = { scenarioId: "s", index: 1, verdicts: { a1: "ok", a2: "ko" } };
  const storage = storageAvec("mdj_guide_s", JSON.stringify(ancienne));
  const p = chargerProgression("s", storage, ETAPES);
  // a1 et a2 ont déjà une réponse, a3 non → reprise au premier point sans réponse (a3,
  // index 2) — comportement DÉJÀ en place avant ce lot, inchangé par motifs/joues.
  assert.equal(p.index, 2);
  assert.deepEqual(p.verdicts, { a1: "ok", a2: "ko" });
});

step("progression ANCIENNE relue → noterMotif()/marquerJoue() fonctionnent sans exception", () => {
  const ancienne = { scenarioId: "s", index: 0, verdicts: {} };
  const storage = storageAvec("mdj_guide_s", JSON.stringify(ancienne));
  const p = chargerProgression("s", storage, ETAPES);
  assert.doesNotThrow(() => {
    const p2 = noterMotif(p, "a1", "le bouton ne répond pas");
    assert.equal(p2.motifs?.a1, "le bouton ne répond pas");
    const p3 = marquerJoue(p2, "a1");
    assert.deepEqual(p3.joues, ["a1"]);
  });
});

step("progression ancienne avec motifs/joues du MAUVAIS type → retombe sur {} / [], jamais une forme suspecte", () => {
  const corrompue = { scenarioId: "s", index: 0, verdicts: {}, motifs: "pas un objet", joues: "pas un tableau" };
  const storage = storageAvec("mdj_guide_s", JSON.stringify(corrompue));
  const p = chargerProgression("s", storage, ETAPES);
  assert.deepEqual(p.motifs, {});
  assert.deepEqual(p.joues, []);
});

step("progression RÉCENTE (avec motifs/joues déjà présents) → conservés tels quels", () => {
  const recente = {
    scenarioId: "s", index: 1, verdicts: { a1: "ko" },
    motifs: { a1: "écart déjà motivé" }, joues: ["a1"],
  };
  const storage = storageAvec("mdj_guide_s", JSON.stringify(recente));
  const p = chargerProgression("s", storage, ETAPES);
  assert.deepEqual(p.motifs, { a1: "écart déjà motivé" });
  assert.deepEqual(p.joues, ["a1"]);
});

step("joues avec des éléments non-string → filtrés, jamais propagés tels quels", () => {
  const corrompue = { scenarioId: "s", index: 0, verdicts: {}, joues: ["a1", 42, null, "a2"] };
  const storage = storageAvec("mdj_guide_s", JSON.stringify(corrompue));
  const p = chargerProgression("s", storage, ETAPES);
  assert.deepEqual(p.joues, ["a1", "a2"]);
});

console.log(`\n${passed} assertions vertes`);
