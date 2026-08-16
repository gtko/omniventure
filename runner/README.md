# Pont local OmniVenture

Exécute les harnais de codage (**Claude Code**, **Codex CLI**, **opencode**,
**Gemini CLI**, **Antigravity**) sur votre machine et les expose à
l'interface OmniVenture.

## Pourquoi un processus séparé

L'application est déployée sur **Cloudflare Workers** : pas de système de
fichiers, pas de création de processus. Lancer une CLI depuis le Worker est
donc impossible par construction. Ce pont comble l'écart : il tourne chez vous,
l'interface l'appelle en `127.0.0.1`.

## Démarrage

```bash
node runner/server.mjs
```

Aucune dépendance : uniquement la bibliothèque standard de Node 20+.

## Sécurité

- écoute **uniquement** sur la boucle locale (`127.0.0.1`) ;
- refuse toute origine qui n'est pas `localhost` / `127.0.0.1` ;
- jeton partagé optionnel : `OMNIVENTURE_RUNNER_TOKEN=… node runner/server.mjs`
  (à saisir ensuite dans la console Harnais).

Le harnais s'exécute avec **vos droits** et peut modifier le dépôt. Relisez
toujours le diff : rien n'est committé ni déployé automatiquement.

## Adapter un harnais

Les commandes vivent dans [`src/lib/harnesses.json`](../src/lib/harnesses.json),
partagé par le pont et l'interface :

```json
{
  "id": "claude",
  "bin": "claude",
  "versionArgs": ["--version"],
  "runArgs": ["-p", "{prompt}"]
}
```

`{prompt}` est remplacé par la consigne. Si une CLI change de syntaxe, il suffit
d'éditer ce fichier — aucun code à toucher.

## API

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/health` | état du pont + harnais détectés (avec version) |
| POST | `/run` | `{ harnessId, prompt, cwd? }` → `{ runId }` |
| GET | `/run/:id/stream` | flux SSE de la sortie ligne à ligne |
| POST | `/run/:id/cancel` | interrompt le processus |
