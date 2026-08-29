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

### Prochaine action
Gate de validation humaine du PRD §0 (jamais deux couches sans retour) : Mariella
décide — enchaîner couche 2 (plan phases/tâches, v1.0) ou s'arrêter. GitHub toujours
en attente de `! gh auth login`.
