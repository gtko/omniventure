# Spécification : Authentification et gestion des utilisateurs

## 1. Problème utilisateur

Les utilisateurs ont besoin d'un moyen simple et sécurisé pour :
* Accéder à la plateforme Humanize.ai.
* Gérer leurs informations personnelles de base.
* Récupérer l'accès à leur compte en cas d'oubli de mot de passe.

## 2. Parcours utilisateur attendu

### 2.1 Inscription (Écran : Inscription)

1.  L'utilisateur arrive sur la page d'accueil et clique sur "S'inscrire" ou est redirigé vers la page d'inscription.
2.  L'utilisateur saisit son adresse e-mail et un mot de passe (deux fois pour confirmation).
3.  L'utilisateur coche la case "J'accepte les conditions générales d'utilisation et la politique de confidentialité".
4.  L'utilisateur clique sur "Créer mon compte".
5.  Un e-mail de vérification est envoyé à l'adresse fournie.
6.  L'utilisateur clique sur le lien de vérification dans l'e-mail.
7.  Le compte est activé et l'utilisateur est redirigé vers la page de connexion ou le tableau de bord.

### 2.2 Connexion (Écran : Connexion)

1.  L'utilisateur arrive sur la page d'accueil et clique sur "Se connecter" ou est redirigé vers la page de connexion.
2.  L'utilisateur saisit son adresse e-mail et son mot de passe.
3.  L'utilisateur clique sur "Se connecter".
4.  Si les identifiants sont corrects, l'utilisateur est redirigé vers le tableau de bord.
5.  Si les identifiants sont incorrects, un message d'erreur est affiché.

### 2.3 Mot de passe oublié (Écran : Mot de passe oublié, Écran : Réinitialisation mot de passe)

1.  Sur la page de connexion, l'utilisateur clique sur "Mot de passe oublié ?".
2.  L'utilisateur saisit son adresse e-mail et clique sur "Envoyer".
3.  Un e-mail contenant un lien de réinitialisation de mot de passe est envoyé à l'adresse fournie.
4.  L'utilisateur clique sur le lien de réinitialisation dans l'e-mail.
5.  L'utilisateur saisit un nouveau mot de passe (deux fois pour confirmation).
6.  L'utilisateur clique sur "Réinitialiser mon mot de passe".
7.  Le mot de passe est mis à jour et l'utilisateur est redirigé vers la page de connexion avec un message de succès.

### 2.4 Gestion du profil (Écran : Mon profil)

1.  L'utilisateur connecté accède à la section "Mon profil" via le menu de navigation.
2.  L'utilisateur peut visualiser et modifier son adresse e-mail (avec re-vérification si modifiée) et son mot de passe (après confirmation de l'ancien mot de passe).
3.  L'utilisateur clique sur "Enregistrer les modifications".
4.  Un message de succès est affiché.

## 3. Critères d'acceptation vérifiables

*   **Création de compte :**
    *   Un utilisateur peut s'inscrire avec une adresse e-mail valide et un mot de passe respectant les règles de complexité (minimum 8 caractères, incluant majuscule, minuscule, chiffre et caractère spécial).
    *   Un e-mail de vérification est envoyé à l'adresse fournie après l'inscription.
    *   Le compte est activé après que l'utilisateur a cliqué sur le lien de vérification.
    *   Un utilisateur ne peut pas s'inscrire avec une adresse e-mail déjà utilisée.

*   **Connexion :**
    *   Un utilisateur peut se connecter avec une adresse e-mail et un mot de passe valides et un compte activé.
    *   Un message d'erreur approprié est affiché en cas d'identifiants incorrects ou de compte non activé.

*   **Réinitialisation de mot de passe :**
    *   Un utilisateur peut demander la réinitialisation de son mot de passe en fournissant son adresse e-mail enregistrée.
    *   Un e-mail de réinitialisation de mot de passe est envoyé à l'adresse fournie.
    *   Le lien de réinitialisation de mot de passe est valide pour une durée limitée (ex: 24 heures).
    *   L'utilisateur peut définir un nouveau mot de passe après avoir cliqué sur le lien de réinitialisation.

*   **Gestion du profil :**
    *   Un utilisateur peut modifier son adresse e-mail.
    *   Si l'adresse e-mail est modifiée, un nouvel e-mail de vérification est envoyé et l'ancienne adresse e-mail reste active jusqu'à la vérification de la nouvelle.
    *   Un utilisateur peut modifier son mot de passe après avoir fourni l'ancien mot de passe correct.

## 4. Hors périmètre pour cette itération

*   Authentification multi-facteurs (MFA).
*   Connexion via des fournisseurs tiers (Google, Facebook, etc.).
*   Rôles et permissions utilisateurs avancés.
*   Historique de connexion ou d'activité du compte.
*   Suppression de compte par l'utilisateur.
*   Notifications par SMS ou autres canaux que l'e-mail.
