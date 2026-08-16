/**
 * L'ossature d'un produit.
 *
 * C'est ce qui manquait pour qu'un SaaS sorte vraiment. Un agent à qui on
 * demandait « construis la page d'accueil » écrivait un fichier isolé, dans un
 * dossier vide, sans configuration, sans build, sans rien autour : le résultat
 * était un tas de fichiers qui ne formaient jamais une application.
 *
 * Ici, le produit démarre comme un projet Astro + React + Tailwind sur
 * Cloudflare qui **compile dès la première minute**. Les agents éditent alors
 * une application qui marche, au lieu d'en inventer une un fichier à la fois.
 * C'est aussi ce qui rend la vérification possible : on peut demander à `npm
 * run build` de trancher, plutôt que de croire un compte rendu.
 *
 * Les versions sont celles de l'usine — même Astro, même adaptateur, même
 * Tailwind. Un produit qui utiliserait autre chose découvrirait ses
 * incompatibilités le jour du déploiement.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const write = (root, path, content) => {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');
};

/** Un nom de paquet npm valide, tiré du nom du produit. */
const packageName = (name) =>
  String(name || 'produit')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'produit';

/**
 * Écrit l'ossature. Ne touche à rien si le projet existe déjà : on ne veut pas
 * écraser le travail des agents parce que quelqu'un a relancé la commande.
 */
export function scaffold(root, { name = 'Produit', stack = 'saas' } = {}) {
  if (existsSync(join(root, 'package.json'))) {
    return { created: false, reason: 'Le projet existe déjà — rien n’a été écrasé.' };
  }

  const slug = packageName(name);
  const files = stack === 'mobile' ? mobileFiles(name, slug) : webFiles(name, slug, stack);

  for (const [path, content] of Object.entries(files)) write(root, path, content);
  return { created: true, files: Object.keys(files).length, stack };
}

/* ------------------------------------------------------------------ */
/* Application web : SaaS, e-commerce, contenu                         */
/* ------------------------------------------------------------------ */

function webFiles(name, slug, stack) {
  return {
    'package.json': `{
  "name": "${slug}",
  "type": "module",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "astro dev",
    "build": "astro check && astro build",
    "preview": "astro preview",
    "deploy": "wrangler deploy"
  },
  "dependencies": {
    "@astrojs/cloudflare": "^12.2.3",
    "@astrojs/react": "^4.2.1",
    "@astrojs/tailwind": "^6.0.0",
    "astro": "^5.4.1",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tailwindcss": "^3.4.17"
  },
  "devDependencies": {
    "@astrojs/check": "^0.9.10",
    "@types/react": "^19.0.10",
    "@types/react-dom": "^19.0.4",
    "typescript": "^5.8.2",
    "wrangler": "^4.59.2"
  }
}
`,

    'astro.config.mjs': `import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';

// Rendu serveur sur Cloudflare Workers : c'est la seule cible de l'agence.
export default defineConfig({
  output: 'server',
  adapter: cloudflare({ imageService: 'passthrough' }),
  integrations: [react(), tailwind()]
});
`,

    'tsconfig.json': `{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "react",
    "types": ["@cloudflare/workers-types"]
  },
  "exclude": ["dist"]
}
`,

    'tailwind.config.mjs': `/**
 * Les couleurs et les rayons viennent des variables CSS posées par le design
 * system (src/styles/tokens.css). Un seul endroit décide de l'apparence.
 */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        marque: 'var(--couleur-marque)',
        'marque-sombre': 'var(--couleur-marque-sombre)',
        surface: 'var(--couleur-surface)',
        encre: 'var(--couleur-encre)',
        'encre-douce': 'var(--couleur-encre-douce)'
      },
      borderRadius: { app: 'var(--rayon)' },
      fontFamily: { titre: 'var(--police-titre)', texte: 'var(--police-texte)' }
    }
  },
  plugins: []
};
`,

    'wrangler.jsonc': `{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "${slug}",
  "main": "./dist/_worker.js/index.js",
  "compatibility_date": "2025-03-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": { "directory": "./dist", "binding": "ASSETS" },

  // Créez-les avec : wrangler d1 create ${slug} · wrangler r2 bucket create ${slug}-media
  "d1_databases": [{ "binding": "DB", "database_name": "${slug}", "database_id": "à-remplir" }],
  "r2_buckets": [{ "binding": "MEDIA", "bucket_name": "${slug}-media" }]
}
`,

    '.gitignore': `node_modules/
dist/
.astro/
.wrangler/
.env
.env.*
.omniventure/
`,

    'src/styles/tokens.css': `/*
 * Jetons de design.
 *
 * Ce fichier est réécrit par le design system de l'agence : ne le modifiez pas
 * à la main, la prochaine génération écraserait vos changements. Pour changer
 * l'apparence, changez le design system.
 */
:root {
  --couleur-marque: #4f46e5;
  --couleur-marque-sombre: #4338ca;
  --couleur-surface: #ffffff;
  --couleur-encre: #0f172a;
  --couleur-encre-douce: #475569;
  --rayon: 0.75rem;
  --police-titre: ui-sans-serif, system-ui, sans-serif;
  --police-texte: ui-sans-serif, system-ui, sans-serif;
}
`,

    'src/styles/global.css': `@import './tokens.css';

@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  background: var(--couleur-surface);
  color: var(--couleur-encre);
  font-family: var(--police-texte);
}
`,

    'src/layouts/Base.astro': `---
/**
 * Gabarit commun. Toute page passe par ici : c'est ce qui garantit que le
 * produit reste cohérent d'un écran à l'autre.
 */
import '../styles/global.css';

interface Props {
  titre: string;
  description?: string;
}

const { titre, description = '' } = Astro.props;
---

<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{titre}</title>
    {description && <meta name="description" content={description} />}
  </head>
  <body class="min-h-screen antialiased">
    <slot />
  </body>
</html>
`,

    'src/pages/index.astro': `---
import Base from '../layouts/Base.astro';

/**
 * Page d'accueil.
 *
 * Point de départ à remplacer par la promesse réelle du produit. Elle est
 * volontairement pauvre : elle prouve que la chaîne compile et se déploie, elle
 * ne prétend pas être le produit.
 */
const promesse = '${name}';
---

<Base titre={promesse}>
  <main class="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6">
    <h1 class="font-titre text-4xl font-bold text-encre">{promesse}</h1>
    <p class="mt-3 text-lg text-encre-douce">
      Ossature en place : Astro, React, Tailwind, Cloudflare. Remplacez ce contenu par la promesse du produit.
    </p>
    <a
      href="/app"
      class="mt-8 inline-flex w-fit rounded-app bg-marque px-5 py-3 font-semibold text-white transition-colors hover:bg-marque-sombre"
    >
      Ouvrir l'application
    </a>
  </main>
</Base>
`,

    'src/pages/app/index.astro': `---
import Base from '../../layouts/Base.astro';

export const prerender = false;
---

<Base titre="Application">
  <main class="mx-auto max-w-5xl px-6 py-12">
    <h1 class="font-titre text-2xl font-bold text-encre">Application</h1>
    <p class="mt-2 text-encre-douce">L'écran principal du produit se construit ici.</p>
  </main>
</Base>
`,

    'src/pages/api/sante.ts': `import type { APIRoute } from 'astro';

export const prerender = false;

/**
 * Contrôle de vie. Sert au déploiement : si cette route ne répond pas, la mise
 * en ligne a échoué, quoi qu'en dise le journal de build.
 */
export const GET: APIRoute = async ({ locals }) => {
  const env = (locals as any)?.runtime?.env;
  return new Response(
    JSON.stringify({ ok: true, base: !!env?.DB, fichiers: !!env?.MEDIA, at: new Date().toISOString() }),
    { headers: { 'Content-Type': 'application/json' } }
  );
};
`,

    'schema.sql': `-- Schéma du produit. Appliquez-le avec :
--   wrangler d1 execute ${slug} --file schema.sql --remote

CREATE TABLE IF NOT EXISTS comptes (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    cree_le INTEGER NOT NULL,
    -- Abonnement : 'essai' | 'actif' | 'annule'
    abonnement TEXT DEFAULT 'essai',
    stripe_customer_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_comptes_email ON comptes (email);
`,

    'CONVENTIONS.md': `# Conventions de ce produit

Elles ne sont pas décoratives : un agent qui les ignore produit du code que le
suivant devra deviner.

## Ce qui est imposé

- **Tout tourne sur Cloudflare.** Workers, D1, R2, KV. Pas de serveur Node
  permanent, pas de Postgres, pas de service tiers d'hébergement.
- **Astro pour les pages, React seulement en îlots.** Une page qui n'a pas
  besoin d'interactivité n'embarque pas de JavaScript.
- **Les couleurs et les polices viennent de \`src/styles/tokens.css\`**, écrit
  par le design system. On n'écrit jamais une couleur en dur dans un composant.

## Structure

    src/pages/          une page = une route
    src/pages/api/      les routes serveur, \`prerender = false\`
    src/layouts/        les gabarits communs
    src/components/     les composants React, un par fichier
    src/lib/            la logique métier, testable sans navigateur
    schema.sql          le schéma D1

## Écriture

- Le français pour les noms de domaine métier, l'anglais pour ce qui vient des
  bibliothèques. On ne traduit pas \`useState\`.
- Un commentaire explique **pourquoi**, jamais **quoi** : le code dit déjà quoi.
- Une fonction qui dépasse l'écran cherche à être coupée.

## Avant de dire que c'est fini

    npm run build

Si ça ne compile pas, ce n'est pas livré.
`,

    'README.md': `# ${name}

Produit fabriqué par l'agence OmniVenture. Pile : Astro 5, React 19, Tailwind,
Cloudflare Workers, D1, R2.

## Démarrer

    npm install
    npm run dev

## Vérifier

    npm run build

## Mettre en ligne

    wrangler d1 create ${slug}          # puis reporter l'identifiant dans wrangler.jsonc
    wrangler d1 execute ${slug} --file schema.sql --remote
    wrangler r2 bucket create ${slug}-media
    npm run build && wrangler deploy

Les conventions de code sont dans [CONVENTIONS.md](./CONVENTIONS.md).
`
  };
}

/* ------------------------------------------------------------------ */
/* Application mobile                                                  */
/* ------------------------------------------------------------------ */

/**
 * Pour le mobile, l'ossature se limite à l'API.
 *
 * Un projet Expo ne se génère pas sérieusement à la main : il se crée avec
 * `create-expo-app`, qui a besoin du réseau et de plusieurs minutes. On pose
 * donc l'API — la partie qui vit sur Cloudflare — et on dit franchement ce qui
 * reste à faire côté application.
 */
function mobileFiles(name, slug) {
  return {
    'package.json': `{
  "name": "${slug}-api",
  "type": "module",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "build": "tsc --noEmit",
    "deploy": "wrangler deploy"
  },
  "dependencies": { "hono": "^4.6.14" },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250204.0",
    "typescript": "^5.8.2",
    "wrangler": "^4.59.2"
  }
}
`,
    'tsconfig.json': `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "types": ["@cloudflare/workers-types"],
    "noEmit": true
  },
  "include": ["src"]
}
`,
    'wrangler.jsonc': `{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "${slug}-api",
  "main": "src/index.ts",
  "compatibility_date": "2025-03-01",
  "compatibility_flags": ["nodejs_compat"],
  "d1_databases": [{ "binding": "DB", "database_name": "${slug}", "database_id": "à-remplir" }],
  "r2_buckets": [{ "binding": "MEDIA", "bucket_name": "${slug}-media" }]
}
`,
    '.gitignore': `node_modules/\n.wrangler/\n.env\n`,
    'src/index.ts': `import { Hono } from 'hono';

type Bindings = { DB: D1Database; MEDIA: R2Bucket };

const app = new Hono<{ Bindings: Bindings }>();

/** Contrôle de vie : si ça ne répond pas, la mise en ligne a échoué. */
app.get('/sante', (c) => c.json({ ok: true, at: new Date().toISOString() }));

export default app;
`,
    'README.md': `# ${name} — API

L'API du produit, en Hono sur Cloudflare Workers.

    npm install
    npm run dev

## L'application

Le client React Native n'est pas généré ici : il se crée avec
\`npx create-expo-app\`, qui demande le réseau et plusieurs minutes. Une fois
créé, il consomme cette API — c'est le seul lien entre les deux.
`
  };
}
