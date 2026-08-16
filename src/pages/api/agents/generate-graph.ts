import type { APIRoute } from 'astro';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json() as any;
    const { 
      prompt, 
      openRouterKey, 
      model = 'google/gemini-2.5-flash',
      availableModels = [],
      // Concevoir l'organigramme est un acte de DRH : elle prête sa persona
      // et sa fiche de poste à cet appel.
      persona,
      job
    } = body;

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return new Response(JSON.stringify({ error: 'Un prompt décrivant le graphe ou l\'équipe souhaitée est requis.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const cleanPrompt = prompt.trim();

    // Top recommended contemporary models list (never obsolete)
    const recommendedModelsNotice = availableModels.length > 0
      ? `MODÈLES OPENROUTER DISPONIBLES EN DIRECT (CHOISIR UNIQUEMENT PARMI CEUX-CI) :
${availableModels.slice(0, 40).map((m: any) => `- ${m.id} (${m.name})`).join('\n')}`
      : `MODÈLES CONTEMPORAINS RECOMMANDÉS (CHOISIR STRICTEMENT PARMI CETTE LISTE MODERNE) :
- C-Level & Raisonnement Stratégique : "x-ai/grok-2", "anthropic/claude-3.7-sonnet", "deepseek/deepseek-r1"
- VP & Head of Coordination : "qwen/qwen-2.5-72b-instruct", "google/gemini-2.5-pro", "x-ai/grok-2"
- Lead Architectes & Veille : "google/gemini-2.5-flash", "deepseek/deepseek-chat"
- Workers Code & Micro-Tâches : "qwen/qwen-2.5-coder-32b-instruct", "deepseek/deepseek-chat", "google/gemini-2.5-flash"
- QA Recette & Sentinel : "google/gemini-2.5-flash", "qwen/qwen-2.5-72b-instruct"`;

    // If an OpenRouter key is available, call the real LLM for deep graph & team generation
    if (openRouterKey && openRouterKey.startsWith('sk-or-')) {
      try {
        const systemInstruction = `${persona?.trim() || "Tu es la DRH d'OmniVenture, architecte de l'organisation."}
${job?.trim() ?? ''}

Tu es le Métamodèle Architecte d'Entreprises d'IA & Systèmes Multi-Agents OmniVenture.
Ta mission est de concevoir un Super-Graphe d'Équipes d'Agents complet, ultra-profond et moderne selon la demande de l'utilisateur.

HIÉRARCHIE D'ENTREPRISE STRICTE (5 NIVEAUX DE PROFONDEUR) :
1. "c_level" (👑 C-Level : CEO, CTO, CMO, CPO) - Vision globale, arbitrage P&L, budget et gouvernance.
2. "vp" (💼 VP : VP Engineering, VP Growth, VP Product) - Coordination départementale et validation des livrables.
3. "head_of" (🎖️ Head of : Head of Scraping, Head of Frontend Astro, Head of QA, Head of Ads) - Découpage tactique.
4. "lead" (📐 Lead : Lead Architecte, Lead DevOps Canary, Lead Copywriter) - Spécification des micro-tâches atomiques (< 50 lignes).
5. "expert" (⚡ Expert / Worker : Worker Devs DeepSeek/Qwen, Scraper Worker Gemini, QA Tester, Sentiment Analyst) - Exécution haute vitesse.

RÈGLES D'ORGANISATION PAR ÉQUIPES :
- Chaque agent doit appartenir à une équipe (teamId et teamName, ex: "team_strategy", "team_research", "team_core_dev", "team_growth").
- Associe chaque agent au modèle le plus adapté et moderne (JAMAIS de modèles obsolètes).

${recommendedModelsNotice}

Retourne STRICTEMENT un objet JSON valide sans balise markdown \`\`\`json avec ce format :
{
  "summary": "Résumé de l'architecture d'équipes et de la profondeur hiérarchique",
  "teams": [
    { "id": "team_id", "name": "Nom de l'équipe", "icon": "🏢", "description": "Rôle de l'équipe" }
  ],
  "agents": [
    {
      "id": "agent_unique_id",
      "role": "Titre du poste (ex: VP Engineering, Lead Scraper)",
      "hierarchyLevel": "c_level" | "vp" | "head_of" | "lead" | "expert",
      "tier": 1 | 2 | 3,
      "teamId": "team_id",
      "teamName": "Nom de l'équipe",
      "category": "orchestration" | "research" | "engineering" | "growth" | "operations",
      "modelId": "identifiant_openrouter_valide",
      "description": "Courte description du poste",
      "temperature": 0.2,
      "maxTokens": 2048,
      "ameMd": "# Ame.md — Titre\\n\\nPhilosophie, éthique et règles strictes...",
      "jobMd": "# Job.md — Titre\\n\\n1. Inputs reçus\\n2. Workflow étape par étape..."
    }
  ],
  "channels": [
    {
      "id": "ch_id",
      "sourceId": "agent_source_id",
      "sourceName": "Nom Source",
      "targetId": "agent_target_id",
      "targetName": "Nom Cible",
      "protocol": "RPC Synchrone" | "Queue Asynchrone" | "Événement Edge (Pub/Sub)",
      "payloadType": "Type de payload",
      "triggerEvent": "Événement déclencheur",
      "description": "Explication de la communication",
      "enabled": true
    }
  ]
}`;

        const openRouterRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openRouterKey}`,
            'HTTP-Referer': 'https://factory.dev',
            'X-Title': 'OmniVenture Multi-Team Graph Generator'
          },
          body: JSON.stringify({
            model: model || 'google/gemini-2.5-flash',
            messages: [
              { role: 'system', content: systemInstruction },
              { role: 'user', content: `[CRÉATION DE SUPER-GRAPHE D'ÉQUIPES]\n${cleanPrompt}` }
            ],
            temperature: 0.3,
            max_tokens: 4000
          })
        });

        if (openRouterRes.ok) {
          const completion = await openRouterRes.json() as any;
          const rawText = completion.choices?.[0]?.message?.content || '';
          const cleanedText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
          const parsed = JSON.parse(cleanedText);

          if (parsed && Array.isArray(parsed.agents) && parsed.agents.length > 0) {
            return new Response(JSON.stringify({
              success: true,
              data: parsed,
              source: 'openrouter_live',
              modelUsed: model
            }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      } catch (err) {
        console.warn('OpenRouter Multi-Team Graph generation failed, using heuristic template generator', err);
      }
    }

    // Heuristic Multi-Team Graph Generator with full 5-tier depth
    const generatedTeams = [
      { id: 'team_strategy', name: 'Direction & Stratégie', icon: '👑', description: 'Gouvernance, arbitrage P&L et vision produit' },
      { id: 'team_research', name: 'Intelligence & Veille Marché', icon: '🔬', description: 'Scraping de concurrents, détection de frustrations et pricing' },
      { id: 'team_engineering', name: 'Ingénierie & Core Cloudflare', icon: '📐', description: 'Architecture Astro SSR, bases D1 et code atomique' },
      { id: 'team_ops_qa', name: 'Qualité, Sécurité & Canary', icon: '🛡️', description: 'Recette automatisée TypeScript, déploiement progressif et résilience' }
    ];

    const generatedAgents = [
      // 1. C-LEVEL
      {
        id: 'ceo_agent',
        role: 'CEO & Vision Suprême',
        hierarchyLevel: 'c_level',
        tier: 1,
        teamId: 'team_strategy',
        teamName: 'Direction & Stratégie',
        category: 'orchestration',
        modelId: 'x-ai/grok-2',
        description: `Gouvernance globale et arbitrage ROI pour "${cleanPrompt.slice(0, 30)}"`,
        temperature: 0.7,
        maxTokens: 4096,
        ameMd: `# Ame.md — CEO & Vision Suprême\n\nTu diriges l'ensemble des départements pour l'objectif : ${cleanPrompt}.\nZéro micromanagement, orientation rentabilité pure.`,
        jobMd: `# Job.md — Gouvernance\n\n1. Définir les objectifs clés (OKRs).\n2. Valider les budgets tokens et livrables des VPs.\n3. Arbitrer les lancements de nouveaux Micro-SaaS.`
      },

      // 2. VP LEVEL
      {
        id: 'vp_eng_agent',
        role: 'VP Engineering & Architecture Edge',
        hierarchyLevel: 'vp',
        tier: 1,
        teamId: 'team_engineering',
        teamName: 'Ingénierie & Core Cloudflare',
        category: 'engineering',
        modelId: 'qwen/qwen-2.5-72b-instruct',
        description: 'Supervise l\'architecture technique, les SLAs Cloudflare et la robustesse D1.',
        temperature: 0.2,
        maxTokens: 4096,
        ameMd: `# Ame.md — VP Engineering\n\nGarant de l'excellence technique. Pas de dette technique, architectures sans serveur résilientes.`,
        jobMd: `# Job.md — Supervision Ingénierie\n\n1. Traduire les directives du CEO en architecture système.\n2. Coordonner les Heads of Frontend et Backend.`
      },
      {
        id: 'vp_growth_agent',
        role: 'VP Growth & Analyse de Marché',
        hierarchyLevel: 'vp',
        tier: 1,
        teamId: 'team_research',
        teamName: 'Intelligence & Veille Marché',
        category: 'research',
        modelId: 'google/gemini-2.5-flash',
        description: 'Pilote l\'acquisition, le scraping concurrent et les tunnels à micro-tarification ($0.50 trial).',
        temperature: 0.3,
        maxTokens: 2048,
        ameMd: `# Ame.md — VP Growth\n\nObsédé par le coût d'acquisition client (CAC) et le taux de conversion trial-to-paid.`,
        jobMd: `# Job.md — Stratégie Croissance\n\n1. Identifier les angles d'attaque marketing.\n2. Coordonner les sous-agents d'extraction web.`
      },

      // 3. HEAD OF LEVEL
      {
        id: 'head_scraping_agent',
        role: 'Head of Scraping & Data Extraction',
        hierarchyLevel: 'head_of',
        tier: 2,
        teamId: 'team_research',
        teamName: 'Intelligence & Veille Marché',
        category: 'research',
        modelId: 'google/gemini-2.5-flash',
        description: 'Orchestre les pipelines d\'extraction web, normalisation de grilles de prix et avis.',
        temperature: 0.1,
        maxTokens: 2048,
        ameMd: `# Ame.md — Head of Scraping\n\nMaître de la donnée publique. Extraction chirurgicale sans bruit.`,
        jobMd: `# Job.md — Pipeline Data\n\n1. Définir les sélecteurs et schémas d'extraction.\n2. Déléguer aux Workers Scrapers.`
      },
      {
        id: 'head_qa_agent',
        role: 'Head of QA & Sécurité Canary',
        hierarchyLevel: 'head_of',
        tier: 2,
        teamId: 'team_ops_qa',
        teamName: 'Qualité, Sécurité & Canary',
        category: 'operations',
        modelId: 'qwen/qwen-2.5-72b-instruct',
        description: 'Supervise la recette automatique, les audits Lighthouse 100/100 et le déploiement Canary.',
        temperature: 0.1,
        maxTokens: 2048,
        ameMd: `# Ame.md — Head of QA\n\nGardien impitoyable de la stabilité. 0 incident de production.`,
        jobMd: `# Job.md — Matrice de Tests\n\n1. Valider les tests d'intégration TypeScript.\n2. Gérer le routage progressif de trafic Cloudflare (10% -> 100%).`
      },

      // 4. LEAD LEVEL
      {
        id: 'lead_dev_agent',
        role: 'Lead Architecte Astro SSR',
        hierarchyLevel: 'lead',
        tier: 2,
        teamId: 'team_engineering',
        teamName: 'Ingénierie & Core Cloudflare',
        category: 'engineering',
        modelId: 'google/gemini-2.5-flash',
        description: 'Découpe les spécifications en micro-tâches atomiques (< 50 lignes) pour les workers.',
        temperature: 0.2,
        maxTokens: 4096,
        ameMd: `# Ame.md — Lead Architecte\n\nConcepteur du code modulaire et des contrats d'interfaces Astro 5.`,
        jobMd: `# Job.md — Découpage DAG\n\n1. Rédiger les specs des composants UI.\n2. Alimenter les queues Cloudflare pour les Workers.`
      },

      // 5. EXPERT / WORKER LEVEL
      {
        id: 'worker_coder_agent',
        role: 'Worker Développeur Haute Vitesse',
        hierarchyLevel: 'expert',
        tier: 3,
        teamId: 'team_engineering',
        teamName: 'Ingénierie & Core Cloudflare',
        category: 'engineering',
        modelId: 'deepseek/deepseek-chat',
        description: 'Rédige le code atomique TypeScript et composants UI à coût infime (~$0.14/M tokens).',
        temperature: 0.2,
        maxTokens: 2048,
        ameMd: `# Ame.md — Artisan Code\n\nProduction de code propre, testable et sans fioritures.`,
        jobMd: `# Job.md — Implémentation\n\n1. Écrire le composant assigné.\n2. Soumettre à la recette QA.`
      },
      {
        id: 'worker_scraper_agent',
        role: 'Worker Scraper & Parser HTML',
        hierarchyLevel: 'expert',
        tier: 3,
        teamId: 'team_research',
        teamName: 'Intelligence & Veille Marché',
        category: 'research',
        modelId: 'google/gemini-2.5-flash',
        description: 'Extraction directe des prix, formulaires et avis sans charger les modèles supérieurs.',
        temperature: 0.1,
        maxTokens: 2048,
        ameMd: `# Ame.md — Parser Web\n\nExtraction haute précision. Normalisation immédiate des payloads JSON.`,
        jobMd: `# Job.md — Parsing\n\n1. Parcourir l'URL.\n2. Renvoyer le JSON des tarifs.`
      },
      {
        id: 'worker_qa_agent',
        role: 'Worker QA & Auditeur TypeScript',
        hierarchyLevel: 'expert',
        tier: 3,
        teamId: 'team_ops_qa',
        teamName: 'Qualité, Sécurité & Canary',
        category: 'operations',
        modelId: 'google/gemini-2.5-flash',
        description: 'Vérification stricte de typage, linting et simulation de paiement Stripe 48h.',
        temperature: 0.1,
        maxTokens: 2048,
        ameMd: `# Ame.md — Auditeur Code\n\nInspection méticuleuse de chaque ligne générée.`,
        jobMd: `# Job.md — Validation\n\n1. astro check.\n2. Rapport de conformité 100%.`
      }
    ];

    const generatedChannels = [
      {
        id: 'ch-ceo-vpeng',
        sourceId: 'ceo_agent',
        sourceName: 'CEO & Vision Suprême',
        targetId: 'vp_eng_agent',
        targetName: 'VP Engineering',
        protocol: 'RPC Synchrone',
        payloadType: 'Directive Stratégique & Budget',
        triggerEvent: 'Lancement de Mission',
        description: 'Transmission de l\'objectif business et allocation de budget.',
        enabled: true
      },
      {
        id: 'ch-ceo-vpgrowth',
        sourceId: 'ceo_agent',
        sourceName: 'CEO & Vision Suprême',
        targetId: 'vp_growth_agent',
        targetName: 'VP Growth',
        protocol: 'RPC Synchrone',
        payloadType: 'Cible Marché & Angle Business',
        triggerEvent: 'Lancement de Mission',
        description: 'Ordre d\'analyse concurrentielle et étude de niche.',
        enabled: true
      },
      {
        id: 'ch-vpgrowth-headscrap',
        sourceId: 'vp_growth_agent',
        sourceName: 'VP Growth',
        targetId: 'head_scraping_agent',
        targetName: 'Head of Scraping',
        protocol: 'RPC Synchrone',
        payloadType: 'Mots-clés & Domaines Cibles',
        triggerEvent: 'Dossier Marché Ouvert',
        description: 'Délégation de l\'extraction technique et benchmark.',
        enabled: true
      },
      {
        id: 'ch-headscrap-workerscrap',
        sourceId: 'head_scraping_agent',
        sourceName: 'Head of Scraping',
        targetId: 'worker_scraper_agent',
        targetName: 'Worker Scraper',
        protocol: 'Queue Asynchrone',
        payloadType: 'Jobs d\'Extraction Parallèle',
        triggerEvent: 'Distribution Tâches',
        description: 'Exécution atomique des crawls à coût infime ($0.15/M).',
        enabled: true
      },
      {
        id: 'ch-vpeng-leaddev',
        sourceId: 'vp_eng_agent',
        sourceName: 'VP Engineering',
        targetId: 'lead_dev_agent',
        targetName: 'Lead Architecte',
        protocol: 'RPC Synchrone',
        payloadType: 'Architecture Globale & Schéma D1',
        triggerEvent: 'Spécifications Validées',
        description: 'Conception des routes et contrats de données.',
        enabled: true
      },
      {
        id: 'ch-leaddev-workercoder',
        sourceId: 'lead_dev_agent',
        sourceName: 'Lead Architecte',
        targetId: 'worker_coder_agent',
        targetName: 'Worker Développeur',
        protocol: 'Queue Asynchrone',
        payloadType: 'Micro-Tâches Code (<50 lignes)',
        triggerEvent: 'Découpage Composants',
        description: 'Distribution en parallèle du code Astro SSR vers DeepSeek V3.',
        enabled: true
      },
      {
        id: 'ch-workercoder-workerqa',
        sourceId: 'worker_coder_agent',
        sourceName: 'Worker Développeur',
        targetId: 'worker_qa_agent',
        targetName: 'Worker QA',
        protocol: 'RPC Synchrone',
        payloadType: 'Fichiers Sources Générés',
        triggerEvent: 'Code Rédigé',
        description: 'Audit TypeScript et vérification de conformité.',
        enabled: true
      },
      {
        id: 'ch-workerqa-headqa',
        sourceId: 'worker_qa_agent',
        sourceName: 'Worker QA',
        targetId: 'head_qa_agent',
        targetName: 'Head of QA',
        protocol: 'RPC Synchrone',
        payloadType: 'Rapport de Recette Validé',
        triggerEvent: 'Tests Réussis 100%',
        description: 'Autorisation de déploiement Canary progressif.',
        enabled: true
      }
    ];

    return new Response(JSON.stringify({
      success: true,
      data: {
        summary: `Super-Graphe d'Équipes (5 Niveaux) : ${generatedAgents.length} agents organisés en ${generatedTeams.length} équipes pour : "${cleanPrompt}"`,
        teams: generatedTeams,
        agents: generatedAgents,
        channels: generatedChannels
      },
      source: 'heuristic_template',
      modelUsed: model
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || 'Erreur lors de la génération du super-graphe' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
