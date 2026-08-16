# Spécification : Soumission de texte et sélection du modèle

## Problème utilisateur
L'utilisateur souhaite "humaniser" un texte généré par une IA pour le rendre indétectable par les outils de détection. Il a besoin d'un moyen simple et rapide de soumettre son texte, de choisir le modèle d'humanisation le plus adapté à ses besoins (en termes de performance et de coût), et de lancer le processus.

## Parcours utilisateur attendu

### Écran 1 : Soumission du texte (Nom de l'écran : `Humanize_Input`)
1.  L'utilisateur arrive sur la page de soumission.
2.  Il voit un champ de texte principal (textarea) où il peut coller ou taper son contenu.
3.  Un compteur de mots indique en temps réel le nombre de mots du texte saisi.
4.  Un bouton "Humaniser" est visible mais désactivé tant que le texte n'atteint pas un minimum de mots (ex: 50 mots).
5.  Sous le champ de texte, une section "Options d'humanisation" est présente, mais peut être réduite par défaut.

### Écran 2 : Sélection du modèle et lancement (Nom de l'écran : `Humanize_Options`)
1.  Lorsque l'utilisateur clique sur le bouton "Humaniser" (ou si la section "Options d'humanisation" est développée), il accède aux options.
2.  Il voit une liste de modèles d'humanisation disponibles, chacun avec :
    *   Son nom (ex: "Rapide & Économique", "Qualité Supérieure", "Style Créatif").
    *   Une brève description de ses caractéristiques (ex: "Idéal pour les brouillons", "Meilleure indétectabilité", "Ton de voix unique").
    *   Son coût estimé en crédits pour le texte soumis.
    *   Un indicateur de performance ou de "garantie d'indétectabilité" (ex: "Score GPTZero > 90%").
3.  Un modèle est présélectionné par défaut (ex: "Rapide & Économique").
4.  L'utilisateur peut sélectionner un autre modèle.
5.  Un bouton "Lancer l'humanisation" est visible, affichant le coût total en crédits pour le modèle sélectionné.
6.  Un message d'erreur s'affiche si l'utilisateur n'a pas assez de crédits pour le modèle choisi.

## Critères d'acceptation vérifiables

### Soumission du texte
*   Le champ de texte `Humanize_Input` accepte la saisie de texte multi-lignes.
*   Le compteur de mots affiche le nombre exact de mots du texte saisi.
*   Le bouton "Humaniser" est désactivé si le nombre de mots est inférieur à 50.
*   Le bouton "Humaniser" est activé si le nombre de mots est égal ou supérieur à 50.

### Sélection du modèle
*   La liste des modèles d'humanisation affiche au moins trois options distinctes.
*   Chaque option de modèle affiche un nom, une description, un coût en crédits et un indicateur de performance.
*   Le modèle par défaut est clairement identifié et sélectionné lors de l'affichage de l'écran `Humanize_Options`.
*   La sélection d'un modèle met à jour le coût total affiché sur le bouton "Lancer l'humanisation".
*   Le bouton "Lancer l'humanisation" est désactivé si l'utilisateur n'a pas suffisamment de crédits pour le modèle sélectionné.
*   Un message d'erreur clair est affiché lorsque l'utilisateur n'a pas assez de crédits.

## Hors périmètre pour cette itération
*   Gestion des crédits utilisateurs (achat, affichage du solde détaillé).
*   Historique des soumissions et des textes humanisés.
*   Fonctionnalités d'édition ou de relecture du texte original.
*   Intégration avec des API externes pour la soumission de texte (ex: Google Docs).
*   Personnalisation avancée des modèles d'humanisation (ex: choix du ton, du style).
*   Affichage des résultats de l'humanisation (ce sera une étape ultérieure).
*   Authentification et gestion des utilisateurs.
