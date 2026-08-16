# Directive Produit - Humanize.ai

## Cible

Rédacteurs SEO, agences de contenu et freelances francophones qui utilisent des IA génératives (ChatGPT, Claude, Gemini) et cherchent à rendre leurs contenus indétectables par les outils de détection d'IA professionnels (GPTZero, Originality.ai, Turnitin, Copyleaks).

## Problème Résolu Mieux Que Les Concurrents

Les solutions existantes (Undetectable.ai, StealthGPT, BypassGPT) sont soit généralistes et ne garantissent pas l'indétectabilité pour le français, soit leurs coûts d'inférence sont mal maîtrisés pour une utilisation à haute cadence. Humanize.ai offre une solution spécifiquement optimisée pour le français, garantissant l'indétectabilité avec un coût d'inférence minimisé, permettant aux professionnels du contenu de produire à grande échelle sans compromettre la qualité ou le budget.

## Trois Résultats Visés et Leur Mesure

1.  **Taux d'indétectabilité supérieur à 95% :** Mesuré par des tests automatisés sur un corpus de textes générés par IA et humanisés par Humanize.ai, soumis aux principaux détecteurs d'IA du marché (GPTZero, Originality.ai, Turnitin, Copyleaks).
2.  **Coût d'inférence par mot réduit de 30% par rapport aux concurrents :** Mesuré par une analyse comparative des coûts d'API et d'infrastructure pour le traitement d'un volume de mots équivalent, en se basant sur les tarifs publics ou estimés des concurrents et les coûts réels de Humanize.ai.
3.  **Taux de conversion du trial en abonnement payant de 15% :** Mesuré par le suivi des inscriptions au trial et des conversions en abonnements payants via le tableau de bord analytique du produit.

## Hors Périmètre

*   Détection de plagiat généraliste (au-delà de la détection d'IA).
*   Humanisation de contenus multimédias (images, voix, vidéo).
*   Support d'autres langues que le français dans la phase initiale.
*   Développement d'une extension Chrome ou d'une suite d'outils académiques complète dans la phase initiale (focus sur l'humanisation de texte).

# Cadre Technique - Humanize.ai

## Pile Retenue

*   **Langage de développement :** Python (pour le backend et les modèles d'IA) et TypeScript (pour le frontend).
*   **Framework Backend :** FastAPI (léger, performant, asynchrone, typé).
*   **Framework Frontend :** Next.js (React) (pour le rendu côté serveur, l'optimisation SEO et la rapidité de développement).
*   **Base de données :** PostgreSQL (fiable, robuste, bien supportée).
*   **Orchestration/Déploiement :** Docker et Kubernetes (pour la scalabilité et la gestion des microservices).
*   **Fournisseur Cloud :** Google Cloud Platform (pour l'accès aux TPUs/GPUs pour l'inférence, et l'intégration avec d'autres services Google).
*   **Modèles d'IA :** Initialement, fine-tuning de modèles open-source (ex: variantes de Llama, Falcon) pour l'humanisation en français, avec une stratégie d'intégration progressive des API de modèles propriétaires (OpenAI, Anthropic, Google) si nécessaire pour atteindre les objectifs de performance, en privilégiant toujours le coût.

## Contraintes Non Négociables

*   **Coût d'inférence :** Le coût par mot humanisé doit être le plus bas du marché francophone, avec une optimisation continue des modèles et de l'infrastructure.
*   **Latence :** Le temps de réponse pour l'humanisation d'un texte doit être inférieur à 5 secondes pour un texte de 1000 mots.
*   **Sécurité des données :** Conformité totale au RGPD. Aucune donnée utilisateur (textes soumis, textes humanisés) ne doit être utilisée pour l'entraînement des modèles sans consentement explicite.
*   **Indétectabilité :** Le critère principal de succès est la capacité à passer les détecteurs d'IA professionnels avec un score élevé d'humanité.

## Dette Acceptée Scieemment

*   **Interface utilisateur minimale (MVP) :** Dans un premier temps, l'UI se concentrera sur la fonctionnalité principale d'humanisation, avec des options avancées ajoutées itérativement.
*   **Support multilingue :** Le focus initial est exclusivement sur le français. L'ajout d'autres langues sera une phase ultérieure.
*   **Intégrations tierces :** Pas d'intégrations API avec des CMS ou d'autres outils de rédaction dans la phase initiale (API publique à venir).

## Ce Qui Est Interdit Dans Ce Projet

*   Utilisation de modèles d'IA propriétaires sans une analyse de coût/bénéfice rigoureuse et une justification claire de leur supériorité par rapport aux alternatives open-source.
*   Développement d'une infrastructure on-premise : tout doit être cloud-native et scalable.
*   Compromettre la sécurité des données ou la conformité RGPD pour des gains de performance ou de coût à court terme.
*   Ignorer les retours des utilisateurs sur l'efficacité de l'humanisation et la détection. Le produit doit évoluer en fonction des performances réelles sur les détecteurs et de la satisfaction client.