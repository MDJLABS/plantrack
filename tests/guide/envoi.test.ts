// tests/guide/envoi.test.ts — corps de la requête (`corpsEnvoi`) et appel réseau
// (`envoyerResultat`) de guide-envoi.ts.
//
// `corpsEnvoi` est pure (aucun DOM, aucun réseau) : seules les étapes qui portent un `pt`
// (identifiant PlanTrack) ET ont déjà un verdict partent dans le corps ; le motif n'accompagne
// que les "ko" (cf. bandeau de tête de guide-compte-rendu.ts — se raviser en "ok" après un motif
// posé ne doit pas laisser un écart motivé qui n'existe plus).
//
// `envoyerResultat` est testée avec un `fetch` global REMPLACÉ (pas de vrai réseau) :
// - revalide `poste` (défense en profondeur) → `javascript:`/`http://evil`/userinfo rejetés
//   AVANT tout appel réseau, même si l'appelant a « oublié » de valider en amont ;
// - construit l'URL via l'API `URL` (`new URL("/guide/resultat", origine)` +
//   `searchParams.set("projet", …)`) — on le prouve en inspectant l'URL REÇUE par le `fetch`
//   remplacé, pas en relisant le code : un `projet` qui porte `&`/`#`/un chemin ne doit jamais
//   s'injecter dans la requête.
//
// EXÉCUTION :
//   node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
//     --import ./tests/guide/support/register.mjs tests/guide/envoi.test.ts

import assert from "node:assert/strict";
import { corpsEnvoi, envoyerResultat } from "../../.claude/hooks/plantrack_guide/lib/guide/guide-envoi";
import type { GuideProgress, GuideScenario } from "../../.claude/hooks/plantrack_guide/lib/guide/types";

// Les pas qui touchent `envoyerResultat` remplacent le `fetch` GLOBAL (pas d'injection de
// dépendance dans ce module) : ils doivent s'exécuter en SÉRIE, jamais en parallèle, sous
// peine qu'un pas restaure le fetch d'un autre pendant qu'il est encore en vol. `step` empile
// donc des FONCTIONS (pas des promesses déjà lancées), jouées une à une par `tout()`.
let passed = 0;
const pas: Array<{ n: string; fn: () => void | Promise<void> }> = [];
function step(n: string, fn: () => void | Promise<void>) {
  pas.push({ n, fn });
}
async function tout() {
  for (const { n, fn } of pas) {
    try {
      await fn();
      passed++;
      console.log("ok -", n);
    } catch (e) {
      console.error("FAIL -", n, "\n", e);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passed} assertions vertes`);
}

const SCENARIO: GuideScenario = {
  id: "temoin-geste",
  titre: "Témoin",
  date: "2026-10-28",
  page: "—",
  etapes: [
    { id: "r1", titre: "R1", action: "—", attendu: "—", pt: "pt-r1" },
    { id: "r2", titre: "R2 (sans pt)", action: "—", attendu: "—" },
    { id: "r3", titre: "R3 (pas encore répondu)", action: "—", attendu: "—", pt: "pt-r3" },
    { id: "r4", titre: "R4 (ko motivé)", action: "—", attendu: "—", pt: "pt-r4" },
    { id: "r5", titre: "R5 (motif posé puis ravisée en ok)", action: "—", attendu: "—", pt: "pt-r5" },
  ],
};

// --- 1. corpsEnvoi() — filtrage pt + verdict, motif uniquement sur "ko" -------------------

step("corpsEnvoi : ne transmet que les étapes avec pt ET verdict, motif seulement sur ko", () => {
  const prog: GuideProgress = {
    scenarioId: SCENARIO.id,
    index: 0,
    verdicts: { r1: "ok", r2: "ok", r4: "ko", r5: "ok" },
    motifs: { r4: "le bouton ne répond pas", r5: "ancien motif, périmé" },
  };
  const corps = corpsEnvoi(SCENARIO, prog, "jeton-abc");
  assert.equal(corps.jeton, "jeton-abc");
  assert.equal(corps.guide, SCENARIO.id);
  assert.deepEqual(corps.verdicts, [
    { pt: "pt-r1", verdict: "ok" },
    { pt: "pt-r4", verdict: "ko", motif: "le bouton ne répond pas" },
    { pt: "pt-r5", verdict: "ok" }, // ravisée en "ok" : le motif périmé ne doit PAS ressortir
  ]);
});
step("corpsEnvoi : aucun verdict → verdicts vide, jamais une exception", () => {
  const prog: GuideProgress = { scenarioId: SCENARIO.id, index: 0, verdicts: {} };
  assert.deepEqual(corpsEnvoi(SCENARIO, prog, "j").verdicts, []);
});
step("corpsEnvoi : motifs absent (ancienne progression, round de correction) → jamais une exception", () => {
  const prog = { scenarioId: SCENARIO.id, index: 0, verdicts: { r4: "ko" } } as GuideProgress;
  assert.doesNotThrow(() => corpsEnvoi(SCENARIO, prog, "j"));
  assert.deepEqual(corpsEnvoi(SCENARIO, prog, "j").verdicts, [{ pt: "pt-r4", verdict: "ko" }]);
});

// --- 2. envoyerResultat() — revalidation (défense en profondeur) -------------------------

type AppelFetch = { url: string; init: RequestInit | undefined };
function remplacerFetch(reponse: () => Promise<Response> | Response): { appels: AppelFetch[]; restaurer: () => void } {
  const appels: AppelFetch[] = [];
  const original = globalThis.fetch;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    appels.push({ url: String(input), init });
    return reponse();
  }) as typeof fetch;
  return { appels, restaurer: () => { (globalThis as unknown as { fetch: typeof fetch }).fetch = original; } };
}

step("envoyerResultat : poste=javascript: → rejeté AVANT tout appel réseau", async () => {
  const { appels, restaurer } = remplacerFetch(() => {
    throw new Error("fetch n'aurait jamais dû être appelé");
  });
  try {
    const r = await envoyerResultat("javascript:alert(1)", "projet", { jeton: "j", guide: "g", verdicts: [] });
    assert.equal(r.ok, false);
    assert.equal(r.message, "destination invalide");
    assert.equal(appels.length, 0, "aucun appel réseau ne doit partir pour une destination invalide");
  } finally {
    restaurer();
  }
});
step("envoyerResultat : poste=http://evil (non local) → rejeté AVANT tout appel réseau", async () => {
  const { appels, restaurer } = remplacerFetch(() => {
    throw new Error("fetch n'aurait jamais dû être appelé");
  });
  try {
    const r = await envoyerResultat("http://evil.example.com", "projet", { jeton: "j", guide: "g", verdicts: [] });
    assert.equal(r.ok, false);
    assert.equal(appels.length, 0);
  } finally {
    restaurer();
  }
});
step("envoyerResultat : poste avec userinfo → rejeté AVANT tout appel réseau", async () => {
  const { appels, restaurer } = remplacerFetch(() => {
    throw new Error("fetch n'aurait jamais dû être appelé");
  });
  try {
    const r = await envoyerResultat("https://u:p@exemple.com", "projet", { jeton: "j", guide: "g", verdicts: [] });
    assert.equal(r.ok, false);
    assert.equal(appels.length, 0);
  } finally {
    restaurer();
  }
});

step("envoyerResultat : poste valide → URL construite via l'API URL (origine + /guide/resultat?projet=…)", async () => {
  const { appels, restaurer } = remplacerFetch(() => new Response(null, { status: 200 }));
  try {
    const r = await envoyerResultat("https://exemple.com/chemin-ignore?x=1", "mon projet & bizarre", {
      jeton: "j",
      guide: "g",
      verdicts: [],
    });
    assert.equal(r.ok, true);
    assert.equal(appels.length, 1);
    const url = new URL(appels[0]!.url);
    assert.equal(url.origin, "https://exemple.com", "l'origine du poste d'entrée est respectée, pas son chemin");
    assert.equal(url.pathname, "/guide/resultat");
    assert.equal(url.searchParams.get("projet"), "mon projet & bizarre", "projet correctement encodé par l'API URL, jamais injecté brut");
  } finally {
    restaurer();
  }
});
step("envoyerResultat : réponse non-2xx → { ok: false }, jamais une exception", async () => {
  const { restaurer } = remplacerFetch(() => new Response(null, { status: 500 }));
  try {
    const r = await envoyerResultat("https://exemple.com", "p", { jeton: "j", guide: "g", verdicts: [] });
    assert.equal(r.ok, false);
  } finally {
    restaurer();
  }
});
step("envoyerResultat : fetch qui lève (réseau coupé) → { ok: false }, jamais une exception qui traverse", async () => {
  const { restaurer } = remplacerFetch(() => {
    throw new Error("réseau coupé");
  });
  try {
    await assert.doesNotReject(async () => {
      const r = await envoyerResultat("https://exemple.com", "p", { jeton: "j", guide: "g", verdicts: [] });
      assert.equal(r.ok, false);
    });
  } finally {
    restaurer();
  }
});

await tout();
