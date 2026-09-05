---
name: plantrack
description: État persistant du projet (fils de travail, décisions actées, bugs) — consignes à lire avant toute tâche.
---

**Important : lis le bloc « PlanTrack » du fichier `AGENTS.md` à la racine du projet et applique ses consignes.** C'est la source unique des règles PlanTrack.

Particularité ici (pas de hooks, donc pas d'injection automatique) : lance `./plantrack status` en début de tâche pour lire l'état persistant, et refais-le après toute compaction du contexte.
