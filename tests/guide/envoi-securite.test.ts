// tests/guide/envoi-securite.test.ts — VALIDATION DE LA DESTINATION de l'envoi du résultat
// (revue sécurité, lot « curseur animé »).
//
// CE QUE CETTE SUITE PROUVE
// --------------------------
// `resoudreEnvoi`/`parserInfosEnvoi` (guide-visite.ts) acceptaient un `poste` ARBITRAIRE —
// aucune vérification de schéma, d'hôte, ni d'absence d'identifiants dans l'URL — et ne
// gardaient aucune dépendance à la présence d'un `?guide=` valide sur la même page. Un
// convive capable de poser trois paramètres d'URL (`retour`, `poste`, `projet`) pouvait donc
// faire partir une requête POST (via `guide-envoi.ts`, `envoyerResultat`) vers N'IMPORTE QUELLE
// origine, avec le contenu du guide en corps.
//
// `validerPoste()` ferme ça : `new URL()` dans un `try` (élimine `javascript:` et tout ce qui
// n'a pas d'autorité analysable), protocole `https:` obligatoire (ou `http:` seulement pour
// `localhost`/`127.0.0.1`/`[::1]`, développement), userinfo (`user:pass@hote`) refusé, et SEULE
// l'origine est gardée (jamais le chemin/query/hash d'entrée). `resoudreEnvoi()` exige en plus
// que la MÊME page porte un `?guide=` valide (`decisionVisite.ecrireSession`) — sans guide actif,
// aucune info d'envoi n'est jamais rendue. `parserInfosEnvoi` (relecture de session) réapplique
// la même validation : une clé `sessionStorage` forgée à la main ne vaut pas mieux qu'un
// paramètre d'URL direct. `envoyerResultat` (guide-envoi.ts) revalide une TROISIÈME fois
// (défense en profondeur) et construit l'URL finale avec l'API `URL`, jamais par concaténation.
//
// Aucun DOM, aucun réseau ici : fonctions pures, testées en Node direct.
//
// EXÉCUTION :
//   node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
//     --import ./tests/guide/support/register.mjs tests/guide/envoi-securite.test.ts

import assert from "node:assert/strict";
import {
  validerPoste,
  resoudreEnvoi,
  type InfosEnvoi,
} from "../../.claude/hooks/plantrack_guide/lib/guide/guide-visite";
import type { DecisionMontage } from "../../.claude/hooks/plantrack_guide/lib/guide/guide-visite";
import { getScenario } from "./fixtures/scenarios";

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

const SCENARIO = getScenario("temoin-principal")!;
const DECISION_OUVERTURE: DecisionMontage = { scenario: SCENARIO, ecrireSession: true };
const DECISION_REPRISE: DecisionMontage = { scenario: SCENARIO, ecrireSession: false };

// --- 1. validerPoste() — schéma, hôte, userinfo -------------------------------------------

step('validerPoste("javascript:alert(1)") → null (aucune autorité analysable)', () => {
  assert.equal(validerPoste("javascript:alert(1)"), null);
});
step('validerPoste("http://evil.example.com") → null (http vers un hôte DISTANT)', () => {
  assert.equal(validerPoste("http://evil.example.com"), null);
});
step('validerPoste("https://u:p@evil.example.com") → null (userinfo refusé)', () => {
  assert.equal(validerPoste("https://u:p@evil.example.com"), null);
});
step('validerPoste("https://u@evil.example.com") → null (username seul déjà refusé)', () => {
  assert.equal(validerPoste("https://u@evil.example.com"), null);
});
step('validerPoste("data:text/html,<script>") → null', () => {
  assert.equal(validerPoste("data:text/html,<script>alert(1)</script>"), null);
});
step('validerPoste("not a url") → null (new URL() lève)', () => {
  assert.equal(validerPoste("not a url"), null);
});
step('validerPoste("https://exemple.com/chemin?x=1#h") → origine SEULE, jamais le chemin/query/hash', () => {
  assert.equal(validerPoste("https://exemple.com/chemin?x=1#h"), "https://exemple.com");
});
step('validerPoste("http://localhost:3000") → accepté (dev), origine normalisée', () => {
  assert.equal(validerPoste("http://localhost:3000"), "http://localhost:3000");
});
step('validerPoste("http://127.0.0.1:3000") → accepté (dev)', () => {
  assert.equal(validerPoste("http://127.0.0.1:3000"), "http://127.0.0.1:3000");
});
step('validerPoste("http://[::1]:3000") → accepté (dev, loopback IPv6)', () => {
  assert.equal(validerPoste("http://[::1]:3000"), "http://[::1]:3000");
});
step('validerPoste("https://exemple.com") → accepté', () => {
  assert.equal(validerPoste("https://exemple.com"), "https://exemple.com");
});

// --- 1b. validerPoste() — liste blanche facultative (NEXT_PUBLIC_GUIDE_POSTES) -------------
//
// Variable lue À CHAQUE appel (pas au chargement du module) : chaque pas pose puis retire
// la variable — jamais de `step` laissé « sale » pour les sections suivantes, qui comptent
// sur l'absence de liste blanche pour exercer la règle habituelle (https / loopback).

function avecListeBlanche(valeur: string | undefined, fn: () => void) {
  const avant = process.env.NEXT_PUBLIC_GUIDE_POSTES;
  if (valeur === undefined) delete process.env.NEXT_PUBLIC_GUIDE_POSTES;
  else process.env.NEXT_PUBLIC_GUIDE_POSTES = valeur;
  try {
    fn();
  } finally {
    if (avant === undefined) delete process.env.NEXT_PUBLIC_GUIDE_POSTES;
    else process.env.NEXT_PUBLIC_GUIDE_POSTES = avant;
  }
}

step("liste blanche définie : origine absente de la liste → null, même en https", () => {
  avecListeBlanche("https://a.exemple.com,https://b.exemple.com", () => {
    assert.equal(validerPoste("https://c.exemple.com"), null);
  });
});
step("liste blanche définie : origine présente → acceptée, origine normalisée", () => {
  avecListeBlanche("https://a.exemple.com,https://b.exemple.com", () => {
    assert.equal(validerPoste("https://a.exemple.com/chemin-ignore?x=1"), "https://a.exemple.com");
  });
});
step("liste blanche définie : seule elle décide — un http DISTANT listé passe (hors règle habituelle)", () => {
  avecListeBlanche("http://interne.exemple.com", () => {
    assert.equal(validerPoste("http://interne.exemple.com"), "http://interne.exemple.com");
  });
});
step("liste blanche définie : localhost NON listé → refusé (la règle habituelle ne le sauve plus)", () => {
  avecListeBlanche("https://a.exemple.com", () => {
    assert.equal(validerPoste("http://localhost:3000"), null);
  });
});
step("liste blanche définie mais userinfo présent → refusé AVANT même de consulter la liste", () => {
  avecListeBlanche("https://exemple.com", () => {
    assert.equal(validerPoste("https://u:p@exemple.com"), null);
  });
});
step("liste blanche avec entrée mal formée + espaces → ignorée, le reste de la liste fonctionne", () => {
  avecListeBlanche(" https://a.exemple.com , pas-une-url , https://b.exemple.com ", () => {
    assert.equal(validerPoste("https://a.exemple.com"), "https://a.exemple.com");
    assert.equal(validerPoste("https://b.exemple.com"), "https://b.exemple.com");
    assert.equal(validerPoste("https://pas-une-url"), null);
  });
});
step("liste blanche vide ou faite seulement d'entrées mal formées → retombe sur la règle habituelle", () => {
  avecListeBlanche(" , pas-une-url , ", () => {
    assert.equal(validerPoste("https://exemple.com"), "https://exemple.com");
    assert.equal(validerPoste("http://localhost:3000"), "http://localhost:3000");
  });
});
step("variable absente (cas par défaut) → règle habituelle inchangée, hôte distant http refusé", () => {
  avecListeBlanche(undefined, () => {
    assert.equal(validerPoste("http://evil.example.com"), null);
    assert.equal(validerPoste("https://exemple.com"), "https://exemple.com");
  });
});

// --- 2. resoudreEnvoi() — pas de ?guide= valide sur la page → rien, quoi que l'URL porte --

step("decisionVisite null (pas de ?guide= valide) → resoudreEnvoi rend TOUJOURS null", () => {
  const r = resoudreEnvoi(null, "jeton-abc123", "https://exemple.com", "projet-x", null);
  assert.equal(r, null);
});
step("decisionVisite null, même avec une session d'envoi déjà valide → null quand même", () => {
  const sessionValide = JSON.stringify({ jeton: "abc123", poste: "https://exemple.com", projet: "p" });
  assert.equal(resoudreEnvoi(null, null, null, null, sessionValide), null);
});

// --- 3. resoudreEnvoi() — les trois paramètres d'URL, avec guide actif et valide ----------

step("guide ouvert explicitement + poste/jeton valides → InfosEnvoi, origine normalisée", () => {
  const r = resoudreEnvoi(DECISION_OUVERTURE, "jeton-abc_123", "https://exemple.com/chemin-ignore", "mon-projet", null);
  assert.deepEqual(r, { jeton: "jeton-abc_123", poste: "https://exemple.com", projet: "mon-projet" } as InfosEnvoi);
});
step("guide ouvert explicitement + poste javascript: → rejeté, retombe sur la session (ici vide → null)", () => {
  const r = resoudreEnvoi(DECISION_OUVERTURE, "jeton-abc", "javascript:alert(1)", "p", null);
  assert.equal(r, null);
});
step("guide ouvert explicitement + poste http://evil (non local) → rejeté", () => {
  const r = resoudreEnvoi(DECISION_OUVERTURE, "jeton-abc", "http://evil.example.com", "p", null);
  assert.equal(r, null);
});
step("guide ouvert explicitement + poste avec userinfo → rejeté", () => {
  const r = resoudreEnvoi(DECISION_OUVERTURE, "jeton-abc", "https://u:p@exemple.com", "p", null);
  assert.equal(r, null);
});
step("guide ouvert explicitement MAIS simple reprise (ecrireSession=false) → les paramètres d'URL sont IGNORÉS", () => {
  // Même si les trois paramètres sont présents et valides, une reprise (pas une ouverture
  // explicite) ne doit jamais les honorer — seule une session déjà valide compte.
  const r = resoudreEnvoi(DECISION_REPRISE, "jeton-abc", "https://exemple.com", "p", null);
  assert.equal(r, null);
});

// --- 4. Jeton : longueur bornée et alphabet restreint -------------------------------------

step("jeton avec espace → rejeté (retombe sur la session, ici vide → null)", () => {
  const r = resoudreEnvoi(DECISION_OUVERTURE, "jeton avec espace", "https://exemple.com", "p", null);
  assert.equal(r, null);
});
step('jeton avec guillemet → rejeté', () => {
  const r = resoudreEnvoi(DECISION_OUVERTURE, 'jeton"injecte', "https://exemple.com", "p", null);
  assert.equal(r, null);
});
step("jeton trop long (201 caractères) → rejeté", () => {
  const long = "a".repeat(201);
  const r = resoudreEnvoi(DECISION_OUVERTURE, long, "https://exemple.com", "p", null);
  assert.equal(r, null);
});
step("jeton de 200 caractères (borne haute) → accepté", () => {
  const pile = "a".repeat(200);
  const r = resoudreEnvoi(DECISION_OUVERTURE, pile, "https://exemple.com", "p", null);
  assert.deepEqual(r, { jeton: pile, poste: "https://exemple.com", projet: "p" });
});

// --- 5. parserInfosEnvoi() (relecture de session) — même validation, défense en profondeur ---

step("session d'envoi forgée avec poste=javascript: → null (pas seulement à l'écriture)", () => {
  const forgee = JSON.stringify({ jeton: "abc123", poste: "javascript:alert(1)", projet: "p" });
  assert.equal(resoudreEnvoi(DECISION_REPRISE, null, null, null, forgee), null);
});
step("session d'envoi forgée avec poste=http://evil → null", () => {
  const forgee = JSON.stringify({ jeton: "abc123", poste: "http://evil.example.com", projet: "p" });
  assert.equal(resoudreEnvoi(DECISION_REPRISE, null, null, null, forgee), null);
});
step("session d'envoi forgée avec userinfo → null", () => {
  const forgee = JSON.stringify({ jeton: "abc123", poste: "https://u:p@exemple.com", projet: "p" });
  assert.equal(resoudreEnvoi(DECISION_REPRISE, null, null, null, forgee), null);
});
step("session d'envoi forgée avec jeton invalide (caractères) → null", () => {
  const forgee = JSON.stringify({ jeton: "a b c", poste: "https://exemple.com", projet: "p" });
  assert.equal(resoudreEnvoi(DECISION_REPRISE, null, null, null, forgee), null);
});
step("session d'envoi valide, relue sur une simple reprise → honorée, origine normalisée", () => {
  const valide = JSON.stringify({ jeton: "abc123", poste: "https://exemple.com/chemin-ignore", projet: "p" });
  const r = resoudreEnvoi(DECISION_REPRISE, null, null, null, valide);
  assert.deepEqual(r, { jeton: "abc123", poste: "https://exemple.com", projet: "p" });
});
step("session d'envoi illisible (JSON cassé) → null, jamais une exception", () => {
  assert.doesNotThrow(() => {
    assert.equal(resoudreEnvoi(DECISION_REPRISE, null, null, null, "{pas du json"), null);
  });
});
step("session d'envoi absente (null/undefined/vide) → null", () => {
  assert.equal(resoudreEnvoi(DECISION_REPRISE, null, null, null, null), null);
  assert.equal(resoudreEnvoi(DECISION_REPRISE, null, null, null, undefined), null);
  assert.equal(resoudreEnvoi(DECISION_REPRISE, null, null, null, ""), null);
});

console.log(`\n${passed} assertions vertes`);
