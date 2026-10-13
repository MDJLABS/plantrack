#!/usr/bin/env bash
# Releve de sante quotidien (choix de Mariella, 13/10 — d57) : 4 semaines de surveillance,
# une bulle seulement sur panne NEUVE (d23). Passee la date de fin : le rapport final,
# puis le minuteur s'arrete seul.
set -euo pipefail
ICI=$(cd "$(dirname "$0")" && pwd)
RELEVE=${RELEVE_CMD:-"$ICI/plantrack releve"}
FIN=${RELEVE_FIN:-2026-11-10}
ENVOI=${RELEVE_ENVOI:-bulle}   # RELEVE_ENVOI=echo pour essayer sans envoyer
ARRET=${RELEVE_ARRET:-"systemctl disable --now plantrack-releve.timer"}

bulle() { cd "$ICI" && env -u CLAUDE_CODE_SESSION_ID node /home/mariella/bcc/hook/repondre.ts "$@"; }

texte=$($RELEVE)
if [ "$(date +%F)" \< "$FIN" ]; then
  [ -z "$texte" ] || "$ENVOI" "$texte" --ton probleme
else
  "$ENVOI" "$($RELEVE --rapport)" --ton info
  $ARRET
fi
exit 0
