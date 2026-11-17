#!/usr/bin/env bash
# Gardien du chef d'orchestre (d266) : seul rescape de vps-charge-alerte.sh.
# Une bulle si l'orchestre est arrete ou muet depuis GARDIEN_MUET_S, au plus une fois par 6 h.
set -uo pipefail
[ -r /etc/plantrack/capacite.conf ] && . /etc/plantrack/capacite.conf
MUET=${GARDIEN_MUET_S:-600}
ETAT=/var/lib/plantrack-orchestre/etat.json
TEMOIN=/run/plantrack-gardien.stamp
maintenant=$(date +%s)
ts=$(python3 -c 'import json,sys;print(int(float(json.load(open(sys.argv[1])).get("ts",0))))' "$ETAT" 2>/dev/null || echo 0)
actif=$(systemctl is-active plantrack-orchestre.service 2>/dev/null || true)
if [ "$actif" = active ] && [ $(( maintenant - ts )) -lt "$MUET" ]; then
	rm -f "$TEMOIN"; exit 0
fi
[ -e "$TEMOIN" ] && [ $(( maintenant - $(stat -c %Y "$TEMOIN") )) -lt 21600 ] && exit 0
touch "$TEMOIN"
texte="Le chef d'orchestre du serveur ne répond plus (service : ${actif:-inconnu}, dernière mesure il y a $(( (maintenant - ts) / 60 )) min). Plus rien ne retient les tâches lourdes tant qu'il est arrêté."
cd /home/mariella/plantrack && env -u CLAUDE_CODE_SESSION_ID \
	node /home/mariella/bcc/hook/repondre.ts --ton probleme "$texte" || true
