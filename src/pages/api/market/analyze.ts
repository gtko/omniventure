/**
 * Analyse concurrentielle.
 *
 * Deux modes :
 *   - « domain »  : on VA LIRE le site (accueil, tarifs, fonctionnalités,
 *     clients, intégrations, nouveautés…) et on donne ce texte au modèle.
 *     Sans ça l'analyse n'est qu'un souvenir de modèle, souvent périmé et
 *     parfois inventé.
 *   - « keyword » : pas d'URL à lire, le modèle cartographie la niche et
 *     propose les concurrents à analyser ensuite un par un.
 *
 * Les pages à lire ne sont pas devinées au hasard : on suit les liens réels de
 * la page d'accueil. Un site qui appelle sa page de prix « /nos-offres » est
 * donc lu correctement, là où une liste de chemins figés le manquait.
 *
 * Le rapport distingue toujours trois niveaux :
 *   - les faits relevés mécaniquement dans le HTML (`facts`) — vérifiables ;
 *   - les pages réellement lues (`sources`) ;
 *   - l'interprétation du modèle, dont `scores.confidence` dit la solidité.
 */

import type { APIRoute } from 'astro';

export const prerender = false;

const FETCH_TIMEOUT_MS = 9000;
/** Accueil + 6 pages internes : au-delà on paie de la latence pour du bruit. */
const MAX_SECONDARY_PAGES = 6;
/** Les pages qui portent l'offre méritent plus de texte que les autres. */
const CHARS_PRIMARY = 14000;
const CHARS_SECONDARY = 7000;
/** Budget total de texte envoyé au modèle. */
const EVIDENCE_CHARS = 46000;
const UA = 'Mozilla/5.0 (compatible; OmniVentureBot/1.0; veille concurrentielle)';

export type PageRole =
  | 'accueil'
  | 'tarifs'
  | 'fonctionnalites'
  | 'clients'
  | 'integrations'
  | 'nouveautes'
  | 'a-propos'
  | 'faq';

/** Libellés affichés côté interface. */
export const ROLE_LABELS: Record<PageRole, string> = {
  accueil: 'Accueil',
  tarifs: 'Tarifs',
  fonctionnalites: 'Fonctionnalités',
  clients: 'Clients',
  integrations: 'Intégrations',
  nouveautes: 'Nouveautés',
  'a-propos': 'À propos',
  faq: 'Aide / FAQ'
};

interface FetchedPage {
  url: string;
  status: number;
  title: string;
  text: string;
  html: string;
  role: PageRole;
}

/**
 * Pages recherchées, par ordre de valeur pour l'analyse. `match` est testé
 * contre « chemin + libellé du lien » : c'est ce qui permet de reconnaître
 * « /nos-offres » ou « Combien ça coûte ? » comme une page de tarifs.
 * `guess` n'est renseigné que là où deviner vaut le coup d'un aller-retour.
 */
const ROLE_HINTS: Array<{ role: PageRole; match: RegExp; guess?: string[] }> = [
  {
    role: 'tarifs',
    match: /pricing|tarif|\bprix\b|\bplans?\b|abonnement|offres|combien|subscribe/i,
    guess: ['/pricing', '/tarifs', '/plans', '/prix']
  },
  {
    role: 'fonctionnalites',
    match: /feature|fonctionnalit|\bproduct\b|\bproduit\b|platform|plateforme|how-it-works|comment-ca-marche/i,
    guess: ['/features', '/product']
  },
  { role: 'clients', match: /customer|\bclients?\b|case-?stud|cas-client|t[ée]moignage|testimonial|success/i },
  { role: 'integrations', match: /int[ée]gration|marketplace|\bapps?\b|connecteur|connector/i },
  { role: 'nouveautes', match: /changelog|release|what.?s.?new|nouveaut|roadmap|\bblog\b/i },
  { role: 'a-propos', match: /\babout\b|propos|company|entreprise|\bteam\b|[ée]quipe|manifesto/i },
  { role: 'faq', match: /\bfaq\b|\bhelp\b|\baide\b|\bdocs?\b|documentation|support/i }
];

/* ------------------------------------------------------------------ */
/* Lecture des pages                                                   */
/* ------------------------------------------------------------------ */

function normalizeUrl(input: string): string {
  const trimmed = input.trim().replace(/\s+/g, '');
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/+/, '')}`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/gi, "'")
    .replace(/&(?:eacute|Eacute);/g, 'é')
    .replace(/&(?:egrave|Egrave);/g, 'è')
    .replace(/\s+/g, ' ')
    .trim();
}

/** www.exemple.com et exemple.com sont le même site. */
function sameSite(a: string, b: string): boolean {
  return a.replace(/^www\./i, '').toLowerCase() === b.replace(/^www\./i, '').toLowerCase();
}

async function fetchPage(url: string, role: PageRole): Promise<FetchedPage | null> {
  const limit = role === 'accueil' || role === 'tarifs' ? CHARS_PRIMARY : CHARS_SECONDARY;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    // L'URL finale, pas celle demandée : une redirection apex → www change la
    // base contre laquelle on résout les liens internes.
    const finalUrl = res.url || url;
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.includes('html')) {
      return { url: finalUrl, status: res.status, title: '', text: '', html: '', role };
    }
    // On garde jusqu'à sept pages en mémoire : moitié moins de HTML par page
    // qu'à l'époque où on n'en lisait que deux.
    const html = (await res.text()).slice(0, 220_000);
    const title = /<title[^>]*>([\s\S]{0,200}?)<\/title>/i.exec(html)?.[1]?.trim() ?? '';
    return { url: finalUrl, status: res.status, title, text: stripHtml(html).slice(0, limit), html, role };
  } catch {
    return null;
  }
}

/** Liens internes de la page d'accueil, classés par rôle (premier trouvé gagne). */
function discoverLinks(html: string, base: URL): Map<PageRole, string> {
  const found = new Map<PageRole, string>();
  const taken = new Set<string>();
  const anchor = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,160}?)<\/a>/gi;

  let match: RegExpExecArray | null;
  while ((match = anchor.exec(html)) !== null) {
    const href = match[1] ?? '';
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) continue;

    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol) || !sameSite(url.hostname, base.hostname)) continue;
    url.hash = '';

    const candidate = url.toString();
    if (taken.has(candidate)) continue;

    const probe = `${url.pathname} ${stripHtml(match[2] ?? '')}`;
    for (const hint of ROLE_HINTS) {
      if (found.has(hint.role)) continue;
      if (hint.match.test(probe)) {
        found.set(hint.role, candidate);
        taken.add(candidate);
        break;
      }
    }
  }

  return found;
}

/**
 * Accueil, puis les pages internes qui portent l'offre. Les liens réels du site
 * priment ; les chemins devinés ne servent que de filet pour les tarifs et les
 * fonctionnalités, et leur échec n'est pas signalé comme une panne.
 */
export async function collectEvidence(target: string): Promise<{
  pages: FetchedPage[];
  sources: string[];
  failed: string[];
}> {
  const root = normalizeUrl(target);
  const pages: FetchedPage[] = [];
  const failed: string[] = [];

  const home = await fetchPage(root, 'accueil');
  if (home?.text) pages.push(home);
  else failed.push(root);

  let base: URL;
  try {
    base = new URL(home?.url || root);
  } catch {
    return { pages, sources: pages.map((page) => page.url), failed };
  }

  const discovered = home?.html ? discoverLinks(home.html, base) : new Map<PageRole, string>();
  const visited = new Set<string>(pages.map((page) => page.url));
  const targets: Array<{ role: PageRole; url: string; guessed: boolean }> = [];

  for (const hint of ROLE_HINTS) {
    if (targets.length >= MAX_SECONDARY_PAGES) break;

    const linked = discovered.get(hint.role);
    const url = linked ?? (hint.guess?.[0] ? new URL(hint.guess[0], base).toString() : undefined);
    if (!url || visited.has(url)) continue;

    visited.add(url);
    targets.push({ role: hint.role, url, guessed: !linked });
  }

  const fetched = await Promise.all(targets.map((entry) => fetchPage(entry.url, entry.role)));

  fetched.forEach((page, index) => {
    const entry = targets[index]!;
    if (page?.text && page.text.length > 200) pages.push(page);
    else if (!entry.guessed) failed.push(entry.url);
  });

  return { pages, sources: pages.map((page) => page.url), failed };
}

/* ------------------------------------------------------------------ */
/* Faits relevés dans le HTML — vérifiables, sans interprétation       */
/* ------------------------------------------------------------------ */

/** Indices techniques lisibles dans le HTML : ce sont des faits, pas des avis. */
export function detectTech(pages: FetchedPage[]): string[] {
  const blob = pages.map((page) => page.html).join(' ').slice(0, 600_000);
  const signals: Array<[string, RegExp]> = [
    ['Next.js', /__NEXT_DATA__|\/_next\//],
    ['Nuxt', /__NUXT__|\/_nuxt\//],
    ['Astro', /astro-island|data-astro-cid/],
    ['React', /react(-dom)?[.@]|data-reactroot/],
    ['Vue', /data-v-[0-9a-f]{8}|vue(\.runtime)?\.js/],
    ['Svelte', /svelte-[0-9a-z]{6}/],
    ['Webflow', /webflow\.js|w-webflow/],
    ['Framer', /framerusercontent|framer\.com/],
    ['Shopify', /cdn\.shopify\.com/],
    ['WordPress', /wp-content|wp-includes/],
    ['Tailwind', /tailwind/i],
    ['Stripe', /js\.stripe\.com|checkout\.stripe/],
    ['Paddle', /paddle\.com|paddlejs/],
    ['Lemon Squeezy', /lemonsqueezy/],
    ['Intercom', /intercom(cdn|\.io)/],
    ['Crisp', /crisp\.chat/],
    ['HubSpot', /hs-scripts|hubspot/],
    ['Segment', /cdn\.segment\.com/],
    ['Google Analytics', /gtag\/js|googletagmanager/],
    ['Plausible', /plausible\.io/],
    ['PostHog', /posthog/],
    ['Mixpanel', /mixpanel/],
    ['Cloudflare', /cdn-cgi\//],
    ['Vercel', /vercel\.app|_vercel/],
    ['Algolia', /algolia/],
    ['Auth0', /auth0\.com/],
    ['Clerk', /clerk\.(dev|com)/]
  ];
  return signals.filter(([, pattern]) => pattern.test(blob)).map(([name]) => name);
}

export interface SiteFacts {
  /** Promesse affichée dans la balise description / og:description. */
  metaDescription: string;
  /** Titres h1–h3 : la structure du discours commercial. */
  headings: string[];
  /** Montants trouvés tels quels sur les pages. */
  priceMentions: string[];
  /** Arguments de réassurance annoncés (essai gratuit, SOC 2, RGPD…). */
  trustSignals: string[];
  /** Plateformes d'avis et communautés vers lesquelles le site pointe. */
  proofLinks: string[];
  /** Produits tiers cités : la surface d'intégration réelle. */
  integrations: string[];
  /** Langues déclarées en hreflang : l'ampleur de l'internationalisation. */
  languages: string[];
}

const TRUST_PATTERNS: Array<[string, RegExp]> = [
  ['Essai gratuit', /essai gratuit|free trial|try (it )?free|14[- ]day|30[- ]day trial/i],
  ['Sans carte bancaire', /no credit card|sans carte (bancaire|de cr[ée]dit)/i],
  ['Offre gratuite', /free (plan|forever|tier)|gratuit [àa] vie|plan gratuit/i],
  ['Démo commerciale', /book a demo|r[ée]server une d[ée]mo|request a demo|parler [àa] (un|l)/i],
  ['Open source', /open[- ]source|github\.com\/[a-z0-9-]+\/[a-z0-9-]+/i],
  ['Auto-hébergeable', /self[- ]host|on[- ]premise|sur vos serveurs/i],
  ['SOC 2', /soc\s?2/i],
  ['ISO 27001', /iso\s?27001/i],
  ['RGPD / GDPR', /\bgdpr\b|\brgpd\b/i],
  ['HIPAA', /\bhipaa\b/i],
  ['SSO / SAML', /\bsso\b|\bsaml\b|single sign[- ]on/i],
  ['API publique', /\bapi\b (docs|documentation|reference|publique)|developers?\.[a-z0-9-]+\./i],
  ['Marque blanche', /white[- ]label|marque blanche/i],
  ['Garantie de remboursement', /money[- ]back|satisfait ou rembours/i],
  ['Tarif par utilisateur', /per (user|seat)|par utilisateur|\/utilisateur/i],
  ['Remise annuelle', /save \d+%|[ée]conomisez \d+%|billed annually|factur[ée] annuellement/i]
];

const PROOF_HOSTS: Array<[string, RegExp]> = [
  ['G2', /g2\.com/i],
  ['Capterra', /capterra\./i],
  ['Trustpilot', /trustpilot\./i],
  ['Product Hunt', /producthunt\.com/i],
  ['GitHub', /github\.com/i],
  ['LinkedIn', /linkedin\.com/i],
  ['X / Twitter', /(twitter|x)\.com\//i],
  ['YouTube', /youtube\.com|youtu\.be/i],
  ['Discord', /discord\.(gg|com)/i],
  ['Slack Community', /slack\.com\/(join|community)/i],
  ['Reddit', /reddit\.com/i],
  ['App Store', /apps\.apple\.com/i],
  ['Google Play', /play\.google\.com/i]
];

const KNOWN_INTEGRATIONS = [
  'Slack', 'Notion', 'HubSpot', 'Salesforce', 'Zapier', 'Make', 'Stripe', 'Shopify', 'Jira', 'Linear',
  'GitHub', 'GitLab', 'Figma', 'Airtable', 'Microsoft Teams', 'Zoom', 'Zendesk', 'Intercom', 'Webflow',
  'WordPress', 'Discord', 'Trello', 'Asana', 'ClickUp', 'Monday', 'Outlook', 'Gmail', 'Google Sheets',
  'Google Drive', 'Dropbox', 'QuickBooks', 'Xero', 'Twilio', 'OpenAI', 'Anthropic', 'Calendly', 'Pipedrive'
];

const PRICE_PATTERN =
  /(?:(?:€|\$|£|CHF|USD|EUR|GBP)\s?\d{1,5}(?:[ .,]\d{1,3})?|\d{1,5}(?:[.,]\d{1,2})?\s?(?:€|\$|£|CHF|USD|EUR|GBP))(?:\s?(?:\/|par |per )\s?(?:mois|month|mo\b|an\b|year|yr\b|utilisateur|user|si[èe]ge|seat|poste))?/gi;

function unique(values: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

/** Tout ce qu'on peut affirmer sans demander son avis à un modèle. */
export function extractFacts(pages: FetchedPage[]): SiteFacts {
  const html = pages.map((page) => page.html).join(' ').slice(0, 600_000);
  const text = pages.map((page) => page.text).join(' ');

  const home = pages.find((page) => page.role === 'accueil');
  const metaDescription =
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']{0,320})["']/i.exec(home?.html ?? '')?.[1] ??
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{0,320})["']/i.exec(home?.html ?? '')?.[1] ??
    '';

  const headings: string[] = [];
  const headingPattern = /<h([1-3])[^>]*>([\s\S]{0,240}?)<\/h\1>/gi;
  let heading: RegExpExecArray | null;
  while ((heading = headingPattern.exec(html)) !== null) {
    const value = stripHtml(heading[2] ?? '');
    if (value.length >= 3 && value.length <= 120) headings.push(value);
  }

  const languages: string[] = [];
  const hreflang = /hreflang=["']([a-z]{2}(?:-[A-Za-z]{2})?)["']/gi;
  let lang: RegExpExecArray | null;
  while ((lang = hreflang.exec(html)) !== null) {
    const value = (lang[1] ?? '').split('-')[0]!.toLowerCase();
    if (value && value !== 'x') languages.push(value);
  }

  return {
    metaDescription: stripHtml(metaDescription).slice(0, 320),
    headings: unique(headings, 28),
    priceMentions: unique(text.match(PRICE_PATTERN)?.map((price) => price.trim()) ?? [], 24),
    trustSignals: TRUST_PATTERNS.filter(([, pattern]) => pattern.test(text) || pattern.test(html)).map(
      ([label]) => label
    ),
    proofLinks: PROOF_HOSTS.filter(([, pattern]) => pattern.test(html)).map(([label]) => label),
    integrations: KNOWN_INTEGRATIONS.filter((name) =>
      new RegExp(`(^|[^a-z])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i').test(text)
    ).slice(0, 24),
    languages: unique(languages, 12)
  };
}

/* ------------------------------------------------------------------ */
/* Schéma du rapport                                                   */
/* ------------------------------------------------------------------ */

const REPORT_SHAPE = `{
  "name": "nom du produit",
  "url": "url canonique",
  "category": "categorie precise",
  "summary": "synthese en 2 phrases : ce que fait le produit et pour qui",
  "pricing": "resume de la tarification en une phrase",
  "pricingModel": {
    "type": "abonnement|usage|licence|freemium|gratuit|mixte|inconnu",
    "entryPrice": "prix d'entree tel qu'affiche, ou non communique",
    "freeTier": "oui|non|inconnu",
    "freeTrial": "duree de l'essai, ou non",
    "seatBased": "oui|non|inconnu",
    "annualDiscount": "remise annuelle affichee, ou non"
  },
  "pricingTiers": [
    { "name": "nom du palier", "price": "prix affiche", "billing": "mensuel|annuel|unique|gratuit", "target": "pour qui", "includes": ["element inclus"] }
  ],
  "strengths": ["ce qu'ils font vraiment bien (3 a 5)"],
  "weaknesses": ["faiblesse exploitable, precise et verifiable (4 a 6)"],
  "missingFeatures": ["besoin non couvert (3 a 5)"],
  "featureMatrix": [
    { "feature": "fonctionnalite comparable", "them": "ce qu'ils proposent exactement", "us": "ce qu'on fait a la place", "gap": "faible|moyen|fort" }
  ],
  "proofPoints": [
    { "claim": "preuve sociale affichee sur le site : chiffre, logo client, certification, avis", "source": "url de la page lue ou elle apparait" }
  ],
  "targetAudience": "client type en une phrase",
  "icp": [
    { "segment": "segment client", "pain": "douleur principale", "trigger": "evenement qui declenche l'achat" }
  ],
  "acquisitionChannels": [
    { "channel": "SEO|Ads|Communaute|Contenu|Partenariats|Product-led", "evidence": "ce qui le laisse penser", "ourAngle": "comment on s'y insere" }
  ],
  "seoKeywords": [
    { "keyword": "requete", "intent": "informationnel|commercial|transactionnel", "difficulty": "faible|moyenne|forte" }
  ],
  "battlecard": [
    { "objection": "objection d'un prospect qui nous compare a eux", "response": "reponse factuelle, sans denigrement (3 a 5)" }
  ],
  "moat": "ce qui les protege reellement : donnees, effet de reseau, integrations, marque, contrats",
  "switchingCost": "ce qui retient un client chez eux, et comment on abaisse ce cout",
  "whyNow": "pourquoi le moment est favorable a un nouvel entrant sur ce marche",
  "recommendedPositioning": "positionnement pour gagner face a eux",
  "pricingExploit": "angle d'attaque tarifaire concret",
  "differentiators": ["ce qui nous rend different, pas juste moins cher (3 a 5)"],
  "viralMarketingHook": "accroche publicitaire",
  "mvpCoreFeatures": ["fonctionnalite indispensable du MVP (3 a 6)"],
  "mvpOutOfScope": ["ce qu'on ne fait volontairement PAS au depart (2 a 4)"],
  "plan90Days": [
    { "phase": "Jours 1-30", "goal": "objectif", "actions": ["action concrete"] }
  ],
  "risks": ["risque serieux : barriere a l'entree, dependance, aspect juridique (2 a 4)"],
  "competitors": [
    { "name": "concurrent", "url": "domaine", "price": "prix constate", "angle": "sa proposition" }
  ],
  "scores": { "opportunity": 0-100, "difficulty": 0-100, "timeToMarketDays": 0, "confidence": 0-100 }
}`;

function buildPrompt(options: {
  query: string;
  isKeyword: boolean;
  persona: string;
  job: string;
  pages: FetchedPage[];
  facts: SiteFacts | null;
  techSignals: string[];
  failed: string[];
}): string {
  const { query, isKeyword, persona, job, pages, facts, techSignals, failed } = options;

  const evidence = pages.length
    ? pages
        .map((page) => `--- PAGE LUE [${ROLE_LABELS[page.role]}] : ${page.url}\nTITRE : ${page.title}\n${page.text}`)
        .join('\n\n')
        .slice(0, EVIDENCE_CHARS)
    : '';

  const factLine = (label: string, values: string[]): string =>
    values.length ? `${label} : ${values.join(' · ')}` : '';

  const factsBlock =
    facts && pages.length
      ? [
          '[FAITS RELEVES MECANIQUEMENT DANS LE HTML — deja verifies, reprends-les tels quels]',
          facts.metaDescription ? `Promesse affichee : ${facts.metaDescription}` : '',
          factLine('Montants trouves sur les pages', facts.priceMentions),
          factLine('Arguments de reassurance annonces', facts.trustSignals),
          factLine('Produits tiers cites', facts.integrations),
          factLine('Plateformes d avis et communautes', facts.proofLinks),
          factLine('Langues du site', facts.languages),
          factLine('Technologies detectees', techSignals),
          factLine('Titres de sections', facts.headings.slice(0, 18))
        ]
          .filter(Boolean)
          .join('\n')
      : '';

  const evidenceBlock = isKeyword
    ? `[DONNEES]
Aucune page a lire dans ce mode : appuie-toi sur ta connaissance du marche, et signale-le en abaissant "confidence".`
    : evidence
      ? `[PAGES REELLEMENT LUES — la source de verite, prime sur ta memoire]
${evidence}`
      : `[AUCUNE PAGE LUE]
Les pages n'ont pas pu etre recuperees (${failed.join(', ') || 'acces refuse'}).
Base-toi sur ta connaissance, abaisse "confidence" en dessous de 45 et ne fabrique aucun prix precis.`;

  const mission = isKeyword
    ? `Cartographie la niche "${query}" : qui sert deja ce marche, ce qui manque, et par ou un nouvel entrant peut passer.
Remplis "competitors" avec 4 a 6 acteurs reels et leurs prix : c'est le point de depart de l'analyse suivante.
"proofPoints" reste vide en mode niche : aucune page n'a ete lue.`
    : `Analyse le concurrent "${query}" a partir des ${pages.length} page(s) ci-dessus.
Exploite CHAQUE page lue : les tarifs donnent les paliers, les fonctionnalites alimentent "featureMatrix",
les pages clients alimentent "proofPoints", les nouveautes disent leur rythme de livraison.
Extrais les paliers de prix REELS tels qu'ils sont affiches. Si une information n'apparait dans aucune page,
ne l'invente pas : ecris "non communique".
Chaque "proofPoints.source" doit etre l'URL d'une page effectivement lue.
Remplis "competitors" avec ses 3 a 5 alternatives directes.`;

  return `[ROLE]
${persona}
${job}

[MISSION]
${mission}

${evidenceBlock}

${factsBlock}

[CONTEXTE OMNIVENTURE]
Nous lancons des micro-SaaS sur Cloudflare, modele essai 0,50 $ pendant 48 h puis abonnement mensuel.
Le MVP doit tenir en moins de trois jours de developpement.

[FORMAT]
Reponds STRICTEMENT par un objet JSON valide, sans markdown, sans texte autour, avec exactement cette forme :
${REPORT_SHAPE}

Ecris en francais. Sois concret : des chiffres, des noms, des faits verifiables plutot que des generalites.`;
}

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

const asArray = (value: unknown, max = 12): any[] =>
  Array.isArray(value) ? value.filter((entry) => entry != null).slice(0, max) : [];

const asStrings = (value: unknown, max = 12): string[] =>
  asArray(value, max).map((entry) => String(typeof entry === 'string' ? entry : JSON.stringify(entry))).filter(Boolean);

const asText = (value: unknown, max: number, fallback = ''): string =>
  String(value ?? fallback).slice(0, max);

const clamp = (value: unknown, fallback: number): number => {
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(0, Math.min(100, Math.round(num))) : fallback;
};

function normalize(raw: any, fallbackName: string, fallbackUrl: string, confidence: number) {
  return {
    name: asText(raw?.name, 120, fallbackName),
    url: asText(raw?.url, 300, fallbackUrl),
    category: asText(raw?.category, 120, 'Non classe'),
    summary: asText(raw?.summary, 600),
    pricing: asText(raw?.pricing, 300, 'Non communique'),
    pricingModel: {
      type: asText(raw?.pricingModel?.type, 40, 'inconnu'),
      entryPrice: asText(raw?.pricingModel?.entryPrice, 60, 'non communique'),
      freeTier: asText(raw?.pricingModel?.freeTier, 20, 'inconnu'),
      freeTrial: asText(raw?.pricingModel?.freeTrial, 60, 'inconnu'),
      seatBased: asText(raw?.pricingModel?.seatBased, 20, 'inconnu'),
      annualDiscount: asText(raw?.pricingModel?.annualDiscount, 60, 'non')
    },
    pricingTiers: asArray(raw?.pricingTiers, 8).map((tier: any) => ({
      name: asText(tier?.name, 60, '—'),
      price: asText(tier?.price, 60, 'non communique'),
      billing: asText(tier?.billing, 30, '—'),
      target: asText(tier?.target, 120),
      includes: asStrings(tier?.includes, 8).map((line) => line.slice(0, 160))
    })),
    strengths: asStrings(raw?.strengths, 6),
    weaknesses: asStrings(raw?.weaknesses, 8),
    missingFeatures: asStrings(raw?.missingFeatures, 8),
    featureMatrix: asArray(raw?.featureMatrix, 10).map((entry: any) => ({
      feature: asText(entry?.feature, 90),
      them: asText(entry?.them, 200),
      us: asText(entry?.us, 200),
      gap: asText(entry?.gap, 20, 'moyen')
    })),
    proofPoints: asArray(raw?.proofPoints, 8).map((entry: any) => ({
      claim: asText(entry?.claim, 240),
      source: asText(entry?.source, 300)
    })),
    targetAudience: asText(raw?.targetAudience, 300),
    icp: asArray(raw?.icp, 5).map((entry: any) => ({
      segment: asText(entry?.segment, 100),
      pain: asText(entry?.pain, 240),
      trigger: asText(entry?.trigger, 240)
    })),
    acquisitionChannels: asArray(raw?.acquisitionChannels, 6).map((entry: any) => ({
      channel: asText(entry?.channel, 60),
      evidence: asText(entry?.evidence, 240),
      ourAngle: asText(entry?.ourAngle, 240)
    })),
    seoKeywords: asArray(raw?.seoKeywords, 12).map((entry: any) => ({
      keyword: asText(entry?.keyword, 90),
      intent: asText(entry?.intent, 40),
      difficulty: asText(entry?.difficulty, 20)
    })),
    battlecard: asArray(raw?.battlecard, 6).map((entry: any) => ({
      objection: asText(entry?.objection, 200),
      response: asText(entry?.response, 320)
    })),
    moat: asText(raw?.moat, 400),
    switchingCost: asText(raw?.switchingCost, 400),
    whyNow: asText(raw?.whyNow, 400),
    recommendedPositioning: asText(raw?.recommendedPositioning, 400),
    pricingExploit: asText(raw?.pricingExploit, 400),
    differentiators: asStrings(raw?.differentiators, 6),
    viralMarketingHook: asText(raw?.viralMarketingHook, 300),
    mvpCoreFeatures: asStrings(raw?.mvpCoreFeatures, 8),
    mvpOutOfScope: asStrings(raw?.mvpOutOfScope, 6),
    plan90Days: asArray(raw?.plan90Days, 4).map((entry: any) => ({
      phase: asText(entry?.phase, 60),
      goal: asText(entry?.goal, 240),
      actions: asStrings(entry?.actions, 6).map((line) => line.slice(0, 200))
    })),
    risks: asStrings(raw?.risks, 6),
    competitors: asArray(raw?.competitors, 8).map((entry: any) => ({
      name: asText(entry?.name, 80),
      url: asText(entry?.url, 160),
      price: asText(entry?.price, 60),
      angle: asText(entry?.angle, 240)
    })),
    scores: {
      opportunity: clamp(raw?.scores?.opportunity, 50),
      difficulty: clamp(raw?.scores?.difficulty, 50),
      timeToMarketDays: Math.max(0, Math.min(365, Number(raw?.scores?.timeToMarketDays) || 3)),
      confidence: clamp(raw?.scores?.confidence, confidence)
    }
  };
}

/** Rapport minimal quand aucune clé n'est disponible : honnête sur son statut. */
function heuristicReport(query: string, isKeyword: boolean) {
  const label = query.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  return normalize(
    {
      name: isKeyword ? `Niche : ${query}` : label,
      url: isKeyword ? `Mots-cles : ${query}` : `https://${label}`,
      category: isKeyword ? 'Niche a qualifier' : 'Concurrent a qualifier',
      summary:
        "Aucune cle OpenRouter n'est configuree : ce rapport est un squelette, pas une analyse. Connectez une cle pour lire reellement le site et obtenir des donnees.",
      pricing: 'Non communique',
      weaknesses: ['Analyse non executee — cle OpenRouter absente'],
      missingFeatures: ['Analyse non executee'],
      recommendedPositioning: 'A determiner apres analyse',
      pricingExploit: 'Essai 0,50 $ pendant 48 h puis abonnement mensuel',
      targetAudience: 'A determiner',
      mvpCoreFeatures: ['A determiner'],
      scores: { opportunity: 0, difficulty: 0, timeToMarketDays: 3, confidence: 0 }
    },
    label,
    isKeyword ? query : `https://${label}`,
    0
  );
}

/**
 * Un schéma plus riche, c'est une réponse plus longue — donc un risque accru de
 * JSON tronqué. On tente une réparation évidente (virgule finale, accolades
 * manquantes) avant d'abandonner.
 */
function parseReport(cleaned: string): any | null {
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0) return null;

  if (end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      /* on tente la réparation ci-dessous */
    }
  }

  let candidate = cleaned.slice(start).replace(/,\s*$/, '');
  const opened = (candidate.match(/{/g) ?? []).length - (candidate.match(/}/g) ?? []).length;
  const openedArrays = (candidate.match(/\[/g) ?? []).length - (candidate.match(/]/g) ?? []).length;
  candidate += ']'.repeat(Math.max(0, openedArrays)) + '}'.repeat(Math.max(0, opened));

  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Route                                                               */
/* ------------------------------------------------------------------ */

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals as any)?.runtime?.env;
    const body = (await request.json()) as any;
    const {
      query,
      searchType = 'domain',
      openRouterKey,
      model = 'google/gemini-2.5-flash',
      ameMd,
      jobMd,
      temperature = 0.2
    } = body ?? {};

    if (!query || typeof query !== 'string' || !query.trim()) {
      return json({ error: 'Domaine ou mot-cle requis' }, 400);
    }

    const cleanQuery = query.trim();
    const isKeyword = searchType === 'keyword';
    const key: string | undefined = openRouterKey?.trim() || env?.OPENROUTER_API_KEY;

    if (!key || !key.startsWith('sk-or-')) {
      return json({
        success: true,
        data: heuristicReport(cleanQuery, isKeyword),
        source: 'heuristic',
        modelUsed: null,
        sources: [],
        pagesRead: [],
        techSignals: [],
        facts: null
      });
    }

    // 1. Lecture réelle du site (mode domaine uniquement).
    const evidence = isKeyword
      ? { pages: [] as FetchedPage[], sources: [] as string[], failed: [] as string[] }
      : await collectEvidence(cleanQuery);
    const techSignals = detectTech(evidence.pages);
    const facts = evidence.pages.length ? extractFacts(evidence.pages) : null;
    const pagesRead = evidence.pages.map((page) => ({
      url: page.url,
      role: page.role,
      label: ROLE_LABELS[page.role],
      title: page.title,
      chars: page.text.length
    }));

    // 2. Analyse.
    const prompt = buildPrompt({
      query: cleanQuery,
      isKeyword,
      persona:
        ameMd ||
        "Tu es l'analyste concurrentiel d'OmniVenture. Tu cherches des faits exploitables, pas des generalites de consultant.",
      job:
        jobMd ||
        "Tu produis un dossier qu'un fondateur peut executer tel quel : prix reels, failles precises, plan de lancement.",
      pages: evidence.pages,
      facts,
      techSignals,
      failed: evidence.failed
    });

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'HTTP-Referer': 'https://factory.dev',
        'X-Title': 'OmniVenture AI - Market Analysis'
      },
      body: JSON.stringify({
        model: model || 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: prompt }],
        temperature: typeof temperature === 'number' ? temperature : 0.2,
        // Le dossier est nettement plus long qu'avant : sous 8000 jetons il
        // arrivait tronqué, donc illisible.
        max_tokens: 8000,
        response_format: { type: 'json_object' }
      })
    });

    if (!res.ok) {
      return json({ error: `OpenRouter ${res.status} : ${(await res.text()).slice(0, 200)}` }, 502);
    }

    const completion = (await res.json()) as any;
    const rawText: string = completion.choices?.[0]?.message?.content ?? '';
    const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = parseReport(cleaned);
    if (!parsed) return json({ error: 'Reponse illisible du modele (JSON invalide)' }, 502);

    const fallbackName = cleanQuery.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    const data = normalize(
      parsed,
      isKeyword ? `Niche : ${cleanQuery}` : fallbackName,
      isKeyword ? cleanQuery : normalizeUrl(cleanQuery),
      // Plus on a lu de pages, plus le rapport mérite qu'on lui fasse crédit.
      evidence.pages.length >= 3 ? 78 : evidence.pages.length > 0 ? 65 : 40
    );

    return json({
      success: true,
      data,
      source: 'openrouter_live',
      modelUsed: completion.model || model,
      sources: evidence.sources,
      failedSources: evidence.failed,
      pagesRead,
      techSignals,
      facts,
      tokens: {
        input: completion.usage?.prompt_tokens ?? 0,
        output: completion.usage?.completion_tokens ?? 0
      }
    });
  } catch (error: any) {
    return json({ error: error?.message || 'Erreur serveur' }, 500);
  }
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
