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
  appliquerClic, appliquerClicDehors, appliquerGlisser, appliquerSaisie, appliquerSurvol,
  appliquerTouche, gesteSansCible, gestesEtape, jouerGeste, jouerGesteAttendu, reecrireSurvol,
  selecteursGeste,
} from "../../.claude/hooks/plantrack_guide/moteur/guide-geste";
import type { GuideGeste } from "../../.claude/hooks/plantrack_guide/moteur/types";

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

// d216 : plusieurs gestes par point.
step("gestesEtape : sans geste => liste vide", () => {
  assert.deepEqual(gestesEtape({}), []);
});
step("gestesEtape : geste puis gestes, dans l'ordre", () => {
  const a: GuideGeste = { type: "saisie", cible: "#champ", valeur: "x" };
  const b: GuideGeste = { type: "clic", cible: "#envoyer" };
  const c: GuideGeste = { type: "clic", cible: "#autre" };
  assert.deepEqual(gestesEtape({ geste: a, gestes: [b, c] }), [a, b, c]);
  assert.deepEqual(gestesEtape({ gestes: [b] }), [b]);
});
step("gestesEtape : un aller coupe la suite juste apres lui", () => {
  const aller: GuideGeste = { type: "aller", url: "/suivi" };
  const clic: GuideGeste = { type: "clic", cible: "#x" };
  assert.deepEqual(gestesEtape({ geste: clic, gestes: [aller, clic] }), [clic, aller]);
});

// --- Gestes du 14/11 (q26) : touche, survol, glisser, clic-dehors, retour ----------------

/** Double minimal qui note les événements reçus (Node 24 a `Event`, pas `MouseEvent`). */
function enregistreur() {
  const recus: { type: string; key?: string }[] = [];
  return {
    recus,
    dispatchEvent(e: Event) { recus.push({ type: e.type, key: (e as unknown as { key?: string }).key }); return true; },
    getBoundingClientRect: () => ({ x: 10, y: 20, width: 100, height: 40 }) as DOMRect,
  };
}

step("selecteursGeste : touche et clic-dehors ne se rabattent jamais sur la zone surlignee", () => {
  assert.deepEqual(selecteursGeste({ type: "touche" }, ["#menu"]), []);
  assert.deepEqual(selecteursGeste({ type: "clic-dehors" }, ["#menu"]), []);
  assert.deepEqual(selecteursGeste({ type: "clic-dehors", cible: "#fond" }, ["#menu"]), ["#fond"]);
  assert.deepEqual(selecteursGeste({ type: "survol" }, ["#ligne"]), ["#ligne"]);
});
step("gesteSansCible : navigation, et Echap / clic-dehors sans cible propre", () => {
  assert.equal(gesteSansCible({ type: "retour" }), true);
  assert.equal(gesteSansCible({ type: "touche" }), true);
  assert.equal(gesteSansCible({ type: "touche", cible: "#champ" }), false);
  assert.equal(gesteSansCible({ type: "survol" }), false);
});
step("gestesEtape : un retour coupe la suite comme un aller", () => {
  const retour: GuideGeste = { type: "retour" };
  const clic: GuideGeste = { type: "clic", cible: "#x" };
  assert.deepEqual(gestesEtape({ gestes: [clic, retour, clic] }), [clic, retour]);
});
step("appliquerTouche : keydown puis keyup, Escape par defaut", () => {
  const el = enregistreur();
  assert.deepEqual(appliquerTouche(el), { ok: true });
  assert.deepEqual(el.recus.map((r) => r.type), ["keydown", "keyup"]);
});
step("appliquerTouche : element absent -> echec declare", () => {
  assert.equal(appliquerTouche(null).ok, false);
});
step("appliquerClicDehors : la suite complete d'un vrai clic", () => {
  const el = enregistreur();
  assert.deepEqual(appliquerClicDehors(el), { ok: true });
  assert.deepEqual(el.recus.map((r) => r.type), ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]);
});
step("appliquerSurvol : evenements d'entree et de mouvement, sans document", () => {
  const el = enregistreur();
  assert.deepEqual(appliquerSurvol(el), { ok: true });
  assert.ok(el.recus.some((r) => r.type === "mouseover"));
  assert.ok(el.recus.some((r) => r.type === "mouseenter"));
});
step("reecrireSurvol : :hover devient la classe forcee, (hover: hover) devient all", () => {
  assert.equal(reecrireSurvol(".a { color: red; }"), null);
  assert.equal(reecrireSurvol(".a:hover { color: red; }"), ".a.guide-force-survol { color: red; }");
  assert.equal(
    reecrireSurvol(".g { &:is(:where(.group):hover *) { @media (hover: hover) { opacity: 1; } } }"),
    ".g { &:is(:where(.group).guide-force-survol *) { @media all { opacity: 1; } } }",
  );
});
step("jouerGeste : touche sans cible -> element qui a le focus", () => {
  const actif = enregistreur();
  const doc = { activeElement: actif, body: {} } as unknown as Document;
  const r = jouerGeste({ type: "touche", touche: "Enter" }, doc, ["#zone"], () => null);
  assert.deepEqual(r, { ok: true });
  assert.equal(actif.recus[0].type, "keydown"); // `key` n'existe qu'en navigateur (KeyboardEvent)
});
step("jouerGeste : clic-dehors sans cible -> fond de page (body)", () => {
  const body = enregistreur();
  const doc = { body } as unknown as Document;
  assert.deepEqual(jouerGeste({ type: "clic-dehors" }, doc, ["#menu"], () => null), { ok: true });
  assert.equal(body.recus.at(-1)?.type, "click");
});

async function asynchrones() {
  const source = enregistreur();
  const dest = enregistreur();
  const docRecus = enregistreur();
  const r = await appliquerGlisser(source, dest, docRecus as unknown as Document, 0);
  assert.deepEqual(r, { ok: true });
  assert.equal(source.recus[0].type, "pointerdown");
  assert.ok(docRecus.recus.filter((e) => e.type === "pointermove").length >= 10);
  assert.equal(docRecus.recus.at(-1)?.type, "mouseup");
  passed++; console.log("ok - appliquerGlisser : dnd-kit, pointerdown puis mouvements puis lacher sur le document");

  const sansVers = await jouerGesteAttendu({ type: "glisser", cible: "#a" }, {} as Document, [], () => source as unknown as Element);
  assert.equal(sansVers.ok, false);
  passed++; console.log("ok - jouerGesteAttendu : glisser sans vers -> echec declare");

  const clic = await jouerGesteAttendu({ type: "clic", cible: "#a" }, {} as Document, [], () => ({ click() {} }) as unknown as Element);
  assert.deepEqual(clic, { ok: true });
  passed++; console.log("ok - jouerGesteAttendu : les gestes immediats passent par jouerGeste");
}

asynchrones().then(
  () => console.log(`\n${passed} assertions vertes`),
  (e) => { console.error("FAIL - asynchrones\n", e); process.exitCode = 1; },
);
