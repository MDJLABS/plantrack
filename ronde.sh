#!/usr/bin/env bash
# Ronde automatique (choix de Mariella, 09/10) : doctor --all toutes les 4 h par un
# minuteur systeme, sans agent. E-mail UNIQUEMENT pour une panne absente de
# .planning/ronde-reference.txt et pas encore signalee. Sinon : silence.
set -euo pipefail
ICI=$(cd "$(dirname "$0")" && pwd)
DOCTOR=${RONDE_DOCTOR:-"$ICI/plantrack doctor --all"}
REF=${RONDE_REF:-"$ICI/.planning/ronde-reference.txt"}
ETAT=${RONDE_ETAT:-/var/lib/plantrack-ronde/deja-signale}
ENVOI=${RONDE_ENVOI:-courriel}   # RONDE_ENVOI=echo pour essayer sans envoyer
REPOS=${RONDE_REPOS:-~/.plantrack-repos}   # ~ : HOME est absent sous systemd
COEUR="$ICI/.claude/hooks/pt.py"

# Rattrapage du coeur (choix de Mariella, 10/10) : un depot en retard passe par `update`
# seulement si aucun processus n'y travaille (pg7), et le commit ne prend que les
# fichiers que l'update a touches — jamais le travail en cours de quelqu'un d'autre.
occupe() { for c in /proc/[0-9]*/cwd; do case "$(readlink "$c" 2>/dev/null)/" in "$1"/*) return 0;; esac; done; return 1; }
sales() { git -C "$1" status --porcelain | cut -c4- | sort; }
while read -r d; do
  [ "$d" != "$ICI" ] && [ -f "$d/.claude/hooks/pt.py" ] || continue
  cmp -s "$d/.claude/hooks/pt.py" "$COEUR" && continue
  occupe "$d" && continue
  avant=$(sales "$d")
  grep -qx '.claude/hooks/pt.py' <<<"$avant" && continue
  CLAUDE_PROJECT_DIR="$d" python3 "$COEUR" update >/dev/null 2>&1 || continue
  mapfile -t f < <(comm -13 <(printf '%s\n' "$avant") <(sales "$d") | sed '/^$/d')
  git -C "$d" add -- "${f[@]}" && git -C "$d" commit -q -m "chore(plantrack): coeur mis a jour par la ronde" -- "${f[@]}" ||
    { git -C "$d" reset -q -- "${f[@]}"; echo "ronde : commit refuse dans $d (coeur mis a jour, non commite)" >&2; }
done < <(cat "$REPOS" 2>/dev/null)

# "depot — nom du controle" : le nom s'arrete au premier " (" ou " — "
cle='function nom(s){ sub(/ \(.*/,"",s); sub(/ — .*/,"",s); return s }'
# separe "depot — reste" sans compter les octets du tiret long (mawk/gawk divergent)
cle='function nom(s){ sub(/ \(.*/,"",s); sub(/ — .*/,"",s); sub(/ :.*/,"",s); return s }
     function depot(s){ sub(/ — .*/,"",s); return s }
     function reste(s){ if(!sub(/^[^—]* — /,"",s)) s=""; return s }'
connues=$(awk "$cle"' /^!!  /{ s=substr($0,5); r=reste(s); if(r!="") print depot(s) " — " nom(r) }' "$REF")
pannes=$($DOCTOR 2>&1 | awk "$cle"'
  /^!!  /{ s=substr($0,5); d=depot(s); r=reste(s); if(r!~/probleme\(s\)$/) print d " — " nom(r); next }
  /^      !!  /{ print d " — " nom(substr($0,11)) }' | sort -u) || true

mkdir -p "$(dirname "$ETAT")"; touch "$ETAT"
actives=$(printf '%s\n' "$pannes" | awk -v k="$connues" 'BEGIN{ n=split(k,a,"\n"); for(i=1;i<=n;i++) c[a[i]] }
  NF && !($0 in c) && !(("* — " substr($0, index($0," — ")+length(" — "))) in c)' | sort -u)
nouvelles=$(comm -23 <(printf '%s\n' "$actives" | sed '/^$/d') <(sort -u "$ETAT"))

courriel() {
  . /root/.config/mdj/resend.env   # sans export : la cle ne passe pas dans l'environnement des enfants
  jq -n --arg t "$1" '{from:"PlanTrack <alerte@mdjlabs.com>", to:["slimanemedjahdi@gmail.com"],
    subject:"PlanTrack : panne detectee par la ronde", text:$t}' |
  curl -sS -X POST https://api.resend.com/emails -H @<(printf 'Authorization: Bearer %s\n' "$RESEND_API_KEY") \
    -H "Content-Type: application/json" -d @- | grep -q '"id"'
}
[ -z "$nouvelles" ] || $ENVOI "La ronde PlanTrack a trouve une panne nouvelle :

$nouvelles

Ouvre le fil PlanTrack dans Better Call Code pour qu'on regarde."
printf '%s\n' "$actives" | sed '/^$/d' > "$ETAT"
