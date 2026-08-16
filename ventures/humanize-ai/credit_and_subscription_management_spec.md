# Spécification : Gestion des crédits et abonnements (MVP)

## 1. Problème utilisateur

L'utilisateur ne sait pas combien de crédits il lui reste pour utiliser le service d'humanisation. Il ne peut pas non plus acheter facilement des crédits supplémentaires pour continuer à utiliser le service sans interruption. Cela crée de la frustration et peut entraîner une perte d'engagement.

## 2. Parcours utilisateur attendu

### Écran 1 : Tableau de bord utilisateur (User Dashboard)

*   **Description :** Page d'accueil de l'utilisateur après connexion. Affiche un aperçu de l'activité et des informations clés.
*   **Éléments clés :**
    *   Affichage clair du solde de crédits restant.
    *   Bouton "Acheter des crédits" ou "Recharger" visible et accessible.

### Écran 2 : Achat de crédits (Credit Purchase)

*   **Description :** Page dédiée à l'achat de crédits.
*   **Éléments clés :**
    *   Formulaire simple pour choisir un montant de crédits (ex: 1000 crédits pour X€, 5000 crédits pour Y€).
    *   Champ de saisie pour les informations de paiement (carte bancaire).
    *   Bouton de confirmation d'achat.
    *   Affichage du prix total.

### Écran 3 : Confirmation d'achat (Purchase Confirmation)

*   **Description :** Page affichant le succès de la transaction.
*   **Éléments clés :**
    *   Message de confirmation de l'achat.
    *   Récapitulatif des crédits achetés.
    *   Option de retour au tableau de bord.

## 3. Critères d'acceptation vérifiables

*   **Affichage du solde :** Le solde de crédits de l'utilisateur est affiché sur le tableau de bord utilisateur (Écran 1).
*   **Accès à l'achat :** Le bouton "Acheter des crédits" sur le tableau de bord (Écran 1) redirige l'utilisateur vers la page d'achat de crédits (Écran 2).
*   **Sélection du montant :** L'utilisateur peut sélectionner un montant de crédits à acheter sur la page d'achat (Écran 2).
*   **Traitement du paiement :** L'utilisateur peut entrer ses informations de carte bancaire et valider l'achat sur la page d'achat (Écran 2).
*   **Confirmation de transaction :** Après un achat réussi, l'utilisateur est redirigé vers la page de confirmation (Écran 3) affichant un message de succès et le nouveau solde de crédits.
*   **Mise à jour du solde :** Le solde de crédits de l'utilisateur est mis à jour immédiatement après un achat réussi et est visible sur le tableau de bord (Écran 1).
*   **Gestion des erreurs de paiement :** En cas d'échec de paiement, un message d'erreur clair est affiché à l'utilisateur sur la page d'achat (Écran 2).

## 4. Hors périmètre pour cette itération (MVP)

*   **Plans d'abonnement récurrents :** Seul l'achat de crédits ponctuels est géré. Les abonnements mensuels ou annuels ne sont pas inclus.
*   **Historique des transactions :** L'affichage d'un historique détaillé des achats de crédits n'est pas prévu.
*   **Facturation détaillée :** La génération de factures PDF ou l'envoi de reçus détaillés par e-mail ne sont pas inclus.
*   **Codes promotionnels/réductions :** L'application de codes promotionnels ou de réductions n'est pas supportée.
*   **Modes de paiement multiples :** Seul le paiement par carte bancaire est géré. Les autres modes (PayPal, virement, etc.) ne sont pas inclus.
*   **Notifications de solde faible :** L'envoi de notifications automatiques lorsque le solde de crédits est faible n'est pas inclus.
*   **Remboursements :** La gestion des remboursements n'est pas incluse.
