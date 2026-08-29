# PlanTrack — contexte, plan et bugs pour les longues sessions agent

Un seul fichier Python, stdlib uniquement, aucune dépendance, aucune base de données.
Objectif : ne perdre ni décision, ni bug, ni état de fil pendant une session longue,
malgré la compaction du contexte.

## Installation (2 minutes)

Depuis la racine du projet cible :

```bash
uvx plantrack init               # ou : pipx run plantrack init
./plantrack init --git-hook      # optionnel : le garde-fou git pre-commit
```

(Paquet publié sur PyPI — licence MIT. Depuis un clone du repo :
`uvx --from git+https://github.com/mdjlabs/plantrack plantrack init` marche aussi.)

`init` copie le cœur dans `.claude/hooks/pt.py` (auto-copie vendorée : le projet reste
autonome, les hooks marchent sur un simple clone), écrit les hooks de **tous** les
agents supportés — `.claude/settings.json` (Claude Code) et `.codex/hooks.json`
(Codex), jamais écrasés s'ils existent —, le wrapper `./plantrack`, le bloc
d'instructions complet dans `AGENTS.md` (le standard lu par la plupart des agents)
plus une ligne d'import `@AGENTS.md` entre marqueurs dans `CLAUDE.md` et `GEMINI.md`,
et exclut `.plantrack/transcripts/` du versionnage. Il est idempotent — un fichier de
config est inerte tant que l'agent n'est pas là : celui que tu installeras **après**
trouvera PlanTrack déjà en place, sans option à connaître, même s'ils sont plusieurs.

Le journal `.plantrack/events.jsonl` **se versionne** : une ligne par événement, diff
lisible en revue, merge trivial.

Redémarre Claude Code. Vérifie avec `/hooks` que les quatre hooks sont chargés, ou :

```bash
./plantrack doctor               # hooks, journal, budget de contexte
```

## Utilisation

Tout se tape dans le prompt de l'agent. Les commandes commençant par `!` sont
**interceptées et rejetées avant d'atteindre le modèle** : l'agent ne les voit jamais,
son contexte reste propre, et tu ne le déconcentres pas de sa tâche.

| Commande | Effet |
|---|---|
| `!focus page inscription` | ouvre un fil de travail (ou reprend `!focus t1`) |
| `!bug page profil : l'avatar ne se rafraîchit pas` | enregistre un bug sans interrompre le fil en cours |
| `!decide on abandonne X — motif : Y` | acte une décision, rappelée à chaque session |
| `!park reste à faire… ne pas toucher à Z` | met le fil en pause **avec note de reprise obligatoire** |
| `!close` | ferme le fil actif |
| `!state` | affiche l'état persistant |
| `!n'importe quel texte` | capture libre dans l'inbox, à classer plus tard |

Un bug accepte une sévérité : `!bug le paiement échoue --blocker` (ou `--low`/`--high`).
Un bug `blocker` s'affiche en tête du bloc réinjecté à chaque session.

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

## Ce que font les quatre hooks

| Hook | Rôle |
|---|---|
| `UserPromptSubmit` | intercepte les `!`, écrit dans le journal, rejette le prompt (exit 2) |
| `PostToolUse` (Edit/Write) | journalise automatiquement chaque fichier écrit, rattaché au fil actif |
| `SessionStart` | injecte le bloc d'état — se redéclenche avec `source=compact`, donc **après chaque compaction** |
| `PreCompact` | archive le transcript dans `.plantrack/transcripts/` avant qu'il soit compacté |

Le bloc réinjecté fait environ 250 tokens sur un projet à deux fils. Plafond dur à
3 000 caractères, avec troncature : s'il enflait, il se ferait compacter à son tour.

## Garde-fous délibérés

- **Impossible de changer de fil sans parker.** `!focus` est refusé tant que le fil actif
  n'a pas de note de reprise. C'est le seul moment où ton scénario perdait vraiment
  quelque chose.
- **Note de reprise obligatoire.** `!park` sans texte échoue.
- **Motif de rejet obligatoire.** `plantrack reject` sans `-m` échoue.
- **Trois fils ouverts maximum.** Au-delà, le bloc réinjecté devient trop gros pour
  survivre à une compaction.
- **Rien ne se supprime.** Journal append-only : l'état est reconstruit par rejeu.
- **Un commit ne touche pas un fil en pause.** `plantrack init --git-hook` installe un
  `pre-commit` qui bloque tout commit d'un fichier appartenant à un fil parqué — le seul
  garde-fou qui ne dépende d'aucun modèle. Contournement assumé : `git commit --no-verify`.

## Vérifier que ça marche

```bash
echo '{"prompt":"!focus test"}'        | python3 .claude/hooks/pt.py hook-prompt
echo '{"prompt":"!bug ça casse ici"}'  | python3 .claude/hooks/pt.py hook-prompt
echo '{"source":"compact"}'            | python3 .claude/hooks/pt.py hook-context
```

Le scénario complet — ouvrir un fil, éditer, remonter un bug ailleurs, acter une décision,
parker, ouvrir un autre fil, revenir — a été rejoué et passe.

## Limites assumées

- Pas de MCP, pas de SQLite. Volontaire : un journal JSONL rejoué suffit à cette échelle.
- **Ce qui n'est jamais capturé reste perdu.** La nuance expliquée en prose et jamais
  transformée en `!decide` disparaît à la compaction. Seul l'archivage du transcript
  permet de la retrouver, à la main.
- Hooks Claude Code **et Codex CLI**, écrits d'office par `init` (même protocole :
  `UserPromptSubmit` bloquant, `SessionStart` — y compris `source: "compact"` —,
  `PostToolUse`, `PreCompact`) ; dans Codex, lancer `/hooks` une fois pour approuver
  les hooks du projet. Le chemin des fichiers édités est extrait du patch
  `apply_patch` ; la détection de rôle s'appuie sur `CODEX_THREAD_ID`/`CODEX_SANDBOX`
  (posées par le shell de l'agent Codex — non documentées, à confirmer sur un projet
  réel). Les autres agents n'ont pas de hooks : ils lisent `AGENTS.md` (ou la ligne
  d'import dans `GEMINI.md`) et utilisent la CLI, sans réinjection automatique.
- IDs séquentiels calculés par rejeu : à revoir en cas de travail multi-branches
  simultané.

## Mesure à tenir pendant deux semaines

Une seule ligne dans un fichier à part, à chaque fois que ça arrive :

- nombre de fois où tu as dû répéter une consigne déjà donnée ;
- nombre de bugs signalés deux fois ;
- nombre de reprises de fil où la note de reprise a suffi.

Sans ces trois chiffres, tu ne sauras pas dans six semaines si l'outil sert, et tu risques
de le maintenir par principe. C'est aussi le seul argument crédible le jour où tu publies.

## La suite

Le PRD fait foi : voir `PRD-PlanTrack-v0.2.md` (jalons §16). Livré : couches 1 à 4
(capture, plan phases/tâches, bugs/tentatives, pre-commit) + `init`/`doctor`/`stats`
+ le portage Codex (§13 — testé sur le contrat documenté ; PlanTrack n'installe jamais
d'agent, la validation en conditions réelles appartient à qui installe Codex).
Reste : la publication —
uniquement si les chiffres de `plantrack stats` la justifient. La greffe sur Beads a
été écartée par décision de conception (PRD §6 : un stockage binaire interdit le diff
et le merge git) — au mieux un pont d'export en extension. MCP en option, jamais en
socle.

Référence hooks : https://code.claude.com/docs/en/hooks
