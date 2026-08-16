/**
 * Une phrase → un dossier de lancement, préparé par l'agence.
 *
 * Ce n'est pas un appel de modèle unique : chaque étape est confiée à l'agent
 * compétent, avec SON modèle et SA persona telle qu'elle est configurée dans le
 * graphe. Entre deux étapes, l'agence va réellement lire les sites des
 * concurrents — ce sont ces pages, et non la mémoire d'un modèle, qui servent
 * de base à l'analyse.
 *
 *   1. Cadrage              — l'orchestrateur reformule et désigne les cibles
 *   2. Lecture des sites    — aucune IA : on télécharge accueil + tarifs
 *   3. Analyse concurrence  — la veille exploite ce qui a été lu
 *   4. Produit & MVP        — l'architecte découpe
 *   5. Design & marque      — la direction artistique nomme et habille
 *   6. Growth & tarification— le CRO fixe les prix et les canaux
 *   7. Recrutement          — la DRH dit qui manque pour y arriver
 *
 * La progression est diffusée au fil de l'eau (flux SSE) : l'opérateur voit qui
 * travaille, et le bureau peut animer les échanges correspondants.
 */

import type { APIRoute } from 'astro';
import { cultureBlock, type CulturePillar } from '../../../lib/culture';
import { askModelJson } from '../../../lib/model-json';
import { collectEvidence, detectTech } from '../market/analyze';

export const prerender = false;

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface GraphAgentInput {
  id: string;
  role: string;
  modelId?: string;
  ameMd?: string;
  jobMd?: string;
  temperature?: number;
}

interface StepDefinition {
  /** Identifiant de l'agent dans le graphe. */
  agentId: string;
  /** Repli si cet agent n'existe pas (graphe personnalisé). */
  fallbackRole: string;
  key: string;
  label: string;
}

const FALLBACK_MODEL = 'google/gemini-2.5-flash';

/* ------------------------------------------------------------------ */
/* Appel d'un agent                                                    */
/* ------------------------------------------------------------------ */

async function askAgent(options: {
  key: string;
  agent: GraphAgentInput | undefined;
  fallbackRole: string;
  instruction: string;
  shape: string;
  maxTokens?: number;
  culture?: CulturePillar[] | null;
  onRetry?: (info: { attempt: number; max: number; reason: string }) => void;
}): Promise<{ data: any; model: string; tokens: number; attempts: number }> {
  const { agent, fallbackRole, instruction, shape } = options;
  const persona = agent?.ameMd?.trim() || `Tu es ${agent?.role || fallbackRole} chez OmniVenture.`;
  const job = agent?.jobMd?.trim() || '';

  const prompt = `${cultureBlock(options.culture)}

${persona}
${job}

${instruction}

[FORMAT]
Réponds STRICTEMENT par un objet JSON valide, sans markdown, sans texte autour :
${shape}

Écris en français. Sois concret : des noms, des chiffres, des faits. Aucune généralité de consultant.`;

  return askModelJson({
    key: options.key,
    model: agent?.modelId || FALLBACK_MODEL,
    prompt,
    temperature: agent?.temperature ?? 0.5,
    maxTokens: options.maxTokens,
    title: 'OmniVenture AI - Venture Blueprint',
    onRetry: options.onRetry
  });
}

/* ------------------------------------------------------------------ */
/* Étapes                                                              */
/* ------------------------------------------------------------------ */

const STEPS: StepDefinition[] = [
  { key: 'cadrage', agentId: 'master', fallbackRole: 'Orchestrateur', label: 'Cadrage de la demande' },
  { key: 'lecture', agentId: 'market_scraper_agent', fallbackRole: 'Scraper web', label: 'Lecture des sites concurrents' },
  { key: 'concurrence', agentId: 'market_agent', fallbackRole: 'Veille concurrentielle', label: 'Analyse concurrentielle' },
  { key: 'produit', agentId: 'lead_dev', fallbackRole: 'Architecte', label: 'Produit & MVP' },
  { key: 'design', agentId: 'design_lead', fallbackRole: 'Direction artistique', label: 'Marque & design' },
  { key: 'growth', agentId: 'cro_agent', fallbackRole: 'CRO', label: 'Tarification & acquisition' },
  { key: 'recrutement', agentId: 'hr_agent', fallbackRole: 'DRH', label: 'Recrutements nécessaires' }
];

const slugify = (input: string) =>
  input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'venture';

const asStrings = (value: unknown, max: number): string[] =>
  Array.isArray(value)
    ? value.filter((entry) => typeof entry === 'string' && entry.trim()).slice(0, max).map((entry) => entry.slice(0, 240))
    : [];

const asObjects = (value: unknown, max: number): any[] =>
  Array.isArray(value) ? value.filter((entry) => entry && typeof entry === 'object').slice(0, max) : [];

const clampInt = (value: unknown, fallback: number, min: number, max: number) => {
  const num = Math.round(Number(value));
  return Number.isFinite(num) ? Math.max(min, Math.min(max, num)) : fallback;
};

/* ------------------------------------------------------------------ */
/* Route                                                               */
/* ------------------------------------------------------------------ */

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any)?.runtime?.env;
  const body = (await request.json().catch(() => ({}))) as {
    idea?: string;
    openRouterKey?: string;
    graph?: GraphAgentInput[];
    culture?: CulturePillar[];
  };

  const idea = body.idea?.trim() ?? '';
  if (idea.length < 10) return json({ error: 'Décrivez en une phrase ce que vous voulez lancer.' }, 400);

  const key = body.openRouterKey?.trim() || env?.OPENROUTER_API_KEY;
  if (!key || !key.startsWith('sk-or-')) {
    return json({ error: 'Clé OpenRouter absente : renseignez-la dans le studio d’agents.' }, 400);
  }

  const graph = Array.isArray(body.graph) ? body.graph : [];
  const culture = Array.isArray(body.culture) ? body.culture : null;
  const agentOf = (id: string) => graph.find((agent) => agent.id === id);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      const step = (definition: StepDefinition, status: 'start' | 'done', extra: Record<string, unknown> = {}) => {
        const agent = agentOf(definition.agentId);
        send({
          type: 'step',
          key: definition.key,
          label: definition.label,
          status,
          agentId: definition.agentId,
          agentRole: agent?.role ?? definition.fallbackRole,
          model: agent?.modelId ?? FALLBACK_MODEL,
          ...extra
        });
      };


      /**
       * Un métier retente jusqu'à trois fois avant d'abandonner, et son échec
       * final vide sa section sans emporter le dossier.
       */
      const failures: string[] = [];
      const safeAsk = async (
        definition: StepDefinition,
        options: Parameters<typeof askAgent>[0]
      ): Promise<{ data: any; model: string; tokens: number; ok: boolean }> => {
        try {
          const result = await askAgent({
            ...options,
            onRetry: ({ attempt, max, reason }) =>
              send({
                type: 'retry',
                key: definition.key,
                label: definition.label,
                attempt,
                max,
                reason: reason.slice(0, 140)
              })
          });
          return { ...result, ok: true };
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'échec';
          failures.push(`${definition.label} — ${reason} (3 tentatives)`);
          return { data: {}, model: options.agent?.modelId ?? FALLBACK_MODEL, tokens: 0, ok: false };
        }
      };

      let totalTokens = 0;

      try {
        /* 1. Cadrage ------------------------------------------------ */
        step(STEPS[0], 'start');
        const cadrage = await safeAsk(STEPS[0], {
          key,
          agent: agentOf('master'),
          fallbackRole: STEPS[0].fallbackRole,
          culture,
          instruction: `[DEMANDE DE L'OPÉRATEUR]\n${idea.slice(0, 1500)}\n\n[MISSION]\nReformule la demande en brief exploitable, puis désigne les cibles à étudier : 4 à 6 concurrents RÉELS et existants (domaines exacts, sans http), et les requêtes de recherche qui comptent sur ce marché.`,
          shape: `{
  "brief": "reformulation en 2 phrases de ce qu'il faut construire et pour qui",
  "market": "marche vise, en une phrase",
  "competitorDomains": ["exemple.com"],
  "searchQueries": ["requete"],
  "risks": ["risque a verifier tot"]
}`
        });
        totalTokens += cadrage.tokens;
        const domains = asStrings(cadrage.data?.competitorDomains, 6)
          .map((domain) => domain.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim())
          .filter((domain) => /\./.test(domain));
        step(STEPS[0], 'done', {
          summary: cadrage.ok ? `${domains.length} concurrents à étudier` : '⚠ étape échouée',
          failed: !cadrage.ok
        });

        /* 2. Lecture réelle des sites ------------------------------- */
        step(STEPS[1], 'start', { model: 'aucun modèle — lecture directe' });
        const dossierSources: string[] = [];
        const evidence: Array<{ domain: string; text: string; tech: string[] }> = [];
        for (const domain of domains.slice(0, 4)) {
          send({ type: 'read', domain, status: 'start' });
          const collected = await collectEvidence(domain);
          const text = collected.pages.map((page) => `--- ${page.url}\n${page.text}`).join('\n\n').slice(0, 9000);
          if (text) {
            evidence.push({ domain, text, tech: detectTech(collected.pages) });
            dossierSources.push(...collected.sources);
          }
          send({ type: 'read', domain, status: 'done', pages: collected.sources.length });
        }
        step(STEPS[1], 'done', { summary: `${dossierSources.length} pages lues sur ${evidence.length} sites` });

        const evidenceBlock = evidence.length
          ? evidence
              .map((entry) => `### ${entry.domain} (technos : ${entry.tech.join(', ') || 'non détectées'})\n${entry.text}`)
              .join('\n\n')
              .slice(0, 24000)
          : "Aucune page n'a pu être lue : signale-le et reste prudent sur les prix.";

        /* 3. Analyse concurrentielle -------------------------------- */
        step(STEPS[2], 'start');
        const concurrence = await safeAsk(STEPS[2], {
          key,
          agent: agentOf('market_agent'),
          fallbackRole: STEPS[2].fallbackRole,
          culture,
          maxTokens: 3200,
          instruction: `[PROJET]\n${cadrage.data?.brief ?? idea}\n\n[PAGES RÉELLEMENT LUES — source de vérité, prime sur ta mémoire]\n${evidenceBlock}\n\n[MISSION]\nDresse l'état du marché : qui est là, à quel prix, ce qu'ils font bien, et où se trouve la brèche. N'invente aucun prix qui n'apparaît pas dans les pages : écris "non communiqué".`,
          shape: `{
  "competitors": [{ "name": "", "url": "", "price": "", "strength": "", "weakness": "" }],
  "priceRange": "fourchette constatee sur le marche",
  "gap": "la breche exploitable, en une phrase",
  "differentiators": ["ce qui nous rendrait different (3 a 5)"],
  "positioning": "positionnement recommande",
  "opportunityScore": 0
}`
        });
        totalTokens += concurrence.tokens;
        step(STEPS[2], 'done', {
          summary: concurrence.ok ? concurrence.data?.gap?.slice(0, 90) ?? 'analyse produite' : '⚠ étape échouée',
          failed: !concurrence.ok
        });

        const marketContext = `[PROJET]\n${cadrage.data?.brief ?? idea}\n[MARCHÉ]\n${cadrage.data?.market ?? ''}\n[POSITIONNEMENT RETENU]\n${concurrence.data?.positioning ?? ''}\n[BRÈCHE]\n${concurrence.data?.gap ?? ''}\n[PRIX DU MARCHÉ]\n${concurrence.data?.priceRange ?? ''}`;

        /* 4-6. Produit, design, growth — en parallèle --------------- */
        step(STEPS[3], 'start');
        step(STEPS[4], 'start');
        step(STEPS[5], 'start');

        const [produit, design, growth] = await Promise.all([
          safeAsk(STEPS[3], {
            key,
            agent: agentOf('lead_dev'),
            fallbackRole: STEPS[3].fallbackRole,
            culture,
            instruction: `${marketContext}\n\n[MISSION]\nDécoupe le produit : ce que contient le MVP (livrable en moins de 3 jours sur Astro + Cloudflare D1/Workers), ce qu'on écarte volontairement, et les briques techniques à prévoir.`,
            shape: `{
  "mvpFeatures": ["fonctionnalite (4 a 6)"],
  "outOfScope": ["ce qu'on ne fait pas au depart (2 a 4)"],
  "stack": ["brique technique"],
  "integrations": ["service externe necessaire"],
  "effortDays": 3,
  "mainTechnicalRisk": ""
}`
          }),
          safeAsk(STEPS[4], {
            key,
            agent: agentOf('design_lead'),
            fallbackRole: STEPS[4].fallbackRole,
            culture,
            instruction: `${marketContext}\n\n[MISSION]\nDonne une identité à ce produit : un nom court et prononçable (vérifie qu'il ne copie aucun concurrent cité), une accroche, un ton, une palette hexadécimale, des typographies, et les écrans du MVP avec leur intention.`,
            shape: `{
  "name": "",
  "domain": "nomdedomaine.com",
  "tagline": "moins de 70 caracteres",
  "tone": "",
  "palette": ["#000000"],
  "typography": { "heading": "", "body": "" },
  "screens": [{ "name": "", "goal": "", "keyElements": ["" ] }],
  "visualDirection": ""
}`
          }),
          safeAsk(STEPS[5], {
            key,
            agent: agentOf('cro_agent'),
            fallbackRole: STEPS[5].fallbackRole,
            culture,
            instruction: `${marketContext}\n\n[MISSION]\nFixe la tarification chiffrée et la façon d'aller chercher les premiers clients. La maison pratique un essai payant très bas (0,50 $ / 48 h) puis un abonnement mensuel — garde ce modèle s'il convient, propose autre chose s'il ne convient pas, et justifie.`,
            shape: `{
  "businessModel": "trial_rebill | freemium | one_time | affiliate_commission",
  "trialCents": 50,
  "recurringCents": 2900,
  "trialHours": 48,
  "pricingRationale": "",
  "acquisition": [{ "channel": "", "angle": "", "firstAction": "" }],
  "seoKeywords": ["requete"],
  "hook": "accroche publicitaire"
}`
          })
        ]);
        totalTokens += produit.tokens + design.tokens + growth.tokens;
        step(STEPS[3], 'done', {
          summary: produit.ok ? `${asStrings(produit.data?.mvpFeatures, 8).length} fonctionnalités au MVP` : '⚠ étape échouée',
          failed: !produit.ok
        });
        step(STEPS[4], 'done', {
          summary: design.ok ? design.data?.name ?? 'identité produite' : '⚠ étape échouée',
          failed: !design.ok
        });
        step(STEPS[5], 'done', {
          summary: growth.ok ? `${(Number(growth.data?.recurringCents) || 0) / 100} €/mois` : '⚠ étape échouée',
          failed: !growth.ok
        });

        /* 7. Recrutement -------------------------------------------- */
        step(STEPS[6], 'start');
        const recrutement = await safeAsk(STEPS[6], {
          key,
          agent: agentOf('hr_agent'),
          fallbackRole: STEPS[6].fallbackRole,
          culture,
          instruction: `${marketContext}\n\n[MVP RETENU]\n${asStrings(produit.data?.mvpFeatures, 8).join(' · ')}\n[ACQUISITION]\n${asObjects(growth.data?.acquisition, 5).map((entry: any) => entry?.channel).join(' · ')}\n\n[ORGANIGRAMME ACTUEL]\n${graph.map((agent) => `- ${agent.id} : ${agent.role}`).join('\n') || '(inconnu)'}\n\n[MISSION]\nDis qui manque pour mener ce projet. Ne propose un recrutement que si aucun agent existant ne couvre le besoin — sinon nomme l'agent qui s'en charge. Sois économe : une organisation qui gonfle sans raison coûte cher.`,
          shape: `{
  "covered": [{ "need": "", "byAgentId": "" }],
  "hires": [{ "role": "", "hierarchyLevel": "expert", "teamName": "", "why": "", "urgency": "basse | moyenne | haute" }]
}`
        });
        totalTokens += recrutement.tokens;
        const hires = asObjects(recrutement.data?.hires, 5);
        step(STEPS[6], 'done', {
          summary: !recrutement.ok
            ? '⚠ étape échouée'
            : hires.length > 0
              ? `${hires.length} recrutement(s) proposé(s)`
              : 'aucun recrutement nécessaire',
          failed: !recrutement.ok
        });

        /* Dossier final — assemblé en code, sans appel supplémentaire */
        const name = String(design.data?.name ?? idea.slice(0, 30)).slice(0, 60).trim();
        const slug = slugify(name);

        send({
          type: 'done',
          dossier: {
            idea,
            brief: String(cadrage.data?.brief ?? '').slice(0, 600),
            market: String(cadrage.data?.market ?? '').slice(0, 300),
            name,
            slug,
            domain: String(design.data?.domain ?? `${slug}.factory.dev`).slice(0, 100),
            tagline: String(design.data?.tagline ?? '').slice(0, 140),
            positioning: String(concurrence.data?.positioning ?? '').slice(0, 400),
            gap: String(concurrence.data?.gap ?? '').slice(0, 300),
            priceRange: String(concurrence.data?.priceRange ?? '').slice(0, 160),
            opportunityScore: clampInt(concurrence.data?.opportunityScore, 50, 0, 100),
            competitors: asObjects(concurrence.data?.competitors, 6).map((entry: any) => ({
              name: String(entry?.name ?? '').slice(0, 80),
              url: String(entry?.url ?? '').slice(0, 120),
              price: String(entry?.price ?? '').slice(0, 60),
              strength: String(entry?.strength ?? '').slice(0, 200),
              weakness: String(entry?.weakness ?? '').slice(0, 200)
            })),
            differentiators: asStrings(concurrence.data?.differentiators, 5),
            product: {
              mvpFeatures: asStrings(produit.data?.mvpFeatures, 8),
              outOfScope: asStrings(produit.data?.outOfScope, 5),
              stack: asStrings(produit.data?.stack, 8),
              integrations: asStrings(produit.data?.integrations, 6),
              effortDays: clampInt(produit.data?.effortDays, 3, 1, 90),
              mainTechnicalRisk: String(produit.data?.mainTechnicalRisk ?? '').slice(0, 300)
            },
            design: {
              tone: String(design.data?.tone ?? '').slice(0, 160),
              palette: asStrings(design.data?.palette, 5).filter((color) => /^#[0-9a-f]{3,8}$/i.test(color)),
              typography: {
                heading: String(design.data?.typography?.heading ?? '').slice(0, 60),
                body: String(design.data?.typography?.body ?? '').slice(0, 60)
              },
              visualDirection: String(design.data?.visualDirection ?? '').slice(0, 400),
              screens: asObjects(design.data?.screens, 6).map((entry: any) => ({
                name: String(entry?.name ?? '').slice(0, 60),
                goal: String(entry?.goal ?? '').slice(0, 200),
                keyElements: asStrings(entry?.keyElements, 6)
              }))
            },
            pricing: {
              businessModel: String(growth.data?.businessModel ?? 'trial_rebill'),
              trialCents: clampInt(growth.data?.trialCents, 50, 0, 100_000),
              recurringCents: clampInt(growth.data?.recurringCents, 2900, 0, 1_000_000),
              trialHours: clampInt(growth.data?.trialHours, 48, 0, 8760),
              rationale: String(growth.data?.pricingRationale ?? '').slice(0, 400)
            },
            growth: {
              acquisition: asObjects(growth.data?.acquisition, 5).map((entry: any) => ({
                channel: String(entry?.channel ?? '').slice(0, 60),
                angle: String(entry?.angle ?? '').slice(0, 240),
                firstAction: String(entry?.firstAction ?? '').slice(0, 240)
              })),
              seoKeywords: asStrings(growth.data?.seoKeywords, 10),
              hook: String(growth.data?.hook ?? '').slice(0, 240)
            },
            hiring: {
              covered: asObjects(recrutement.data?.covered, 8).map((entry: any) => ({
                need: String(entry?.need ?? '').slice(0, 160),
                byAgentId: String(entry?.byAgentId ?? '').slice(0, 60)
              })),
              hires: hires.map((entry: any) => ({
                role: String(entry?.role ?? '').slice(0, 120),
                hierarchyLevel: String(entry?.hierarchyLevel ?? 'expert').slice(0, 20),
                teamName: String(entry?.teamName ?? '').slice(0, 80),
                why: String(entry?.why ?? '').slice(0, 300),
                urgency: ['basse', 'moyenne', 'haute'].includes(entry?.urgency) ? entry.urgency : 'moyenne'
              }))
            },
            risks: asStrings(cadrage.data?.risks, 5),
            sources: dossierSources,
            warnings: failures,
            tokens: totalTokens
          }
        });
      } catch (error) {
        send({ type: 'error', message: error instanceof Error ? error.message : 'Échec de la préparation' });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive'
    }
  });
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
