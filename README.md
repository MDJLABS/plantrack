# PlanTrack v0 — couche de capture

Squelette fonctionnel, testé. ~380 lignes, Python stdlib uniquement, aucune dépendance,
aucune base de données. Objectif unique : ne perdre ni décision, ni bug, ni état de fil
pendant une session longue, malgré la compaction du contexte.

## Installation (2 minutes)

Depuis la racine du projet cible (CodeRing en premier) :

```bash
tar xzf plantrack-v0.tar.gz -C .        # dépose .claude/hooks/pt.py, .claude/settings.json, plantrack
chmod +x plantrack .claude/hooks/pt.py
./plantrack help
```

Si un `.claude/settings.json` existe déjà, fusionne le bloc `hooks` à la main plutôt que
d'écraser le fichier.

Ajoute à ton `.gitignore` :

```
.plantrack/transcripts/
```

Le journal `.plantrack/events.jsonl` **se versionne** : une ligne par événement, diff
lisible en revue, merge trivial.

Redémarre Claude Code. Vérifie avec `/hooks` que les quatre hooks sont chargés.

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

Côté humain, hors session :

```bash
./plantrack status              # le bloc d'état, tel que l'agent le voit
./plantrack bugs                # bugs ouverts + motifs de rejet
./plantrack inbox               # captures non classées
./plantrack threads             # fils actifs / en pause / fermés
./plantrack verify b1           # toi seul valides
./plantrack reject b1 -m "le cache n'était pas la cause, ne pas retenter"
./plantrack file n1 bug         # classe une note d'inbox en bug
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

## Vérifier que ça marche

```bash
echo '{"prompt":"!focus test"}'        | python3 .claude/hooks/pt.py hook-prompt
echo '{"prompt":"!bug ça casse ici"}'  | python3 .claude/hooks/pt.py hook-prompt
echo '{"source":"compact"}'            | python3 .claude/hooks/pt.py hook-context
```

Le scénario complet — ouvrir un fil, éditer, remonter un bug ailleurs, acter une décision,
parker, ouvrir un autre fil, revenir — a été rejoué et passe.

## Limites assumées de la v0

- Pas de MCP, pas de SQLite, pas de plan structuré en phases/tâches. Volontaire :
  on mesure d'abord si la capture suffit.
- **Ce qui n'est jamais capturé reste perdu.** La nuance expliquée en prose et jamais
  transformée en `!decide` disparaît à la compaction. Seul l'archivage du transcript
  permet de la retrouver, à la main.
- Hooks Claude Code. Codex CLI expose le même protocole sur six événements
  (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`,
  `Stop`) : le portage se fait par traduction de config. Les autres agents retombent sur
  la CLI + une consigne dans `AGENTS.md`, sans garantie.
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

Le PRD fait foi : voir `PRD-PlanTrack-v0.2.md` (jalons §16). Dans l'ordre : le hook
`pre-commit` (couche 4 — le seul garde-fou qui ne dépende d'aucun modèle), puis le plan
phases/tâches (couche 2) et le registre de tentatives par bug (couche 3), sur le même
journal JSONL. La greffe sur Beads a été écartée par décision de conception (PRD §6 :
un stockage binaire interdit le diff et le merge git) — au mieux un pont d'export en
extension. MCP en option, jamais en socle.

Référence hooks : https://code.claude.com/docs/en/hooks
