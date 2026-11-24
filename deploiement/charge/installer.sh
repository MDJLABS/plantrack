#!/usr/bin/env bash
# Installe l'etape 1 de la piste A (d266). A lancer en root. Retour arriere :
# mettre les interrupteurs a 0 dans /etc/plantrack/capacite.conf, ou restaurer
# backup/code/2026-11-17-charge/.
set -euo pipefail
ICI=$(cd "$(dirname "$0")" && pwd)
install -d /etc/plantrack /etc/systemd/system/plantrack-orchestre.service.d
[ -e /etc/plantrack/capacite.conf ] || install -m 644 "$ICI/capacite.conf" /etc/plantrack/capacite.conf
install -m 644 "$ICI/orchestre.d/capacite.conf" /etc/systemd/system/plantrack-orchestre.service.d/capacite.conf
install -m 755 "$ICI/plantrack-gardien.sh" /usr/local/bin/plantrack-gardien.sh
install -m 644 "$ICI/plantrack-gardien.service" "$ICI/plantrack-gardien.timer" /etc/systemd/system/
install -m 755 "$ICI/kvm-lourd" /usr/local/bin/kvm-lourd
install -m 755 "$ICI/menage-serveur.sh" /usr/local/bin/menage-serveur.sh
install -m 755 "$ICI/supa-start" /usr/local/bin/supa-start
# outil navigateur installe une fois (d299) : les sessions bcc lancent cli.js
# directement, sans l'enveloppe "npm exec" qui restait en memoire (~110 Mo chacune).
# Meme version que OUTILS_FIGES.playwright de bcc (server/tour.ts).
npm install --prefix /opt/playwright-mcp @playwright/mcp@0.0.83
systemctl daemon-reload
# une seule voix : l'ancienne alerte de charge se tait, le gardien prend le relais
systemctl disable --now vps-charge-alerte.timer 2>/dev/null || true
systemctl enable --now plantrack-gardien.timer
systemctl restart plantrack-orchestre.service
systemctl restart earlyoom.service
echo "etape 1 installee"
