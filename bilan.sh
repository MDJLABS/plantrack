#!/usr/bin/env bash
# Bilan de la semaine (choix de Mariella, 11/10 — d37) : un message par semaine dans le
# fil PlanTrack, par un minuteur systeme, sans agent. Rien a dire -> rien n'est envoye.
set -euo pipefail
ICI=$(cd "$(dirname "$0")" && pwd)
BILAN=${BILAN_CMD:-"$ICI/plantrack bilan --all"}
ENVOI=${BILAN_ENVOI:-bulle}   # BILAN_ENVOI=echo pour essayer sans envoyer

# repondre.ts designe le fil par le dossier courant (pas de session sous systemd) : PlanTrack
bulle() { cd "$ICI" && env -u CLAUDE_CODE_SESSION_ID node /home/mariella/bcc/hook/repondre.ts "$1"; }

texte=$($BILAN)
[ -n "$texte" ] && "$ENVOI" "$texte"
exit 0
