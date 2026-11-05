# À faire en session administrateur (root) — guide qui s'envoie tout seul (05/11, d179)

La session du téléphone (compte bccsession) n'a ni droit root, ni accès GitHub, ni accès aux
ports locaux des sites. Ces gestes restent donc à faire, dans l'ordre :

1. **Pousser sur GitHub** v1.9.36 et v1.9.37 (q18) :
   `cd /home/mariella/plantrack && git push origin main v1.9.36 v1.9.37`
2. **Tests du moteur** (ils ne passent pas sous bccsession, pg30) :
   `node --experimental-strip-types --import ./tests/guide/support/register.mjs tests/guide/avertir.test.ts`
   → attendu : tous `ok`, dont « bouton Réessayer » et « poste éteint au bilan ».
3. **S69 Soirées** (fichiers à root, lecture seule pour bccsession) :
   `cd /home/mariella/Clients/s69-soirees && /home/mariella/plantrack/plantrack update` puis
   commit des fichiers `lib/guide/` et `components/guide/` seulement.
4. **Reconstruire et relancer les sites en `next start`** (le nouveau moteur n'y est pas encore servi) :
   ProJob (`projob-web`), OpenStyle (`openstyle-next`), Mizzzen (`mizzzen-web`) — build du site puis
   `systemctl restart <service>`. ProLearn, MiamBoost et S69 sont en `next dev` : rien à faire.
5. **Relais mdjlabs** (choix de Mariella « Le relais ») :
   ```
   cp /home/mariella/plantrack/deploiement/plantrack-guide-relais.{service,timer} /etc/systemd/system/
   systemctl daemon-reload
   /usr/bin/python3 /home/mariella/plantrack/deploiement/guide-relais-mdjlabs.py   # premier passage : pose le repère
   systemctl enable --now plantrack-guide-relais.timer
   ```
   Contrôle : vérifier que `/home/mariella/mdjlabs-site` est un projet inscrit au poste, sinon `/guide/point`
   répond 404 et le journal du service le dira (`journalctl -u plantrack-guide-relais`).
6. **Essai de bout en bout** : jouer un guide jusqu'au bout sur ProLearn (https://prolearn-dev.mdjlabs.com)
   → la carte de fin doit afficher « ✓ Envoyé à ta session » et le fil ProLearn doit recevoir
   « Retour du guide de test ».
