#!/usr/bin/env bash
# Tests couche 1 — simule les hooks en injectant du JSON sur stdin (PRD §14).
# Usage : bash tests/scenario.sh
set -u

PT="$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/pt.py"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
export CLAUDE_PROJECT_DIR="$TMP"
# Le scenario doit rendre le meme verdict partout (CI, cron, poste nu) :
# l'environnement agent est pose explicitement, jamais herite de la session.
export CLAUDECODE=1
fail=0

check() { # check <description> <sous-chaine attendue> <sortie>
  case "$3" in
    *"$2"*) echo "ok   - $1" ;;
    *) echo "FAIL - $1"; echo "       attendu : $2"; echo "       sortie  : $3"; fail=1 ;;
  esac
}

check_exit() { # check_exit <description> <attendu> <obtenu>
  if [ "$2" = "$3" ]; then echo "ok   - $1"
  else echo "FAIL - $1 (exit $3, attendu $2)"; fail=1; fi
}

check_not() { # check_not <description> <sous-chaine interdite> <sortie>
  case "$3" in
    *"$2"*) echo "FAIL - $1"; echo "       interdit : $2"; echo "       sortie   : $3"; fail=1 ;;
    *) echo "ok   - $1" ;;
  esac
}

prompt() { printf '{"prompt":"%s"}' "$1" | python3 "$PT" hook-prompt 2>&1; }
ctx() { printf '{"source":"%s"}' "$1" | python3 "$PT" hook-context 2>&1; }
H() { env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT python3 "$PT" "$@" 2>&1; }

# 1. !focus ouvre un fil, et le prompt est rejete (exit 2 : le modele ne le voit jamais)
out=$(prompt '!focus page inscription'); rc=$?
check_exit "!focus rejette le prompt (exit 2)" 2 "$rc"
check "!focus ouvre le fil t1" "nouveau fil t1" "$out"

# 2. !bug capture sans interrompre, et reapparait dans le bloc reinjecte apres compaction
out=$(prompt '!bug l avatar ne se rafraichit pas'); rc=$?
check_exit "!bug rejette le prompt (exit 2)" 2 "$rc"
check "!bug enregistre b1" "bug b1 enregistre" "$out"
out=$(ctx compact)
check "b1 present apres compaction" "b1" "$out"
check "bandeau de reinjection post-compaction" "contexte compacte" "$out"

# 3. !focus sur un second sujet echoue tant que le fil actif n'est pas parque
out=$(prompt '!focus autre page')
check "!focus refuse sans park prealable" "refuse" "$out"
out=$(prompt '!focus --force')
check "pas d echappatoire --force" "refuse" "$out"

# 4. !park sans note echoue
out=$(prompt '!park')
check "!park sans note refuse" "exige une note" "$out"

# 5. !park avec note, puis reprise : la note est restituee
out=$(prompt '!park reste le CSS, ne pas toucher au backend')
check "!park avec note accepte" "en pause" "$out"
out=$(prompt '!focus t1')
check "reprise restitue la note" "reste le CSS" "$out"

# 6. O6 : verify/reject refuses depuis un environnement agent
out=$(CLAUDECODE=1 python3 "$PT" verify b1 2>&1); rc=$?
check "verify bloque en env agent" "reserve a l'humain" "$out"
check_exit "verify en env agent sort en erreur" 1 "$rc"
out=$(CLAUDECODE=1 python3 "$PT" reject b1 -m test 2>&1)
check "reject bloque en env agent" "reserve a l'humain" "$out"

# 7. O6 + machine a etats : l'humain valide/rejette, mais seulement un bug to_verify
out=$(H verify b1)
check "verify refuse un bug encore open" 'est "open"' "$out"
out=$(python3 "$PT" bug b1 to_verify 2>&1)
check "l agent passe un bug en to_verify" "to_verify" "$out"
out=$(H reject b1 -m "pas la cause")
check "reject humain avec motif passe" "rouvert avec motif" "$out"
python3 "$PT" bug b1 to_verify >/dev/null 2>&1
out=$(H verify b1)
check "verify humain passe sur un bug to_verify" "valide" "$out"

# 8. une ligne corrompue dans events.jsonl ne casse ni la projection ni la session
echo '{"kind": PAS DU JSON' >> "$TMP/.plantrack/events.jsonl"
out=$(ctx startup); rc=$?
check_exit "ligne corrompue : hook-context sort en 0" 0 "$rc"
check "ligne corrompue : l etat survit" "t1" "$out"
echo '{"kind":"decision"}' >> "$TMP/.plantrack/events.jsonl"
out=$(ctx startup); rc=$?
check_exit "evenement incomplet : hook-context sort en 0" 0 "$rc"
check "evenement incomplet : l etat survit" "t1" "$out"

# 9. le bloc reinjecte reste sous le plafond de 3000 caracteres
for i in $(seq 1 30); do
  printf '{"prompt":"!decide decision numero %s — motif tres long %s"}' "$i" \
    "$(printf 'x%.0s' $(seq 1 120))" | python3 "$PT" hook-prompt >/dev/null 2>&1
done
n=$(ctx compact | wc -c)
if [ "$n" -le 3000 ]; then echo "ok   - bloc reinjecte sous le plafond dur ($n chars)"
else echo "FAIL - bloc reinjecte a $n chars (> 3000)"; fail=1; fi

# 10. v0.5 — le hook pre-commit bloque un commit touchant un fichier d'un fil parque
printf '{"tool_input":{"file_path":"%s/src/a.txt"}}' "$TMP" | python3 "$PT" hook-filelog
prompt '!park en attente de la maquette' >/dev/null
mkdir -p "$TMP/.claude/hooks" "$TMP/src"
cp "$PT" "$TMP/.claude/hooks/pt.py"
echo contenu > "$TMP/src/a.txt"
echo libre > "$TMP/libre.txt"
git -C "$TMP" init -q
git -C "$TMP" add -A
out=$(cd "$TMP" && python3 "$PT" init --git-hook 2>&1)
check "init --git-hook installe le hook" "pre-commit installe" "$out"
out=$(cd "$TMP" && git -c user.name=t -c user.email=t@t commit -m x 2>&1); rc=$?
check_exit "commit d un fichier parque bloque (exit 1)" 1 "$rc"
check "le message nomme le fil fautif" "appartient au fil t1" "$out"
check "le contournement est documente" "no-verify" "$out"
out=$(cd "$TMP" && git -c user.name=t -c user.email=t@t commit -q --no-verify -m x 2>&1); rc=$?
check_exit "contournement --no-verify passe" 0 "$rc"
echo v2 > "$TMP/libre.txt"
git -C "$TMP" add libre.txt
out=$(cd "$TMP" && git -c user.name=t -c user.email=t@t commit -q -m y 2>&1); rc=$?
check_exit "commit d un fichier libre passe" 0 "$rc"
out=$(cd "$TMP" && python3 "$PT" init --git-hook 2>&1); rc=$?
check "init refuse d ecraser un pre-commit existant" "existe deja" "$out"

# 11. couche 2 — plan phases/taches
out=$(H phase add Authentification --goal parcours complet)
check "phase add cree p1" "phase p1 creee" "$out"
out=$(H task add p1 Formulaire d inscription)
check "task add cree k1" "tache k1 creee" "$out"
out=$(python3 "$PT" task start k1 2>&1)
check "task start autorise a l agent" "in_progress" "$out"
out=$(python3 "$PT" task done k1 2>&1)
check "task done refuse a l agent" "reserve a l'humain" "$out"
out=$(H task cancel k1)
check "task cancel sans motif refuse" "motif obligatoire" "$out"
out=$(H task cancel k1 -m "parcours simplifie retenu")
check "task cancel avec motif passe" "decision actee" "$out"
out=$(ctx compact)
check "l annulation alimente les decisions reinjectees" "k1 annulee" "$out"
H task add p1 Upload v1 >/dev/null
H task add p1 Upload unifie >/dev/null
out=$(H task replace k2 k9 -m x)
check "replace vers une tache inexistante refuse" "doit exister" "$out"
out=$(H task replace k2 k3 -m "composant unifie")
check "replace passe avec cible et motif" "remplacee par k3" "$out"
out=$(H plan)
check "l arbre montre le remplacement" "-> k3" "$out"
out=$(prompt '!focus k2')
check "!focus sur une tache remplacee refuse" "replaced" "$out"
out=$(prompt '!focus k3')
check "!focus <tache> ouvre un fil rattache" "tache k3" "$out"
out=$(ctx startup)
check "le bloc reinjecte porte la tache du fil actif" "[k3]" "$out"

# 12. le pre-commit s'etend aux taches annulees
printf '{"tool_input":{"file_path":"%s/src/b.txt"}}' "$TMP" | python3 "$PT" hook-filelog
H task cancel k3 -m "finalement inutile" >/dev/null
echo b > "$TMP/src/b.txt"
git -C "$TMP" add src/b.txt
out=$(cd "$TMP" && git -c user.name=t -c user.email=t@t commit -m z 2>&1); rc=$?
check_exit "commit d une tache annulee bloque (exit 1)" 1 "$rc"
check "le message nomme la tache annulee" "appartient a la tache k3" "$out"
git -C "$TMP" reset -q

# 13. plan import : proposition, validation humaine obligatoire
printf '## Paiement\n- integrer stripe\n- page facturation\n' > "$TMP/plan.md"
out=$(python3 "$PT" plan import "$TMP/plan.md" < /dev/null 2>&1)
check "plan import refuse en env agent" "reserve a l'humain" "$out"
out=$(printf 'y\n' | H plan import "$TMP/plan.md")
check "plan import ecrit apres confirmation" "importee" "$out"
out=$(H plan)
check "les taches importees sont dans l arbre" "integrer stripe" "$out"
out=$(printf 'n\n' | H plan import "$TMP/plan.md")
check "plan import sans confirmation n ecrit rien" "abandon" "$out"

# 14. couche 3 — bugs enrichis, tentatives, machine a etats (§9 ; tests 6-7 du PRD §14)
out=$(prompt '!bug le paiement echoue en prod --blocker')
check "!bug --blocker enregistre la severite" "[blocker]" "$out"
out=$(ctx startup)
check "bug bloquant en tete du bloc reinjecte" "BUG BLOQUANT" "$out"

out=$(python3 "$PT" attempt b2 le cache invalide la session 2>&1)
check "premiere tentative consignee" "tentative a1" "$out"
out=$(python3 "$PT" attempt b2 "le cache invalide la session !" 2>&1); rc=$?
check "hypothese quasi identique refusee (test 6 PRD)" "deja tentee" "$out"
check_exit "le refus de doublon sort en erreur" 1 "$rc"
out=$(python3 "$PT" attempt b2 la variable d environnement manque en prod 2>&1)
check "hypothese differente acceptee" "tentative a2" "$out"

out=$(python3 "$PT" bug b2 validated 2>&1)
check "validated refuse cote agent (test 7 PRD)" "reserve a l'humain" "$out"
check "le refus oriente vers to_verify" "to_verify" "$out"
python3 "$PT" bug b2 to_verify >/dev/null 2>&1
out=$(H reject b2 -m "la variable etait bien presente")
check "reject signale l attache a la tentative" "attache a la derniere tentative" "$out"
out=$(H attempts b2)
check "attempts liste le motif de rejet" "la variable etait bien presente" "$out"
out=$(python3 "$PT" attempt b2 "la variable d environnement manque en prod" 2>&1)
check "retenter l hypothese rejetee rend son motif" "motif du rejet : la variable etait bien presente" "$out"

python3 "$PT" bug b2 to_verify >/dev/null 2>&1
out=$(H verify b2)
check "verify passe apres to_verify" "valide" "$out"
out=$(python3 "$PT" bug b2 in_progress 2>&1)
check "un etat terminal est fige" "etat terminal" "$out"
out=$(python3 "$PT" attempt b2 nouvelle piste 2>&1)
check "plus de tentative sur un bug clos" "plus rien a tenter" "$out"

prompt '!bug scintillement leger du footer --low' >/dev/null
out=$(python3 "$PT" bug b3 wont_fix -m cosmetique 2>&1)
check "wont_fix refuse cote agent" "reserve a l'humain" "$out"
out=$(H bug b3 wont_fix)
check "wont_fix sans motif refuse" "motif obligatoire" "$out"
out=$(H bug b3 wont_fix -m "cosmetique, hors perimetre v1")
check "wont_fix humain avec motif passe" "wont_fix" "$out"
out=$(H bugs)
check_not "un bug wont_fix sort de la liste des bugs ouverts" "b3" "$out"

# 15. v1.1 — init vendorise complet dans un projet vierge
TMP2=$(mktemp -d)
out=$(CLAUDE_PROJECT_DIR="$TMP2" python3 "$PT" init 2>&1)
check "init copie le coeur" "pt.py copie" "$out"
check "init ecrit les 4 hooks" "settings.json ecrit" "$out"
check "init insere le bloc d instructions" "insere dans CLAUDE.md" "$out"
check "init exclut les transcripts" ".plantrack/transcripts/" "$(cat "$TMP2/.gitignore")"
out=$(cd "$TMP2" && ./plantrack help 2>&1)
check "le wrapper ./plantrack fonctionne" "commandes" "$out"
out=$(CLAUDE_PROJECT_DIR="$TMP2" python3 "$PT" init 2>&1)
check "init idempotent : coeur identique reconnu" "deja en place" "$out"
check "init idempotent : bloc non duplique" "a jour dans" "$out"
n=$(grep -c "plantrack:start" "$TMP2/CLAUDE.md")
check_exit "un seul jeu de marqueurs dans CLAUDE.md" 1 "$n"
printf '{"hooks":{}}' > "$TMP2/.claude/settings.json"
out=$(CLAUDE_PROJECT_DIR="$TMP2" python3 "$PT" init 2>&1)
check "settings existant : les hooks sont fusionnes" "4 hooks PlanTrack fusionnes" "$out"
check "settings fusionne : les 4 hooks presents" "hook-precompact" "$(cat "$TMP2/.claude/settings.json")"

# 16. v1.1 — doctor et stats
out=$(cd "$TMP2" && rm .claude/settings.json && CLAUDE_PROJECT_DIR="$TMP2" python3 "$PT" init >/dev/null 2>&1; CLAUDE_PROJECT_DIR="$TMP2" ./plantrack doctor 2>&1); rc=$?
check_exit "doctor tout vert apres init" 0 "$rc"
check "doctor valide le coeur vendorise" "ok  coeur vendorise" "$out"
rm -rf "$TMP2"
out=$(python3 "$PT" doctor 2>&1); rc=$?
check "doctor detecte la ligne corrompue du journal" "corrompue" "$out"
check_exit "doctor sort en erreur si probleme" 1 "$rc"
out=$(python3 "$PT" stats 2>&1)
check "stats compte les reprises de fil" "reprises de fil :" "$out"
check "stats compte les blocages pre-commit" "blocages pre-commit : 2" "$out"

# 17. revue v1.1 — reject exige to_verify, signal de boucle dans stats
prompt '!bug le bouton contraste trop faible' >/dev/null
out=$(H reject b4 -m "pas encore corrige")
check "reject refuse un bug encore open" 'est "open"' "$out"
python3 "$PT" bug b4 to_verify >/dev/null 2>&1
H reject b4 -m "premier faux espoir" >/dev/null
python3 "$PT" bug b4 to_verify >/dev/null 2>&1
H reject b4 -m "second faux espoir" >/dev/null
out=$(python3 "$PT" stats 2>&1)
check "stats signale la boucle apres 2 rejets" "signal de boucle" "$out"
check "le signal de boucle nomme le bug" "b4" "$out"

# 18. revue v1.1 — close, chemin positif des taches, classement d inbox
out=$(prompt '!close')
check "!close ferme le fil actif" "ferme" "$out"
out=$(prompt '!focus nettoyage css')
check "!close libere l ouverture d un nouveau fil" "nouveau fil t3" "$out"
out=$(H close t3)
check "plantrack close ferme un fil par id" "ferme" "$out"
H task add p1 Page profil >/dev/null
python3 "$PT" task start k6 >/dev/null 2>&1
out=$(python3 "$PT" task verify k6 2>&1)
check "task verify autorise a l agent" "a verifier" "$out"
out=$(H task done k6)
check "task done humain termine la tache" "terminee" "$out"
out=$(prompt '!penser au favicon manquant')
check "capture libre en inbox" "n1" "$out"
out=$(python3 "$PT" file n1 tache 2>&1); rc=$?
check "file refuse une destination inconnue" "usage" "$out"
check_exit "file destination inconnue sort en erreur" 1 "$rc"
out=$(H file n1 decision)
check "file vers decision classe la note" "decision" "$out"

# 19. revue v1.1 — reinjection d une inbox seule, blocs d instructions multi-agents
TMP3=$(mktemp -d)
printf '{"prompt":"!verifier les quotas API"}' | CLAUDE_PROJECT_DIR="$TMP3" python3 "$PT" hook-prompt >/dev/null 2>&1
out=$(printf '{"source":"startup"}' | CLAUDE_PROJECT_DIR="$TMP3" python3 "$PT" hook-context 2>&1)
check "une inbox seule est reinjectee" "INBOX" "$out"
printf '# Notes utilisateur\n' > "$TMP3/AGENTS.md"
out=$(CLAUDE_PROJECT_DIR="$TMP3" python3 "$PT" init 2>&1)
check "init insere le bloc complet dans AGENTS.md" "insere dans AGENTS.md" "$out"
check "init preserve le contenu utilisateur" "Notes utilisateur" "$(cat "$TMP3/AGENTS.md")"
check "CLAUDE.md recoit la ligne d import" "@AGENTS.md" "$(cat "$TMP3/CLAUDE.md")"
check "GEMINI.md recoit la ligne d import" "@AGENTS.md" "$(cat "$TMP3/GEMINI.md")"
check "la skill Deep Code est ecrite" "name: plantrack" "$(cat "$TMP3/.deepcode/skills/plantrack/SKILL.md")"
check "la skill Deep Code renvoie vers AGENTS.md" "AGENTS.md" "$(cat "$TMP3/.deepcode/skills/plantrack/SKILL.md")"
out=$(CLAUDE_PROJECT_DIR="$TMP3" python3 "$PT" init 2>&1)
check "init idempotent sur la skill Deep Code" "skill Deep Code (.deepcode/skills/plantrack/SKILL.md) deja en place" "$out"
rm -rf "$TMP3"
TMP4=$(mktemp -d)
printf '<!-- plantrack:start -->\nancien bloc complet v1.1\n<!-- plantrack:end -->\n' > "$TMP4/CLAUDE.md"
out=$(CLAUDE_PROJECT_DIR="$TMP4" python3 "$PT" init --agent gemini 2>&1)
check "--agent est annonce obsolete" "obsolete" "$out"
check "un ancien bloc CLAUDE.md est mis a niveau" "mis a jour dans CLAUDE.md" "$out"
check "le bloc CLAUDE.md devient la ligne d import" "@AGENTS.md" "$(cat "$TMP4/CLAUDE.md")"
rm -rf "$TMP4"

# 20. revue lots B+C — pre-commit fiable, restitution des tentatives (§5), schema §9
H task add p1 Retouche du header >/dev/null
out=$(prompt '!focus k7')
check "focus k7 ouvre un fil rattache" "tache k7" "$out"
printf '{"tool_input":{"file_path":"%s/src/a.txt"}}' "$TMP" | python3 "$PT" hook-filelog
echo v3 > "$TMP/src/a.txt"
git -C "$TMP" add src/a.txt
out=$(cd "$TMP" && git -c user.name=t -c user.email=t@t commit -q -m l3 2>&1); rc=$?
check_exit "fichier repris par le fil actif : commit passe" 0 "$rc"

prompt '!bug le header masque le menu --high' >/dev/null
out=$(grep '"kind": "bug"' "$TMP/.plantrack/events.jsonl" | tail -1)
check "l evenement bug porte la tache (§9)" '"task": "k7"' "$out"
python3 "$PT" attempt b5 le z-index du header ecrase le menu >/dev/null 2>&1
out=$(grep '"hypothesis"' "$TMP/.plantrack/events.jsonl" | tail -1)
check "attempt consigne l hypothese (§9)" "z-index du header" "$out"
check "attempt consigne l acteur (§9)" '"actor": "claude-code"' "$out"
python3 "$PT" bug b5 to_verify >/dev/null 2>&1
H reject b5 -m "le z-index etait correct" >/dev/null
out=$(ctx compact)
check "le bloc restitue la tentative rejetee (§5)" "deja rejete" "$out"
check "la tentative rejetee porte son motif" "le z-index etait correct" "$out"
python3 "$PT" bug b5 to_verify >/dev/null 2>&1
out=$(python3 "$PT" bug b5 open 2>&1); rc=$?
check "retrograder to_verify->open sans motif refuse" "motif obligatoire" "$out"
check_exit "la retrogradation sans motif sort en erreur" 1 "$rc"
out=$(python3 "$PT" bug b5 open -m "la correction ne tient pas en prod" 2>&1)
check "retrograder avec motif passe" "motif conserve" "$out"
out=$(H attempts b5)
check "le motif de retrogradation s attache a la tentative" "la correction ne tient pas en prod" "$out"

TMP5=$(mktemp -d)
mkdir -p "$TMP5/proj"
git -C "$TMP5" init -q
printf '{"prompt":"!focus module imbrique"}' | CLAUDE_PROJECT_DIR="$TMP5/proj" python3 "$PT" hook-prompt >/dev/null 2>&1
printf '{"tool_input":{"file_path":"%s/proj/x.txt"}}' "$TMP5" | CLAUDE_PROJECT_DIR="$TMP5/proj" python3 "$PT" hook-filelog
printf '{"prompt":"!park en attente"}' | CLAUDE_PROJECT_DIR="$TMP5/proj" python3 "$PT" hook-prompt >/dev/null 2>&1
echo x > "$TMP5/proj/x.txt"
git -C "$TMP5" add -A
out=$(CLAUDE_PROJECT_DIR="$TMP5/proj" python3 "$PT" precommit 2>&1); rc=$?
check_exit "precommit voit un fil parque sous une racine git plus haute" 1 "$rc"
check "et nomme le fil fautif" "appartient au fil t1" "$out"
rm -rf "$TMP5"

# 21. portage Codex (§13) — hooks codex par defaut, apply_patch, detection de role
TMP6=$(mktemp -d)
out=$(CLAUDE_PROJECT_DIR="$TMP6" python3 "$PT" init 2>&1)
check "init ecrit .codex/hooks.json par defaut" ".codex/hooks.json ecrit (4 hooks)" "$out"
check "init pointe vers l approbation /hooks" "/hooks pour approuver" "$out"
check "init ecrit AGENTS.md" "insere dans AGENTS.md" "$out"
hj=$(cat "$TMP6/.codex/hooks.json")
for h in hook-prompt hook-filelog hook-context hook-precompact; do
  check "hooks.json declare $h" "$h" "$hj"
done
check "hooks.json resout la racine git (cwd de session variable)" "git rev-parse --show-toplevel" "$hj"
check "hooks.json couvre apply_patch" "apply_patch" "$hj"
python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$TMP6/.codex/hooks.json" \
  && check "hooks.json est du JSON valide" ok ok || check "hooks.json est du JSON valide" ok invalide
out=$(CLAUDE_PROJECT_DIR="$TMP6" python3 "$PT" init 2>&1)
check "init idempotent sur les hooks codex" ".codex/hooks.json deja en place" "$out"
check "init idempotent sur les blocs md" "a jour dans AGENTS.md" "$out"
out=$(CLAUDE_PROJECT_DIR="$TMP6" python3 "$PT" doctor 2>&1 || true)
check "doctor verifie les hooks codex" "declare dans .codex/hooks.json" "$out"
rm -rf "$TMP6"

# 22. rapport miamboost 2026-08-29 — fusion dans un settings.json existant,
# --git-hook n'ampute plus l'installation, JSON invalide = INCOMPLETE
TMP7=$(mktemp -d)
mkdir -p "$TMP7/.claude"
printf '{ "enabledPlugins": { "cloudflare@claude-plugins-official": true } }\n' > "$TMP7/.claude/settings.json"
git -C "$TMP7" init -q
out=$(CLAUDE_PROJECT_DIR="$TMP7" python3 "$PT" init --git-hook 2>&1)
check "init fusionne dans un settings.json existant" "4 hooks PlanTrack fusionnes" "$out"
check "init --git-hook fait AUSSI l installation complete" "insere dans AGENTS.md" "$out"
check "init --git-hook pose le garde-fou git" "hook pre-commit installe" "$out"
check "et annonce une installation terminee" "installation terminee" "$out"
sj=$(cat "$TMP7/.claude/settings.json")
check "la fusion preserve l existant (enabledPlugins)" "enabledPlugins" "$sj"
for h in hook-prompt hook-filelog hook-context hook-precompact; do
  check "settings.json fusionne declare $h" "$h" "$sj"
done
python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$TMP7/.claude/settings.json" \
  && check "settings.json fusionne est du JSON valide" ok ok || check "settings.json fusionne est du JSON valide" ok invalide
out=$(CLAUDE_PROJECT_DIR="$TMP7" python3 "$PT" init 2>&1)
check "fusion idempotente au second init" ".claude/settings.json deja en place" "$out"
n=$(grep -c "hook-prompt" "$TMP7/.claude/settings.json")
check "aucun hook duplique au second init" 1 "$n"
printf 'pas du json' > "$TMP7/.claude/settings.json"
out=$(CLAUDE_PROJECT_DIR="$TMP7" python3 "$PT" init 2>&1)
check "JSON invalide : le bloc a coller est imprime" '"hooks"' "$out"
check "JSON invalide : l installation s annonce INCOMPLETE" "INCOMPLETE" "$out"
rm -rf "$TMP7"

# 23. commande update — remplace la copie vendoree puis rejoue init
TMP8=$(mktemp -d)
out=$(CLAUDE_PROJECT_DIR="$TMP8" python3 "$PT" update 2>&1); rc=$?
check_exit "update sans installation refuse" 1 "$rc"
check "et renvoie vers init" "lance \`plantrack init\`" "$out"
CLAUDE_PROJECT_DIR="$TMP8" python3 "$PT" init >/dev/null 2>&1
printf '\n# vieille version simulee\n' >> "$TMP8/.claude/hooks/pt.py"
out=$(CLAUDE_PROJECT_DIR="$TMP8" python3 "$PT" init 2>&1); rc=$?
check_exit "init refuse toujours d ecraser une copie differente" 1 "$rc"
check "et renvoie vers update" "plantrack@latest update" "$out"
out=$(CLAUDE_PROJECT_DIR="$TMP8" python3 "$PT" update 2>&1)
check "update remplace la copie vendoree" "pt.py mis a jour" "$out"
check "update rejoue init derriere" "deja en place" "$out"
cmp -s "$PT" "$TMP8/.claude/hooks/pt.py" \
  && check "la copie vendoree est identique a la source" ok ok \
  || check "la copie vendoree est identique a la source" ok differente
out=$(CLAUDE_PROJECT_DIR="$TMP8" python3 "$PT" update 2>&1)
check "update idempotent" "pt.py deja a jour" "$out"
out=$(CLAUDE_PROJECT_DIR="$TMP8" python3 "$TMP8/.claude/hooks/pt.py" update 2>&1); rc=$?
check_exit "la copie installee ne se met pas a jour seule" 1 "$rc"
check "et renvoie vers uvx" "uvx plantrack@latest update" "$out"
rm -rf "$TMP8"

# 24. garde-fou surcouches — un outil (GSD...) regenere CLAUDE.md sans la reference
TMP9=$(mktemp -d)
CLAUDE_PROJECT_DIR="$TMP9" python3 "$PT" init >/dev/null 2>&1
printf '# CLAUDE.md regenere par un autre outil\n' > "$TMP9/CLAUDE.md"
out=$(CLAUDE_PROJECT_DIR="$TMP9" python3 "$PT" doctor 2>&1 || true)
check "doctor detecte la reference perdue dans CLAUDE.md" "!!  ligne d'import @AGENTS.md dans CLAUDE.md" "$out"
check "doctor voit GEMINI.md intact" "ok  ligne d'import @AGENTS.md dans GEMINI.md" "$out"
check "et designe la regeneration comme cause" "regenere le fichier ? relance" "$out"
CLAUDE_PROJECT_DIR="$TMP9" python3 "$PT" init >/dev/null 2>&1
check "init repose la reference" "@AGENTS.md" "$(cat "$TMP9/CLAUDE.md")"
check "sans toucher au contenu regenere" "regenere par un autre outil" "$(cat "$TMP9/CLAUDE.md")"
rm -rf "$TMP9"

printf '{"tool_name":"apply_patch","tool_input":{"command":"*** Begin Patch\\n*** Add File: src/patch1.txt\\n+hello\\n*** Update File: docs/patch2.md\\n*** End Patch"},"cwd":"%s"}' "$TMP" | python3 "$PT" hook-filelog
check "apply_patch : premier fichier du patch journalise" '"text": "src/patch1.txt"' "$(cat "$TMP/.plantrack/events.jsonl")"
check "apply_patch : second fichier du patch journalise" '"text": "docs/patch2.md"' "$(cat "$TMP/.plantrack/events.jsonl")"

out=$(env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT CODEX_THREAD_ID=th1 python3 "$PT" bug b5 wont_fix -m test 2>&1); rc=$?
check "l agent Codex est detecte (CODEX_THREAD_ID)" "reserve a l'humain" "$out"
check_exit "wont_fix refuse cote agent Codex" 1 "$rc"

echo
[ "$fail" = 0 ] && echo "TOUS LES TESTS PASSENT" || { echo "DES TESTS ECHOUENT"; exit 1; }
