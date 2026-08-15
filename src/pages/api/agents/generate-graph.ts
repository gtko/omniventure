import type { APIRoute } from 'astro';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json() as any;
    const { 
      prompt, 
      openRouterKey, 
      model = 'google/gemini-2.5-flash' 
    } = body;

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return new Response(JSON.stringify({ error: 'Un prompt décrivant le graphe souhaité est requis.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const cleanPrompt = prompt.trim();

    // If an OpenRouter key is available, call the real LLM for deep graph generation
    if (openRouterKey && openRouterKey.startsWith('sk-or-')) {
      try {
        const systemInstruction = `Tu es le Métamodèle Architecte de Systèmes Multi-Agents OmniVenture.
Ta mission est de concevoir un Graphe d'Agents Décloisonné complet et cohérent selon le besoin de l'utilisateur.

RÈGLES D'ARCHITECTURE DU GRAPHE :
1. Tiers Hiérarchiques :
   - Tier 1 : Cerveaux Stratégiques, Arbitres & Orchestrateurs (ex: CEO, Planificateur Crise, Détective Niche).
   - Tier 2 : Spécialistes Métier, Scrapers, Chercheurs, Architectes, Copywriters.
   - Tier 3 : Workers d'Exécution Atomique, Recette QA, DevOps Canary, Optimiseurs CRO.
2. Chaque agent doit avoir :
   - id: string unique (ex: real_estate_crawler, roi_analyst, deal_closer)
   - role: string (nom explicite du rôle)
   - tier: 1 | 2 | 3
   - category: "orchestration" | "research" | "engineering" | "growth" | "operations"
   - modelId: modèle OpenRouter recommandé (ex: "google/gemini-2.5-flash", "deepseek/deepseek-chat", "x-ai/grok-2", "qwen/qwen-2.5-72b-instruct")
   - description: résumé court de la fonction
   - temperature: float (0.1 à 0.7)
   - maxTokens: int (2048 ou 4096)
   - ameMd: Markdown complet décrivant l'identité, les principes stricts et l'éthique de travail de l'agent.
   - jobMd: Markdown complet décrivant les inputs reçus et le workflow séquentiel pas-à-pas de l'agent.
3. Canaux de Communication (channels) :
   - Définir les liaisons entre agents émetteurs (sourceId) et récepteurs (targetId)
   - protocol: "RPC Synchrone" | "Queue Asynchrone" | "Événement Edge (Pub/Sub)"
   - payloadType: description du format de données (ex: "Dossier JSON", "Code source")
   - triggerEvent: événement déclencheur
   - description: explication de l'échange

Retourne STRICTEMENT un objet JSON valide sans balise markdown \`\`\`json avec ce format :
{
  "summary": "Résumé de l'architecture du graphe conçu",
  "agents": [ ... ],
  "channels": [ ... ]
}`;

        const openRouterRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openRouterKey}`,
            'HTTP-Referer': 'https://factory.dev',
            'X-Title': 'OmniVenture Graph Generator'
          },
          body: JSON.stringify({
            model: model || 'google/gemini-2.5-flash',
            messages: [
              { role: 'system', content: systemInstruction },
              { role: 'user', content: `[BESOIN UTILISATEUR]\n${cleanPrompt}` }
            ],
            temperature: 0.3,
            max_tokens: 3500
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
        console.warn('OpenRouter Graph generation failed, using heuristic template generator', err);
      }
    }

    // Heuristic Smart Graph Generator based on prompt keywords
    const isScraping = /scrap|crawl|extract|donn|data/i.test(cleanPrompt);
    const isEcom = /ecom|drop|boutique|vêt|shop|produit/i.test(cleanPrompt);
    const isFinance = /financ|invest|bourse|crypto|compta|factur/i.test(cleanPrompt);

    const generatedAgents = [
      {
        id: 'specialized_master',
        role: `Orchestrateur Suprême (${cleanPrompt.slice(0, 24)})`,
        tier: 1,
        category: 'orchestration',
        modelId: 'x-ai/grok-2',
        description: `Orchestrateur stratégique pilotant l'ensemble du workflow pour "${cleanPrompt.slice(0, 40)}"`,
        temperature: 0.5,
        maxTokens: 4096,
        ameMd: `# Ame.md — Orchestrateur Spécialisé\n\nTu es le Cerveau Central dédié à : ${cleanPrompt}.\nTu coordonnes les agents de Niveau 2 et 3 sans exécuter de micro-tâches directes.`,
        jobMd: `# Job.md — Workflow Stratégique\n\n1. Décomposer l'objectif en DAG de sous-tâches atomiques.\n2. Déléguer aux spécialistes métier.\n3. Valider la recette finale.`
      },
      {
        id: isScraping ? 'data_crawler' : isFinance ? 'financial_auditor' : 'market_specialist',
        role: isScraping ? 'Agent Crawler & Extraction Massive' : isFinance ? 'Agent Audit Financier & Chiffres' : 'Agent Spécialiste Niche & Offre',
        tier: 2,
        category: 'research',
        modelId: 'google/gemini-2.5-flash',
        description: `Agent de recherche et d'analyse profonde pour ${cleanPrompt.slice(0, 30)}`,
        temperature: 0.2,
        maxTokens: 2048,
        ameMd: `# Ame.md — Spécialiste Recherche\n\nTu traques les données brutes et les opportunités sans tolérance pour les approximations.`,
        jobMd: `# Job.md — Extraction & Analyse\n\n1. Analyse des sources d'entrées.\n2. Normalisation des données.\n3. Rendu structuré JSON à l'Orchestrateur.`
      },
      {
        id: 'domain_architect',
        role: 'Architecte Produit & Endpoints',
        tier: 2,
        category: 'engineering',
        modelId: 'google/gemini-2.5-flash',
        description: 'Conception technique, bases de données D1 SQLite et interfaces API Cloudflare Edge.',
        temperature: 0.2,
        maxTokens: 4096,
        ameMd: `# Ame.md — Architecte Produit\n\nExpertise Cloudflare Workers & Astro SSR. Architecture modulaire et robuste.`,
        jobMd: `# Job.md — Spécifications Techniques\n\n1. Modélisation de la base SQL.\n2. Définition des endpoints REST / RPC.`
      },
      {
        id: 'execution_worker',
        role: 'Worker Développeur Atomique',
        tier: 3,
        category: 'engineering',
        modelId: 'deepseek/deepseek-chat',
        description: 'Génération ultra-rapide des modules, pages et scripts d\'automatisation.',
        temperature: 0.2,
        maxTokens: 2048,
        ameMd: `# Ame.md — Worker Haute Vitesse\n\nProduction de code propre, testé et < 50 lignes par composant.`,
        jobMd: `# Job.md — Génération\n\n1. Écriture du code conforme aux specs.\n2. Envoi au banc de test QA.`
      },
      {
        id: 'qa_sentinel',
        role: 'Agent QA & Validation Stricte',
        tier: 3,
        category: 'operations',
        modelId: 'google/gemini-2.5-flash',
        description: 'Validation qualité, tests de non-régression et audits de performance 100/100.',
        temperature: 0.1,
        maxTokens: 2048,
        ameMd: `# Ame.md — Sentinelle Qualité\n\n0 bug toléré. Vérification stricte des types et de la sécurité.`,
        jobMd: `# Job.md — Recette\n\n1. Compilation et linting.\n2. Validation des scénarios d'usage.`
      }
    ];

    const generatedChannels = [
      {
        id: 'ch-gen-1',
        sourceId: 'specialized_master',
        sourceName: `Orchestrateur Suprême`,
        targetId: generatedAgents[1].id,
        targetName: generatedAgents[1].role,
        protocol: 'RPC Synchrone',
        payloadType: 'Brief Objectif & Paramètres',
        triggerEvent: 'Lancement de Mission',
        description: 'Délégation de l\'analyse approfondie au spécialiste de Niveau 2.',
        enabled: true
      },
      {
        id: 'ch-gen-2',
        sourceId: generatedAgents[1].id,
        sourceName: generatedAgents[1].role,
        targetId: 'domain_architect',
        targetName: 'Architecte Produit',
        protocol: 'RPC Synchrone',
        payloadType: 'Données Synthétisées (JSON)',
        triggerEvent: 'Fin d\'Analyse',
        description: 'Transmission des contraintes et données métier pour conception technique.',
        enabled: true
      },
      {
        id: 'ch-gen-3',
        sourceId: 'domain_architect',
        sourceName: 'Architecte Produit',
        targetId: 'execution_worker',
        targetName: 'Worker Développeur',
        protocol: 'Queue Asynchrone',
        payloadType: 'Spécifications Micro-Tâches',
        triggerEvent: 'Distribution Tâches',
        description: 'Envoi des tâches d\'implémentation en parallèle.',
        enabled: true
      },
      {
        id: 'ch-gen-4',
        sourceId: 'execution_worker',
        sourceName: 'Worker Développeur',
        targetId: 'qa_sentinel',
        targetName: 'Agent QA',
        protocol: 'RPC Synchrone',
        payloadType: 'Code & Artifacts',
        triggerEvent: 'Code Livré',
        description: 'Validation de conformité et audit de performance.',
        enabled: true
      }
    ];

    return new Response(JSON.stringify({
      success: true,
      data: {
        summary: `Graphe sur-mesure de ${generatedAgents.length} agents conçu pour : "${cleanPrompt}"`,
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
    return new Response(JSON.stringify({ error: e.message || 'Erreur lors de la génération du graphe' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
