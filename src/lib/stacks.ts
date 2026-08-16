/**
 * Les piles techniques de l'agence — et la contrainte qui les gouverne.
 *
 * Tout ce que l'agence fabrique est hébergé sur Cloudflare. Ce n'est pas une
 * préférence, c'est une règle : un produit qui a besoin d'un serveur Node
 * permanent, d'un Postgres managé ou d'un déploiement Vercel n'est pas
 * déployable ici, et le découvrir au moment de la mise en ligne coûte le
 * sprint entier.
 *
 * Un modèle de langage, laissé libre, propose spontanément Next.js sur Vercel
 * avec Supabase — c'est la réponse la plus fréquente sur Internet, donc la plus
 * probable. D'où ce fichier : le cadre est écrit, injecté dans les consignes,
 * et l'interdit est nommé explicitement plutôt que sous-entendu.
 */

export type StackId = 'saas' | 'mobile' | 'ecommerce' | 'contenu';

export interface Stack {
  id: StackId;
  label: string;
  icon: string;
  /** Ce que cette pile sert à construire. */
  summary: string;
  /** Les briques retenues, dans l'ordre où on les rencontre. */
  bricks: Array<{ name: string; why: string }>;
  /** Ce qu'on ajoute seulement si le besoin est démontré. */
  optional: Array<{ name: string; when: string }>;
}

/**
 * Interdits communs.
 *
 * Écrits en creux parce qu'un cadre qui ne dit que le permis laisse croire que
 * le reste est négociable.
 */
export const FORBIDDEN: string[] = [
  'Vercel, Netlify, Render, Fly.io, Heroku, AWS, GCP, Azure — rien n’est hébergé ailleurs que sur Cloudflare',
  'PostgreSQL, MySQL, MongoDB, Supabase, PlanetScale, Neon — la base est D1, point',
  'Redis, Memcached — le cache est KV, la coordination est un Durable Object',
  'S3, Cloudinary, UploadThing — les fichiers vont dans R2',
  'un serveur Node.js permanent, un cron système, un worker de fond qui tourne en boucle',
  'toute bibliothèque qui exige `fs`, `child_process`, `net`, ou un binaire natif'
];

/** Ce que le runtime impose, et qu'on oublie systématiquement. */
export const RUNTIME_LIMITS: string[] = [
  'pas de système de fichiers : rien ne s’écrit sur disque au moment de l’exécution',
  'pas de processus long : une requête a un budget CPU, pas une durée illimitée',
  'les tâches différées passent par Queues ou Cron Triggers, jamais par setInterval',
  "l'état partagé entre requêtes vit dans D1, KV ou un Durable Object — jamais dans une variable de module"
];

export const STACKS: Record<StackId, Stack> = {
  saas: {
    id: 'saas',
    label: 'SaaS',
    icon: '🧩',
    summary: 'Une application web avec comptes, abonnement et tableau de bord.',
    bricks: [
      { name: 'Astro 5 en rendu serveur', why: 'des pages rapides, du HTML d’abord, et des îlots là où il en faut' },
      { name: 'React 19 en îlots', why: 'l’interactivité seulement où elle est nécessaire' },
      { name: 'Cloudflare Workers', why: 'l’exécution, au plus près de l’utilisateur' },
      { name: 'D1', why: 'la base relationnelle : comptes, abonnements, données métier' },
      { name: 'R2', why: 'les fichiers et les visuels' },
      { name: 'KV', why: 'le cache et les préférences à lecture fréquente' },
      { name: 'Stripe', why: 'l’encaissement, par webhook vers un Worker' }
    ],
    optional: [
      { name: 'OpenRouter', when: 'le produit a réellement besoin d’un modèle de langage' },
      { name: 'Durable Objects', when: 'il faut coordonner plusieurs clients en temps réel' },
      { name: 'Queues', when: 'un traitement dépasse le budget d’une requête' }
    ]
  },
  mobile: {
    id: 'mobile',
    label: 'Application mobile',
    icon: '📱',
    summary: 'Une application installable, adossée à une API sur Cloudflare.',
    bricks: [
      { name: 'React Native avec Expo', why: 'un seul code pour iOS et Android, et des mises à jour sans passer par les stores' },
      { name: 'Hono sur Cloudflare Workers', why: 'l’API : léger, écrit pour ce runtime, sans dépendance Node' },
      { name: 'D1', why: 'les données' },
      { name: 'R2', why: 'les médias envoyés depuis l’appareil' }
    ],
    optional: [
      { name: 'OpenRouter', when: 'le produit a besoin d’un modèle' },
      { name: 'Expo Notifications', when: 'les notifications font partie de la promesse' }
    ]
  },
  ecommerce: {
    id: 'ecommerce',
    label: 'E-commerce',
    icon: '🛒',
    summary: 'Une boutique : catalogue, panier, paiement.',
    bricks: [
      { name: 'Astro 5 en rendu serveur', why: 'des fiches produit indexables et rapides' },
      { name: 'vcart.js', why: 'le panier, développé et maintenu en interne — on ne dépend de personne dessus' },
      { name: 'Cloudflare Workers', why: 'l’exécution' },
      { name: 'D1', why: 'catalogue, commandes, stocks' },
      { name: 'R2', why: 'les visuels produits' },
      { name: 'Stripe', why: 'le paiement' }
    ],
    optional: [{ name: 'Queues', when: 'les commandes déclenchent des traitements différés' }]
  },
  contenu: {
    id: 'contenu',
    label: 'Contenu & affiliation',
    icon: '📰',
    summary: 'Un site éditorial qui vit du référencement et des liens affiliés.',
    bricks: [
      { name: 'Astro 5, pages statiques quand c’est possible', why: 'le référencement se gagne sur la vitesse' },
      { name: 'Cloudflare Pages / Workers', why: 'la diffusion' },
      { name: 'D1', why: 'le suivi des clics et des conversions' },
      { name: 'R2', why: 'les images éditoriales' }
    ],
    optional: [{ name: 'OpenRouter', when: 'la production éditoriale est assistée' }]
  }
};

/** Pile par défaut selon le type de produit déclaré. */
export function stackFor(ventureType: string | undefined): StackId {
  switch (ventureType) {
    case 'dropship':
      return 'ecommerce';
    case 'affiliate':
    case 'ebook':
    case 'viral_campaign':
      return 'contenu';
    default:
      return 'saas';
  }
}

/**
 * Le cadre technique, tel qu'il est donné aux agents.
 *
 * Court volontairement : une consigne longue se dilue. Le permis, l'interdit,
 * les limites du runtime — rien d'autre.
 */
export function stackBlock(id: StackId): string {
  const stack = STACKS[id] ?? STACKS.saas;
  return [
    `[CADRE TECHNIQUE — ${stack.icon} ${stack.label}]`,
    "Tout est hébergé sur Cloudflare. Sans exception, y compris pour une maquette ou un prototype.",
    '',
    'Briques retenues :',
    ...stack.bricks.map((brick) => `- ${brick.name} — ${brick.why}`),
    '',
    'À n’ajouter que si le besoin est démontré :',
    ...stack.optional.map((brick) => `- ${brick.name} — ${brick.when}`),
    '',
    'Interdits :',
    ...FORBIDDEN.map((entry) => `- ${entry}`),
    '',
    'Le runtime impose :',
    ...RUNTIME_LIMITS.map((entry) => `- ${entry}`),
    '',
    'Si une fonctionnalité semble exiger un service interdit, dis-le au lieu de le proposer : il existe presque toujours un équivalent Cloudflare, et quand il n’y en a pas, c’est la fonctionnalité qu’il faut revoir.'
  ].join('\n');
}
