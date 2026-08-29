# PlanTrack

**Contexte, plan et bugs persistants pour les longues sessions d'agent de codage.**

[![PyPI](https://img.shields.io/pypi/v/plantrack)](https://pypi.org/project/plantrack/)
[![Python](https://img.shields.io/badge/python-3.11+-blue)](https://pypi.org/project/plantrack/)
[![Licence](https://img.shields.io/badge/licence-MIT-green)](https://github.com/MDJLABS/plantrack/blob/main/LICENSE)
[![Dépendances](https://img.shields.io/badge/d%C3%A9pendances-0-brightgreen)](https://github.com/MDJLABS/plantrack)

Un agent de codage oublie. Quand la conversation devient trop longue, elle est
compressée et des détails disparaissent : un bug signalé au passage, une décision
prise il y a deux heures, la raison d'un choix. PlanTrack tient un **carnet de
bord** dans le projet et le réinjecte automatiquement à l'agent — à chaque
nouvelle session et après chaque compression. L'agent repart toujours de ce qui
a été **écrit**, jamais de ce dont il « se souvient ».

Un seul fichier Python, stdlib uniquement, **zéro dépendance**, aucune base de
données. Le carnet est un fichier texte versionné avec le projet.

## Installation (2 minutes)

Depuis la racine du projet cible :

```bash
uvx plantrack init               # ou : pipx run plantrack init
./plantrack init --git-hook      # optionnel : le garde-fou git pre-commit
```

Redémarre ton agent, c'est tout. Vérifie avec `/hooks` (Claude Code) ou :

```bash
./plantrack doctor               # hooks, journal, budget de contexte
```

`init` est **idempotent et non destructif** : si un `CLAUDE.md`, un `AGENTS.md`
ou un `settings.json` existe déjà, PlanTrack **s'y ajoute** (fusion, marqueurs)
sans jamais rien effacer. Un fichier de config est inerte tant que l'agent n'est
pas là : l'agent que tu installeras **après** trouvera PlanTrack déjà en place,
sans option à connaître — même s'ils sont plusieurs.

Pour mettre à jour une installation existante :

```bash
uvx plantrack@latest update      # remplace le moteur, remet tout à niveau,
                                 # ne touche jamais au carnet ni à tes fichiers
```

## Comment ça marche, tout simplement

Tout ce qui est noté dans le carnet est **définitif** : à chaque session, et
après chaque compression du contexte, l'agent reçoit automatiquement le résumé
du carnet. Au quotidien :

- **Tu vois un bug en plein milieu d'une tâche ?** Tape `!bug l'avatar ne se
  rafraîchit pas`. Le bug est noté et l'agent ne voit même pas passer le message :
  il n'est pas déconcentré de sa tâche. Le bug ressortira à chaque session tant
  qu'il n'est pas réglé — impossible de l'oublier.
- **Vous prenez une décision ?** `!decide on abandonne X — motif : Y`. Elle est
  rappelée à l'agent à chaque session, avec interdiction de la réimplémenter.
- **Tu changes d'avis plus tard ?** Tu actes une nouvelle décision. Rien ne
  s'efface jamais : l'ancienne reste dans l'historique — on sait *pourquoi* on
  avait choisi autrement — et la nouvelle fait foi.
- **Tu pars sur un autre sujet ?** `!park reste à faire : Z`. La note de reprise
  est obligatoire — c'est elle qui permet de reprendre le fil dans trois jours
  sans rien reperdre.
- **L'agent dit qu'un bug est corrigé ?** Il n'a pas le droit de le déclarer
  réglé : le bug passe « à vérifier » et c'est toi qui valides ou rejettes, avec
  un motif conservé — l'agent ne retentera pas deux fois la même correction.
- **Une nouvelle session démarre ?** Rien à faire : l'état complet (fils en
  cours, décisions, bugs ouverts) est réinjecté automatiquement.
- **L'agent écrit désormais lui-même au carnet.** Une décision prise en
  conversation, un bug repéré en passant, un piège technique découvert : il les
  consigne lui-même via la CLI (`./plantrack decide/bug/piege`), marqués
  `(agent)` pour qu'on distingue toujours ce qu'il a noté de ce que tu as noté.
  Avant de corriger un bug, il consulte d'abord les tentatives passées — il ne
  retente jamais une hypothèse déjà rejetée.

Le carnet (`.plantrack/events.jsonl`) ne fait que s'allonger, ligne par ligne :
rien ne s'y supprime, l'état courant est recalculé en le relisant. Changer
d'avis, revenir en arrière, reprendre après une pause : tout reste cohérent
parce que tout est écrit. Et comme c'est du texte, une ligne par événement,
**il se versionne** : diff lisible en revue, merge trivial.

## Une session type, pas à pas

```text
toi   : !focus page inscription          ← ouvre un fil de travail
        … tu travailles avec l'agent …
toi   : !bug le profil perd l'avatar     ← noté ; l'agent ne le voit même pas
toi   : !decide validation côté serveur uniquement — motif : pas de code en double
toi   : !park reste le CSS mobile        ← pause, note de reprise obligatoire
toi   : !focus paiement                  ← nouveau fil

        … trois jours et dix compactions plus tard, nouvelle session …

agent : [PlanTrack] Fil actif : paiement. En pause : page inscription
        (reste le CSS mobile). Bug ouvert : le profil perd l'avatar.
        Décision : validation côté serveur uniquement.
```

Rien n'a été répété, rien n'a été perdu — et le bloc réinjecté pèse environ
250 tokens sur un projet à deux fils (plafond dur à 3 000 caractères).

## Les commandes

Dans le prompt de l'agent — les commandes commençant par `!` sont **interceptées
avant d'atteindre le modèle** : son contexte reste propre.

| Commande | Effet |
|---|---|
| `!focus page inscription` | ouvre un fil de travail (ou reprend `!focus t1`) |
| `!bug l'avatar ne se rafraîchit pas` | enregistre un bug sans interrompre le fil |
| `!decide on abandonne X — motif : Y` | acte une décision, rappelée à chaque session |
| `!park reste à faire… ne pas toucher à Z` | met le fil en pause **avec note de reprise obligatoire** |
| `!close` | ferme le fil actif |
| `!piege le cache invalide la session` | note un piège technique, rappelé à chaque session |
| `!question faut-il garder l'ancien format ?` | pose une question à l'humain, rappelée tant que sans réponse |
| `!answer q1 oui, on garde` | toi seule : réponds à une question en attente |
| `!state` | affiche l'état persistant |
| `!testcheck on\|off` | active/désactive les guides de test cochables (off par défaut) |
| `!check s1 ok` / `!check s1 ko -m "motif"` | toi seule : verdict sur une étape de guide (motif obligatoire pour ko) |
| `!n'importe quel texte` | capture libre dans l'inbox, à classer plus tard |

Un bug accepte une sévérité : `!bug le paiement échoue --blocker` (ou
`--low`/`--high`). Un bug `blocker` s'affiche en tête du bloc réinjecté.

Côté humain, hors session :

```bash
./plantrack status              # le bloc d'état, tel que l'agent le voit
./plantrack bugs                # bugs ouverts + tentatives + motifs de rejet
./plantrack plan                # arbre phases/tâches ; plan import <f.md> pour proposer
./plantrack attempt b1 "hypothèse testée"   # refusé si déjà tentée (similarité > 0.85)
./plantrack attempts b1         # journal des tentatives et motifs de rejet
./plantrack bug b1 wont_fix -m "cosmétique"  # toi seule (motif obligatoire)
./plantrack verify b1           # toi seule valides (bug en to_verify uniquement)
./plantrack reject b1 -m "le cache n'était pas la cause, ne pas retenter"
./plantrack file n1 bug         # classe une note d'inbox en bug
./plantrack stats               # usage sur 14 jours — la mesure qui justifie l'outil
```

Côté agent, dans son propre shell (v1.5) :

```bash
./plantrack decide "texte"      # acte une décision, marquée (agent)
./plantrack bug "texte"         # crée un bug, marqué (agent) — ./plantrack bug <id> <statut> reste le changement de statut
./plantrack piege "texte"       # note un piège technique
./plantrack question "texte"    # pose une question, rappelée jusqu'à réponse
./plantrack answer q1 "texte"   # toi seule, hors session
./plantrack testcheck on|off    # active/désactive les guides de test (off par défaut)
./plantrack guide "titre"       # crée un guide de test ; ./plantrack guide g1 l'affiche
./plantrack step g1 "texte"     # ajoute une étape au guide
./plantrack check s1 ok|ko [-m motif]   # toi seule : verdict sur une étape
```

### Une recette de test qui se coche

`!testcheck on` transforme une recette de test en checklist persistante :
l'agent structure les étapes (`./plantrack guide`, `./plantrack step`), mais ne
pose jamais le verdict lui-même — c'est le même principe que pour un bug,
réservé à l'humain (`./plantrack check s1 ok` ou `ko -m "motif"`, motif
obligatoire pour un échec). Tant qu'une étape n'a pas de verdict, elle
ressort dans le bloc réinjecté à chaque session — impossible d'oublier une
recette à moitié testée. Option coupée par défaut : `!testcheck off` ne
supprime rien, elle cache juste le bloc.

## Sous le capot

```text
toi ──"!bug …"──▶ hook UserPromptSubmit ──▶ .plantrack/events.jsonl (append-only)
                                                      │ rejeu
agent ◀───── bloc d'état (~250 tokens) ◀──── hook SessionStart
             à chaque session ET après chaque compaction
```

| Hook | Rôle |
|---|---|
| `UserPromptSubmit` | intercepte les `!`, écrit dans le journal, rejette le prompt (exit 2) |
| `PostToolUse` (Edit/Write) | journalise automatiquement chaque fichier écrit, rattaché au fil actif |
| `SessionStart` | injecte le bloc d'état — se redéclenche avec `source=compact`, donc **après chaque compaction** |
| `PreCompact` | archive le transcript dans `.plantrack/transcripts/` avant qu'il soit compacté |

`init` copie le cœur dans `.claude/hooks/pt.py` (copie vendorée : le projet
reste autonome, les hooks marchent sur un simple clone), écrit les hooks de
tous les agents supportés, le wrapper `./plantrack`, le bloc d'instructions
complet dans `AGENTS.md` (la source unique) plus une ligne d'import
`@AGENTS.md` entre marqueurs dans `CLAUDE.md` et `GEMINI.md`, une skill
Deep Code qui renvoie vers `AGENTS.md`, et installe d'office un hook git
`post-commit` qui journalise chaque commit sur le fil actif (pur logging,
jamais bloquant — sans rapport avec le `pre-commit` garde-fou, resté opt-in).

## Quels agents sont couverts ?

Un seul principe : **les règles vivent dans `AGENTS.md`** (la source unique) ;
tout le reste — hooks, lignes d'import, skill — n'est qu'un chemin pour y mener.

| Agent | Mécanisme | Réinjection automatique |
|---|---|---|
| Claude Code | 4 hooks + import dans `CLAUDE.md` | ✅ |
| Codex CLI | 4 hooks (`.codex/hooks.json`, approuver via `/hooks`) | ✅ |
| Gemini CLI | ligne d'import dans `GEMINI.md` | — (lit `AGENTS.md`, utilise la CLI) |
| ZCode, Grok Build, Kimi Code CLI, Mistral Vibe | lisent `AGENTS.md` nativement | — |
| Deep Code (DeepSeek, tiers) | skill `.deepcode/skills/plantrack/` | — (`./plantrack status` en début de tâche) |
| Surcouches : BMAD, task-master, claude-flow, spec-kit | leurs sous-agents reçoivent le `CLAUDE.md` du projet | ✅ via Claude Code |

PlanTrack n'installe **jamais** d'agent : il pose des fichiers de configuration
inertes, chaque agent trouve les siens en arrivant. Cas particulier : GSD
regénère son propre `CLAUDE.md` et peut écraser la ligne d'import —
`plantrack doctor` le détecte, `plantrack init` la repose.

## Garde-fous délibérés

- **Impossible de changer de fil sans parker.** `!focus` est refusé tant que le
  fil actif n'a pas de note de reprise — le seul moment où quelque chose se
  perdait vraiment.
- **Note de reprise obligatoire.** `!park` sans texte échoue.
- **Motif de rejet obligatoire.** `plantrack reject` sans `-m` échoue.
- **Trois fils ouverts maximum.** Au-delà, le bloc réinjecté deviendrait trop
  gros pour survivre à une compaction.
- **Rien ne se supprime.** Journal append-only : l'état est reconstruit par rejeu.
- **Un commit ne touche pas un fil en pause.** `plantrack init --git-hook`
  installe un `pre-commit` qui bloque tout commit d'un fichier appartenant à un
  fil parqué — le seul garde-fou qui ne dépende d'aucun modèle. Contournement
  assumé : `git commit --no-verify`.

## Vérifier que ça marche

```bash
echo '{"prompt":"!focus test"}'        | python3 .claude/hooks/pt.py hook-prompt
echo '{"prompt":"!bug ça casse ici"}'  | python3 .claude/hooks/pt.py hook-prompt
echo '{"source":"compact"}'            | python3 .claude/hooks/pt.py hook-context
```

Le scénario complet — ouvrir un fil, éditer, remonter un bug ailleurs, acter
une décision, parker, ouvrir un autre fil, revenir — est rejoué par
`tests/scenario.sh` (238 vérifications).

## Limites assumées

- Pas de MCP, pas de SQLite. Volontaire : un journal JSONL rejoué suffit à
  cette échelle.
- **Ce qui n'est jamais capturé reste perdu.** La nuance expliquée en prose et
  jamais transformée en `!decide` disparaît à la compaction. Seul l'archivage
  du transcript permet de la retrouver, à la main.
- Les agents sans hooks n'ont pas de réinjection automatique : ils lisent
  `AGENTS.md` et utilisent la CLI. Dans Codex, la détection de rôle s'appuie
  sur `CODEX_THREAD_ID`/`CODEX_SANDBOX` (non documentées, à confirmer sur un
  projet réel). Aucun agent tiers ne supporte l'import `@fichier` — d'où le
  bloc complet dans `AGENTS.md`, jamais une simple référence.
- IDs séquentiels calculés par rejeu : à revoir en cas de travail
  multi-branches simultané.

## Licence

MIT. Référence hooks : https://code.claude.com/docs/en/hooks
