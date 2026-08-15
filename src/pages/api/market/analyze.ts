import type { APIRoute } from 'astro';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json() as any;
    const { 
      query, 
      searchType = 'domain', 
      openRouterKey, 
      model = 'google/gemini-2.5-flash',
      ameMd,
      jobMd,
      temperature = 0.2
    } = body;

    if (!query || typeof query !== 'string' || !query.trim()) {
      return new Response(JSON.stringify({ error: 'Domaine ou mot-clé requis' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const cleanQuery = query.trim();
    const isKeyword = searchType === 'keyword';

    // If an OpenRouter key is available, call the real LLM for deep analysis using custom Agent persona & instructions
    if (openRouterKey && openRouterKey.startsWith('sk-or-')) {
      try {
        const systemPersona = ameMd || `Tu es le Détective Stratégique d'OmniVenture. Ton obsession est de dénicher les points faibles critiques des concurrents et les opportunités de marché inexploitées sans gaspiller de ressources.`;
        const jobWorkflow = jobMd || `Analyse en profondeur les inputs reçus et structure un plan d'attaque commercial avec tarification d'essai à 0.50$.`;

        const userPrompt = isKeyword
          ? `[INSTRUCTIONS DE L'AGENT]
${systemPersona}
${jobWorkflow}

[MISSION D'ANALYSE DE NICHE / MOTS-CLÉS]
Analyse la niche ou les mots-clés de marché suivants : "${cleanQuery}".
Identifie les acteurs en place, les frustrations des acheteurs et l'opportunité de créer un Micro-SaaS ultra-rentable.
Retourne STRICTEMENT un objet JSON valide sans markdown, sans balise \`\`\`json, avec ce format exact :
{
  "name": "Niche : ${cleanQuery}",
  "url": "Mots-clés : ${cleanQuery}",
  "category": "Catégorie de Marché / Niche",
  "pricing": "Fourchette de prix constatée sur cette niche",
  "weaknesses": [
    "Frustration majeure 1 des utilisateurs de cette niche",
    "Frustration 2",
    "Frustration 3",
    "Frustration 4"
  ],
  "missingFeatures": [
    "Besoin non comblé 1",
    "Besoin non comblé 2",
    "Besoin non comblé 3"
  ],
  "pricingExploit": "Stratégie de tarification (ex: Essai 0.50$ pendant 48h puis 29$/mois sans engagement)",
  "recommendedPositioning": "Positionnement exact du Micro-SaaS pour dominer ces mots-clés",
  "targetAudience": "Profil client idéal qui recherche ces mots-clés",
  "viralMarketingHook": "Accroche publicitaire pour capter cette audience",
  "mvpCoreFeatures": [
    "Fonctionnalité 1 indispensable",
    "Fonctionnalité 2",
    "Fonctionnalité 3"
  ]
}`
          : `[INSTRUCTIONS DE L'AGENT]
${systemPersona}
${jobWorkflow}

[MISSION D'ANALYSE DE DOMAINE CONCURRENT]
Analyse en profondeur le site ou concurrent suivant : "${cleanQuery}".
Retourne STRICTEMENT un objet JSON valide sans markdown, sans balise \`\`\`json, avec ce format exact :
{
  "name": "${cleanQuery.replace(/^https?:\/\//i, '').replace(/\/.*$/, '')}",
  "url": "${cleanQuery.startsWith('http') ? cleanQuery : 'https://' + cleanQuery}",
  "category": "Catégorie précise du produit",
  "pricing": "Tarification du concurrent",
  "weaknesses": [
    "Point faible 1 du concurrent",
    "Point faible 2",
    "Point faible 3",
    "Point faible 4"
  ],
  "missingFeatures": [
    "Fonctionnalité manquante 1",
    "Fonctionnalité manquante 2",
    "Fonctionnalité manquante 3"
  ],
  "pricingExploit": "Angle d'attaque tarifaire (ex: Essai 0.50$ 48h puis abonnement sans engagement)",
  "recommendedPositioning": "Positionnement pour battre ce concurrent",
  "targetAudience": "Audience frustrée par ce concurrent",
  "viralMarketingHook": "Accroche publicitaire pour convertir leurs clients",
  "mvpCoreFeatures": [
    "Fonctionnalité clé 1",
    "Fonctionnalité clé 2",
    "Fonctionnalité clé 3"
  ]
}`;

        const openRouterRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openRouterKey}`,
            'HTTP-Referer': 'https://factory.dev',
            'X-Title': 'OmniVenture AI'
          },
          body: JSON.stringify({
            model: model || 'google/gemini-2.5-flash',
            messages: [{ role: 'user', content: userPrompt }],
            temperature: typeof temperature === 'number' ? temperature : 0.2,
            max_tokens: 1500
          })
        });

        if (openRouterRes.ok) {
          const completion = await openRouterRes.json() as any;
          const rawText = completion.choices?.[0]?.message?.content || '';
          const cleanedText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
          const parsed = JSON.parse(cleanedText);
          return new Response(JSON.stringify({ 
            success: true, 
            data: parsed, 
            source: 'openrouter_live',
            modelUsed: model || 'google/gemini-2.5-flash'
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      } catch (err) {
        console.warn('OpenRouter API call failed, using heuristic fallback', err);
      }
    }

    // Dynamic heuristic fallback
    const title = cleanQuery.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    const dynamicData = isKeyword
      ? {
          name: `Niche : ${cleanQuery}`,
          url: `Mots-clés : "${cleanQuery}"`,
          category: `Marché B2B / SaaS autour de "${cleanQuery}"`,
          pricing: 'Abonnements du secteur oscillant entre 19$ et 79$/mois',
          weaknesses: [
            `Solutions existantes trop complexes pour les requêtes ciblées sur "${cleanQuery}"`,
            'Tarification inaccessible pour les indépendants et débutants',
            'Manque d\'automatisation directe en un clic par intelligence artificielle',
            'Tunnels de vente obsolètes sans micro-période d\'essai sans friction'
          ],
          missingFeatures: [
            `Génération instantanée dédiée exclusivement à "${cleanQuery}"`,
            'Micro-pass 48h à 0.50$ sans engagement',
            'Export instantané et synchronisation Cloudflare Edge'
          ],
          pricingExploit: `Accès d'essai flash à 0.50$ pendant 48h puis abonnement récurrent à 19$/mois.`,
          recommendedPositioning: `L'outil n°1 le plus rapide et abordable pour "${cleanQuery}".`,
          targetAudience: `Professionnels et créateurs effectuant des recherches sur "${cleanQuery}"`,
          viralMarketingHook: `Le nouvel outil IA secret pour automatiser "${cleanQuery}" en 30 secondes...`,
          mvpCoreFeatures: [
            `Moteur IA dédié à "${cleanQuery}"`,
            'Tunnel Stripe Checkout trial 0.50$',
            'Interface minimale sans configuration technique'
          ]
        }
      : {
          name: title.charAt(0).toUpperCase() + title.slice(1),
          url: cleanQuery.startsWith('http') ? cleanQuery : `https://${cleanQuery.toLowerCase()}`,
          category: `Outil & Logiciel concurrent (${title})`,
          pricing: `Forfaits mensuels récurrents de ${title} avec engagement`,
          weaknesses: [
            `Complexité excessive : interface surchargée pour les besoins simples`,
            `Tarification par utilisateur qui pénalise les équipes en croissance`,
            'Temps de chargement et support souvent critiqués',
            'Fonctionnalités avancées réservées aux plans Entreprise très chers'
          ],
          missingFeatures: [
            'Automatisation IA en 1-clic sans paramétrage lourd',
            'Option de paiement à l\'usage ou micro-essai 48h',
            'Architecture Edge ultra-rapide sans latence'
          ],
          pricingExploit: `Offre d'essai 48h à 0.50$ puis 19$/mois sans engagement face aux forfaits lourds de ${title}.`,
          recommendedPositioning: `Version allégée, 10x plus rapide et assistée par IA de ${title}.`,
          targetAudience: `Utilisateurs frustrés par la complexité ou le prix de ${title}`,
          viralMarketingHook: `Pourquoi continuer à payer cher pour ${title} quand cette alternative existe pour 0.50$...`,
          mvpCoreFeatures: [
            `Cas d'usage principal de ${title} en 1-clic`,
            'Tunnel de paiement trial 0.50$ (48h)',
            'Génération et export instantané'
          ]
        };

    return new Response(JSON.stringify({ 
      success: true, 
      data: dynamicData, 
      source: 'heuristic',
      modelUsed: model || 'google/gemini-2.5-flash'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || 'Erreur serveur' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
