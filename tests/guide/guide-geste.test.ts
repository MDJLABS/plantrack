// tests/guide/guide-geste.test.ts — JOUER un geste automatiquement (`guide-geste.ts`).
//
// Fonctions PURES, testées SANS jsdom (cf. bandeau de tête de guide-geste.ts) : un objet
// minimal (`{ click }` / `{ value, dispatchEvent }`) suffit à exercer `appliquerClic`/
// `appliquerSaisie`. `jouerGeste` accepte `resolve` en injection — on y passe un double qui
// ne dépend d'aucun DOM réel, et `doc` n'est jamais déréférencé par ce double.
//
// Ce fichier tourne en Node NU (pas de navigateur) : `typeof HTMLInputElement === "undefined"`
// est donc vrai ici, et `appliquerSaisie` retombe systématiquement sur l'affectation directe
// (`cible.value = …`), jamais sur le setter natif — c'est la branche que ce fichier exerce ;
// le setter natif (vrai `HTMLInputElement`) n'est couvert nulle part en Node, seulement en
// navigateur réel.
//
// EXÉCUTION :
//   node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
//     --import ./tests/guide/support/register.mjs tests/guide/guide-geste.test.ts

import assert from "node:assert/strict";
import {
  appliquerClic, appliquerSaisie, jouerGeste, selecteursGeste,
} from "../../.claude/hooks/plantrack_guide/lib/guide/guide-geste";
import type { GuideGeste } from "../../.claude/hooks/plantrack_guide/lib/guide/types";

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

// --- 1. selecteursGeste() — ordre précis puis repli ---------------------------------------

step("selecteursGeste : geste.cible d'abord, puis les cibles de repli", () => {
  assert.deepEqual(
    selecteursGeste({ type: "clic", cible: "#bouton" }, ["#zone-a", "#zone-b"]),
    ["#bouton", "#zone-a", "#zone-b"],
  );
});
step("selecteursGeste : pas de cible sur le geste → seulement le repli", () => {
  assert.deepEqual(selecteursGeste({ type: "clic" }, ["#zone-a"]), ["#zone-a"]);
});
step("selecteursGeste : ni cible ni repli → liste vide, jamais une exception", () => {
  assert.deepEqual(selecteursGeste({ type: "clic" }), []);
});

// --- 2. appliquerClic() --------------------------------------------------------------------

step("appliquerClic : élément absent (null) → échec déclaré, jamais une exception", () => {
  assert.deepEqual(appliquerClic(null), { ok: false, raison: "élément non cliquable" });
});
step("appliquerClic : objet sans click() → échec déclaré", () => {
  assert.deepEqual(appliquerClic({}), { ok: false, raison: "élément non cliquable" });
});
step("appliquerClic : double minimal { click() } → ok, click() appelé une fois", () => {
  let appels = 0;
  const r = appliquerClic({ click: () => { appels++; } });
  assert.deepEqual(r, { ok: true });
  assert.equal(appels, 1);
});
step("appliquerClic : click() qui lève → échec déclaré, jamais une exception qui traverse", () => {
  const r = appliquerClic({ click: () => { throw new Error("boom"); } });
  assert.deepEqual(r, { ok: false, raison: "le clic a échoué" });
});

// --- 3. appliquerSaisie() -------------------------------------------------------------------

step("appliquerSaisie : élément absent (null) → échec déclaré", () => {
  assert.deepEqual(appliquerSaisie(null, "x"), { ok: false, raison: "élément de saisie absent" });
});
step("appliquerSaisie : double { value, dispatchEvent } → value posée, input + change déclenchés", () => {
  const evenements: string[] = [];
  const el = {
    value: "",
    dispatchEvent(e: Event) { evenements.push(e.type); return true; },
  };
  const r = appliquerSaisie(el, "bonjour");
  assert.deepEqual(r, { ok: true });
  assert.equal(el.value, "bonjour");
  assert.deepEqual(evenements, ["input", "change"]);
});
step("appliquerSaisie : double sans dispatchEvent → value posée quand même, ok", () => {
  const el: { value: string } = { value: "" };
  const r = appliquerSaisie(el, "bonjour");
  assert.deepEqual(r, { ok: true });
  assert.equal(el.value, "bonjour");
});
step("appliquerSaisie : poser value lève → échec déclaré, jamais une exception qui traverse", () => {
  const el: { value: string } = {
    get value() { return ""; },
    set value(_v: string) { throw new Error("boom"); },
  };
  const r = appliquerSaisie(el, "x");
  assert.deepEqual(r, { ok: false, raison: "la saisie a échoué" });
});
step("appliquerSaisie : valeur par défaut vide quand geste.valeur est absent (cf. jouerGeste)", () => {
  const el: { value: string } = { value: "préexistant" };
  appliquerSaisie(el, "");
  assert.equal(el.value, "");
});

// --- 4. jouerGeste() -------------------------------------------------------------------------

const DOC_FACTICE = {} as Document; // jamais déréférencé : `resolve` est injecté ci-dessous

step('jouerGeste : type "clic", cible résolue → ok', () => {
  const geste: GuideGeste = { type: "clic", cible: "#bouton" };
  const el = { click: () => {} };
  const r = jouerGeste(geste, DOC_FACTICE, [], () => el as unknown as Element);
  assert.deepEqual(r, { ok: true });
});
step('jouerGeste : type "clic", cible introuvable → échec déclaré, jamais un clic prétendu', () => {
  const geste: GuideGeste = { type: "clic", cible: "#absent" };
  const r = jouerGeste(geste, DOC_FACTICE, [], () => null);
  assert.deepEqual(r, { ok: false, raison: "cible introuvable" });
});
step('jouerGeste : type "saisie", cible résolue → pose la valeur du geste', () => {
  const el = { value: "" };
  const geste: GuideGeste = { type: "saisie", cible: "#champ", valeur: "abc" };
  const r = jouerGeste(geste, DOC_FACTICE, [], () => el as unknown as Element);
  assert.deepEqual(r, { ok: true });
  assert.equal(el.value, "abc");
});
step('jouerGeste : type "saisie" sans geste.valeur → pose une chaîne vide, jamais undefined', () => {
  const el = { value: "ancien" };
  const geste: GuideGeste = { type: "saisie", cible: "#champ" };
  jouerGeste(geste, DOC_FACTICE, [], () => el as unknown as Element);
  assert.equal(el.value, "");
});
step('jouerGeste : type "aller" sans url → échec déclaré avant toute tentative de navigation', () => {
  const geste: GuideGeste = { type: "aller" };
  const r = jouerGeste(geste, DOC_FACTICE);
  assert.deepEqual(r, { ok: false, raison: 'geste "aller" sans url' });
});
step('jouerGeste : type "aller" avec url, en Node (sans `location`) → "navigation indisponible"', () => {
  // Ce fichier tourne en Node nu : `location` n'existe pas, exactement le même repli que
  // dans un contexte navigateur restreint où `location.assign` serait absent.
  const geste: GuideGeste = { type: "aller", url: "https://exemple.com/menu" };
  const r = jouerGeste(geste, DOC_FACTICE);
  assert.deepEqual(r, { ok: false, raison: "navigation indisponible" });
});
step("jouerGeste : resolve qui lève → échec déclaré, jamais une exception qui traverse", () => {
  const geste: GuideGeste = { type: "clic", cible: "#bouton" };
  const r = jouerGeste(geste, DOC_FACTICE, [], () => { throw new Error("boom"); });
  assert.deepEqual(r, { ok: false, raison: "le geste a échoué" });
});
step("jouerGeste : type inconnu → échec déclaré PROPREMENT, jamais silencieux", () => {
  const geste = { type: "mystere" } as unknown as GuideGeste;
  const el = { click: () => {} };
  const r = jouerGeste(geste, DOC_FACTICE, [], () => el as unknown as Element);
  assert.equal(r.ok, false);
  assert.match(r.raison ?? "", /type de geste inconnu/);
});
step('jouerGeste : "clic"/"saisie" passent bien les cibles de repli à `resolve` (via selecteursGeste)', () => {
  const geste: GuideGeste = { type: "clic" }; // pas de cible sur le geste
  let recus: string[] = [];
  const el = { click: () => {} };
  jouerGeste(geste, DOC_FACTICE, ["#repli-a", "#repli-b"], (selecteurs) => {
    recus = selecteurs;
    return el as unknown as Element;
  });
  assert.deepEqual(recus, ["#repli-a", "#repli-b"]);
});

console.log(`\n${passed} assertions vertes`);
