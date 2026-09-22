# Note pour la session PlanTrack — un « parcours » avec des règles de phase

Rédigée le 13/09/2026 par la session bcc, à la demande de Mariella, pour être
proposée telle quelle à la session Claude Code de PlanTrack.

## 1. D'où vient la demande

Better Call Code (bcc) fait travailler un agent Claude Code dans un atelier
isolé, pour un client non technicien qui n'a qu'un téléphone. Le client ne voit
pas le code : il reçoit des cartes (questions à choix) et des bulles de chat.

Trois confusions se répètent, mesurées dans le code de bcc le 13/09/2026 :

- **L'agent demande au lieu de proposer.** La consigne d'atelier lui dit de
  poser les choix par question. Un client qui dit « je veux une application »
  reçoit une question, pas une proposition. Il faudrait l'inverse : deux ou
  trois pistes concrètes d'abord, la question ensuite.
- **Un brainstorming multi-agents ne s'enchaîne pas.** Chaque agent qui a
  besoin d'un arbitrage pose une carte. Un tour de table à cinq voix produit
  cinq cartes, ou s'arrête au premier arbitrage. Il n'existe aucune notion de
  « round » : quand la salle parle entre elle, quand elle consulte l'humain.
- **Personne ne sait où en est le projet.** La base de bcc trace les appels et
  les tours de parole, pas l'avancement. La seule trace de phase est
  PlanTrack, que l'application affiche déjà (écran de complétude).

n8n a été évalué en réunion le 13/09 et écarté : il ajouterait une quatrième
horloge (l'app, le prompt vocal, PlanTrack, n8n) sans donner de règle à l'agent.
La bonne brique est PlanTrack, parce qu'il est déjà dans l'atelier, déjà injecté
dans le contexte de l'agent, déjà lu par l'application.

## 2. Ce que PlanTrack sait déjà faire (mesuré, `pt.py` vendoré)

- Journal `events.jsonl` append-only, état reconstruit par rejeu.
- `phase add|start|done|cancel`, `task add|start|verify|done|cancel|replace`.
- Fils (`!focus`, `!park`, `!close`), bugs avec tentatives, décisions, pièges,
  questions en attente, guides de test (`guide`/`step`/`check`, verdict humain).
- Injection d'un bloc d'état au démarrage et après chaque compaction.
- `doctor` : signale les défauts (bugs sans verdict, état amputé).

Il manque une seule chose : **une phase ne porte pas de règle**. PlanTrack sait
dire « phase 2 en cours », pas « en phase 2 tu dois livrer deux pistes avant
toute question ».

## 3. La proposition : un parcours

Un **parcours** est une suite ordonnée de phases, déclarée une fois, où chaque
phase porte :

| Champ | Rôle | Exemple (parcours « projet client ») |
|---|---|---|
| `nom` | identifiant lisible | `proposer` |
| `regle` | une phrase injectée dans le contexte de l'agent | « Livre 2 ou 3 pistes concrètes avec une recommandation. Aucune question avant. » |
| `livrable` | ce qui doit exister pour sortir de la phase | « une carte avec 2-3 options et une reco » |
| `porte` | qui autorise la sortie : `agent` ou `humain` | `humain` |

Le parcours « projet client » que bcc utiliserait, générique à toutes les
familles de projet (flyer, site, application, document…) :

1. **comprendre** — règle : « Au plus trois questions, en une seule carte. »
   porte : agent.
2. **proposer** — règle : « Deux ou trois pistes concrètes, chacune avec un
   exemple visible, et ta recommandation en premier. Aucune question avant
   d'avoir livré les pistes. » porte : humain (le client choisit).
3. **cadrer** — règle : « Une page : ce qu'on fait, ce qu'on ne fait pas, ce
   que le client verra à la fin. » porte : humain (le client valide).
4. **construire** — règle : « Ne pose une question que si tu es bloqué. Le
   reste, tu décides et tu le notes en décision. » porte : agent.
5. **livrer** — règle : « Montre le résultat dans `sortie/`, demande le
   verdict. » porte : humain.

Ce qui varie par famille de projet n'est pas le parcours mais le contenu de la
phase **proposer** ; bcc le fournit lui-même dans le CLAUDE.md de la famille
(trois maquettes pour un flyer, deux outils existants ou du code pour une
application, un plan pour un document). PlanTrack n'a pas à connaître les
familles.

## 4. Ce que PlanTrack ferait concrètement

1. **Déclarer** : `plantrack parcours import <fichier.json>` (ou YAML), qui
   émet un événement `parcours_defini` avec la liste des phases et leurs
   règles. Une commande agent `!parcours <nom>` pour démarrer un parcours
   déclaré.
2. **Avancer** : `!phase next` clôt la phase courante et ouvre la suivante.
   Si la porte est `humain`, PlanTrack refuse tant qu'une `question` posée
   dans cette phase n'a pas reçu de `answer` (il sait déjà faire les deux).
3. **Injecter** : le bloc d'état gagne trois lignes en tête :
   ```
   PARCOURS projet-client — phase 2/5 : proposer
     règle : Deux ou trois pistes concrètes… Aucune question avant.
     sortie : porte humaine (le client choisit)
   ```
4. **Garder** : `doctor` signale « question posée hors porte » (une `question`
   émise dans une phase dont la règle interdit les questions) et « phase sans
   livrable depuis N heures ». Pas de blocage dur : un avertissement, comme
   pour les bugs sans verdict.
5. **Exposer** : la phase courante et sa règle dans la sortie JSON que bcc lit
   déjà pour `/completude`, afin que l'application montre au client « votre
   agent vous prépare des propositions » plutôt qu'un fil vide.

## 5. Ce qui n'est PAS demandé

- Pas de moteur de workflow, pas d'exécution automatique de quoi que ce soit.
- Pas de branchement conditionnel entre phases : une suite linéaire suffit.
- Pas de « tour de table » modélisé dans PlanTrack. Le protocole de tour de
  table (la salle délibère en interne, une seule carte par round) vit dans une
  skill côté bcc ; PlanTrack ne voit que la carte finale, comme une `question`.
- Pas de dépendance nouvelle : stdlib Python, comme aujourd'hui.

## 6. Exemple de bout en bout

Client : « Je veux une carte de visite. »

- Phase 1 *comprendre* : une carte, trois questions (nom, activité, ton).
- Phase 2 *proposer* : l'agent produit trois maquettes dans `sortie/`, pose
  une carte « laquelle ? » avec sa recommandation. PlanTrack voit une
  `question` en phase à porte humaine ; `!phase next` passe quand le client a
  répondu.
- Phase 3 *cadrer* : une page « recto, verso, formats fournis ». Carte de
  validation.
- Phase 4 *construire* : aucune carte sauf blocage ; décisions notées.
- Phase 5 *livrer* : PDF dans `sortie/`, carte « verdict ? ».

Si l'agent pose une question en phase 4 sans être bloqué, `doctor` le dit à
Mariella ; elle décide si la règle doit changer.

## 7. Comment bcc s'y branche (côté bcc, pas PlanTrack)

- `server/familles.ts` : le tronc commun du CLAUDE.md décrit le parcours en
  cinq phases et la règle « jamais une question sans une proposition dessous » ;
  chaque famille garde cinq lignes sur ce qu'elle propose en phase 2.
- `server/atelier.ts` (`CONSIGNE_ATELIER`) : la règle « poser le choix par
  question » devient « poser le choix par question **après** avoir livré les
  pistes ».
- Une skill « tour de table » posée dans l'atelier : rounds internes, une carte
  par round, reco en premier.
- `server/plantrack.ts` / écran de complétude : afficher la phase courante.
