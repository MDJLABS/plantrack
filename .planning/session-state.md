# État de session — PlanTrack

## Dernière session : 2026-08-29

### Décisions actées par Mariella (party mode)
- **Installation** : `uvx --from git+https://github.com/mdjlabs/plantrack plantrack init` — PyPI attendra le jalon Publication (§16 PRD).
- **Ancrage** : auto-copie vendorée — `plantrack init` copie pt.py dans `.claude/hooks/` du projet cible ; `plantrack doctor` signalera les versions en retard.
- **GitHub** : repo privé maintenant, public seulement au jalon Publication.
- Le code de la couche 1 était dans `documents/` (non versionné) ; étudié avant usage, conforme au PRD, importé au commit initial.

### Audit couche 1 (v0) vs PRD v0.2 — écarts relevés
1. **O6 contournable** : l'agent peut lancer `./plantrack verify` via Bash — le verrou « validated réservé à l'humain » n'est pas technique. Piste : refuser verify/reject si env CLAUDECODE présent.
2. **README v0 périmé** : mentionne la greffe Beads, contredit la décision de conception du PRD v0.2 (§6, JSONL retenu).
3. **Verrue `!focus --force`** : pt.py:216 — `--force` saute le refus mais crée un fil nommé « --force ».
4. **Pas de tests scriptés** (§14 les exige — tests/scenario.sh à écrire).
5. Note Winston : le pre-commit v0.5 (couche 4) ne peut garder que les fils parqués tant que la couche 2 (tâches) n'existe pas — garde partielle à assumer.

### État
- Commit initial `6209f57` : layout installable (.claude/, plantrack, README, PRD).
- Commit `21fed8c` : les 4 correctifs d'audit livrés — O6 verrouillé (verify/reject
  refusés si env CLAUDECODE/CLAUDE_CODE_ENTRYPOINT), verrue `--force` supprimée,
  README aligné PRD, `tests/scenario.sh` (19 checks, tous verts).
- Remote GitHub PAS créé : `gh` non authentifié → Mariella doit lancer `! gh auth login`,
  puis créer `mdjlabs/plantrack` en privé et pousser.

### Jalon v0.5 ATTEINT — commit `6d922c6`
- `plantrack init --git-hook` + `plantrack precommit` : commit bloqué si un fichier
  stagé appartient à un fil parqué (portée v0.5 ; les tâches cancelled/replaced
  viendront avec la couche 2). 26 checks verts dans tests/scenario.sh.

### Couche 2 LIVRÉE — commit `9f45006`
- Plan phases/tâches complet (§8) : CLI plan/phase/task/decisions, plan import avec
  validation humaine, statuts réservés à l'humain, décisions d'abandon automatiques,
  `!focus <task_id>`, pre-commit étendu aux tâches cancelled/replaced.

### Dérogation fichier unique ACTÉE — commit `a2b614a`
Décision Mariella 2026-08-29 : pt.py reste un seul fichier (auto-copie vendorée
triviale) ; seuil d'éclatement du PRD §0 relevé de 700 à 1200 lignes.

### Couche 3 LIVRÉE — commit `1fdb7a7` → v1.0 COMPLÈTE (couches 1+2+3+4)
- Bugs enrichis (`!bug … --low|--high|--blocker`), bug blocker = avertissement en tête
  du bloc réinjecté ; tentatives (`plantrack attempt`) avec refus de doublon
  difflib > 0.85 rendant l'hypothèse précédente + son motif de rejet (test 6 §14) ;
  machine à états (`plantrack bug <id> <statut>`) : validated refusé à l'agent avec
  message pédagogique (test 7 §14), wont_fix humain seul avec motif, verify/reject
  exigent to_verify, motif de rejet attaché à la dernière tentative, états terminaux
  figés ; `plantrack attempts <bug_id>`.
- 65 checks verts dans tests/scenario.sh. pt.py : 838 lignes (< 1200).
- Écart §11 assumé (hérité v0) : la troncature du bloc coupe par la fin, elle
  n'applique pas l'ordre de priorité décisions > note de reprise > bugs bloquants.

### Prochaine action
Gate PRD §0 post-v1.0 : Mariella décide — v1.1 (`init` complet vendorisé, doctor,
stats) ou trancher d'abord les questions ouvertes §17. GitHub toujours en attente de
`! gh auth login` (puis créer `mdjlabs/plantrack` privé et pousser).
