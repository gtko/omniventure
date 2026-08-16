/**
 * Analyse concurrentielle.
 *
 * Deux modes :
 *   - « domain »  : on VA LIRE le site (accueil + pages de tarifs) et on donne
 *     ce texte au modèle. Sans ça l'analyse n'est qu'un souvenir de modèle,
 *     souvent périmé et parfois inventé.
 *   - « keyword » : pas d'URL à lire, le modèle cartographie la niche et
 *     propose les concurrents à analyser ensuite un par un.
 *
 * Le rapport distingue toujours ce qui vient des pages réellement lues
 * (`sources`) de ce qui relève de l'estimation (`scores.confidence`).
 */

import type { APIRoute } from 'astro';

export const prerender = false;

const FETCH_TIMEOUT_MS = 9000;
const MAX_PAGE_CHARS = 14000;
const UA = 'Mozilla/5.0 (compatible; OmniVentureBot/1.0; veille concurrentielle)';

/** Chemins qui contiennent la tarification dans l'immense majorité des SaaS. */
const PRICING_PATHS = ['/pricing', '/tarifs', '/plans', '/price', '/prix'];

interface FetchedPage {
  url: string;
  status: number;
  title: string;
  text: string;
  html: string;
}

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
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchPage(url: string): Promise<FetchedPage | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.includes('html')) return { url, status: res.status, title: '', text: '', html: '' };
    const html = (await res.text()).slice(0, 400_000);
    const title = /<title[^>]*>([\s\S]{0,200}?)<\/title>/i.exec(html)?.[1]?.trim() ?? '';
    return { url, status: res.status, title, text: stripHtml(html).slice(0, MAX_PAGE_CHARS), html };
  } catch {
    return null;
  }
}

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

/** Accueil + première page de tarifs trouvée. */
export async function collectEvidence(target: string): Promise<{ pages: FetchedPage[]; sources: string[]; failed: string[] }> {
  const root = normalizeUrl(target);
  const pages: FetchedPage[] = [];
  const sources: string[] = [];
  const failed: string[] = [];

  const home = await fetchPage(root);
  if (home?.text) {
    pages.push(home);
    sources.push(home.url);
  } else {
    failed.push(root);
  }

  let base: URL;
  try {
    base = new URL(root);
  } catch {
    return { pages, sources, failed };
  }

  for (const path of PRICING_PATHS) {
    const candidate = new URL(path, base).toString();
    const page = await fetchPage(candidate);
    if (page?.text && page.text.length > 200) {
      pages.push(page);
      sources.push(page.url);
      break; // une page de tarifs suffit
    }
  }

  return { pages, sources, failed };
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
  "pricingTiers": [
    { "name": "nom du palier", "price": "prix affiche", "billing": "mensuel|annuel|unique|gratuit", "target": "pour qui", "includes": ["element inclus"] }
  ],
  "strengths": ["ce qu'ils font vraiment bien (3 a 5)"],
  "weaknesses": ["faiblesse exploitable, precise et verifiable (4 a 6)"],
  "missingFeatures": ["besoin non couvert (3 a 5)"],
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
  failed: string[];
}): string {
  const { query, isKeyword, persona, job, pages, failed } = options;

  const evidence = pages.length
    ? pages
        .map((page) => `--- PAGE LUE : ${page.url}\nTITRE : ${page.title}\n${page.text}`)
        .join('\n\n')
        .slice(0, 26000)
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
Remplis "competitors" avec 4 a 6 acteurs reels et leurs prix : c'est le point de depart de l'analyse suivante.`
    : `Analyse le concurrent "${query}" a partir des pages ci-dessus.
Extrais les paliers de prix REELS tels qu'ils sont affiches. Si une information n'apparait pas dans les pages, ne l'invente pas : ecris "non communique".
Remplis "competitors" avec ses 3 a 5 alternatives directes.`;

  return `[ROLE]
${persona}
${job}

[MISSION]
${mission}

${evidenceBlock}

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

const clamp = (value: unknown, fallback: number): number => {
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(0, Math.min(100, Math.round(num))) : fallback;
};

function normalize(raw: any, fallbackName: string, fallbackUrl: string, confidence: number) {
  return {
    name: String(raw?.name ?? fallbackName).slice(0, 120),
    url: String(raw?.url ?? fallbackUrl).slice(0, 300),
    category: String(raw?.category ?? 'Non classe').slice(0, 120),
    summary: String(raw?.summary ?? '').slice(0, 600),
    pricing: String(raw?.pricing ?? 'Non communique').slice(0, 300),
    pricingTiers: asArray(raw?.pricingTiers, 8).map((tier: any) => ({
      name: String(tier?.name ?? '—').slice(0, 60),
      price: String(tier?.price ?? 'non communique').slice(0, 60),
      billing: String(tier?.billing ?? '—').slice(0, 30),
      target: String(tier?.target ?? '').slice(0, 120),
      includes: asStrings(tier?.includes, 8).map((line) => line.slice(0, 160))
    })),
    strengths: asStrings(raw?.strengths, 6),
    weaknesses: asStrings(raw?.weaknesses, 8),
    missingFeatures: asStrings(raw?.missingFeatures, 8),
    targetAudience: String(raw?.targetAudience ?? '').slice(0, 300),
    icp: asArray(raw?.icp, 5).map((entry: any) => ({
      segment: String(entry?.segment ?? '').slice(0, 100),
      pain: String(entry?.pain ?? '').slice(0, 240),
      trigger: String(entry?.trigger ?? '').slice(0, 240)
    })),
    acquisitionChannels: asArray(raw?.acquisitionChannels, 6).map((entry: any) => ({
      channel: String(entry?.channel ?? '').slice(0, 60),
      evidence: String(entry?.evidence ?? '').slice(0, 240),
      ourAngle: String(entry?.ourAngle ?? '').slice(0, 240)
    })),
    seoKeywords: asArray(raw?.seoKeywords, 12).map((entry: any) => ({
      keyword: String(entry?.keyword ?? '').slice(0, 90),
      intent: String(entry?.intent ?? '').slice(0, 40),
      difficulty: String(entry?.difficulty ?? '').slice(0, 20)
    })),
    recommendedPositioning: String(raw?.recommendedPositioning ?? '').slice(0, 400),
    pricingExploit: String(raw?.pricingExploit ?? '').slice(0, 400),
    differentiators: asStrings(raw?.differentiators, 6),
    viralMarketingHook: String(raw?.viralMarketingHook ?? '').slice(0, 300),
    mvpCoreFeatures: asStrings(raw?.mvpCoreFeatures, 8),
    mvpOutOfScope: asStrings(raw?.mvpOutOfScope, 6),
    plan90Days: asArray(raw?.plan90Days, 4).map((entry: any) => ({
      phase: String(entry?.phase ?? '').slice(0, 60),
      goal: String(entry?.goal ?? '').slice(0, 240),
      actions: asStrings(entry?.actions, 6).map((line) => line.slice(0, 200))
    })),
    risks: asStrings(raw?.risks, 6),
    competitors: asArray(raw?.competitors, 8).map((entry: any) => ({
      name: String(entry?.name ?? '').slice(0, 80),
      url: String(entry?.url ?? '').slice(0, 160),
      price: String(entry?.price ?? '').slice(0, 60),
      angle: String(entry?.angle ?? '').slice(0, 240)
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
        techSignals: []
      });
    }

    // 1. Lecture réelle du site (mode domaine uniquement).
    const evidence = isKeyword
      ? { pages: [], sources: [] as string[], failed: [] as string[] }
      : await collectEvidence(cleanQuery);
    const techSignals = detectTech(evidence.pages);

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
        max_tokens: 4000,
        response_format: { type: 'json_object' }
      })
    });

    if (!res.ok) {
      return json({ error: `OpenRouter ${res.status} : ${(await res.text()).slice(0, 200)}` }, 502);
    }

    const completion = (await res.json()) as any;
    const rawText: string = completion.choices?.[0]?.message?.content ?? '';
    const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end < 0) return json({ error: 'Reponse illisible du modele' }, 502);

    let parsed: any;
    try {
      parsed = JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return json({ error: 'JSON invalide dans la reponse du modele' }, 502);
    }

    const fallbackName = cleanQuery.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    const data = normalize(
      parsed,
      isKeyword ? `Niche : ${cleanQuery}` : fallbackName,
      isKeyword ? cleanQuery : normalizeUrl(cleanQuery),
      evidence.pages.length > 0 ? 70 : 40
    );

    return json({
      success: true,
      data,
      source: 'openrouter_live',
      modelUsed: completion.model || model,
      sources: evidence.sources,
      failedSources: evidence.failed,
      techSignals,
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
