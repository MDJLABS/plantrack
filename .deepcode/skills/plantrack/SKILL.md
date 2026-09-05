---
name: plantrack
description: État persistant du projet (fils de travail, décisions actées, bugs) — consignes à lire avant toute tâche.
---

**Important : lis le bloc « PlanTrack » du fichier `AGENTS.md` à la racine du projet et applique ses consignes.** C'est la source unique des règles PlanTrack.

Particularité ici (pas de hooks, donc pas d'injection automatique) : l'état persistant du projet est écrit **dans `AGENTS.md` même**, entre les marqueurs `plantrack:state` — il est rafraîchi à chaque commit, quel que soit l'agent. Lis-le. Pour la version à la seconde près (ou après une compaction du contexte), lance `./plantrack status`.
