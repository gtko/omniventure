# Outillage des agents — inventaire pour tenir une boîte tech entière

Ce document répond à une question simple : **de quoi une agence d'agents a-t-elle
besoin pour faire tourner une entreprise technologique de bout en bout ?**

Il sert de carte : ce qui existe, ce qui manque, où chaque chose s'exécute, et
dans quel ordre les construire.

---

## 1. Le principe : deux mondes, trois niveaux

### Deux mondes d'exécution

Un Worker Cloudflare n'a **ni disque, ni processus, ni navigateur**. Ce n'est pas
une limite passagère, c'est le modèle d'exécution. Tout outil appartient donc à
l'un de ces deux mondes :

| | Où | Ce qu'il peut faire | Ce qu'il ne peut pas |
|---|---|---|---|
| **Edge** | dans le Worker | HTTP sortant, D1, KV, R2, files d'attente, cron, secrets | lire un fichier local, lancer une commande, ouvrir un navigateur |
| **Hôte** | machine locale (pont) ou conteneur cloud | fichiers, git, commandes, navigateur, compilation, tests | rien de bloquant, mais il faut un hôte allumé |

**Conséquence pratique :** tout ce qui ressemble à « coder », « tester »,
« naviguer » exige un hôte. Aujourd'hui c'est votre machine (`node runner/server.mjs`).
Demain, ce peut être un conteneur cloud (§ 12).

### Trois niveaux d'autonomie

Le niveau est décidé **à chaque exécution**, jamais accordé en permanence, et
vérifié côté serveur — pas côté client.

| Niveau | L'agent peut | Exemples d'outils |
|---|---|---|
| `read` | lire et rapporter | `fs_read`, `fs_search`, `browser_read`, `git status` |
| `write` | modifier les fichiers du projet | `fs_write` |
| `full` | exécuter des commandes | `shell`, `gh`, `git commit` |

---

## 2. État actuel — ce qui existe déjà

| Outil | Monde | Statut |
|---|---|---|
| `fs_list`, `fs_read`, `fs_search` | hôte | ✅ |
| `fs_write` | hôte | ✅ |
| `git` (lecture) / `git` (écriture) | hôte | ✅ / ✅ en `full` |
| `gh` (GitHub CLI) | hôte | ✅ en `full` |
| `shell` (liste blanche de binaires) | hôte | ✅ en `full` |
| `browser_read` (page rendue, JS exécuté) | hôte | ✅ |
| `browser_screenshot` | hôte | ✅ |
| `http_fetch` (sans navigateur) | hôte | ✅ |
| `api_call` (avec secrets du coffre) | **Edge** | ✅ |
| Harnais de codage (Claude Code, Codex, opencode, Gemini, Antigravity) | hôte | ✅ |
| Coffre-fort chiffré + substitution `{{secret:NOM}}` | Edge | ✅ |
| Lecture réelle des sites concurrents | Edge | ✅ |
| Génération d'images (R2) | Edge | ✅ |
| Design system : tokens + composants | Edge | ✅ |
| Suivi de tâches, discussions, documentation | client | ✅ |
| Recrutement d'agents (DRH) | Edge | ✅ |

---

## 3. Exécution & code

| Outil | À quoi il sert | Monde | Statut |
|---|---|---|---|
| Lecture / écriture de fichiers | modifier le produit | hôte | ✅ |
| Recherche dans le dépôt | se repérer avant d'agir | hôte | ✅ |
| Shell encadré | installer, compiler, lancer | hôte | ✅ |
| **Conteneur de développement cloud** | coder sans machine allumée | hôte cloud | ❌ § 12 |
| Compilation & vérification de types | ne pas livrer du code cassé | hôte | ⚠️ via `shell` |
| Tests unitaires / e2e | prouver que ça marche | hôte | ⚠️ via `shell` |
| Lint & format | cohérence du code | hôte | ⚠️ via `shell` |
| Git : branche, commit, diff, merge | traçabilité des changements | hôte | ✅ |
| **Revue de code automatisée** | second regard avant fusion | hôte | ❌ |
| GitHub : PR, issues, releases | collaborer, publier | hôte | ✅ via `gh` |
| **CI/CD** (déclencher, lire un échec) | ne pas déployer à l'aveugle | Edge | ❌ |
| **Migrations de base** | faire évoluer le schéma sans casser | Edge | ❌ |
| **Feature flags** | livrer sans exposer | Edge | ❌ |
| **Registre d'artefacts** | versionner les livrables | Edge | ❌ |

> Les ⚠️ passent aujourd'hui par `shell`. Les transformer en outils dédiés leur
> donnerait un résultat structuré (nombre d'erreurs, fichiers en cause) au lieu
> d'un flot de texte à relire.

## 4. Navigation & recherche

| Outil | À quoi il sert | Monde | Statut |
|---|---|---|---|
| Requête HTTP | lire une API, un flux | les deux | ✅ |
| Navigateur : lire une page rendue | ce que voit un humain | hôte | ✅ |
| Navigateur : capture d'écran | preuve visuelle, revue de design | hôte | ✅ |
| **Navigateur : interagir** (cliquer, saisir, se connecter) | tester un tunnel, un formulaire | hôte | ❌ demande CDP |
| **Recherche web** | trouver ce qu'on ne sait pas déjà | Edge | ❌ |
| **Lecture de PDF / documents** | contrats, études, factures | Edge | ❌ |
| Extraction structurée d'un site | tarifs, fonctionnalités | Edge | ✅ |
| **Veille (RSS, alertes, changements)** | savoir quand un concurrent bouge | Edge | ❌ |

## 5. Infrastructure & exploitation

| Outil | À quoi il sert | Monde | Statut |
|---|---|---|---|
| Déploiement (Workers / Pages) | mettre en ligne | hôte | ⚠️ via `shell wrangler` |
| **Rollback** | revenir en arrière vite | Edge | ❌ |
| **DNS & domaines** | acheter, pointer, vérifier | Edge | ❌ |
| **Certificats** | HTTPS partout | Edge | ❌ |
| Stockage objet (R2) | images, exports, sauvegardes | Edge | ✅ |
| Base de données (D1) | données du produit | Edge | ✅ |
| Cache / KV | états courts, compteurs | Edge | ✅ |
| **Files d'attente & tâches planifiées** | travail asynchrone, cron | Edge | ⚠️ configuré, non outillé |
| **Journaux & traces** | comprendre un incident | Edge | ❌ |
| **Métriques & alertes** | être prévenu avant le client | Edge | ❌ |
| **Page de statut publique** | dire la vérité pendant une panne | Edge | ❌ |
| **Sauvegarde & restauration** | survivre à une erreur | Edge | ❌ |

## 6. Produit & design

| Outil | À quoi il sert | Monde | Statut |
|---|---|---|---|
| Génération d'images | logo, illustrations, maquettes | Edge | ✅ |
| Tokens de design | une seule source de vérité visuelle | Edge | ✅ |
| Composants (HTML → stack cible) | ne pas refaire le design à chaque fois | Edge | ✅ |
| Aperçu isolé des composants | valider avant intégration | client | ✅ |
| **Test d'accessibilité** | ne pas exclure des clients | hôte | ❌ |
| **Non-régression visuelle** | voir ce qui a bougé | hôte | ❌ demande capture + comparaison |
| **Prototype cliquable** | valider un parcours avant de coder | client | ❌ |

## 7. Croissance & acquisition

| Outil | À quoi il sert | Monde | Statut |
|---|---|---|---|
| Analyse concurrentielle | savoir où se placer | Edge | ✅ |
| **Recherche de mots-clés & volumes** | viser ce qui est cherché | Edge | ❌ |
| **Audit SEO technique** | être indexable | hôte | ❌ |
| **Publication de contenu** | occuper le terrain | Edge | ❌ |
| **Régie publicitaire** (Google, Meta, TikTok) | acheter du trafic | Edge | ❌ |
| **E-mail transactionnel** | activation, relance, reçu | Edge | ❌ |
| **E-mail marketing & séquences** | convertir dans la durée | Edge | ❌ |
| **Réseaux sociaux** | présence et distribution | Edge | ❌ |
| **Analytics produit** | savoir ce qui est utilisé | Edge | ❌ |
| **A/B testing** | trancher par la mesure | Edge | ⚠️ écran existant, non outillé |
| **Attribution** | savoir ce qui rapporte | Edge | ❌ |

## 8. Argent

| Outil | À quoi il sert | Monde | Statut |
|---|---|---|---|
| **Paiements (Stripe)** : produits, prix, abonnements | encaisser | Edge | ❌ clé au coffre, outil à écrire |
| **Webhooks de paiement** | réagir à un échec, une résiliation | Edge | ❌ |
| **Remboursements & litiges** | traiter proprement | Edge | ❌ |
| **Facturation & TVA** | être en règle | Edge | ❌ |
| **Comptabilité** | tenir les comptes | Edge | ❌ |
| **Tableau de bord MRR / churn** | piloter | Edge | ⚠️ affiché, non calculé sur données réelles |
| **Coût des modèles** | ne pas dépenser plus qu'on ne gagne | Edge | ✅ |
| **Prévision de trésorerie** | voir venir | Edge | ❌ |

## 9. Clients

| Outil | À quoi il sert | Monde | Statut |
|---|---|---|---|
| **Boîte de réception partagée** | répondre | Edge | ❌ |
| **Tickets** | ne rien perdre | Edge | ❌ |
| **Base de connaissance publique** | éviter la question | Edge | ⚠️ interne uniquement |
| **Chat en direct** | débloquer un achat | Edge | ❌ |
| **Enquêtes & NPS** | savoir ce qui déçoit | Edge | ❌ |

## 10. Juridique, conformité, sécurité

| Outil | À quoi il sert | Monde | Statut |
|---|---|---|---|
| **CGU / CGV / confidentialité** | exister légalement | Edge | ❌ |
| **RGPD : registre, export, suppression** | obligation, pas option | Edge | ❌ |
| **Bandeau cookies & consentement** | idem | client | ❌ |
| **Licences des dépendances** | ne pas voler | hôte | ❌ |
| **Scan de vulnérabilités** | ne pas héberger un trou | hôte | ❌ |
| **Détection de secrets dans le code** | ne pas publier ses clés | hôte | ❌ |
| Coffre-fort chiffré | centraliser les clés | Edge | ✅ |
| **Rotation des clés** | limiter la casse | Edge | ⚠️ rappel seulement |
| **Journal d'audit** | savoir qui a fait quoi | Edge | ⚠️ partiel |

## 11. Organisation interne

| Outil | À quoi il sert | Monde | Statut |
|---|---|---|---|
| Suivi de tâches | savoir qui fait quoi | client | ✅ |
| Discussions entre agents | coordination | client | ✅ |
| Documentation + relecture | réduire le bus factor | Edge | ✅ |
| Recrutement d'agents | faire grandir l'organigramme | Edge | ✅ |
| Culture d'agence injectée à chaque appel | cohérence de tous | Edge | ✅ |
| **Budget de jetons par agent** | plafonner la dépense | Edge | ❌ |
| **Décisions d'architecture (ADR)** | garder la trace des choix | client | ❌ |
| **Calendrier & rituels** | rythme de l'agence | client | ⚠️ rituels simulés |

---

## 12. Conteneurs cloud — coder sans machine locale

**Fait.** Wrangler est passé en 4.59.2 et le bac à sable est configuré.

### Ce qui a été mis en place

| Élément | Où |
|---|---|
| `@cloudflare/sandbox` 0.12.7 | dépendance du projet |
| Classe `Sandbox` exportée | `worker/index.ts` |
| Liaison `SANDBOX` + migration `v2` | `wrangler.jsonc` |
| Image du conteneur | `Dockerfile` |
| Exécution des outils dans le conteneur | `src/pages/api/sandbox/call.ts` |
| Choix du lieu d'exécution | écran « Mission autonome » |

Les noms d'outils sont **identiques** entre le pont local et le conteneur :
changer de lieu d'exécution ne change pas ce que l'agent sait faire, seulement
où il le fait.

### Un correctif nécessaire au passage

Le déploiement était **déjà cassé** avant les conteneurs : `wrangler.jsonc`
déclarait deux Durable Objects (`VentureAutonomousAgent`, `OrchestratorAgent`)
que la sortie d'Astro n'exportait pas. `wrangler deploy` refusait de publier.
`worker/index.ts` réexporte désormais le gestionnaire d'Astro **et** les classes
persistantes.

### Prérequis pour déployer

**Docker doit tourner sur la machine qui déploie.** C'est wrangler qui construit
l'image du conteneur puis la pousse vers le registre Cloudflare ; sans Docker,
`wrangler deploy` s'arrête avec :

> The Docker CLI could not be launched.

Sur cette machine, Docker n'est pas installé — le reste du déploiement est
validé (le Worker s'empaquette, les trois Durable Objects sont liés), seule la
construction de l'image manque.

### En développement local

`"dev": { "enable_containers": false }` : sans cela, `astro dev` refuse de
démarrer faute d'image construite. Passez à `true` quand vous voulez essayer le
bac à sable en local, Docker démarré.

### Différences avec le pont local

| | Machine locale | Conteneur |
|---|---|---|
| Coût | gratuit | facturé au temps d'exécution |
| Disponibilité | exige votre machine allumée | permanent |
| Navigateur | ✅ Chrome | ❌ absent de l'image par défaut |
| Dépôt | déjà là | cloné par l'outil `setup` |
| Nombre d'outils | 10 | 6 |

### Ce qui reste à faire

1. Installer Docker Desktop et lancer `wrangler deploy` une première fois
   (comptez 2 à 3 minutes de provisionnement après la première publication).
2. Ajouter Chrome à l'image si les agents doivent naviguer depuis le cloud.
3. Décider de la politique d'extinction : un conteneur inactif coûte encore.

## 13. Par où commencer

L'ordre suivant maximise ce que l'agence peut faire seule, en partant de ce qui
manque le plus :

1. **Stripe** — sans encaissement, rien de ce qui précède ne rapporte.
2. **E-mail transactionnel** — activation et relance sont le premier levier de conversion.
3. **Journaux et alertes** — savoir qu'on est cassé avant que le client ne le dise.
4. **Recherche web** — les agents raisonnent aujourd'hui sur ce qu'ils savent déjà.
5. **Conteneurs cloud** — pour que l'agence travaille quand votre machine est éteinte.
6. **Analytics produit** — arrêter de décider au jugé.
7. **Juridique** — CGU, confidentialité, RGPD : bloquant dès le premier client européen.

---

*Chaque ligne « ❌ » est une capacité que l'agence n'a pas. Aucune n'est
techniquement bloquée : ce sont des outils à écrire, pas des impossibilités.*
