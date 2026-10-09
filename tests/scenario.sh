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
export PLANTRACK_REGISTRY="$TMP/registry"
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

# 2. !bug capture sans interrompre, et reapparait apres compaction : au compteur
# du resume (d6), en entier dans la fiche
out=$(prompt '!bug l avatar ne se rafraichit pas'); rc=$?
check_exit "!bug rejette le prompt (exit 2)" 2 "$rc"
check "!bug enregistre b1" "bug b1 enregistre" "$out"
out=$(ctx compact)
check "le resume signale le bug apres compaction" "1 bug(s) non corrige(s)" "$out"
check "bandeau de reinjection post-compaction" "contexte compacte" "$out"
check "b1 est entier dans la fiche" "b1" "$(python3 "$PT" status 2>&1)"

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

# 10b. v1.7 — sans fil actif, le commit ouvre un fil d'office au lieu d'etre perdu
out=$(H threads)
check "un commit sans fil ouvre un fil d office" "travaux sur" "$out"
out=$(ctx startup)
check "le bloc signale que ce fil attend son vrai nom" "ouvert d'office" "$out"
prompt '!close' >/dev/null
out=$(cd "$TMP" && python3 "$PT" init --git-hook 2>&1); rc=$?
check "init reconnait son propre pre-commit sans le redoubler" "deja en place" "$out"

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
out=$(python3 "$PT" status 2>&1)
check "l annulation alimente les decisions de la fiche" "k1 annulee" "$out"
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
check "!close libere l ouverture d un nouveau fil" "nouveau fil t4" "$out"
out=$(H close t4)
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
out=$(python3 "$PT" status 2>&1)
check "la fiche restitue la tentative rejetee (§5)" "deja rejete" "$out"
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

# 25. v1.5 — provenance (agent)/(humain) sur decisions et bugs, CLI decide/bug (creation),
# desambiguation avec le changement de statut existant
TMP10=$(mktemp -d)
out=$(CLAUDE_PROJECT_DIR="$TMP10" python3 "$PT" decide "on utilise redis pour le cache" 2>&1)
check "plantrack decide cree une decision" "decision d1 actee" "$out"
out=$(CLAUDE_PROJECT_DIR="$TMP10" python3 "$PT" status 2>&1)
check "decision creee par la CLI est marquee (agent)" "(agent)" "$out"
out=$(printf '{"prompt":"!decide on garde postgres"}' | CLAUDE_PROJECT_DIR="$TMP10" python3 "$PT" hook-prompt 2>&1)
check "!decide via hook enregistre d2" "decision d2 actee" "$out"
out=$(CLAUDE_PROJECT_DIR="$TMP10" python3 "$PT" status 2>&1)
d2line=$(printf '%s\n' "$out" | grep "^  d2 ")
check_not "!decide via hook ne porte pas de marqueur (agent)" "(agent)" "$d2line"

out=$(CLAUDE_PROJECT_DIR="$TMP10" python3 "$PT" bug "le paiement echoue" --high 2>&1)
check "plantrack bug <texte> cree un bug" "bug b1" "$out"
check "plantrack bug <texte> porte la severite" "[high]" "$out"
out=$(CLAUDE_PROJECT_DIR="$TMP10" python3 "$PT" bugs 2>&1)
check "bug cree par la CLI est marque (agent)" "(agent)" "$out"
out=$(CLAUDE_PROJECT_DIR="$TMP10" python3 "$PT" bug b1 to_verify 2>&1)
check "bug <id> <statut> reste le changement de statut (desambiguation)" "to_verify" "$out"
out=$(CLAUDE_PROJECT_DIR="$TMP10" python3 "$PT" bugs 2>&1)
check "le statut de b1 a bien change" "to_verify" "$out"
rm -rf "$TMP10"

# 26. v1.5 — bloc-notes des pieges : hook + CLI, reinjection, ids sequentiels
TMP11=$(mktemp -d)
out=$(printf '{"prompt":"!piege le cache invalide la session au deploy"}' \
  | CLAUDE_PROJECT_DIR="$TMP11" python3 "$PT" hook-prompt 2>&1); rc=$?
check_exit "!piege rejette le prompt (exit 2)" 2 "$rc"
check "!piege note pg1 (prefixe dedie, pas de collision avec les phases)" "piege pg1 note" "$out"
out=$(CLAUDE_PROJECT_DIR="$TMP11" python3 "$PT" piege "ne jamais committer .env" 2>&1)
check "plantrack piege cree pg2" "piege pg2 note" "$out"
out=$(printf '{"source":"startup"}' | CLAUDE_PROJECT_DIR="$TMP11" python3 "$PT" hook-context 2>&1)
check "les pieges sont comptes dans le resume" "2 piege(s) connu(s)" "$out"
out=$(CLAUDE_PROJECT_DIR="$TMP11" python3 "$PT" status 2>&1)
check "les pieges sont dans la fiche" "Pieges connus" "$out"
check "pg1 apparait dans la fiche" "pg1 :" "$out"
check "pg2 apparait dans la fiche" "pg2 :" "$out"
rm -rf "$TMP11"

# 27. v1.5 — questions en attente de verdict : hook + CLI, reponse fait disparaitre du bloc
TMP12=$(mktemp -d)
out=$(printf '{"prompt":"!question faut-il garder l ancien format d export ?"}' \
  | CLAUDE_PROJECT_DIR="$TMP12" python3 "$PT" hook-prompt 2>&1); rc=$?
check_exit "!question rejette le prompt (exit 2)" 2 "$rc"
check "!question enregistre q1" "question q1 enregistree" "$out"
out=$(printf '{"source":"startup"}' | CLAUDE_PROJECT_DIR="$TMP12" python3 "$PT" hook-context 2>&1)
check "la question en attente ressort au compteur du resume" "1 question(s) sans reponse" "$out"
out=$(CLAUDE_PROJECT_DIR="$TMP12" python3 "$PT" status 2>&1)
check "la question en attente ressort dans la fiche" "Questions en attente" "$out"
check "q1 apparait dans la fiche" "q1 :" "$out"

out=$(CLAUDE_PROJECT_DIR="$TMP12" python3 "$PT" question "prochaine version : 2.0 ou 1.6 ?" 2>&1)
check "plantrack question cree q2" "question q2 enregistree" "$out"

out=$(env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT CLAUDE_PROJECT_DIR="$TMP12" python3 "$PT" answer q1 "oui, on garde l ancien format" 2>&1)
check "plantrack answer repond a q1" "q1 repondue" "$out"
out=$(printf '{"source":"startup"}' | CLAUDE_PROJECT_DIR="$TMP12" python3 "$PT" hook-context 2>&1)
check "le compteur du resume redescend a la reponse" "1 question(s) sans reponse" "$out"
out=$(CLAUDE_PROJECT_DIR="$TMP12" python3 "$PT" status 2>&1)
check_not "q1 repondue disparait de la fiche" "q1 :" "$out"
check "q2 encore sans reponse reste dans la fiche" "q2 :" "$out"

out=$(env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT CLAUDE_PROJECT_DIR="$TMP12" python3 "$PT" answer qX "texte" 2>&1); rc=$?
check "answer sur id inconnu : erreur claire" "introuvable" "$out"
check_exit "answer id inconnu sort en erreur" 1 "$rc"

out=$(env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT CLAUDE_PROJECT_DIR="$TMP12" python3 "$PT" answer q1 "autre reponse" 2>&1); rc=$?
check "answer sur question deja repondue : erreur claire" "deja une reponse" "$out"
check_exit "answer deja repondue sort en erreur" 1 "$rc"

out=$(env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT CLAUDE_PROJECT_DIR="$TMP12" python3 "$PT" answer q2 2>&1); rc=$?
check "answer sans texte : erreur claire" "usage" "$out"
check_exit "answer sans texte sort en erreur" 1 "$rc"

out=$(CLAUDE_PROJECT_DIR="$TMP12" python3 "$PT" answer q2 "texte" 2>&1); rc=$?
check "answer refuse cote agent (O6, comme verify/wont_fix)" "reserve a l'humain" "$out"
check_exit "answer refuse cote agent sort en erreur" 1 "$rc"
rm -rf "$TMP12"

# 28. v1.5 — tentatives cablees dans le bloc reinjecte (compteur + derniere hypothese)
TMP13=$(mktemp -d)
printf '{"prompt":"!bug le paiement echoue"}' | CLAUDE_PROJECT_DIR="$TMP13" python3 "$PT" hook-prompt >/dev/null 2>&1
CLAUDE_PROJECT_DIR="$TMP13" python3 "$PT" attempt b1 le cache invalide la session >/dev/null 2>&1
CLAUDE_PROJECT_DIR="$TMP13" python3 "$PT" attempt b1 la variable d environnement manque en prod >/dev/null 2>&1
out=$(CLAUDE_PROJECT_DIR="$TMP13" python3 "$PT" status 2>&1)
check "la fiche affiche le compteur de tentatives" "2 tentatives" "$out"
check "la fiche affiche la derniere hypothese" "derniere: la variable d environnement" "$out"
rm -rf "$TMP13"

# 29. v1.5 — init rejoue sur une installation existante : MD_BLOCK mis a niveau, idempotent
TMP14=$(mktemp -d)
printf '<!-- plantrack:start -->\nancien bloc PlanTrack (pre-v1.5)\n<!-- plantrack:end -->\n' > "$TMP14/AGENTS.md"
out=$(CLAUDE_PROJECT_DIR="$TMP14" python3 "$PT" init 2>&1)
check "init met a niveau le bloc AGENTS.md existant" "mis a jour dans AGENTS.md" "$out"
check "le nouveau bloc mentionne l ecriture agent" "plantrack piege" "$(cat "$TMP14/AGENTS.md")"
check "le nouveau bloc mentionne les questions" "plantrack question" "$(cat "$TMP14/AGENTS.md")"
out=$(CLAUDE_PROJECT_DIR="$TMP14" python3 "$PT" init 2>&1)
check "second init : bloc AGENTS.md idempotent" "a jour dans AGENTS.md" "$out"
n=$(grep -c "plantrack:start" "$TMP14/AGENTS.md")
check_exit "un seul jeu de marqueurs apres mise a niveau" 1 "$n"
rm -rf "$TMP14"

# 30. v1.6.0 — post-commit journalisant installe d'office (pre-commit aussi depuis b15)
TMP15=$(mktemp -d)
git -C "$TMP15" init -q
out=$(CLAUDE_PROJECT_DIR="$TMP15" python3 "$PT" init 2>&1)
check "init installe le post-commit d'office (sans --git-hook)" "hook post-commit installe" "$out"
check "init pose le garde-fou pre-commit d office (b15)" "hook pre-commit installe" "$out"
out=$(CLAUDE_PROJECT_DIR="$TMP15" python3 "$PT" init 2>&1)
check "second init : post-commit deja en place (idempotent)" "hook post-commit deja en place" "$out"

printf '{"prompt":"!focus travail post-commit"}' | CLAUDE_PROJECT_DIR="$TMP15" python3 "$PT" hook-prompt >/dev/null 2>&1
echo x > "$TMP15/f.txt"
git -C "$TMP15" add f.txt
out=$(cd "$TMP15" && env -u CLAUDE_PROJECT_DIR git -c user.name=t -c user.email=t@t commit -q -m "feat: premier commit" 2>&1); rc=$?
check_exit "commit avec fil actif passe (post-commit jamais bloquant)" 0 "$rc"
out=$(CLAUDE_PROJECT_DIR="$TMP15" python3 "$PT" threads 2>&1)
check "le commit est attache au fil actif" "commits : 1" "$out"
check "avec le sha du dernier commit" "(dernier" "$out"
out=$(printf '{"source":"startup"}' | CLAUDE_PROJECT_DIR="$TMP15" python3 "$PT" hook-context 2>&1)
check "le bloc reinjecte porte le compteur de commits" "[1 commits]" "$out"

printf '{"prompt":"!close"}' | CLAUDE_PROJECT_DIR="$TMP15" python3 "$PT" hook-prompt >/dev/null 2>&1
echo y > "$TMP15/g.txt"
git -C "$TMP15" add g.txt
out=$(cd "$TMP15" && env -u CLAUDE_PROJECT_DIR git -c user.name=t -c user.email=t@t commit -q -m "second commit sans fil" 2>&1); rc=$?
check_exit "commit sans fil actif passe (jamais bloquant)" 0 "$rc"
out=$(CLAUDE_PROJECT_DIR="$TMP15" python3 "$PT" threads 2>&1)
check "le fil ferme ne recupere pas le commit" "commits : 1" "$out"
check "un fil d office prend le relais, nomme d apres la branche" "travaux sur" "$out"
out=$(CLAUDE_PROJECT_DIR="$TMP15" python3 "$PT" doctor 2>&1 || true)
check "doctor mesure l usage : tous les commits sont arrives au carnet" "ok  commits arrives au carnet (2/2 depuis" "$out"
rm -rf "$TMP15"

# 30b. v1.7 — doctor voit un depot vert en configuration mais muet a l'usage
TMP18=$(mktemp -d)
git -C "$TMP18" init -q
CLAUDE_PROJECT_DIR="$TMP18" python3 "$PT" init >/dev/null 2>&1
rm -f "$TMP18/.git/hooks/post-commit"          # le hook saute : plus rien n'est journalise
echo x > "$TMP18/f.txt"; git -C "$TMP18" add f.txt
(cd "$TMP18" && env -u CLAUDE_PROJECT_DIR git -c user.name=t -c user.email=t@t commit -q -m "un commit hors carnet")
CLAUDE_PROJECT_DIR="$TMP18" python3 "$PT" decide "pour que le journal existe" >/dev/null 2>&1
out=$(CLAUDE_PROJECT_DIR="$TMP18" python3 "$PT" doctor 2>&1 || true)
check "doctor signale le hook post-commit disparu" "!!  hook git post-commit" "$out"

# 30c. v1.7 — registre et vue d'ensemble de la flotte
check "init inscrit le depot au registre" "$TMP18" "$(cat "$PLANTRACK_REGISTRY")"
out=$(python3 "$PT" doctor --all 2>&1); rc=$?
check "doctor --all parcourt les depots enregistres" "$TMP18" "$out"
check "doctor --all compte les depots en defaut" "en defaut" "$out"
check_exit "doctor --all sort en erreur si un depot deraille" 1 "$rc"
echo "/tmp/depot-plantrack-inexistant" >> "$PLANTRACK_REGISTRY"
out=$(python3 "$PT" doctor --all 2>&1 || true)
check "doctor --all retire du registre un depot efface" "1 depot(s) efface(s) retire(s)" "$out"
check_not "et l entree ne revient pas" "depot-plantrack-inexistant" "$(cat "$PLANTRACK_REGISTRY")"
TMP20=$(mktemp -d); echo "$TMP20" >> "$PLANTRACK_REGISTRY"
out=$(python3 "$PT" doctor --all 2>&1 || true)
check "un depot present mais desinstalle est signale, pas efface" "installation absente" "$out"
rm -rf "$TMP20"
rm -rf "$TMP18"

# 30d. v1.7.1 — instantane de l'etat dans AGENTS.md, pour les agents sans hooks
TMP19=$(mktemp -d)
git -C "$TMP19" init -q
CLAUDE_PROJECT_DIR="$TMP19" python3 "$PT" init >/dev/null 2>&1
check "init pose les marqueurs d etat dans AGENTS.md" "<!-- plantrack:state -->" "$(cat "$TMP19/AGENTS.md")"
CLAUDE_PROJECT_DIR="$TMP19" python3 "$PT" decide "le carnet fait foi" >/dev/null 2>&1
echo x > "$TMP19/f.txt"; git -C "$TMP19" add f.txt
(cd "$TMP19" && env -u CLAUDE_PROJECT_DIR git -c user.name=t -c user.email=t@t commit -q -m "feat: x")
out=$(cat "$TMP19/AGENTS.md")
check "le post-commit rafraichit l instantane, quel que soit l agent" "le carnet fait foi" "$out"
check "l instantane porte le fil ouvert d office" "travaux sur" "$out"
check_not "l instantane ne duplique pas les regles deja presentes au-dessus" "REGLES PLANTRACK" "$out"
n=$(grep -c "plantrack:state" "$TMP19/AGENTS.md")
check "un seul jeu de marqueurs d etat apres rafraichissement" "2" "$n"
check "injections.json est gitignore (propre a la machine)" "injections.json" "$(cat "$TMP19/.gitignore")"
out=$(printf '{"source":"startup"}' | CLAUDE_PROJECT_DIR="$TMP19" python3 "$PT" hook-context >/dev/null 2>&1; cat "$TMP19/.plantrack/injections.json")
check "hook-context laisse une trace horodatee de l injection" "claude" "$out"
out=$(CLAUDE_PROJECT_DIR="$TMP19" python3 "$PT" doctor 2>&1 || true)
check "doctor rend compte de l injection reelle" "etat injecte (claude le" "$out"
rm -rf "$TMP19"

# 30e. v1.7 — les regles sont injectees hors budget, jamais tronquees
out=$(ctx compact)
check "les regles sont reinjectees avec l etat" "REGLES PLANTRACK" "$out"
check "et portent la regle du verdict humain" "Tu ne valides jamais un bug toi-même" "$out"

# 31. un hook git occupe par un autre outil est GREFFE, jamais ecrase ni abandonne
# (renoncer laissait le garde-fou eteint pour de bon — cas de bcc sous lefthook)
TMP16=$(mktemp -d)
git -C "$TMP16" init -q
for h in post-commit pre-commit; do
  printf '#!/bin/sh\necho foreign-hook\nexit 0\n' > "$TMP16/.git/hooks/$h"
  chmod +x "$TMP16/.git/hooks/$h"
done
out=$(CLAUDE_PROJECT_DIR="$TMP16" python3 "$PT" init --git-hook 2>&1)
check "un hook etranger recoit la greffe PlanTrack" "greffe sur le hook existant" "$out"
check "le reste de l'installation continue malgre tout" "insere dans AGENTS.md" "$out"
post=$(cat "$TMP16/.git/hooks/post-commit")
check "le contenu etranger est preserve" "foreign-hook" "$post"
check "l appel PlanTrack est bien present" "hook-commit" "$post"
pre=$(cat "$TMP16/.git/hooks/pre-commit")
check "la greffe passe AVANT l exit de l occupant" \
  "pt.py precommit" "$(printf '%s' "$pre" | sed -n '1,4p')"
check "la greffe teste la presence de pt.py avant de bloquer" "[ -f .claude/hooks/pt.py ]" "$pre"
out=$(CLAUDE_PROJECT_DIR="$TMP16" python3 "$PT" init --git-hook 2>&1)
check "une seconde installation ne redouble pas la greffe" "deja en place" "$out"
check_exit "hook greffe toujours executable" 0 \
  "$(cd "$TMP16" && sh .git/hooks/post-commit >/dev/null 2>&1; echo $?)"
# une version ANTERIEURE de l'appel compte comme deja en place : sinon chaque
# mise a niveau empilerait une greffe de plus sur le meme hook
printf '#!/bin/sh\nexec python3 .claude/hooks/pt.py precommit\n' > "$TMP16/.git/hooks/pre-commit"
out=$(CLAUDE_PROJECT_DIR="$TMP16" python3 "$PT" init --git-hook 2>&1)
check "un appel PlanTrack d une version anterieure n est pas redouble" "deja en place" "$out"
rm -rf "$TMP16"

# 32. v1.6.0 — guides de test coches, caches derriere !testcheck (off par defaut)
TMP17=$(mktemp -d)
out=$(printf '{"prompt":"!guide un titre"}' | CLAUDE_PROJECT_DIR="$TMP17" python3 "$PT" hook-prompt 2>&1); rc=$?
check_exit "!guide rejette le prompt (exit 2)" 2 "$rc"
check "!guide refuse tant que testcheck est off" "testcheck desactivee" "$out"
out=$(CLAUDE_PROJECT_DIR="$TMP17" python3 "$PT" guide "un titre" 2>&1)
check "plantrack guide refuse aussi tant que testcheck est off" "testcheck desactivee" "$out"
out=$(printf '{"source":"startup"}' | CLAUDE_PROJECT_DIR="$TMP17" python3 "$PT" hook-context 2>&1)
check_not "rien dans le bloc reinjecte tant que testcheck est off" "Guide" "$out"

out=$(printf '{"prompt":"!testcheck on"}' | CLAUDE_PROJECT_DIR="$TMP17" python3 "$PT" hook-prompt 2>&1); rc=$?
check_exit "!testcheck rejette le prompt (exit 2)" 2 "$rc"
check "!testcheck on active l'option" "testcheck active" "$out"

out=$(printf '{"prompt":"!guide parcours inscription"}' | CLAUDE_PROJECT_DIR="$TMP17" python3 "$PT" hook-prompt 2>&1)
check "!guide cree g1 une fois testcheck actif" "guide g1 cree" "$out"
out=$(printf '{"prompt":"!step g1 cliquer sur inscription"}' | CLAUDE_PROJECT_DIR="$TMP17" python3 "$PT" hook-prompt 2>&1)
check "!step ajoute s1 au guide" "etape s1 ajoutee" "$out"
CLAUDE_PROJECT_DIR="$TMP17" python3 "$PT" step g1 "verifier le mail de confirmation" >/dev/null 2>&1

out=$(printf '{"source":"startup"}' | CLAUDE_PROJECT_DIR="$TMP17" python3 "$PT" hook-context 2>&1)
check "les etapes sans verdict ressortent dans le bloc" "etapes sans verdict" "$out"
check "s1 est nomme dans le bloc" "s1" "$out"

out=$(CLAUDE_PROJECT_DIR="$TMP17" python3 "$PT" check s1 ok 2>&1); rc=$?
check "check refuse cote agent (verdict reserve a l'humain)" "reserve a l'humain" "$out"
check_exit "check refuse cote agent sort en erreur" 1 "$rc"
out=$(env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT CLAUDE_PROJECT_DIR="$TMP17" python3 "$PT" check s1 ko 2>&1)
check "check ko sans motif refuse" "motif obligatoire" "$out"
out=$(env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT CLAUDE_PROJECT_DIR="$TMP17" python3 "$PT" check s1 ko -m "bouton introuvable" 2>&1)
check "check ko avec motif passe (humain)" "s1 : ko" "$out"

out=$(printf '{"prompt":"!check s2 ok"}' | CLAUDE_PROJECT_DIR="$TMP17" python3 "$PT" hook-prompt 2>&1); rc=$?
check_exit "!check rejette le prompt (exit 2)" 2 "$rc"
check "!check ok verdict s2 cote hook" "s2 : ok" "$out"

out=$(printf '{"source":"startup"}' | CLAUDE_PROJECT_DIR="$TMP17" python3 "$PT" hook-context 2>&1)
check_not "toutes les etapes verdictees : plus rien dans le bloc" "etapes sans verdict" "$out"
out=$(CLAUDE_PROJECT_DIR="$TMP17" python3 "$PT" guide g1 2>&1)
check "plantrack guide <id> affiche le verdict negatif" "✗ s1" "$out"
check "et le verdict positif" "✓ s2" "$out"

out=$(printf '{"prompt":"!testcheck off"}' | CLAUDE_PROJECT_DIR="$TMP17" python3 "$PT" hook-prompt 2>&1)
check "!testcheck off desactive l'option" "testcheck desactive" "$out"
out=$(CLAUDE_PROJECT_DIR="$TMP17" python3 "$PT" guide g1 2>&1)
check "testcheck off : les donnees restent consultables (rien n'est efface)" "s1" "$out"
out=$(CLAUDE_PROJECT_DIR="$TMP17" python3 "$PT" step g1 "nouvelle etape" 2>&1)
check "testcheck off : creer une nouvelle etape est de nouveau refuse" "testcheck desactivee" "$out"
rm -rf "$TMP17"

# 18. d6 — plus aucune coupe : la fiche est ENTIERE (bugs, decisions, pieges,
# questions au complet), et le resume injecte en session ne porte que des
# compteurs et le renvoi vers la fiche — court par construction.
TMP18=$(mktemp -d)
L=$(python3 -c 'print("x"*130)')
for i in 1 2 3 4 5 6 7 8; do
  CLAUDE_PROJECT_DIR="$TMP18" python3 "$PT" bug "BUGCONSERVE$i $L" >/dev/null
done
for i in 5 6 7 8; do
  CLAUDE_PROJECT_DIR="$TMP18" python3 "$PT" bug b$i to_verify >/dev/null
done
for i in 1 2 3 4 5 6; do
  CLAUDE_PROJECT_DIR="$TMP18" python3 "$PT" decide "DECISIONCONSERVEE$i $L" >/dev/null
  CLAUDE_PROJECT_DIR="$TMP18" python3 "$PT" piege "PIEGECONSERVE$i $L" >/dev/null
  CLAUDE_PROJECT_DIR="$TMP18" python3 "$PT" question "QUESTIONCONSERVEE$i $L" >/dev/null
done
blk=$(CLAUDE_PROJECT_DIR="$TMP18" python3 "$PT" status 2>&1)
for i in 1 8; do
  check "fiche : le bug b$i est entier" "BUGCONSERVE$i" "$blk"
done
check "fiche : les decisions actees au complet" "DECISIONCONSERVEE6" "$blk"
check "fiche : les pieges connus au complet" "PIEGECONSERVE6" "$blk"
check "fiche : les questions en attente au complet" "QUESTIONCONSERVEE6" "$blk"
check_not "fiche : plus jamais d elision" "elidee" "$blk"
# le resume injecte ne porte que des compteurs, et tient sous le plafond
r=$(printf '{"source":"startup"}' | CLAUDE_PROJECT_DIR="$TMP18" python3 "$PT" hook-context 2>&1)
check_not "resume : pas de detail de bug" "BUGCONSERVE1" "$r"
check "resume : le compteur des bugs non corriges" "4 bug(s) non corrige(s)" "$r"
check "resume : le compteur des bugs a verdict" "4 bug(s) corrige(s) en attente de verdict humain" "$r"
check "resume : le renvoi vers la fiche est present" "instantane de l'etat" "$r"
n=$(printf '%s' "$r" | wc -c)
if [ "$n" -le 3000 ]; then echo "ok   - resume charge : toujours sous le plafond ($n chars)"
else echo "FAIL - resume charge : $n chars (> 3000)"; fail=1; fi
d=$(CLAUDE_PROJECT_DIR="$TMP18" python3 "$PT" doctor 2>&1)
check "doctor : le resume reste sous le budget" "ok  resume de session sous le budget" "$d"
# une section sans contenu ne doit pas annoncer son intitule dans le vide
TMP18b=$(mktemp -d)
vide=$(CLAUDE_PROJECT_DIR="$TMP18b" python3 "$PT" status 2>&1)
check_not "aucune tete de section vide dans un projet neuf" "Questions en attente" "$vide"
check_not "aucune tete de section vide dans un projet neuf (pieges)" "Pieges connus" "$vide"
rm -rf "$TMP18" "$TMP18b"

# 19. Le verdict humain sans quitter la session : !verify / !reject (humain par
# construction, comme !answer : seul l'humain tape un prompt) — audit du 13/09 :
# 0 verdict sur 48 bugs, la CLI exigeait un second terminal.
TMP19=$(mktemp -d)
P19() { CLAUDE_PROJECT_DIR="$TMP19" prompt "$1"; }
P19 '!focus verdicts' >/dev/null
P19 '!bug le bouton ne repond pas' >/dev/null
CLAUDE_PROJECT_DIR="$TMP19" python3 "$PT" attempt b1 "le handler n est pas branche" >/dev/null 2>&1
out=$(P19 '!verify b1')
check "!verify refuse un bug qui n est pas to_verify" "to_verify" "$out"
CLAUDE_PROJECT_DIR="$TMP19" python3 "$PT" bug b1 to_verify >/dev/null 2>&1
out=$(P19 '!reject b1'); check "!reject sans motif : usage" "usage" "$out"
out=$(P19 '!reject b1 le bouton reste mort'); rc=$?
check_exit "!reject rejette le prompt (exit 2)" 2 "$rc"
check "!reject rouvre le bug avec motif" "b1 rouvert avec motif" "$out"
out=$(CLAUDE_PROJECT_DIR="$TMP19" python3 "$PT" attempts b1 2>&1)
check "!reject : le motif est attache a la derniere tentative" "rejetee : le bouton reste mort" "$out"
CLAUDE_PROJECT_DIR="$TMP19" python3 "$PT" bug b1 to_verify >/dev/null 2>&1
out=$(P19 '!verify b1'); rc=$?
check_exit "!verify rejette le prompt (exit 2)" 2 "$rc"
check "!verify valide le bug" "b1 valide" "$out"
out=$(CLAUDE_PROJECT_DIR="$TMP19" python3 "$PT" status 2>&1)
check_not "bug valide : il quitte le bloc reinjecte" "b1" "$out"
out=$(P19 '!verify b9'); check "!verify sur id inconnu : erreur claire" "introuvable" "$out"
out=$(P19 '!help'); check "!help documente !verify et !reject" "!verify <id>" "$out"
# une question sans reponse depuis plus de 7 jours est un oubli au meme titre qu'un bug
printf '{"ts":"2026-01-01T00:00:00+00:00","kind":"question","id":"q1","text":"on garde le format ?"}\n' >> "$TMP19/.plantrack/events.jsonl"
d=$(CLAUDE_PROJECT_DIR="$TMP19" python3 "$PT" doctor 2>&1)
check "doctor : question sans reponse > 7 jours signalee" "!!  questions sans reponse (1 depuis plus de 7 jours)" "$d"
check "doctor : la question oubliee est nommee avec le geste" "!answer q1" "$d"
rm -rf "$TMP19"

# 20. Le parcours : une phase qui porte une REGLE, et une porte qui decide de la
# sortie. PlanTrack savait dire "phase 2 en cours", pas "en phase 2 tu livres des
# pistes avant toute question" (note bcc du 13/09, q14/d95).
TMP20=$(mktemp -d)
A20() { CLAUDE_PROJECT_DIR="$TMP20" python3 "$PT" "$@" 2>&1; }
H20() { CLAUDE_PROJECT_DIR="$TMP20" H "$@"; }
P20() { CLAUDE_PROJECT_DIR="$TMP20" prompt "$1"; }
PARC="$(cd "$(dirname "$PT")/../.." && pwd)/parcours/projet-client.json"

out=$(A20 parcours import "$PARC")
check "parcours import est reserve a l humain" "reserve a l'humain" "$out"
out=$(echo y | H20 parcours import "$PARC")
check "parcours import ecrit apres confirmation" "parcours projet-client enregistre" "$out"

# une regle plus longue que le budget de ligne est refusee A L IMPORT : injectee,
# elle ferait elider le reste de l'etat sans que personne ne le voie
LONGUE="$TMP20/longue.json"
python3 - "$LONGUE" <<'PY'
import json, sys
json.dump({"nom": "trop-long", "phases": [{"nom": "p", "regle": "x" * 200}]},
          open(sys.argv[1], "w", encoding="utf-8"))
PY
out=$(echo y | H20 parcours import "$LONGUE")
check "une regle-paragraphe est refusee a l import" "maximum 140" "$out"
SANSREGLE="$TMP20/sansregle.json"
python3 - "$SANSREGLE" <<'PY'
import json, sys
json.dump({"nom": "creux", "phases": [{"nom": "p"}]}, open(sys.argv[1], "w", encoding="utf-8"))
PY
out=$(echo y | H20 parcours import "$SANSREGLE")
check "une phase sans regle est refusee a l import" "regle" "$out"

out=$(A20 parcours start projet-client)
check "parcours start ouvre la phase 1" "phase 1/5" "$out"
out=$(A20 parcours start projet-client)
check "un parcours deja lance ne se relance pas" "tourne deja" "$out"

# la regle sort en TETE du bloc et au rang 0 : une consigne elidee n'existe pas
out=$(CLAUDE_PROJECT_DIR="$TMP20" ctx startup)
check "la phase active est injectee dans le bloc" "PARCOURS projet-client — phase 1/5" "$out"
check "la regle de la phase est injectee" "Au plus trois questions" "$out"
check "la porte est annoncee a l agent" "porte agent" "$out"

out=$(A20 phase next)
check "porte agent : l agent passe seul" "phase 2/5" "$out"
out=$(A20 phase next)
check "porte humaine sans question : refus" "aucune question n'a ete posee" "$out"
A20 question "laquelle des trois ?" >/dev/null
out=$(A20 phase next)
check "porte humaine, question sans reponse : refus" "attend(ent) toujours une reponse" "$out"
out=$(CLAUDE_PROJECT_DIR="$TMP20" ctx startup)
check "porte humaine : le bloc l annonce" "porte humaine" "$out"
H20 answer q1 "la deuxieme" >/dev/null
out=$(A20 phase next)
check "porte humaine : la reponse ouvre la porte" "phase 3/5" "$out"

# une question posee dans une phase qui n'en veut pas : avertissement, pas blocage
A20 question "on valide ?" >/dev/null; H20 answer q2 "oui" >/dev/null
A20 phase next >/dev/null
out=$(A20 question "je fais quoi pour la couleur ?")
check "question dans une phase sans question : avertie sur le champ" "n'admet pas de question" "$out"
out=$(A20 doctor)
check "doctor : question posee hors porte" "questions posees hors porte (1)" "$out"
check_not "doctor n interdit rien, il avertit" "refuse" "$out"

# fin de parcours : pas de phase 6 inventee
A20 phase next >/dev/null
A20 question "verdict ?" >/dev/null; H20 answer q4 "ok" >/dev/null
out=$(A20 phase next)
check "la derniere phase acheve le parcours" "parcours projet-client acheve" "$out"
out=$(CLAUDE_PROJECT_DIR="$TMP20" ctx startup)
check_not "parcours acheve : plus de regle injectee" "PARCOURS projet-client" "$out"

# ce que bcc lit pour son ecran de completude
A20 parcours start projet-client >/dev/null 2>&1
out=$(A20 parcours json)
check "parcours json : la phase courante" '"parcours": null' "$out"
out=$(A20 phase next)
check "phase next sans phase active : message clair" "aucune phase active" "$out"

# une phase creee a la main n'appartient a aucun parcours : phase done reste le chemin
TMP20b=$(mktemp -d)
CLAUDE_PROJECT_DIR="$TMP20b" python3 "$PT" phase add "au fil de l eau" >/dev/null 2>&1
CLAUDE_PROJECT_DIR="$TMP20b" python3 "$PT" phase start p1 >/dev/null 2>&1
out=$(CLAUDE_PROJECT_DIR="$TMP20b" python3 "$PT" phase next 2>&1)
check "phase hors parcours : next renvoie vers phase done" "n'appartient a aucun parcours" "$out"
out=$(CLAUDE_PROJECT_DIR="$TMP20b" ctx startup)
check_not "une phase sans regle n encombre pas le bloc" "regle :" "$out"
rm -rf "$TMP20" "$TMP20b"

# 21. b10 — la fenetre d'usage se prend sur l'horloge de GIT, pas sur celle du
# journal. Le hook post-commit tourne APRES le commit : qu'il franchisse une
# seconde et `git log --since` excluait le premier commit que le journal, lui,
# comptait — l'ecart annoncait 2/1 sans qu'un seul commit manque. C'etait le
# test 30 rouge par intermittence (pg8). Ici la course est FORCEE, plus subie :
# le ts du journal est pose une seconde apres la date du commit.
TMP21=$(mktemp -d)
(cd "$TMP21" && git init -q . && git config user.email t@t && git config user.name t \
  && mkdir -p .plantrack .git/hooks && echo hook-commit > .git/hooks/post-commit \
  && echo a > f && git add f && git commit -q -m one) >/dev/null 2>&1
SHA=$(cd "$TMP21" && git log -1 --format=%H)
CD=$(cd "$TMP21" && git log -1 --format=%cI)
TS=$(python3 -c "
from datetime import datetime, timedelta, timezone
print((datetime.fromisoformat('$CD') + timedelta(seconds=1)).astimezone(timezone.utc).isoformat(timespec='seconds'))")
printf '{"ts":"%s","kind":"commit","id":"c1","sha":"%s","thread":"t1"}\n' "$TS" "$SHA" \
  > "$TMP21/.plantrack/events.jsonl"
out=$(CLAUDE_PROJECT_DIR="$TMP21" python3 "$PT" doctor 2>&1)
check "hook une seconde apres le commit : le commit reste dans la fenetre" \
  "commits arrives au carnet (1/1" "$out"
# sha introuvable (commit amende ou reset, pg4) : repli sur le ts du journal,
# jamais une exception qui emporterait tout le doctor
printf '{"ts":"%s","kind":"commit","id":"c2","sha":"0000000","thread":"t1"}\n' "$TS" \
  >> "$TMP21/.plantrack/events.jsonl"
out=$(CLAUDE_PROJECT_DIR="$TMP21" python3 "$PT" doctor 2>&1)
check "un sha introuvable ne casse pas le controle d usage" "commits arrives au carnet" "$out"
rm -rf "$TMP21"

# 22. b5 — worktree git : `.git` est un FICHIER 'gitdir: <chemin>', pas un
# repertoire. Sans resolution, branch() lit un HEAD absent et retombe en silence
# sur 'le depot', et l'installation refuse 'pas de depot git ici'. Les hooks, eux,
# vivent dans le repertoire COMMUN du depot principal, jamais dans le worktree.
TMP22=$(mktemp -d)
(cd "$TMP22" && git init -q principal && cd principal && git config user.email t@t \
  && git config user.name t && git commit -q --allow-empty -m init \
  && git worktree add -q ../feature -b feature) >/dev/null 2>&1
WT="$TMP22/feature"
out=$(CLAUDE_PROJECT_DIR="$WT" python3 "$PT" init --git-hook 2>&1)
check "worktree : l installation ne refuse plus le depot" "installation terminee" "$out"
check "worktree : le garde-fou pre-commit est pose" "hook pre-commit installe" "$out"
check "worktree : les hooks vont au repertoire commun" ok \
  "$([ -f "$TMP22/principal/.git/hooks/post-commit" ] && echo ok || echo absent)"
check "worktree : rien n a ete ecrit dans le repertoire du worktree" ok \
  "$([ -d "$TMP22/principal/.git/worktrees/feature/hooks" ] && echo dedans || echo ok)"
(cd "$WT" && export CLAUDE_PROJECT_DIR="$WT" && echo x > f.txt && git add f.txt \
  && git commit -q --no-verify -m "essai") >/dev/null 2>&1
# le sha, pas le ratio du doctor : le commit d'amorce du depot principal tombe
# dans la meme seconde et fausserait le compte (meme famille que pg8)
SHA22=$(cd "$WT" && git log -1 --format=%h)
check "worktree : le commit arrive au carnet" "$SHA22" "$(cat "$WT/.plantrack/events.jsonl")"
out=$(CLAUDE_PROJECT_DIR="$WT" python3 -c "
import importlib.util, sys
s = importlib.util.spec_from_file_location('pt', sys.argv[1])
m = importlib.util.module_from_spec(s); s.loader.exec_module(m)
print(m.branch())" "$PT" 2>&1)
check "worktree : la branche est lue, pas devinee" feature "$out"
rm -rf "$TMP22"

# 23. b11 — "plantrack bug verify b5" : mots inverses. La desambiguation ne
# regardait que le premier argument, donc la commande partait en TEXTE et creait
# un bug fantome dans un journal qui ne s'efface pas. Refus + bonne forme.
TMP23=$(mktemp -d)
(cd "$TMP23" && git init -q .) >/dev/null 2>&1
CLAUDE_PROJECT_DIR="$TMP23" python3 "$PT" init >/dev/null 2>&1
CLAUDE_PROJECT_DIR="$TMP23" python3 "$PT" bug "un vrai bug" >/dev/null 2>&1
out=$(CLAUDE_PROJECT_DIR="$TMP23" python3 "$PT" bug verify b1 2>&1)
check "mots inverses : la commande est refusee" "mots inverses" "$out"
check "et la bonne forme est rappelee" "plantrack bug b1 verify" "$out"
check_not "aucun bug fantome n a ete cree" "b2 enregistre" "$out"
out=$(CLAUDE_PROJECT_DIR="$TMP23" python3 "$PT" bug "regression sur b1" 2>&1)
check "un texte libre qui cite un id reste un bug" "b2 enregistre" "$out"
out=$(CLAUDE_PROJECT_DIR="$TMP23" python3 "$PT" bug b1 to_verify 2>&1)
check "la forme correcte passe toujours" "b1 -> to_verify" "$out"
rm -rf "$TMP23"

# 24. b4/d6 — la note pedagogique du fil auto-ouvert reste affichee sous le fil,
# et plus rien ne s'elide : les bugs restent entiers dans la fiche a cote d'elle.
TMP24=$(mktemp -d)
(cd "$TMP24" && git init -q . && git config user.email t@t && git config user.name t) >/dev/null 2>&1
CLAUDE_PROJECT_DIR="$TMP24" python3 "$PT" init >/dev/null 2>&1
(cd "$TMP24" && export CLAUDE_PROJECT_DIR="$TMP24" && echo a > f \
  && git add f && git commit -q --no-verify -m un) >/dev/null 2>&1
L24=$(python3 -c 'print("y"*130)')
for i in 1 2 3 4 5 6; do
  CLAUDE_PROJECT_DIR="$TMP24" python3 "$PT" bug "BUGVIVANT$i $L24" >/dev/null
done
blk=$(CLAUDE_PROJECT_DIR="$TMP24" python3 "$PT" status 2>&1)
check "fil auto-ouvert : la note reste affichee a taille normale" "fil ouvert d'office" "$blk"
check "les bugs non corriges restent entiers a cote de la note" "BUGVIVANT6" "$blk"
rm -rf "$TMP24"

# 25. b7 — un hook ne doit jamais bloquer une session, donc il avale ses pannes.
# Avalees SANS TRACE, elles sont invisibles, meme pour le doctor (contre d2).
# Ici la panne est reelle : injections.json illisible fait echouer note_injection
# a chaque demarrage. Le hook continue de servir l'etat, mais il le dit.
TMP25=$(mktemp -d)
(cd "$TMP25" && git init -q .) >/dev/null 2>&1
CLAUDE_PROJECT_DIR="$TMP25" python3 "$PT" init >/dev/null 2>&1
CLAUDE_PROJECT_DIR="$TMP25" python3 "$PT" bug "un bug quelconque" >/dev/null
check "incidents.log est gitignore" ".plantrack/incidents.log" "$(cat "$TMP25/.gitignore")"
out=$(CLAUDE_PROJECT_DIR="$TMP25" python3 "$PT" doctor 2>&1)
check "aucune panne avalee au depart" "ok  pannes avalees par les hooks (0" "$out"
printf 'pas du json' > "$TMP25/.plantrack/injections.json"
out=$(printf '{"source":"startup"}' | CLAUDE_PROJECT_DIR="$TMP25" python3 "$PT" hook-context 2>&1)
check "la panne n empeche pas le hook de servir l etat" "1 bug(s) non corrige(s)" "$out"
check "la panne est tracee, avec son origine" "note_injection" "$(cat "$TMP25/.plantrack/incidents.log")"
out=$(CLAUDE_PROJECT_DIR="$TMP25" python3 "$PT" doctor 2>&1)
check "le doctor annonce la panne avalee" "!!  pannes avalees par les hooks (1" "$out"
check "et donne la derniere trace" "JSONDecodeError" "$out"
rm -rf "$TMP25"

# 26. b6 — hook-filelog n'ecoutait que Edit|Write|MultiEdit|NotebookEdit : une
# ecriture via Bash (sed -i, redirection, heredoc) n'etait jamais journalisee.
# Le hook extrait desormais les cibles d'ecriture de la commande — best effort :
# seul un chemin qui existe vraiment apres la commande est retenu.
TMP26=$(mktemp -d)
(cd "$TMP26" && git init -q .) >/dev/null 2>&1
CLAUDE_PROJECT_DIR="$TMP26" python3 "$PT" init >/dev/null 2>&1
printf '{"prompt":"!focus fil bash"}' | CLAUDE_PROJECT_DIR="$TMP26" python3 "$PT" hook-prompt >/dev/null 2>&1
mkdir -p "$TMP26/src"
echo v1 > "$TMP26/src/conf.txt"; echo v1 > "$TMP26/src/log.txt"; echo v1 > "$TMP26/src/notes.md"
flog() { printf '{"tool_name":"Bash","tool_input":{"command":"%s"},"cwd":"%s"}' "$1" "$TMP26" | CLAUDE_PROJECT_DIR="$TMP26" python3 "$PT" hook-filelog; }
flog "sed -i s/v1/v2/ src/conf.txt"
check "b6 : sed -i journalise sa cible" '"text": "src/conf.txt"' "$(cat "$TMP26/.plantrack/events.jsonl")"
flog "echo ligne >> src/log.txt 2>/dev/null"
check "b6 : la redirection >> est journalisee" '"text": "src/log.txt"' "$(cat "$TMP26/.plantrack/events.jsonl")"
check_not "b6 : /dev/null n est pas un fichier touche" '"text": "/dev/null"' "$(cat "$TMP26/.plantrack/events.jsonl")"
flog "cat > src/notes.md <<EOF"
check "b6 : le heredoc journalise sa cible" '"text": "src/notes.md"' "$(cat "$TMP26/.plantrack/events.jsonl")"
flog "grep -n motif src/conf.txt > /tmp/inexistant-b6-xyz.txt"
check_not "b6 : une cible qui n existe pas n est pas journalisee" "inexistant-b6-xyz" "$(cat "$TMP26/.plantrack/events.jsonl")"
n=$(grep -c '"text": "src/conf.txt"' "$TMP26/.plantrack/events.jsonl")
check "b6 : une lecture pure ne journalise pas son argument" "1" "$n"
# le matcher d'une installation existante doit etre rafraichi par init (la
# fusion comparait sur la commande seule : l'entree etait 'deja en place')
python3 - "$TMP26/.claude/settings.json" <<'EOF'
import json, sys
p = sys.argv[1]; d = json.load(open(p))
d["hooks"]["PostToolUse"][0]["matcher"] = "Edit|Write|MultiEdit|NotebookEdit"
json.dump(d, open(p, "w"), indent=2)
EOF
CLAUDE_PROJECT_DIR="$TMP26" python3 "$PT" init >/dev/null 2>&1
check "b6 : init rafraichit un matcher perime" "Edit|Write|MultiEdit|NotebookEdit|Bash" "$(cat "$TMP26/.claude/settings.json")"
rm -rf "$TMP26"

# 27. b9 — l'instantane AGENTS.md n'etait regenere qu'au post-commit : une
# ecriture sans commit derriere (decision, bug_status, question) laissait le
# fichier perime pour tout agent qui le LIT (Codex, Gemini, relecture humaine).
# Desormais tout processus qui ecrit au journal rafraichit l'instantane en sortant.
TMP27=$(mktemp -d)
(cd "$TMP27" && git init -q .) >/dev/null 2>&1
CLAUDE_PROJECT_DIR="$TMP27" python3 "$PT" init >/dev/null 2>&1
CLAUDE_PROJECT_DIR="$TMP27" python3 "$PT" decide "le cache passe sur redis, sans commit" >/dev/null
check "b9 : une decision CLI sans commit rafraichit AGENTS.md" "le cache passe sur redis" "$(cat "$TMP27/AGENTS.md")"
printf '{"prompt":"!bug la pagination saute une page"}' | CLAUDE_PROJECT_DIR="$TMP27" python3 "$PT" hook-prompt >/dev/null 2>&1
check "b9 : un !bug via hook (exit 2) rafraichit AGENTS.md" "la pagination saute une page" "$(cat "$TMP27/AGENTS.md")"
CLAUDE_PROJECT_DIR="$TMP27" python3 "$PT" attempt b1 "hypothese posee" >/dev/null
CLAUDE_PROJECT_DIR="$TMP27" python3 "$PT" bug b1 to_verify >/dev/null
check "b9 : un changement de statut sans commit suit dans AGENTS.md" "b1 (to_verify)" "$(cat "$TMP27/AGENTS.md")"
rm -rf "$TMP27"

# --- 31. canal humain relaye (--de, d107) : verify/reject/answer attestes ---
echo; echo "-- canal humain relaye (--de) --"
TMP31=$(mktemp -d)
(cd "$TMP31" && git init -q .) >/dev/null 2>&1
CLAUDE_PROJECT_DIR="$TMP31" python3 "$PT" init >/dev/null 2>&1
CLAUDE_PROJECT_DIR="$TMP31" python3 "$PT" bug "le tri saute une ligne" >/dev/null
CLAUDE_PROJECT_DIR="$TMP31" python3 "$PT" attempt b1 "corrige l'index de depart" >/dev/null
CLAUDE_PROJECT_DIR="$TMP31" python3 "$PT" bug b1 to_verify >/dev/null
out=$(CLAUDE_PROJECT_DIR="$TMP31" python3 "$PT" verify b1 2>&1) && ec=0 || ec=$?
check "d107 : verify sans --de reste bloque en env agent" "reserve a l'humain" "$out"
check "d107 : le refus enseigne la forme relayee" '--de' "$out"
out=$(CLAUDE_PROJECT_DIR="$TMP31" python3 "$PT" verify b1 --de "tel 23/09 : carte 'b1 ton verdict ?' -> Valider" 2>&1)
check "d107 : verify --de atteste passe en env agent" "b1 valide" "$out"
check "d107 : le canal est journalise avec le verdict" '"canal": "tel 23/09' "$(cat "$TMP31/.plantrack/events.jsonl")"
CLAUDE_PROJECT_DIR="$TMP31" python3 "$PT" bug "le filtre perd la casse" >/dev/null
CLAUDE_PROJECT_DIR="$TMP31" python3 "$PT" attempt b2 "normalise en minuscules" >/dev/null
CLAUDE_PROJECT_DIR="$TMP31" python3 "$PT" bug b2 to_verify >/dev/null
out=$(CLAUDE_PROJECT_DIR="$TMP31" python3 "$PT" reject b2 --de "carnet web 23/09 : coche Refuser" -m "la casse revient sur les accents" 2>&1)
check "d107 : reject --de atteste rouvre le bug" "b2 rouvert avec motif" "$out"
out=$(CLAUDE_PROJECT_DIR="$TMP31" python3 "$PT" question "faut-il paginer la liste ?" 2>&1)
out=$(CLAUDE_PROJECT_DIR="$TMP31" python3 "$PT" answer q1 oui, par 20 --de "tel 23/09 : carte pagination -> oui par 20" 2>&1)
check "d107 : answer --de atteste enregistre la reponse" "q1 repondue" "$out"
out=$(CLAUDE_PROJECT_DIR="$TMP31" python3 "$PT" verify b1 --de 2>&1) && ec=0 || ec=$?
check "d107 : --de sans attestation refuse" "attend l'attestation" "$out"
out=$(CLAUDE_PROJECT_DIR="$TMP31" python3 "$PT" plan import /dev/null 2>&1) && ec=0 || ec=$?
check "d107 : les autres gestes humains restent verrouilles" "reserve a l'humain" "$out"
# b12 : la fiche complete n'a AUCUN plafond de nombre — un 9e/10e bug reste visible
for i in $(seq 1 10); do CLAUDE_PROJECT_DIR="$TMP31" python3 "$PT" bug "defaut numero special$i" >/dev/null; done
out=$(CLAUDE_PROJECT_DIR="$TMP31" python3 "$PT" status)
check "b12 : le 1er des 10 bugs reste dans la fiche" "special1" "$out"
check "b12 : le 10e aussi" "special10" "$out"
rm -rf "$TMP31"

# b14 : un commit fait dans une copie git worktree arrive dans le carnet du depot principal
W=$(mktemp -d); git -C "$W" init -q m && cd "$W/m" && git commit -q --allow-empty -m init
mkdir .plantrack && : > .plantrack/events.jsonl && git worktree add -q "$W/copie" 2>/dev/null; cd - >/dev/null
CLAUDE_PROJECT_DIR="$W/copie" python3 "$PT" decide "prise dans la copie" >/dev/null 2>&1
check "b14 : decision d'une copie dans le carnet principal" "prise dans la copie" "$(cat "$W/m/.plantrack/events.jsonl")"
rm -rf "$W"

# Ronde automatique (09/10) : seule une panne hors reference et pas deja signalee part
R=$(mktemp -d)
printf '!!  /x/a — 1 probleme(s)\n      !!  questions sans reponse (2) — q1\n!!  /x/b — 1 probleme(s)\n      !!  garde-fou git pre-commit — lance init\n' > "$R/doc"
printf '!!  * — questions sans reponse : produit (d11)\n' > "$R/ref"
r() { RONDE_REPOS=${RONDE_REPOS:-/dev/null} RONDE_DOCTOR=${RONDE_DOCTOR:-"cat $R/doc"} RONDE_REF="$R/ref" RONDE_ETAT="$R/etat" RONDE_ENVOI=echo bash "$(dirname "$0")/../ronde.sh"; }
out=$(r); check "ronde : panne nouvelle signalee" "/x/b — garde-fou git pre-commit" "$out"
check_not "ronde : panne de la reference muette" "questions sans reponse" "$out"
out=$(r); check_not "ronde : une seule alerte par panne" "garde-fou" "$out"

# Rattrapage du coeur par la ronde (10/10) : depot en retard mis a jour et commite seul,
# sans embarquer le travail en cours ; depot ou un processus travaille : pas touche
D="$R/depot"; git init -q "$D" && CLAUDE_PROJECT_DIR="$D" python3 "$PT" init >/dev/null 2>&1
git -C "$D" add -A && git -C "$D" commit -qm init
echo "# ancienne version" >> "$D/.claude/hooks/pt.py" && git -C "$D" commit -qam vieux
echo travail > "$D/en-cours.txt"; echo "$D" > "$R/repos"
(cd "$D" && exec sleep 30) & occ=$!; sleep 0.3
RONDE_REPOS="$R/repos" RONDE_DOCTOR=true r >/dev/null; kill $occ
check_not "ronde : depot occupe pas touche" "OK" "$(cmp -s "$D/.claude/hooks/pt.py" "$PT" && echo OK)"
RONDE_REPOS="$R/repos" RONDE_DOCTOR=true r >/dev/null
check "ronde : coeur rattrape" "OK" "$(cmp -s "$D/.claude/hooks/pt.py" "$PT" && echo OK)"
check "ronde : commit du rattrapage" "par la ronde" "$(git -C "$D" log -1 --format=%s)"
check "ronde : travail en cours non embarque" "?? en-cours.txt" "$(git -C "$D" status --porcelain)"
rm -rf "$R"

# pg3 (10/10) : le journal n'est analyse qu'une fois par processus, la queue ajoutee
# ensuite (meme processus ou un autre) est bien vue
out=$(python3 - "$PT" <<'EOF'
import json, sys, importlib.util as u
s = u.spec_from_file_location("pt", sys.argv[1]); m = u.module_from_spec(s); sys.argv = ["x"]; s.loader.exec_module(m)
n = [0]; vrai = json.loads
def compte(x): n[0] += 1; return vrai(x)
m.json.loads = compte
lignes = len(m.read_events()) and sum(1 for l in open(m.LOG) if l.strip())
n[0] = 0; m._LUS[:] = [0, []]
m.project(); m.next_id("t"); m.project()
print("analyses", n[0] == lignes)
with open(m.LOG, "a") as f: f.write(json.dumps({"ts": m.now(), "kind": "note", "id": "n999", "text": "queue"}) + "\n")
print("queue", any(e.get("id") == "n999" for e in m.read_events()), n[0] == lignes + 1)
EOF
)
check "carnet : une seule analyse du journal par processus" "analyses True" "$out"
check "carnet : la queue ajoutee est relue seule" "queue True True" "$out"

echo
[ "$fail" = 0 ] && echo "TOUS LES TESTS PASSENT" || { echo "DES TESTS ECHOUENT"; exit 1; }
