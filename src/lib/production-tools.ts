/**
 * Les outils qui fabriquent.
 *
 * Le pont donne accès aux fichiers, au dépôt, au navigateur. Il manquait tout
 * ce qui fait un service numérique : produire une image, poser un design
 * system, écrire une maquette qu'on peut ouvrir, publier un article, brancher
 * un service tiers. Sans ces outils, un agent à qui on demande un visuel ne
 * peut que le *décrire* — et c'est exactement le travers qu'on corrige.
 *
 * Chaque outil enregistre un artefact : ce qui existe après coup et qu'on peut
 * rouvrir. C'est ce registre qui permet ensuite de vérifier qu'une tâche a
 * réellement produit quelque chose, au lieu de croire sur parole un compte
 * rendu bien tourné.
 */

import { addArtifact, type ArtifactKind } from './artifacts';
import type { AgentTool } from './agent-sdk';
import { pushActivity } from './agent-activity';
import { readCulture } from './culture';
import { getRunnerToken, RUNNER_URL } from './harness-client';
import { readDesignSystem, upsertDoc, writeDesignSystem } from './workspace';

export interface ProductionContext {
  agent: { id: string; name: string };
  ventureName: string;
  ventureSlug: string;
  phase?: string;
  taskId?: string;
  /** Modèle du graphe pour cet agent : sert aux appels qui en demandent un. */
  model?: string;
}

const trace = (context: ProductionContext, label: string, detail: string, status: 'running' | 'done' | 'error') => {
  pushActivity({
    id: `prod-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    agentId: context.agent.id,
    agentName: context.agent.name,
    tool: 'production',
    label,
    detail: detail.slice(0, 300),
    status
  });
};

/* ------------------------------------------------------------------ */
/* Visuels                                                             */
/* ------------------------------------------------------------------ */

/**
 * Produire une image, pour de vrai.
 *
 * L'appel passe par la route serveur qui parle à OpenRouter et dépose le
 * résultat dans R2. L'agent reçoit l'adresse, pas l'image : une image en base64
 * dans un contexte de modèle, c'est des milliers de jetons pour rien.
 */
function visualTool(context: ProductionContext): AgentTool {
  return {
    name: 'produire_visuel',
    description:
      "Génère réellement une ou plusieurs images (logo, illustration, capture d'écran d'interface, bannière) et les stocke. Décris précisément ce que tu veux voir : cadrage, style, couleurs, texte visible.",
    parameters: {
      type: 'object',
      properties: {
        brief: { type: 'string', description: "Description précise de l'image attendue" },
        kind: { type: 'string', description: 'logo | illustration | banniere | interface | icone' },
        count: { type: 'number', description: '1 à 3' },
        palette: { type: 'array', items: { type: 'string' }, description: 'Couleurs imposées, en hexadécimal' }
      },
      required: ['brief']
    },
    async execute(args: any, ctx) {
      const label = `🖼️ dessine ${String(args.brief ?? '').slice(0, 34)}`;
      trace(context, label, args.brief ?? '', 'running');

      try {
        const res = await fetch('/api/design/image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: String(args.brief ?? ''),
            // Le modele choisi dans l'atelier graphique, s'il y en a un.
            model: localStorage.getItem('omniventure_image_model') || undefined,
            kind: String(args.kind ?? 'illustration'),
            count: Math.max(1, Math.min(3, Number(args.count) || 1)),
            palette: Array.isArray(args.palette) ? args.palette : [],
            project: context.ventureName,
            agentId: context.agent.id,
            agentName: context.agent.name,
            culture: readCulture(),
            openRouterKey: localStorage.getItem('omniventure_openrouter_key') ?? undefined
          }),
          signal: ctx.signal
        });
        const json = (await res.json()) as { assets?: Array<{ id: string; url: string }>; error?: string };
        if (json.error || !json.assets?.length) throw new Error(json.error ?? 'Aucune image produite');

        addArtifact({
          kind: 'visuel',
          title: String(args.brief ?? '').slice(0, 90),
          summary: `${json.assets.length} image(s) — ${args.kind ?? 'illustration'}`,
          agentId: context.agent.id,
          agentName: context.agent.name,
          ventureName: context.ventureName,
          phase: context.phase,
          taskId: context.taskId,
          location: { assetIds: json.assets.map((asset) => asset.id) }
        });

        trace(context, label, `${json.assets.length} image(s)`, 'done');
        return { produites: json.assets.length, urls: json.assets.map((asset) => asset.url) };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Génération impossible';
        trace(context, `⚠️ ${label}`, message, 'error');
        return { error: message };
      }
    }
  };
}

/* ------------------------------------------------------------------ */
/* Design system                                                       */
/* ------------------------------------------------------------------ */

function designSystemTool(context: ProductionContext): AgentTool {
  return {
    name: 'produire_design_system',
    description:
      "Produit le design system du produit : tokens (couleurs, espacements, typographies) et composants HTML réutilisables. À n'appeler qu'une fois par produit — ensuite, réutilise l'existant.",
    parameters: {
      type: 'object',
      properties: {
        brief: { type: 'string', description: 'Le produit, sa cible, son intention visuelle' },
        palette: { type: 'array', items: { type: 'string' } }
      },
      required: ['brief']
    },
    async execute(args: any, ctx) {
      const label = '🎨 pose le design system';
      trace(context, label, args.brief ?? '', 'running');

      try {
        const res = await fetch('/api/design/system', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            brief: String(args.brief ?? ''),
            project: context.ventureName,
            palette: Array.isArray(args.palette) ? args.palette : [],
            model: context.model,
            agentId: context.agent.id,
            agentName: context.agent.name,
            culture: readCulture(),
            openRouterKey: localStorage.getItem('omniventure_openrouter_key') ?? undefined
          }),
          signal: ctx.signal
        });
        const json = (await res.json()) as { system?: any; error?: string };
        if (json.error || !json.system) throw new Error(json.error ?? 'Système non produit');

        writeDesignSystem(json.system);
        addArtifact({
          kind: 'design',
          title: json.system.name ?? `Design system — ${context.ventureName}`,
          summary: `${json.system.tokens?.length ?? 0} tokens, ${json.system.components?.length ?? 0} composants`,
          agentId: context.agent.id,
          agentName: context.agent.name,
          ventureName: context.ventureName,
          phase: context.phase,
          taskId: context.taskId,
          location: { url: '/?vue=design-system' }
        });

        trace(context, label, `${json.system.tokens?.length ?? 0} tokens`, 'done');
        return {
          tokens: (json.system.tokens ?? []).map((token: any) => `${token.name}: ${token.value}`),
          composants: (json.system.components ?? []).map((component: any) => component.name)
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Design system impossible';
        trace(context, `⚠️ ${label}`, message, 'error');
        return { error: message };
      }
    }
  };
}

/** Le design system déjà posé : à lire avant d'inventer autre chose. */
function designSystemReadTool(context: ProductionContext): AgentTool {
  return {
    name: 'lire_design_system',
    description: 'Lit le design system du produit : tokens et composants disponibles. À consulter avant de maquetter.',
    parameters: { type: 'object', properties: {} },
    async execute() {
      const system = readDesignSystem();
      if (!system) return { present: false, message: 'Aucun design system : produis-le avant de maquetter.' };
      return {
        present: true,
        nom: system.name,
        tokens: system.tokens.map((token) => `${token.name} = ${token.value}`),
        composants: system.components.map((component) => ({ nom: component.name, usage: component.usage }))
      };
    }
  };
}

/* ------------------------------------------------------------------ */
/* Écrits typés                                                        */
/* ------------------------------------------------------------------ */

/**
 * Un écrit qui n'est pas de la documentation.
 *
 * Le type compte : un mémo de décision, une spécification, un article de blog
 * et une page de doc ne se lisent pas au même moment ni par les mêmes gens.
 * Les confondre, c'est ce qui rendait tous les livrables interchangeables.
 */
function writingTool(context: ProductionContext, isDeliverable: boolean): AgentTool {
  return {
    name: 'publier_ecrit',
    description:
      (isDeliverable
        ? "Publie un écrit fini et typé : mémo de décision, spécification, article de blog, page de documentation. Le contenu doit être complet et publiable tel quel — pas un plan, pas un résumé."
        : "Publie une note qui ACCOMPAGNE ton livrable — une décision, un cadrage. Elle ne remplace pas le livrable attendu à cette étape : une tâche qui ne rend qu'un écrit sera comptée en échec."),
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'memo | spec | article | doc' },
        titre: { type: 'string' },
        contenu: { type: 'string', description: 'Le texte complet, en markdown' },
        resume: { type: 'string', description: 'Une ligne : ce que c’est' }
      },
      required: ['type', 'titre', 'contenu']
    },
    async execute(args: any) {
      const kind = (['memo', 'spec', 'article', 'doc'].includes(args.type) ? args.type : 'doc') as ArtifactKind;
      const title = String(args.titre ?? '').slice(0, 140);
      const body = String(args.contenu ?? '');
      const label = `📝 publie ${title.slice(0, 34)}`;

      if (body.trim().length < 200) {
        return { error: 'Trop court pour être publiable : écris le contenu complet, pas un plan.' };
      }

      const folder = kind === 'article' ? 'Contenus' : kind === 'spec' ? 'Spécifications' : kind === 'memo' ? 'Décisions' : 'Documentation';
      const doc = upsertDoc({
        title,
        path: `${folder}/${context.ventureName}`,
        authorId: context.agent.id,
        authorName: context.agent.name,
        body,
        tags: [kind, context.phase ?? ''].filter(Boolean)
      });

      addArtifact({
        kind,
        title,
        summary: String(args.resume ?? '').slice(0, 200) || `${Math.round(body.length / 1000)} k caractères`,
        agentId: context.agent.id,
        agentName: context.agent.name,
        ventureName: context.ventureName,
        phase: context.phase,
        taskId: context.taskId,
        location: { docId: doc.id }
      });

      trace(context, label, `${body.length} caractères`, 'done');
      return { publie: true, id: doc.id, chemin: `${folder}/${context.ventureName}` };
    }
  };
}

/* ------------------------------------------------------------------ */
/* Maquette                                                            */
/* ------------------------------------------------------------------ */

/**
 * Une maquette qu'on peut ouvrir.
 *
 * Décrire un écran en prose ne se vérifie pas. Une page HTML autonome, si :
 * elle s'ouvre dans un navigateur, et le développeur qui la reprend voit
 * exactement ce qui est attendu.
 */
function mockupTool(context: ProductionContext): AgentTool {
  return {
    name: 'produire_maquette',
    description:
      "Produit une maquette d'écran : une page HTML autonome (Tailwind par CDN autorisé) enregistrée dans le dépôt du produit, sous maquettes/. Utilise les tokens du design system.",
    parameters: {
      type: 'object',
      properties: {
        ecran: { type: 'string', description: "Nom de l'écran : accueil, tarifs, tableau de bord…" },
        html: { type: 'string', description: 'Page HTML complète, autonome' },
        notes: { type: 'string', description: 'États couverts, points d’attention' }
      },
      required: ['ecran', 'html']
    },
    async execute(args: any, ctx) {
      const screen = String(args.ecran ?? 'ecran')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      const html = String(args.html ?? '');
      const path = `maquettes/${screen || 'ecran'}.html`;
      const label = `📐 maquette ${screen}`;

      if (!/<[a-z][\s\S]*>/i.test(html) || html.length < 300) {
        return { error: 'Ce n’est pas une page : renvoie du HTML complet et autonome.' };
      }

      trace(context, label, `${html.length} caractères`, 'running');
      try {
        const res = await fetch(`${runnerUrl()}/tools/call`, {
          method: 'POST',
          headers: runnerHeaders(),
          body: JSON.stringify({
            tool: 'fs_write',
            args: { path, content: html },
            autonomy: 'write',
            workspace: context.ventureSlug
          }),
          signal: ctx.signal
        });
        const json = (await res.json()) as { result?: any; error?: string };
        if (json.error) throw new Error(json.error);

        addArtifact({
          kind: 'maquette',
          title: `Maquette — ${args.ecran}`,
          summary: String(args.notes ?? '').slice(0, 200) || 'écran maquetté',
          agentId: context.agent.id,
          agentName: context.agent.name,
          ventureName: context.ventureName,
          phase: context.phase,
          taskId: context.taskId,
          location: { files: [path] }
        });

        trace(context, label, path, 'done');
        return { ecrit: path };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Écriture impossible';
        trace(context, `⚠️ ${label}`, message, 'error');
        return { error: `${message} — la maquette exige le pont local et le niveau « écriture ».` };
      }
    }
  };
}

/** Même adresse et même jeton que le reste du pont : une seule source. */
function runnerUrl(): string {
  return RUNNER_URL;
}

function runnerHeaders(): Record<string, string> {
  const token = getRunnerToken();
  return token
    ? { 'Content-Type': 'application/json', 'X-Omniventure-Token': token }
    : { 'Content-Type': 'application/json' };
}

/* ------------------------------------------------------------------ */
/* Préparation du projet                                               */
/* ------------------------------------------------------------------ */

/**
 * Pose l'ossature et y verse le design, avant que le développement commence.
 *
 * Sans ça, chaque tâche de développement écrivait un fichier isolé dans un
 * dossier vide : les agents produisaient un tas de code qui ne formait jamais
 * une application, et personne ne pouvait vérifier quoi que ce soit. Ici le
 * produit démarre comme un projet qui compile, et les agents l'éditent.
 *
 * Silencieux quand le projet existe déjà : on ne réécrit rien.
 */
export async function prepareVentureProject(
  context: ProductionContext,
  stack: string
): Promise<{ ready: boolean; note: string }> {
  try {
    const init = await callBridge('projet_initialiser', { name: context.ventureName, stack }, 'write', context.ventureSlug);
    if (init.error) return { ready: false, note: init.error };

    // Les jetons du design system deviennent des variables CSS : c'est le seul
    // lien entre ce que le design a décidé et ce que le produit affiche.
    const system = readDesignSystem();
    if (system?.tokens?.length) {
      await callBridge(
        'fs_write',
        { path: 'src/styles/tokens.css', content: tokensCss(system) },
        'write',
        context.ventureSlug
      );
    }

    const created = init.result?.created;
    return {
      ready: true,
      note: created
        ? `Ossature posée (${init.result?.files} fichiers)${system?.tokens?.length ? ', jetons de design appliqués' : ''}.`
        : 'Projet déjà en place.'
    };
  } catch (error) {
    return { ready: false, note: error instanceof Error ? error.message : 'Préparation impossible' };
  }
}

/**
 * Les jetons du design system, en CSS.
 *
 * On écrit tous les jetons sous leur propre nom, puis on renseigne les cinq
 * variables que l'ossature utilise en cherchant le rôle dans le nom du jeton.
 * Quand aucun ne correspond, on laisse la valeur par défaut : mieux vaut un
 * indigo neutre qu'une couleur prise au hasard dans la palette.
 */
function tokensCss(system: NonNullable<ReturnType<typeof readDesignSystem>>): string {
  const colors = system.tokens.filter((token) => token.group === 'color' || /^#|rgb|hsl/.test(token.value));
  const find = (pattern: RegExp) => colors.find((token) => pattern.test(token.name))?.value;

  const marque = find(/primary|marque|brand|accent|principal/i);
  const surface = find(/surface|background|fond|bg/i);
  const encre = find(/\btext\b|ink|encre|foreground|neutral-9|slate-9/i);

  return [
    '/*',
    ` * Jetons de design — écrits par le design system « ${system.name} ».`,
    ' *',
    " * Ne pas modifier à la main : la prochaine génération écraserait vos",
    ' * changements. Pour changer l’apparence, changez le design system.',
    ' */',
    ':root {',
    ...system.tokens.map((token) => `  --${token.name.replace(/[^a-zA-Z0-9-]/g, '-')}: ${token.value};`),
    '',
    '  /* Ce que l’ossature utilise. */',
    `  --couleur-marque: ${marque ?? '#4f46e5'};`,
    `  --couleur-marque-sombre: ${marque ?? '#4338ca'};`,
    `  --couleur-surface: ${surface ?? '#ffffff'};`,
    `  --couleur-encre: ${encre ?? '#0f172a'};`,
    '  --couleur-encre-douce: #475569;',
    '  --rayon: 0.75rem;',
    '  --police-titre: ui-sans-serif, system-ui, sans-serif;',
    '  --police-texte: ui-sans-serif, system-ui, sans-serif;',
    '}',
    ''
  ].join('\n');
}

/** Appel direct au pont, hors du circuit des outils exposés au modèle. */
async function callBridge(
  tool: string,
  args: Record<string, unknown>,
  autonomy: string,
  workspace: string
): Promise<{ result?: any; error?: string }> {
  const res = await fetch(`${runnerUrl()}/tools/call`, {
    method: 'POST',
    headers: runnerHeaders(),
    body: JSON.stringify({ tool, args, autonomy, workspace })
  });
  return (await res.json()) as { result?: any; error?: string };
}

/* ------------------------------------------------------------------ */
/* Mesure                                                              */
/* ------------------------------------------------------------------ */

/**
 * Interroger l'entrepôt de mesure.
 *
 * C'est ce qui distingue un constat d'une impression. Un agent qui doit dire si
 * la promesse tient va chercher le chiffre lui-même, au lieu de raisonner sur
 * ce qu'il imagine du trafic.
 *
 * Il écrit sa propre requête : on ne peut pas prévoir à l'avance les questions
 * d'un produit. La lecture seule est imposée côté serveur, pas ici — une garde
 * côté client ne garde rien.
 */
function analyticsTool(context: ProductionContext): AgentTool {
  return {
    name: 'interroger_mesure',
    description:
      "Interroge l'entrepôt de mesure du produit (trafic, événements, conversions, tests A/B, dépense publicitaire). Écris une requête SQL de lecture, ou demande une mesure connue.",
    parameters: {
      type: 'object',
      properties: {
        sql: {
          type: 'string',
          description:
            "Requête SQL en lecture seule. Tables : analytics_events(site, event, anon_id, session_id, at, day, path, referrer, utm_source, utm_campaign, device, value_cents, props), analytics_experiments, ad_spend. Filtre toujours sur site."
        },
        metric: {
          type: 'string',
          description: 'À défaut de SQL : apercu | evenements | sources | entonnoir | acquisition'
        },
        days: { type: 'number', description: 'Fenêtre en jours (30 par défaut)' }
      }
    },
    async execute(args: any, ctx) {
      const label = `📊 interroge la mesure`;
      trace(context, label, String(args.sql ?? args.metric ?? ''), 'running');

      try {
        const res = await fetch('/api/analytics/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            site: context.ventureSlug,
            sql: args.sql,
            metric: args.metric,
            days: args.days
          }),
          signal: ctx.signal
        });
        const json = (await res.json()) as any;

        if (json.error) {
          trace(context, `⚠️ ${label}`, json.error, 'error');
          return { error: json.error, aide: json.aide };
        }

        const rows = json.rows ?? [];
        trace(context, label, `${rows.length} ligne(s)`, 'done');

        // Un jeu de résultats vide n'est pas une erreur : c'est une réponse, et
        // il vaut mieux le dire que laisser l'agent conclure au hasard.
        if (rows.length === 0) {
          return {
            lignes: [],
            note: "Aucune donnée sur cette période. Soit le mouchard n'est pas encore posé sur le produit, soit personne n'est venu."
          };
        }
        return { lignes: rows.slice(0, 200), sql: json.sql };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Mesure injoignable';
        trace(context, `⚠️ ${label}`, message, 'error');
        return { error: message };
      }
    }
  };
}

/* ------------------------------------------------------------------ */
/* Assemblage                                                          */
/* ------------------------------------------------------------------ */

/**
 * Les outils de production adaptés à une étape.
 *
 * On ne donne pas tout à tout le monde : un développeur n'a pas à générer des
 * logos, et un graphiste n'a pas à écrire le design system. Moins d'outils,
 * moins de dispersion, et un livrable qui correspond à l'étape.
 */
export function productionTools(context: ProductionContext, kinds: ArtifactKind[]): AgentTool[] {
  const tools: AgentTool[] = [];
  const wants = new Set(kinds);

  if (wants.has('visuel') || wants.has('video') || wants.has('maquette')) tools.push(visualTool(context));
  if (wants.has('design')) tools.push(designSystemTool(context));
  if (wants.has('maquette') || wants.has('design') || wants.has('code')) tools.push(designSystemReadTool(context));
  if (wants.has('maquette')) tools.push(mockupTool(context));

  // L'écrit typé est toujours disponible : toute étape peut avoir à poser une
  // décision par écrit, même quand son livrable principal est ailleurs.
  tools.push(writingTool(context, wants.has('memo') || wants.has('spec') || wants.has('article') || wants.has('doc')));

  // La mesure aussi : n'importe quelle étape gagne à vérifier un chiffre plutôt
  // qu'à raisonner sur ce qu'elle imagine du trafic.
  tools.push(analyticsTool(context));

  return tools;
}
