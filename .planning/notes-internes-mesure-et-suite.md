# Notes internes (retirées du README public le 2026-08-29)

Ces deux sections parlaient à Mariella, pas aux visiteurs — déplacées ici
lors de la refonte « présentation publique » du README.

## Mesure à tenir pendant deux semaines

Une seule ligne dans un fichier à part, à chaque fois que ça arrive :

- nombre de fois où tu as dû répéter une consigne déjà donnée ;
- nombre de bugs signalés deux fois ;
- nombre de reprises de fil où la note de reprise a suffi.

Sans ces trois chiffres, tu ne sauras pas dans six semaines si l'outil sert,
et tu risques de le maintenir par principe. C'est aussi le seul argument
crédible le jour où tu publies.

## La suite

Le PRD fait foi : voir `PRD-PlanTrack-v0.2.md` (jalons §16). Livré : couches
1 à 4 (capture, plan phases/tâches, bugs/tentatives, pre-commit) +
`init`/`doctor`/`stats` + le portage Codex (§13 — testé sur le contrat
documenté ; PlanTrack n'installe jamais d'agent, la validation en conditions
réelles appartient à qui installe Codex). Reste : la fin du jalon Publication
(démo) — uniquement si les chiffres de `plantrack stats` la justifient. La
greffe sur Beads a été écartée par décision de conception (PRD §6 : un
stockage binaire interdit le diff et le merge git) — au mieux un pont
d'export en extension. MCP en option, jamais en socle.
