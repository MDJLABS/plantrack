#!/usr/bin/env bash
# Tests couche 1 — simule les hooks en injectant du JSON sur stdin (PRD §14).
# Usage : bash tests/scenario.sh
set -u

PT="$(cd "$(dirname "$0")/.." && pwd)/.claude/hooks/pt.py"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
export CLAUDE_PROJECT_DIR="$TMP"
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

prompt() { printf '{"prompt":"%s"}' "$1" | python3 "$PT" hook-prompt 2>&1; }
ctx() { printf '{"source":"%s"}' "$1" | python3 "$PT" hook-context 2>&1; }

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

# 7. O6 : l'humain, lui, valide et rejette
out=$(env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT python3 "$PT" verify b1 2>&1)
check "verify humain passe" "valide" "$out"
out=$(env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT python3 "$PT" reject b1 -m "pas la cause" 2>&1)
check "reject humain avec motif passe" "rouvert avec motif" "$out"

# 8. une ligne corrompue dans events.jsonl ne casse ni la projection ni la session
echo '{"kind": PAS DU JSON' >> "$TMP/.plantrack/events.jsonl"
out=$(ctx startup); rc=$?
check_exit "ligne corrompue : hook-context sort en 0" 0 "$rc"
check "ligne corrompue : l etat survit" "t1" "$out"

# 9. le bloc reinjecte reste sous le plafond de 3000 caracteres
for i in $(seq 1 30); do
  printf '{"prompt":"!decide decision numero %s — motif tres long %s"}' "$i" \
    "$(printf 'x%.0s' $(seq 1 120))" | python3 "$PT" hook-prompt >/dev/null 2>&1
done
n=$(ctx compact | wc -c)
if [ "$n" -le 3100 ]; then echo "ok   - bloc reinjecte sous le plafond ($n chars)"
else echo "FAIL - bloc reinjecte a $n chars (> 3000 + marge troncature)"; fail=1; fi

echo
[ "$fail" = 0 ] && echo "TOUS LES TESTS PASSENT" || { echo "DES TESTS ECHOUENT"; exit 1; }
