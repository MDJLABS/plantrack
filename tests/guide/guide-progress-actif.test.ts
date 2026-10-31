// tests/guide/guide-progress-actif.test.ts — guide ACTIF (lanceur bas-droite, d138) et
// préséance serveur/local (`lireGuideActif`/`ecrireGuideActif`/`effacerGuideActif`,
// `serveurPrime`/`progressionDepuisServeur`, `guide-progress.ts`).
//
// Pur, aucun DOM — un double minimal de `Storage` suffit.
//
// EXÉCUTION :
//   node --experimental-strip-types --import ./tests/guide/support/register.mjs \
//     tests/guide/guide-progress-actif.test.ts

import assert from "node:assert/strict";
import {
  ecrireGuideActif, effacerGuideActif, lireGuideActif, progressionDepuisServeur, serveurPrime, vide,
  type Storage,
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

function storageVide(): Storage {
  const table = new Map<string, string>();
  return {
    getItem: (k) => table.get(k) ?? null,
    setItem: (k, v) => table.set(k, v),
    removeItem: (k) => table.delete(k),
  };
}

const CONNU = (id: string) => id === "temoin-principal" || id === "temoin-second";

step("aucun guide actif écrit → lireGuideActif rend null", () => {
  assert.equal(lireGuideActif(storageVide(), CONNU), null);
});

step("écrire puis lire → même id rendu", () => {
  const s = storageVide();
  ecrireGuideActif(s, "temoin-second");
  assert.equal(lireGuideActif(s, CONNU), "temoin-second");
});

step("id forgé (inconnu du catalogue) → jamais rendu actif", () => {
  const s = storageVide();
  ecrireGuideActif(s, "__proto__");
  assert.equal(lireGuideActif(s, CONNU), null);
});

step("effacerGuideActif → retombe sur null", () => {
  const s = storageVide();
  ecrireGuideActif(s, "temoin-principal");
  effacerGuideActif(s);
  assert.equal(lireGuideActif(s, CONNU), null);
});

step("storage null → aucune fonction ne lève, lireGuideActif rend null", () => {
  assert.doesNotThrow(() => {
    ecrireGuideActif(null, "temoin-second");
    effacerGuideActif(null);
    assert.equal(lireGuideActif(null, CONNU), null);
  });
});

step("serveurPrime : plus de verdicts côté serveur que localement → true", () => {
  const local = { ...vide("s"), verdicts: { a1: "ok" as const } };
  assert.equal(serveurPrime(local, { a1: {}, a2: {} }), true);
});

step("serveurPrime : autant ou moins côté serveur → false (le local garde la main)", () => {
  const local = { ...vide("s"), verdicts: { a1: "ok" as const, a2: "ko" as const } };
  assert.equal(serveurPrime(local, { a1: {} }), false);
  assert.equal(serveurPrime(local, { a1: {}, a2: {} }), false);
  assert.equal(serveurPrime(local, undefined), false);
});

step("progressionDepuisServeur : reprend au premier point sans réponse", () => {
  const etapesIds = ["a1", "a2", "a3"];
  const verdictsServeur = {
    a1: { v: "ok" as const, a: "2026-10-31T10:00:00.000Z" },
    a2: { v: "ko" as const, note: "le bouton ne répond pas", a: "2026-10-31T10:00:01.000Z" },
  };
  const p = progressionDepuisServeur("s", verdictsServeur, etapesIds);
  assert.equal(p.scenarioId, "s");
  assert.deepEqual(p.verdicts, { a1: "ok", a2: "ko" });
  assert.deepEqual(p.motifs, { a2: "le bouton ne répond pas" });
  assert.equal(p.index, 2, "a3 est le premier point sans réponse");
  assert.deepEqual(p.joues, []);
});

step("progressionDepuisServeur : tous répondus → index reste sur le dernier (bilan affiché)", () => {
  const etapesIds = ["a1"];
  const p = progressionDepuisServeur("s", { a1: { v: "ok", a: "x" } }, etapesIds);
  assert.equal(p.index, 0);
  assert.deepEqual(p.verdicts, { a1: "ok" });
});

console.log(`\n${passed} assertions vertes`);
