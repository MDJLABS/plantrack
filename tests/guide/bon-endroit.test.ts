// tests/guide/bon-endroit.test.ts — « M'emmener au bon endroit » toujours là (15/11, demande s69) :
// mémoire de l'adresse réelle d'un point (`adresseVue`/`retenirAdresseVue`, guide-visite.ts)
// et geste rendu « pas encore joué » (`oublierJoue`, guide-progress.ts).
//
// EXÉCUTION :
//   node --experimental-strip-types --import ./tests/guide/support/register.mjs \
//     tests/guide/bon-endroit.test.ts

import assert from "node:assert/strict";
import { adresseVue, retenirAdresseVue, type StorageVisite } from "../../.claude/hooks/plantrack_guide/moteur/guide-visite";
import { marquerJoue, oublierJoue, vide } from "../../.claude/hooks/plantrack_guide/moteur/guide-progress";

let passed = 0;
function step(n: string, fn: () => void) {
  try { fn(); passed++; console.log("ok -", n); } catch (e) { console.error("FAIL -", n, "\n", e); process.exitCode = 1; }
}
function stock(): StorageVisite {
  const t = new Map<string, string>();
  return { getItem: (k) => t.get(k) ?? null, setItem: (k, v) => { t.set(k, v); }, removeItem: (k) => { t.delete(k); } };
}

step("adresse retenue par scénario et par point, paramètres compris", () => {
  const s = stock();
  retenirAdresseVue(s, "achat", "payer", "/paiement?commande=42&jeton=ab");
  assert.equal(adresseVue(s, "achat", "payer"), "/paiement?commande=42&jeton=ab");
  assert.equal(adresseVue(s, "achat", "suivi"), null);
  assert.equal(adresseVue(s, "autre", "payer"), null);
});

step("la dernière adresse vue remplace la précédente", () => {
  const s = stock();
  retenirAdresseVue(s, "achat", "suivi", "/suivi/1");
  retenirAdresseVue(s, "achat", "suivi", "/suivi/2");
  assert.equal(adresseVue(s, "achat", "suivi"), "/suivi/2");
});

step("jamais une adresse externe ou sans stockage", () => {
  const s = stock();
  s.setItem("guide-vue:achat:x", "//pirate.example/x");
  assert.equal(adresseVue(s, "achat", "x"), null);
  s.setItem("guide-vue:achat:y", "https://pirate.example/");
  assert.equal(adresseVue(s, "achat", "y"), null);
  assert.equal(adresseVue(null, "achat", "x"), null);
  retenirAdresseVue(null, "achat", "x", "/a"); // ne lève pas
});

step("stockage qui lève : aucune exception", () => {
  const casse: StorageVisite = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); }, removeItem: () => {} };
  retenirAdresseVue(casse, "a", "b", "/c");
  assert.equal(adresseVue(casse, "a", "b"), null);
});

step("oublierJoue rend les points rejouables, sans toucher aux autres", () => {
  let p = marquerJoue(marquerJoue(marquerJoue(vide("achat"), "a"), "b"), "c");
  p = oublierJoue(p, ["a", "c"]);
  assert.deepEqual(p.joues, ["b"]);
  const q = oublierJoue(p, ["z"]);
  assert.equal(q, p, "rien à oublier : même objet");
  assert.equal(oublierJoue(vide("achat"), ["a"]).joues?.length ?? 0, 0);
});

console.log(`${passed} ok`);
