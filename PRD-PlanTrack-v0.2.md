# PRD — PlanTrack v0.2

**Destinataire** : agent de codage (Claude Code) chargé de l'implémentation
**Auteur** : Slimane — namespace `mdjlabs`
**Langage** : Python 3.11+, stdlib uniquement. Aucune dépendance externe en v1.
**Licence visée** : MIT
**État** : la couche 1 (capture) est déjà implémentée et testée. Les couches 2 à 4 sont à construire.

---

## 0. Instructions à l'agent qui implémente

- Le fichier `.claude/hooks/pt.py` existe déjà et fonctionne. **Ne le réécris pas depuis zéro.** Étends-le, ou éclate-le en modules si le fichier dépasse 1200 lignes. *(Décision Mariella, 2026-08-29 : seuil relevé de 700 à 1200 — le fichier unique est assumé parce qu'il rend l'auto-copie vendorée de `plantrack init` triviale : une seule copie, un seul diff.)*
- Implémente dans l'ordre des couches (§7 → §8 → §9 → §10). Chaque couche doit être fonctionnelle et testée avant de passer à la suivante.
- **Aucune dépendance externe.** Pas de pip install, pas de framework. Si tu penses en avoir besoin, c'est que le périmètre a dérivé.
- Le §5 (scénario de référence) est la spécification qui fait foi. En cas d'ambiguïté ailleurs dans ce document, c'est lui qui tranche.
- À chaque fin de couche : lance les tests du §14 et arrête-toi pour validation humaine. Ne pas enchaîner deux couches sans retour.
- Rien ne se supprime jamais dans le journal d'événements. Aucune fonction `delete`, ni en CLI, ni ailleurs.

---

## 1. Problème

Sur des sessions de codage longues avec un agent, trois pertes récurrentes coûtent du temps :

1. **Dérive de contexte** : après compaction, l'agent perd le plan et improvise.
2. **Résurrection de fonctionnalités abandonnées** : une feature annulée est réimplémentée plus tard, parce que rien dans le dépôt ne dit qu'elle a été abandonnée ni pourquoi.
3. **Boucles de correction** : sur un bug, l'agent retente une approche déjà rejetée.

Diagnostic central, qui conditionne toute l'architecture : **ce n'est pas un problème de stockage.** N'importe quelle base persiste correctement. Le problème se joue à deux endroits :

- **La capture** : au moment où un bug est signalé ou une décision prise, l'écriture dépend du bon vouloir de l'agent. En deuxième heure de session, il ne l'écrit pas. Rien n'est perdu par la base — ça n'y est jamais entré.
- **La réinjection** : après compaction, l'état est dans la base mais plus dans la fenêtre. Un appel de lecture en début de session ne survit pas à une compaction survenue trois heures plus tard.

Tout ce qui est déterministe (hook, contrainte serveur) tient. Tout ce qui dépend de l'attention du modèle est fragile. Le produit consiste à déplacer le maximum de choses de la seconde catégorie vers la première.

## 2. Objectifs

| # | Objectif | Mesure |
|---|---|---|
| O1 | Aucune décision perdue en session longue | Toute décision saisie via `!decide` réapparaît après N compactions |
| O2 | Aucun bug remonté perdu | Idem pour `!bug`, sans interrompre le fil de travail en cours |
| O3 | Reprise fidèle d'un sujet mis de côté | La note de reprise + les fichiers touchés sont restitués |
| O4 | Aucune fonctionnalité annulée réimplémentée | Les décisions d'abandon sont réinjectées à chaque session et gardées par un hook de commit |
| O5 | Aucune tentative de correction ratée retentée | Refus déterministe d'une hypothèse déjà testée |
| O6 | L'humain seul valide | Techniquement impossible pour l'agent d'écrire un statut validé |
| O7 | Changement d'agent sans perte | Même journal exploitable par Claude Code, Codex, ou en CLI pure |

## 3. Non-objectifs

Interface web, kanban, multi-utilisateur, synchronisation cloud, estimation, vélocité, découpage automatique du plan par IA, intégration Jira/Linear. Toute demande d'ajout doit passer le test : *sans ça, l'agent recommet-il une erreur déjà commise ?*

## 4. Principes

1. **Déterministe plutôt que prescriptif.** Une consigne dans `CLAUDE.md` s'estompe ; un hook, non.
2. **Rien ne se supprime.** Journal append-only, état reconstruit par rejeu. Un trou dans les données est comblé par l'agent avec des suppositions fausses.
3. **L'humain est le portier.** L'agent propose, l'humain valide. Verrou technique, pas contractuel.
4. **Zéro friction à la capture.** Chaque geste coûte 5 secondes maximum. Le seul facteur qui décide si le système survit trois semaines.
5. **Budget de contexte dur.** Ce qui est réinjecté doit rester assez petit pour survivre à une compaction. S'il enfle, il se fait compacter à son tour et le système s'effondre silencieusement.
6. **Agnostique à l'agent.** Journal texte, CLI, hooks. MCP en option, jamais en socle.

## 5. Scénario de référence (spécification qui fait foi)

Une session réelle, à faire passer intégralement :

1. Ouverture d'un fil de travail sur la page inscription.
2. L'agent modifie des fichiers — journalisés automatiquement, sans intervention.
3. En plein milieu, un bug est repéré **sur une autre page** et remonté sans interrompre le fil.
4. Le travail continue sur le plan.
5. Un détail du plan change — l'ancienne version n'est pas écrasée, elle devient un historique.
6. Un second bug est remonté.
7. Le fil est mis de côté avec une note de reprise.
8. Un nouveau fil est ouvert sur une autre page.
9. Retour sur le premier fil : la note de reprise, les fichiers touchés, les bugs liés et les tentatives rejetées sont restitués.

Ce scénario doit passer **après plusieurs compactions du contexte**, et rester vrai si l'utilisateur change d'agent entre l'étape 7 et l'étape 9.

## 6. Architecture

```
mon-projet/
├── .claude/
│   ├── settings.json            # 4 hooks (livré)
│   └── hooks/pt.py              # cœur : journal, projection, hooks, CLI (livré)
├── .plantrack/
│   ├── events.jsonl             # SOURCE DE VÉRITÉ, append-only, versionnée dans git
│   └── transcripts/             # archives PreCompact, gitignorées
├── plantrack                    # wrapper CLI humaine (livré)
└── AGENTS.md / CLAUDE.md        # bloc d'instructions généré
```

**Stockage** : un seul fichier JSONL, une ligne par événement. Aucun état n'est stocké, il est reconstruit par rejeu à chaque appel.

> **Décision de conception à assumer.** Une base SQLite avait été envisagée, puis une greffe sur Beads. Retenu : le journal JSONL propre. Motif — le stockage binaire interdit le diff et le merge git ; et une fois la projection écrite (40 lignes), une dépendance externe apporterait peu à cette échelle tout en créant un couplage. Un pont d'export vers Beads reste possible en extension (§13), pas en socle.

**Deux rôles, imposés par le point d'entrée, jamais par un paramètre d'appel** :
- hooks et serveur MCP éventuel → rôle `agent`, écritures restreintes ;
- exécutable `plantrack` → rôle `human`, écritures complètes.

## 7. Couche 1 — Capture (LIVRÉE, à ne pas casser)

Quatre hooks, déjà implémentés et testés :

| Hook | Rôle |
|---|---|
| `UserPromptSubmit` | intercepte les prompts commençant par `!`, écrit dans le journal, **rejette le prompt (exit 2)** — l'agent ne voit jamais ces commandes, son contexte reste propre |
| `PostToolUse` (Edit\|Write\|MultiEdit\|NotebookEdit) | journalise chaque fichier écrit, rattaché au fil actif |
| `SessionStart` | injecte le bloc d'état ; se redéclenche avec `source=compact`, donc **après chaque compaction** |
| `PreCompact` | archive le transcript avant compaction |

Commandes existantes : `!focus`, `!bug`, `!decide`, `!park`, `!close`, `!state`, `!help`, et `!<texte libre>` → inbox non typée.

Garde-fous existants : `!focus` refusé tant que le fil actif n'est pas parqué ; note de reprise obligatoire sur `!park` ; motif obligatoire sur `reject` ; 3 fils ouverts maximum ; plafond de 3 000 caractères sur le bloc réinjecté.

**Régressions interdites** : ces sept comportements doivent rester vrais après chaque couche ajoutée.

## 8. Couche 2 — Plan (à implémenter)

Objectif : le fil de travail devient rattachable à un plan structuré, sans perdre la légèreté de la couche 1.

### Nouveaux événements

```jsonc
{"kind":"phase_open",  "id":"p1", "text":"Authentification", "goal":"..."}
{"kind":"phase_status","id":"p1", "status":"active|done|cancelled", "text":"motif si cancelled"}
{"kind":"task_open",   "id":"k1", "phase":"p1", "text":"Formulaire d'inscription"}
{"kind":"task_status", "id":"k1", "status":"todo|in_progress|to_verify|done|cancelled|replaced",
                       "text":"motif", "replaced_by":"k7"}
```

### Règles

- Un fil (`thread`) peut porter un `task` : `!focus k1` reprend la tâche existante au lieu de créer un fil libre.
- **Statuts réservés à l'humain** : `done`, `cancelled`, `replaced` sur une tâche ; `done`, `cancelled` sur une phase. L'agent peut écrire `todo`, `in_progress`, `to_verify` et rien d'autre.
- `cancelled` et `replaced` exigent un motif ; `replaced` exige un `replaced_by`. Écriture refusée sinon.
- Toute annulation ou remplacement génère automatiquement une entrée de décision — c'est ce qui alimente la liste « ne jamais réimplémenter ».
- Aucune suppression : une tâche sort du plan par un statut terminal accompagné d'un motif, jamais autrement.

### Amorçage

`plantrack plan import <fichier.md>` : l'agent propose un découpage phases/tâches à partir d'une documentation existante, l'humain valide avant écriture. Aucune écriture sans validation.

## 9. Couche 3 — Bugs et tentatives

### Nouveaux événements

```jsonc
{"kind":"bug",        "id":"b1", "text":"...", "thread":"t1", "task":"k1",
                      "severity":"low|normal|high|blocker", "blocking":true}
{"kind":"attempt",    "id":"a1", "bug":"b1", "hypothesis":"...", "changes":"...", "actor":"claude-code"}
{"kind":"bug_status", "id":"b1", "status":"open|in_progress|to_verify|validated|wont_fix", "text":"motif"}
```

### Machine à états

```
open ──► in_progress ──► to_verify ──┬──► validated        (HUMAIN uniquement)
  ▲                          │        └──► open + motif    (rejet, HUMAIN uniquement)
  └──────────────────────────┘
open ──► wont_fix                                          (HUMAIN uniquement)
```

### Règles déterministes

- L'agent ne peut écrire que `open`, `in_progress`, `to_verify`. Toute autre transition depuis un point d'entrée en rôle `agent` échoue avec un message **pédagogique**, pas un simple refus : *« "validated" est réservé à l'humain. Passe le bug en "to_verify" et signale-le dans ta réponse. »* Le message d'erreur fait partie du produit : il rééduque l'agent.
- `plantrack reject <bug>` **exige** un motif (`-m`). Ce motif est attaché à la dernière tentative. Un rejet sans motif recrée exactement le problème que l'outil combat.
- **Refus d'hypothèse déjà tentée** : `attempt` est refusé si une tentative sémantiquement proche existe sur le même bug. Comparaison volontairement simple — normalisation (minuscules, ponctuation, espaces) puis ratio de similarité via `difflib.SequenceMatcher` > 0.85. Le message d'erreur renvoie la tentative précédente et son motif de rejet.
- Un bug `blocking` sur une phase fait apparaître un avertissement en tête du bloc réinjecté.

## 10. Couche 4 — Garde-fous indépendants du modèle

C'est le seul étage qui tient à la troisième heure de session, quel que soit l'agent.

**A. Hook `pre-commit`** (installé par `plantrack init --git-hook`) : le commit échoue si un fichier modifié est rattaché à une tâche `cancelled`/`replaced` ou à un fil parqué. Message :

```
PlanTrack : src/upload/Legacy.tsx appartient à la tâche k12, annulée le 2026-08-14
Motif : remplacée par le composant Upload unifié (k19)
Contournement : git commit --no-verify
```

**B. Hook `PreToolUse`** (optionnel, matcher `Edit|Write`) : même vérification, mais avant l'écriture. Exit 2 pour bloquer, le message d'erreur repart vers l'agent. Plus intrusif, à activer via `.plantrack/config.json` (`"strict": true`), désactivé par défaut.

**C. Flush sur `PreCompact`** : `stdout` n'est pas injecté sur cet événement — l'archivage du transcript reste donc le seul recours pour retrouver une nuance discutée mais jamais consignée. À documenter comme une limite, pas à masquer.

## 11. Réinjection et budget de contexte

Le bloc produit par `SessionStart` contient, dans cet ordre : fil actif et fichiers récents, fils en pause avec note de reprise, bugs ouverts, décisions actées (« ne jamais réimplémenter »), taille de l'inbox, règles de conduite.

- Plafond dur : 3 000 caractères, avec troncature explicite.
- Limites : 8 bugs, 6 décisions, 6 fichiers, 140 caractères par ligne.
- Priorité en cas de dépassement : décisions d'abandon > note de reprise du fil actif > bugs bloquants > le reste.
- Mesure de référence actuelle : 972 caractères sur un projet à deux fils, un bug, une décision.

## 12. CLI humaine

Existant : `status`, `bugs`, `inbox`, `threads`, `verify`, `reject -m`, `file`, `close`, `help`.

À ajouter :

```
plantrack init [--git-hook] [--agent claude|codex|gemini]
plantrack plan                          # arbre phases/tâches avec statuts
plantrack phase add|start|done|cancel
plantrack task  add|done|cancel|replace
plantrack attempts <bug_id>             # journal des tentatives et motifs de rejet
plantrack decisions                     # journal des décisions, chronologique
plantrack doctor                        # vérifie hooks installés, journal lisible, budget contexte
plantrack stats                         # cf. §15
```

## 13. Portage multi-agents

`plantrack init` insère un bloc entre marqueurs `<!-- plantrack:start -->` / `<!-- plantrack:end -->` sans écraser l'existant :

```markdown
<!-- plantrack:start -->
## PlanTrack
- L'état du projet t'est injecté automatiquement en début de session et après chaque compaction. Fie-toi à ce bloc, pas à ta mémoire de la conversation.
- Ne réimplémente jamais ce qui figure sous DECISIONS ACTEES.
- Ne modifie pas les fichiers d'un fil en pause.
- Après correction d'un bug : consigne la tentative, puis passe-le en "to_verify". Tu ne valides jamais un bug toi-même.
<!-- plantrack:end -->
```

| Agent | Config | Niveau de garantie |
|---|---|---|
| Claude Code | `.claude/settings.json` (4 hooks) | complet |
| Codex CLI | hooks équivalents sur `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `PermissionRequest` — traduction de config | complet, à vérifier tôt |
| Autres CLI | CLI + `AGENTS.md` + hook `pre-commit` | dégradé, mais le garde-fou git tient |

Extension possible : `plantrack export --beads` pour alimenter [Beads](https://github.com/gastownhall/beads) si le besoin de graphe de dépendances apparaît.

## 14. Tests d'acceptation

Écrire un script `tests/scenario.sh` qui simule les hooks en injectant du JSON sur stdin et vérifie les sorties.

1. Le scénario complet du §5 passe, avec une réinjection `source=compact` intercalée entre chaque étape.
2. Un `!bug` n'atteint jamais le modèle (exit 2) et apparaît dans le bloc réinjecté suivant.
3. `!focus` sur un second sujet échoue tant que le fil actif n'est pas parqué.
4. `!park` sans note échoue.
5. Une tâche annulée avec motif apparaît sous « ne jamais réimplémenter » à la session suivante.
6. Un `attempt` avec une hypothèse déjà testée est refusé, et l'erreur contient le motif du rejet précédent.
7. Un passage à `validated` depuis un point d'entrée en rôle `agent` échoue avec le message pédagogique.
8. Un commit touchant un fichier d'une tâche annulée échoue.
9. Le bloc réinjecté reste sous 3 000 caractères avec 3 fils, 10 bugs et 20 décisions.
10. Une ligne corrompue dans `events.jsonl` ne casse ni la projection ni la session.
11. Le journal reste lisible et rejouable après suppression manuelle du dernier événement (robustesse au merge git).

## 15. Mesure d'usage

`plantrack stats` affiche, sur les 14 derniers jours : nombre de captures `!` par type, nombre de bugs rejetés puis re-rejetés (signal de boucle), nombre de reprises de fil, nombre de blocages `pre-commit` déclenchés.

Sans ces chiffres, impossible de savoir dans six semaines si l'outil sert, et le risque est de le maintenir par principe. C'est aussi le seul argument crédible le jour d'une publication publique.

## 16. Jalons

| Jalon | Contenu | Critère de sortie |
|---|---|---|
| **v0** ✅ | Couche capture, 4 hooks, journal, CLI de base | Scénario §5 rejoué et passé |
| **v0.5** | Couche 4 (pre-commit) — la plus rentable, avant le plan | Test 8 |
| **v1.0** | Couche 2 (plan) + couche 3 (bugs/tentatives) | Tests 1 à 11 |
| **v1.1** | `init`, portage Codex, `doctor`, `stats` | Un projet réel repris depuis Codex |
| **Publication** | README, démo, packaging | Uniquement si les chiffres du §15 le justifient |

## 17. Risques et points à trancher

| Risque | Parade |
|---|---|
| Friction de saisie → abandon en 3 semaines | Inbox non typée (`!<texte>`), zéro décision au moment de la capture |
| Ce qui n'est jamais capturé reste perdu | Archivage transcript ; à documenter comme limite assumée |
| Bloc réinjecté qui enfle | Plafond dur + limite de 3 fils, testés (test 9) |
| Dérive vers un Jira maison | §3 opposable à toute demande d'ajout |
| IDs séquentiels par rejeu, en multi-branches | À revoir si travail sur worktrees parallèles — préférer alors un suffixe aléatoire |

**À trancher pendant l'implémentation** : faut-il que l'agent puisse *proposer* `wont_fix` (soumis à validation) plutôt que d'en être totalement exclu ; et si le mode `strict` du §10-B doit devenir le défaut une fois éprouvé.
