import React, { useState, useEffect, useRef } from 'react';
import { ModelCombobox, type OpenRouterModelItem } from './ModelCombobox';
import { agentCall } from '../lib/agent-profile';
import { HIERARCHY_BADGE, HIERARCHY_LABEL, normalizeLevel } from '../lib/hierarchy';
import { ensureCoreAgents } from '../lib/hiring';
import { SHARED_ROLES } from '../lib/agent-roster';
import { CultureEditor } from './CultureEditor';
import { EnterpriseNetworkGraph } from './EnterpriseNetworkGraph';
import { exportGraphToZip, importGraphFromZip, downloadBlobAsFile, type CommunicationChannel } from '../lib/zip-manager';
import { readLocal, writeLocal } from '../lib/local';

export type HierarchyLevel = 'c_level' | 'vp' | 'head_of' | 'lead' | 'expert';

type StudioTab = 'graph' | 'hierarchy' | 'teams' | 'editor' | 'culture' | 'openrouter_config';

/**
 * Les écrans du studio.
 *
 * Un onglet « Bureau Virtuel 2D » figurait ici : il n'affichait pas le bureau,
 * il expliquait que le bureau tournait derrière la fenêtre et invitait à la
 * fermer. Un onglet dont le contenu est « allez ailleurs » n'est pas un onglet.
 */
const STUDIO_TABS: { id: StudioTab; label: string; icon: string; hint: string }[] = [
  { id: 'graph', label: 'Graphe réseau', icon: '🕸️', hint: 'Les agents et leurs canaux, déplaçables' },
  { id: 'hierarchy', label: 'Organigramme', icon: '🏢', hint: 'Les cinq niveaux, du C-Level aux experts' },
  { id: 'teams', label: 'Équipes', icon: '👥', hint: 'Les équipes composables' },
  { id: 'editor', label: 'Âme & Job', icon: '📝', hint: 'Ame.md et Job.md de l’agent sélectionné' },
  { id: 'culture', label: 'Culture', icon: '🧭', hint: 'Ce que toute l’agence partage' },
  { id: 'openrouter_config', label: 'Clés & modèles', icon: '⚙️', hint: 'Clé OpenRouter et modèles disponibles' }
];

export interface TeamData {
  id: string;
  name: string;
  icon: string;
  description: string;
}

export interface AgentCustomData {
  id: string;
  role: string;
  hierarchyLevel: HierarchyLevel;
  tier: 1 | 2 | 3;
  teamId?: string;
  teamName?: string;
  category: 'orchestration' | 'research' | 'engineering' | 'growth' | 'operations';
  modelId: string;
  description: string;
  temperature: number;
  maxTokens: number;
  ameMd: string;
  jobMd: string;
}

const FALLBACK_MODELS: OpenRouterModelItem[] = [
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', pricing: { prompt: '0.00000015', completion: '0.0000006' } },
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3', pricing: { prompt: '0.00000014', completion: '0.00000028' } },
  { id: 'qwen/qwen-2.5-72b-instruct', name: 'Qwen 2.5 72B Instruct', pricing: { prompt: '0.00000035', completion: '0.0000004' } },
  { id: 'qwen/qwen-2.5-coder-32b-instruct', name: 'Qwen 2.5 Coder 32B', pricing: { prompt: '0.00000007', completion: '0.00000016' } },
  { id: 'anthropic/claude-3.7-sonnet', name: 'Claude 3.7 Sonnet', pricing: { prompt: '0.000003', completion: '0.000015' } },
  { id: 'x-ai/grok-2', name: 'Grok 2', pricing: { prompt: '0.000002', completion: '0.000010' } },
  { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1 Reasoning', pricing: { prompt: '0.00000055', completion: '0.00000219' } },
  { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B Instruct', pricing: { prompt: '0.00000012', completion: '0.0000003' } }
];

const INITIAL_TEAMS: TeamData[] = [
  { id: 'team_strategy', name: 'Direction & Stratégie', icon: '👑', description: 'Gouvernance, arbitrage P&L et vision globale des Micro-SaaS' },
  { id: 'team_research', name: 'Intelligence & Veille Marché', icon: '🔬', description: 'Scraping de concurrents, détection de frustrations et pricing exploits' },
  { id: 'team_engineering', name: 'Ingénierie & Core Cloudflare', icon: '📐', description: 'Architecture Astro SSR, bases D1 et composants atomiques' },
  { id: 'team_growth', name: 'Acquisition & Marketing Direct', icon: '📢', description: 'Copywriting persuasif, scripts vidéos et tunnels 0.50$ trial' },
  { id: 'team_ops_qa', name: 'Qualité, Sécurité & Canary', icon: '🛡️', description: 'Recette TypeScript, déploiement Canary progressif et résilience' }
];

const INITIAL_AGENTS_DATA: AgentCustomData[] = [
  ...(SHARED_ROLES as AgentCustomData[]),
  // 1. C-LEVEL
  {
    id: 'master',
    role: 'Orchestrateur Stratégique Suprême',
    hierarchyLevel: 'c_level',
    tier: 1,
    teamId: 'team_strategy',
    teamName: 'Direction & Stratégie',
    category: 'orchestration',
    modelId: 'x-ai/grok-2',
    description: 'Analyse le speech, coordonne l\'ensemble des VPs et agents en DAG de micro-tâches (< 50 lignes).',
    temperature: 0.7,
    maxTokens: 4096,
    ameMd: `# Ame.md — Orchestrateur Stratégique (C-Level)\n\n## Identité & Philosophie\nTu es le Cerveau Central du système OmniVenture.\nTon unique mission est la rentabilité maximale et la réduction drastique des coûts d'inférence.\n\n## Principes Fondamentaux :\n1. Zéro code direct : Tu découpes les projets en sous-tâches atomiques de moins de 50 lignes.\n2. Économie de tokens : Déléguer les recherches et calculs lourds aux agents de Tier 2 et 3.\n3. Orientation Business : Tunnel Trial $0.50 (48h) obligatoire.`,
    jobMd: `# Job.md — Cahier des Charges & Missions\n\n## 1. Inputs Reçus\n- Speech du projet, Niche & Dossier de marché\n\n## 2. Workflow\n1. Interrogation des agents de recherche (Scraper & Sentiment).\n2. Découpage en 5 composants majeurs.\n3. Distribution des sous-tâches à DeepSeek V3 / Qwen Coder.\n4. Déclenchement de l'audit QA.`
  },
  {
    id: 'planner',
    role: 'Planificateur & Gestion de Crise',
    hierarchyLevel: 'c_level',
    tier: 1,
    teamId: 'team_strategy',
    teamName: 'Direction & Stratégie',
    category: 'operations',
    modelId: 'qwen/qwen-2.5-72b-instruct',
    description: 'Validation de résilience Edge et arbitrage Hotfix vs Rollback 0ms en cas d\'incident critique.',
    temperature: 0.3,
    maxTokens: 2048,
    ameMd: `# Ame.md — Sentinelle & Gestion de Crise\n\nTu es le gardien de la résilience Edge. Si erreur isolée : Hotfix en < 30s. Si menace Stripe : Rollback 0ms.`,
    jobMd: `# Job.md — Protocole Incident\n\nSurveillance des alertes 5xx et déclenchement de la procédure d'urgence.`
  },

  // 2. VP LEVEL
  {
    id: 'market_agent',
    role: 'VP Veille Concurrentielle & Niche',
    hierarchyLevel: 'vp',
    tier: 1,
    teamId: 'team_research',
    teamName: 'Intelligence & Veille Marché',
    category: 'research',
    modelId: 'google/gemini-2.5-flash',
    description: 'Pilote les investigations de marché, délègue le scraping et l\'analyse de sentiment aux sous-agents de recherche.',
    temperature: 0.2,
    maxTokens: 2048,
    ameMd: `# Ame.md — Veille Concurrentielle & Niche (VP)\n\n## Identité & Philosophie\nTu es le Détective Stratégique d'OmniVenture.\nTon obsession est de dénicher les points faibles critiques des concurrents et les opportunités de marché inexploitées sans gaspiller de ressources.\n\n## Principes Directeurs :\n1. Économie Maximale : Utilise Gemini 2.5 Flash / DeepSeek V3 pour un coût infime ($0.15/M tokens).\n2. Délégation : Pilote les agents de recherche de Niveau 2 pour extraire les faits bruts.\n3. Angle d'Attaque : Toujours formuler un angle d'attaque à micro-prix ($0.50 trial 48h puis $29/mois).`,
    jobMd: `# Job.md — Analyse de Marché\n\n## 1. Entrées Reçues (Inputs)\n- URL / Domaine du concurrent OU Mots-clés de niche.\n\n## 2. Workflow Séquentiel\n1. Déclencher l'agent de scraping (Tier 2) pour inspecter les tarifs.\n2. Déclencher l'agent d'analyse de sentiment (Tier 2) pour identifier les frustrations.\n3. Structurer le plan d'attaque tarifaire et les spécifications du MVP challenger.`
  },

  // 3. HEAD OF LEVEL
  {
    id: 'lead_dev',
    role: 'Head of Architecture & Sécurité',
    hierarchyLevel: 'head_of',
    tier: 2,
    teamId: 'team_engineering',
    teamName: 'Ingénierie & Core Cloudflare',
    category: 'engineering',
    modelId: 'google/gemini-2.5-flash',
    description: 'Architecture globale Astro SSR, intégration Stripe Checkout & Webhooks, schéma D1.',
    temperature: 0.2,
    maxTokens: 4096,
    ameMd: `# Ame.md — Lead Architecte\n\nIngénieur en chef Astro 5 & Cloudflare Edge. 0 dépendance superflue.`,
    jobMd: `# Job.md — Architecture\n\nConception des endpoints critiques (/api/checkout-trial.ts) et schémas D1 SQL.`
  },
  {
    id: 'devops_agent',
    role: 'Head of DevOps Canary Sentinel',
    hierarchyLevel: 'head_of',
    tier: 2,
    teamId: 'team_ops_qa',
    teamName: 'Qualité, Sécurité & Canary',
    category: 'operations',
    modelId: 'qwen/qwen-2.5-72b-instruct',
    description: 'Gestion du trafic progressif (10% → 100%) sur Cloudflare Workers Versioning.',
    temperature: 0.1,
    maxTokens: 2048,
    ameMd: `# Ame.md — Opérateur Edge\n\nMaître du trafic mondial Cloudflare.`,
    jobMd: `# Job.md — Rollout\n\nRoutage progressif 10% -> 100% et alerte 5xx.`
  },

  // 4. LEAD LEVEL
  {
    id: 'market_scraper_agent',
    role: 'Lead Scraper & Extraction Web',
    hierarchyLevel: 'lead',
    tier: 2,
    teamId: 'team_research',
    teamName: 'Intelligence & Veille Marché',
    category: 'research',
    modelId: 'google/gemini-2.5-flash',
    description: 'Spécialiste activé par l\'orchestrateur d\'analyse pour crawler les pages de pricing et caractéristiques concurrentes.',
    temperature: 0.1,
    maxTokens: 2048,
    ameMd: `# Ame.md — Agent Scraper & Extraction Web\n\nTu es l'œil de l'usine sur le web public. Tu extrais les grilles tarifaires, limites de plans et fonctionnalités techniques avec une précision chirurgicale.`,
    jobMd: `# Job.md — Extraction de Faits\n\n1. Parcourir la landing page et la page /pricing.\n2. Normaliser les devises, périodes d'essai et forfaits payants.\n3. Renvoyer un payload structuré JSON à l'Orchestrateur d'analyse.`
  },
  {
    id: 'copywriter_agent',
    role: 'Lead Copywriting & Accroches Ads',
    hierarchyLevel: 'lead',
    tier: 2,
    teamId: 'team_growth',
    teamName: 'Acquisition & Marketing Direct',
    category: 'growth',
    modelId: 'google/gemini-2.5-flash',
    description: 'Rédige les textes publicitaires Meta, Google, TikTok et les articles SEO ciblant les mots-clés du concurrent.',
    temperature: 0.5,
    maxTokens: 2048,
    ameMd: `# Ame.md — Copywriter Persuasif\n\nMaître du marketing direct et de la conversion. Tu écris des accroches impossibles à ignorer.`,
    jobMd: `# Job.md — Copywriting\n\nGénération d'annonces Google Search, scripts TikTok 9:16 et articles de blog SEO.`
  },

  // 5. EXPERT / WORKER LEVEL
  {
    id: 'sentiment_agent',
    role: "Expert Analyseur d'Avis & Sentiment",
    hierarchyLevel: 'expert',
    tier: 3,
    teamId: 'team_research',
    teamName: 'Intelligence & Veille Marché',
    category: 'research',
    modelId: 'deepseek/deepseek-chat',
    description: 'Sous-agent de recherche analysant les avis négatifs, plaintes Reddit et retours Trustpilot/G2 pour isoler les bugs et mécontentements.',
    temperature: 0.2,
    maxTokens: 2048,
    ameMd: `# Ame.md — Analyseur de Frustrations\n\nTu traques le ressentiment des utilisateurs envers les outils établis : bugs récurrents, tarifs prohibitifs, complexité inutile.`,
    jobMd: `# Job.md — Détection de Frustrations\n\n1. Catégoriser les 4 plus grandes plaintes utilisateurs.\n2. Révéler les 3 fonctionnalités réclamées mais refusées par le concurrent.\n3. Synthétiser en arguments de vente pour le challenger.`
  },
  {
    id: 'worker_dev',
    role: 'Worker Développeur Micro-Tasks',
    hierarchyLevel: 'expert',
    tier: 3,
    teamId: 'team_engineering',
    teamName: 'Ingénierie & Core Cloudflare',
    category: 'engineering',
    modelId: 'deepseek/deepseek-chat',
    description: 'Génération massive de composants Astro, routes API, styles Tailwind et métadonnées SEO.',
    temperature: 0.2,
    maxTokens: 2048,
    ameMd: `# Ame.md — Worker Développeur\n\nArtisan du code atomique haute vitesse. 1 fichier par tâche.`,
    jobMd: `# Job.md — Code\n\nÉcriture des composants .astro et styles Tailwind basiques.`
  },
  {
    id: 'qa_agent',
    role: 'Expert QA & Recette Automatique',
    hierarchyLevel: 'expert',
    tier: 3,
    teamId: 'team_ops_qa',
    teamName: 'Qualité, Sécurité & Canary',
    category: 'operations',
    modelId: 'google/gemini-2.5-flash',
    description: 'Compilation TypeScript, audit Lighthouse et simulation de transition Stripe 48h.',
    temperature: 0.1,
    maxTokens: 2048,
    ameMd: `# Ame.md — Auditeur Qualité\n\nInspecteur impitoyable. 0 erreur tolérée.`,
    jobMd: `# Job.md — Recette\n\nExécution de astro check et validation Lighthouse 100/100.`
  },
  {
    id: 'cro_agent',
    role: 'Expert CRO & Multi-Armed Bandit',
    hierarchyLevel: 'expert',
    tier: 3,
    teamId: 'team_growth',
    teamName: 'Acquisition & Marketing Direct',
    category: 'growth',
    modelId: 'deepseek/deepseek-chat',
    description: 'Multi-Armed Bandit pour optimiser en continu le prix du trial (0.50$ vs 1.00$).',
    temperature: 0.4,
    maxTokens: 2048,
    ameMd: `# Ame.md — Optimiseur de Conversion\n\nScientifique du revenu et du taux de clic.`,
    jobMd: `# Job.md — CRO\n\nArbitrage des variantes A ($0.50) vs B ($1.00) dans Cloudflare KV.`
  }
];

const INITIAL_CHANNELS: CommunicationChannel[] = [
  {
    id: 'ch-market-scraper',
    sourceId: 'market_agent',
    sourceName: 'VP Veille & Marché',
    targetId: 'market_scraper_agent',
    targetName: 'Lead Scraper Web',
    protocol: 'RPC Synchrone',
    payloadType: 'URL cible & Sélecteurs',
    triggerEvent: 'Analyse Domaine Concurrent',
    description: 'Délégation du scraping des prix et fonctionnalités techniques sans charger le modèle maître.',
    enabled: true
  },
  {
    id: 'ch-market-sentiment',
    sourceId: 'market_agent',
    sourceName: 'VP Veille & Marché',
    targetId: 'sentiment_agent',
    targetName: 'Expert Avis & Sentiment',
    protocol: 'RPC Synchrone',
    payloadType: 'Recherche Mots-clés & Frustrations',
    triggerEvent: 'Analyse Niche ou Concurrent',
    description: 'Extraction des plaintes utilisateurs et points de friction pour bâtir le positionnement.',
    enabled: true
  },
  {
    id: 'ch-market-master',
    sourceId: 'market_agent',
    sourceName: 'VP Veille & Marché',
    targetId: 'master',
    targetName: 'CEO & Orchestrateur Suprême',
    protocol: 'RPC Synchrone',
    payloadType: 'Dossier Benchmark Validé (JSON)',
    triggerEvent: 'Création du Micro-SaaS Challenger',
    description: 'Transmission de l\'angle d\'attaque tarifaire et du blueprint produit au cerveau de production.',
    enabled: true
  },
  {
    id: 'ch-master-lead',
    sourceId: 'master',
    sourceName: 'CEO & Orchestrateur Suprême',
    targetId: 'lead_dev',
    targetName: 'Head of Architecture',
    protocol: 'RPC Synchrone',
    payloadType: 'DAG Schema (JSON)',
    triggerEvent: 'Nouveau Projet / Analyse Speech',
    description: 'Transmission du plan d\'architecture globale, routes requises et contrats d\'interfaces.',
    enabled: true
  },
  {
    id: 'ch-master-copy',
    sourceId: 'master',
    sourceName: 'CEO & Orchestrateur Suprême',
    targetId: 'copywriter_agent',
    targetName: 'Lead Copywriting & Ads',
    protocol: 'Queue Asynchrone',
    payloadType: 'Brief Produit & Angles Marketing',
    triggerEvent: 'Génération de Campagnes',
    description: 'Déclenchement asynchrone des publicités et pages de vente.',
    enabled: true
  },
  {
    id: 'ch-lead-worker',
    sourceId: 'lead_dev',
    sourceName: 'Head of Architecture',
    targetId: 'worker_dev',
    targetName: 'Worker Développeur',
    protocol: 'Queue Asynchrone',
    payloadType: 'Micro-Task Spec (<50 lignes)',
    triggerEvent: 'Découpage des Composants',
    description: 'Distribution en parallèle des micro-tâches d\'écriture de composants UI et formulaires.',
    enabled: true
  },
  {
    id: 'ch-worker-qa',
    sourceId: 'worker_dev',
    sourceName: 'Worker Développeur',
    targetId: 'qa_agent',
    targetName: 'Expert QA & Recette',
    protocol: 'RPC Synchrone',
    payloadType: 'Code Source & Tests',
    triggerEvent: 'Fin de Génération de Code',
    description: 'Soumission des fichiers générés pour vérification TypeScript stricte et audit de sécurité.',
    enabled: true
  },
  {
    id: 'ch-qa-devops',
    sourceId: 'qa_agent',
    sourceName: 'Expert QA & Recette',
    targetId: 'devops_agent',
    targetName: 'Head of DevOps Canary',
    protocol: 'RPC Synchrone',
    payloadType: 'Build Artifacts Validés',
    triggerEvent: 'Validation QA 100%',
    description: 'Ordre de déploiement Canary immédiat sur 10% du réseau mondial Cloudflare.',
    enabled: true
  },
  {
    id: 'ch-devops-crisis',
    sourceId: 'devops_agent',
    sourceName: 'Head of DevOps Canary',
    targetId: 'planner',
    targetName: 'Planificateur de Crise',
    protocol: 'Événement Edge (Pub/Sub)',
    payloadType: 'Alerte 5xx & Stack Trace',
    triggerEvent: 'Erreur P95 ou Stripe Echec',
    description: 'Escalade d\'incident en direct pour arbitrage automatique : Hotfix rapide ou Rollback 0ms.',
    enabled: true
  },
  {
    id: 'ch-cro-master',
    sourceId: 'cro_agent',
    sourceName: 'Expert CRO & A/B Test',
    targetId: 'master',
    targetName: 'CEO & Orchestrateur Suprême',
    protocol: 'Queue Asynchrone',
    payloadType: 'Statistiques Multi-Armed Bandit',
    triggerEvent: 'Cycle d\'Optimisation 24h',
    description: 'Rétroaction des prix gagnants (Trial 0.50$ vs 1.00$) pour ajuster les futurs projets.',
    enabled: true
  }
];

export const AgentGraphStudio: React.FC = () => {
  const [openRouterKey, setOpenRouterKey] = useState<string>('');
  const [teams, setTeams] = useState<TeamData[]>(INITIAL_TEAMS);
  const [agents, setAgents] = useState<AgentCustomData[]>(INITIAL_AGENTS_DATA);
  const [channels, setChannels] = useState<CommunicationChannel[]>(INITIAL_CHANNELS);
  const [modelsList, setModelsList] = useState<OpenRouterModelItem[]>(FALLBACK_MODELS);
  const [isLoadingModels, setIsLoadingModels] = useState<boolean>(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('market_agent');
  const [selectedChannelId, setSelectedChannelId] = useState<string>('ch-market-scraper');
  const [selectedTeamFilter, setSelectedTeamFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<StudioTab>('graph');
  const [activeEditorSubTab, setActiveEditorSubTab] = useState<'ame' | 'job' | 'params'>('ame');
  const [keyStatus, setKeyStatus] = useState<'none' | 'valid' | 'invalid'>('none');
  const [isTestingKey, setIsTestingKey] = useState<boolean>(false);
  const [notification, setNotification] = useState<string | null>(null);
  // La « simulation des flux » a disparu : elle allumait les canaux les uns
  // après les autres, à 800 ms d'intervalle, sans qu'aucun agent ne travaille.

  // AI Graph Generator Modal State
  const [isAiModalOpen, setIsAiModalOpen] = useState<boolean>(false);
  const [aiPrompt, setAiPrompt] = useState<string>('');
  // Le générateur d'organigramme est un appel de modèle comme un autre : il
  // part sur celui de la DRH, responsable de la conception de l'organisation.
  const [aiModel, setAiModel] = useState<string>(() => agentCall('orgDesign').model ?? 'google/gemini-2.5-flash');
  const [generatorMode, setGeneratorMode] = useState<'full_supergraph' | 'add_team'>('full_supergraph');
  const [isGeneratingGraph, setIsGeneratingGraph] = useState<boolean>(false);
  const [generatedGraphPreview, setGeneratedGraphPreview] = useState<{ summary: string; teams?: TeamData[]; agents: AgentCustomData[]; channels: CommunicationChannel[] } | null>(null);

  // Zip Import Hidden Ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchOpenRouterModels = async (apiKey?: string) => {
    setIsLoadingModels(true);
    try {
      const headers: Record<string, string> = {
        'HTTP-Referer': 'https://factory.dev',
        'X-Title': 'OmniVenture AI'
      };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const res = await fetch('https://openrouter.ai/api/v1/models', { headers });
      if (res.ok) {
        const json = await res.json() as any;
        if (json && json.data && Array.isArray(json.data) && json.data.length > 0) {
          const mapped: OpenRouterModelItem[] = json.data.map((m: any) => ({
            id: m.id,
            name: m.name || m.id,
            context_length: m.context_length,
            pricing: m.pricing
          }));
          setModelsList(mapped);
          try {
            writeLocal('omniventure_openrouter_models_cache', JSON.stringify(mapped));
          } catch {}
          return mapped;
        }
      }
    } catch (err) {
      console.warn('Could not fetch OpenRouter models live, using fallback', err);
    } finally {
      setIsLoadingModels(false);
    }
    return FALLBACK_MODELS;
  };

  useEffect(() => {
    try {
      const savedKey = readLocal('omniventure_openrouter_key');
      if (savedKey) {
        setOpenRouterKey(savedKey);
        setKeyStatus('valid');
      }

      const savedTeams = readLocal('omniventure_teams_v5');
      if (savedTeams) {
        setTeams(JSON.parse(savedTeams));
      } else {
        writeLocal('omniventure_teams_v5', JSON.stringify(INITIAL_TEAMS));
      }

      // Un graphe déjà enregistré ne connaît pas les métiers ajoutés depuis :
      // la synchronisation les lui ajoute une fois, sans toucher au reste.
      const synced = ensureCoreAgents();
      if (synced.length > 0) {
        setAgents(synced as unknown as AgentCustomData[]);
      } else {
        writeLocal('omniventure_custom_agents_v5', JSON.stringify(INITIAL_AGENTS_DATA));
        setAgents(INITIAL_AGENTS_DATA);
      }

      const savedChannels = readLocal('omniventure_channels_v5');
      if (savedChannels) {
        setChannels(JSON.parse(savedChannels));
      } else {
        writeLocal('omniventure_channels_v5', JSON.stringify(INITIAL_CHANNELS));
      }

      const cachedModels = readLocal('omniventure_openrouter_models_cache');
      if (cachedModels) {
        setModelsList(JSON.parse(cachedModels));
      }
    } catch {}

    fetchOpenRouterModels();
  }, []);

  const currentAgent = agents.find(a => a.id === selectedAgentId) || agents[0];
  const selectedChannel = channels.find(c => c.id === selectedChannelId) || channels[0];

  const handleUpdateCurrentAgent = (fields: Partial<AgentCustomData>) => {
    const updated = agents.map(a => a.id === currentAgent.id ? { ...a, ...fields } : a);
    setAgents(updated);
    writeLocal('omniventure_custom_agents_v5', JSON.stringify(updated));
  };

  const handleToggleChannel = (channelId: string) => {
    const updated = channels.map(c => c.id === channelId ? { ...c, enabled: !c.enabled } : c);
    setChannels(updated);
    writeLocal('omniventure_channels_v5', JSON.stringify(updated));
    setNotification('Canal de communication mis à jour.');
    setTimeout(() => setNotification(null), 2500);
  };

  const handleSaveAll = () => {
    try {
      writeLocal('omniventure_openrouter_key', openRouterKey);
      writeLocal('omniventure_teams_v5', JSON.stringify(teams));
      writeLocal('omniventure_custom_agents_v5', JSON.stringify(agents));
      writeLocal('omniventure_channels_v5', JSON.stringify(channels));
      setNotification('Super-Graphe d\'Équipes enregistré avec succès !');
      setTimeout(() => setNotification(null), 3500);
    } catch (e) {
      console.error(e);
    }
  };

  // ZIP EXPORT
  const handleExportZip = async () => {
    try {
      setNotification('Génération de l\'archive .zip du Super-Graphe...');
      const blob = await exportGraphToZip(agents, channels, teams);
      const filename = `omniventure-supergraph-${new Date().toISOString().split('T')[0]}.zip`;
      downloadBlobAsFile(blob, filename);
      setNotification(`Archive ${filename} téléchargée avec succès (${agents.length} agents, ${teams.length} équipes) !`);
      setTimeout(() => setNotification(null), 3500);
    } catch (err: any) {
      setNotification(`Erreur lors de l'export ZIP : ${err.message || err}`);
    }
  };

  // ZIP IMPORT
  const handleImportZip = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setNotification('Lecture et extraction du fichier .zip...');
      const imported = await importGraphFromZip(file);
      if (imported.teams && imported.teams.length > 0) {
        setTeams(imported.teams);
        writeLocal('omniventure_teams_v5', JSON.stringify(imported.teams));
      }
      setAgents(imported.agents);
      if (imported.channels && imported.channels.length > 0) {
        setChannels(imported.channels);
        writeLocal('omniventure_channels_v5', JSON.stringify(imported.channels));
      }
      setSelectedAgentId(imported.agents[0].id);
      writeLocal('omniventure_custom_agents_v5', JSON.stringify(imported.agents));

      setNotification(`✓ Succès ! ${imported.agents.length} agents et ${imported.channels?.length || 0} canaux importés depuis le .zip.`);
      setTimeout(() => setNotification(null), 4000);
    } catch (err: any) {
      setNotification(`Erreur lors de l'import : ${err.message || err}`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // AI GRAPH GENERATION (WITH LIVE OPENROUTER MODELS)
  const handleGenerateAiGraph = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!aiPrompt.trim()) return;

    setIsGeneratingGraph(true);
    try {
      const res = await fetch('/api/agents/generate-graph', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: aiPrompt.trim(),
          openRouterKey: openRouterKey || undefined,
          model: aiModel,
          availableModels: modelsList.slice(0, 50)
        })
      });

      if (res.ok) {
        const json = await res.json() as any;
        if (json && json.data) {
          setGeneratedGraphPreview(json.data);
          setNotification('Nouveau graphe multi-équipes généré ! Vérifiez l\'aperçu.');
        }
      } else {
        setNotification('Erreur lors de la génération du graphe IA.');
      }
    } catch (err) {
      console.error(err);
      setNotification('Impossible de contacter le générateur IA.');
    } finally {
      setIsGeneratingGraph(false);
      setTimeout(() => setNotification(null), 3500);
    }
  };

  const handleApplyGeneratedGraph = () => {
    if (!generatedGraphPreview) return;

    if (generatorMode === 'full_supergraph') {
      if (generatedGraphPreview.teams && generatedGraphPreview.teams.length > 0) {
        setTeams(generatedGraphPreview.teams);
        writeLocal('omniventure_teams_v5', JSON.stringify(generatedGraphPreview.teams));
      }
      setAgents(generatedGraphPreview.agents);
      setChannels(generatedGraphPreview.channels);
      setSelectedAgentId(generatedGraphPreview.agents[0].id);
      writeLocal('omniventure_custom_agents_v5', JSON.stringify(generatedGraphPreview.agents));
      writeLocal('omniventure_channels_v5', JSON.stringify(generatedGraphPreview.channels));
    } else {
      // Add team mode: append new teams, agents and channels
      if (generatedGraphPreview.teams) {
        const mergedTeams = [...teams, ...generatedGraphPreview.teams.filter(t => !teams.some(existing => existing.id === t.id))];
        setTeams(mergedTeams);
        writeLocal('omniventure_teams_v5', JSON.stringify(mergedTeams));
      }
      const mergedAgents = [...agents, ...generatedGraphPreview.agents.filter(a => !agents.some(existing => existing.id === a.id))];
      const mergedChannels = [...channels, ...generatedGraphPreview.channels.filter(c => !channels.some(existing => existing.id === c.id))];
      setAgents(mergedAgents);
      setChannels(mergedChannels);
      writeLocal('omniventure_custom_agents_v5', JSON.stringify(mergedAgents));
      writeLocal('omniventure_channels_v5', JSON.stringify(mergedChannels));
    }

    setIsAiModalOpen(false);
    setGeneratedGraphPreview(null);
    setAiPrompt('');
    setNotification('Graphe d\'équipes mis à jour avec succès !');
    setTimeout(() => setNotification(null), 3500);
  };

  const handleTestOpenRouterKey = async () => {
    if (!openRouterKey.trim()) {
      setKeyStatus('invalid');
      setNotification('Veuillez entrer une clé API OpenRouter valide.');
      setTimeout(() => setNotification(null), 4000);
      return;
    }

    setIsTestingKey(true);
    try {
      const models = await fetchOpenRouterModels(openRouterKey);
      if (models && models.length > 0) {
        setKeyStatus('valid');
        writeLocal('omniventure_openrouter_key', openRouterKey);
        setNotification(`Connexion réussie ! ${models.length} modèles OpenRouter prêts.`);
      } else {
        setKeyStatus('invalid');
        setNotification('Clé OpenRouter rejetée.');
      }
    } catch {
      setKeyStatus('invalid');
    } finally {
      setIsTestingKey(false);
      setTimeout(() => setNotification(null), 4000);
    }
  };

  const filteredAgents = selectedTeamFilter === 'all' 
    ? agents 
    : agents.filter(a => a.teamId === selectedTeamFilter);

  /**
   * Le badge d'un niveau.
   *
   * Ce `switch` n'avait aucune branche par défaut : un agent venu du
   * générateur par IA ou d'un .zip, portant « C-Level » ou « Worker » plutôt
   * que la clé interne, faisait renvoyer `undefined` — et la lecture de
   * `.color` juste après faisait tomber tout l'écran. C'est ce qui rendait la
   * vue inutilisable dès qu'un graphe était généré.
   */
  const getHierarchyBadge = (level: unknown) => {
    const row = normalizeLevel(level);
    return { label: HIERARCHY_LABEL[row], color: HIERARCHY_BADGE[row] };
  };

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {notification && (
        <div className="fixed bottom-5 right-5 z-50 px-4 py-3 bg-slate-900 text-white rounded-lg shadow-lg text-xs flex items-center gap-2">
          <span>✓</span>
          <span>{notification}</span>
        </div>
      )}

      {/* Hidden File Input for Zip Import */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImportZip}
        accept=".zip"
        className="hidden"
      />

      {/*
        En-tête.

        Il portait un titre sur trois lignes, un badge « 5 Niveaux de
        Profondeur » et un paragraphe d'architecture — tout cela répétait le
        titre de la fenêtre et poussait les onglets, la vraie navigation, en
        troisième rideau. Ici : les onglets d'abord, les actions ensuite, et
        une ligne de chiffres qui, elle, change avec le graphe.
      */}
      <div className="space-y-3 border-b border-slate-200 pb-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <nav className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-300 bg-white p-1">
            {STUDIO_TABS.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  title={tab.hint}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
                    active ? 'bg-indigo-600 font-semibold text-white' : 'font-medium text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <span>{tab.icon}</span>
                  <span>{tab.label}</span>
                  {tab.id === 'teams' && teams.length > 0 && (
                    <span className={`text-[10px] ${active ? 'text-indigo-100' : 'text-slate-400'}`}>
                      {teams.length}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setIsAiModalOpen(true)}
              className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs transition-all hover:from-purple-700 hover:to-indigo-700"
            >
              <span>✨</span>
              <span>Générer par IA</span>
            </button>
            <button
              onClick={handleExportZip}
              title="Exporter le super-graphe et les équipes en archive .zip"
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              📦 Exporter
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              title="Importer une configuration complète depuis un fichier .zip"
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              📥 Importer
            </button>
            <button
              onClick={handleSaveAll}
              className="rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-slate-800"
            >
              Enregistrer
            </button>
          </div>
        </div>

        <p className="font-mono text-[11px] text-slate-500">
          {agents.length} agents · {channels.length} canaux · {teams.length} équipes · C-Level → VP → Head of → Lead →
          Expert
        </p>
      </div>

      {/* AI GRAPH & TEAM GENERATOR MODAL WITH LIVE OPENROUTER COMBOBOX */}
      {isAiModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-3xl rounded-2xl border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-purple-50 to-indigo-50">
              <div className="flex items-center gap-2.5">
                <span className="text-2xl">✨</span>
                <div>
                  <h2 className="text-base font-bold text-slate-900">Générateur de Super-Graphe & Équipes d'Agents</h2>
                  <p className="text-xs text-slate-500">Conception automatique basée sur les derniers modèles OpenRouter.</p>
                </div>
              </div>
              <button
                onClick={() => setIsAiModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4 overflow-y-auto flex-1 text-xs">
              
              {/* Generation Mode Selector */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setGeneratorMode('full_supergraph')}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    generatorMode === 'full_supergraph'
                      ? 'bg-purple-50 border-purple-600 ring-1 ring-purple-600'
                      : 'bg-white border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="font-bold text-slate-900 text-xs">🏢 Super-Graphe d'Entreprise Entier</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Génère 5 niveaux complets (C-Level, VP, Head, Lead, Experts) et plusieurs équipes.</div>
                </button>

                <button
                  type="button"
                  onClick={() => setGeneratorMode('add_team')}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    generatorMode === 'add_team'
                      ? 'bg-indigo-50 border-indigo-600 ring-1 ring-indigo-600'
                      : 'bg-white border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="font-bold text-slate-900 text-xs">➕ Nouvelle Équipe Spécialisée</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Ajoute une équipe autonome à connecter au graphe existant.</div>
                </button>
              </div>

              {/* Inspiration Pills */}
              <div className="space-y-1.5">
                <span className="text-slate-500 font-semibold block">Idées de prompts prêts à l'emploi :</span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    "SaaS B2B d'Extraction Comptable, Factures & Rapprochement Bancaire",
                    "Usine de Scraping Immobilier, Calcul de Rentabilité & Alertes Instantanées",
                    "Graphe E-Commerce & Dropshipping avec Veille TikTok Shop & Fournisseurs",
                    "Équipe Cold Email B2B avec Scraper LinkedIn & Rédacteur d'Icebreakers"
                  ].map(template => (
                    <button
                      key={template}
                      type="button"
                      onClick={() => setAiPrompt(template)}
                      className="px-2.5 py-1 rounded-full bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-700 text-[11px] border border-slate-200 transition-colors"
                    >
                      {template}
                    </button>
                  ))}
                </div>
              </div>

              {/* Prompt Textarea */}
              <div className="space-y-1.5">
                <label className="font-semibold text-slate-800 block">Description de la mission / du produit :</label>
                <textarea
                  rows={3}
                  value={aiPrompt}
                  onChange={e => setAiPrompt(e.target.value)}
                  placeholder="Ex: Conçois une usine d'agents pour un SaaS d'automatisation de déclarations TVA avec un VP Finance, un Head of OCR, un Lead D1 et des workers de calcul..."
                  className="w-full p-3 rounded-xl border border-slate-300 bg-slate-50 focus:bg-white text-slate-900 font-mono text-xs focus:outline-none focus:border-indigo-600 shadow-inner"
                />
              </div>

              {/* Model Combobox (OpenRouter Live Models) */}
              <div className="space-y-1.5 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                <div className="flex items-center justify-between">
                  <span className="text-slate-800 font-semibold">Modèle Architecte (OpenRouter Catalogue en Direct) :</span>
                  <span className="text-[10px] font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-semibold">
                    {modelsList.length} modèles synchronisés
                  </span>
                </div>
                <ModelCombobox
                  value={aiModel}
                  onChange={newModelId => setAiModel(newModelId)}
                  models={modelsList}
                  isLoading={isLoadingModels}
                />
              </div>

              {/* GENERATED PREVIEW */}
              {generatedGraphPreview && (
                <div className="p-4 rounded-xl bg-purple-50/70 border border-purple-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-purple-900 text-xs">{generatedGraphPreview.summary}</span>
                    <span className="px-2 py-0.5 rounded bg-purple-200 text-purple-800 font-mono text-[10px] font-semibold">
                      {generatedGraphPreview.agents.length} Agents • {generatedGraphPreview.channels.length} Canaux
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {generatedGraphPreview.agents.map(ag => {
                      const badge = getHierarchyBadge(ag.hierarchyLevel || 'lead');
                      return (
                        <div key={ag.id} className="p-2.5 bg-white rounded-lg border border-purple-200 text-[11px] space-y-1">
                          <div className="flex items-center justify-between">
                            <span className={`text-[9px] font-semibold px-1.5 py-0.2 rounded border ${badge.color}`}>
                              {badge.label}
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono">{ag.teamName || 'Équipe'}</span>
                          </div>
                          <div className="font-bold text-slate-900 truncate">{ag.role}</div>
                          <div className="text-[10px] text-purple-700 font-mono">{ag.modelId.split('/')[1] || ag.modelId}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-200 flex items-center justify-between bg-slate-50">
              <button
                type="button"
                onClick={() => setIsAiModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 font-medium transition-colors"
              >
                Annuler
              </button>

              <div className="flex items-center gap-2">
                {generatedGraphPreview ? (
                  <button
                    type="button"
                    onClick={handleApplyGeneratedGraph}
                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg shadow-sm transition-colors"
                  >
                    ✓ {generatorMode === 'full_supergraph' ? 'Remplacer le Graphe Actuel' : 'Ajouter cette Équipe au Graphe'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleGenerateAiGraph}
                    disabled={isGeneratingGraph || !aiPrompt.trim()}
                    className="px-5 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    <span>{isGeneratingGraph ? '🧠 Conception de l\'Architecture...' : '✨ Générer l\'Architecture d\'Équipes'}</span>
                  </button>
                )}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* VIEW 0: INTERACTIVE VISUAL NODE NETWORK GRAPH (DAG) */}
      {activeTab === 'graph' && (
        <div className="space-y-4">
          {/*
            Une barre de contrôle occupait ce bandeau : elle répétait le nombre
            d'agents et de canaux — déjà dans l'en-tête — et portait un bouton
            « Lancer Simulation des Flux » qui allumait des traits pendant
            quelques secondes sans qu'aucun agent ne travaille. Le canevas
            explique déjà, en pied, comment le manipuler.
          */}
          <EnterpriseNetworkGraph
            agents={agents}
            channels={channels}
            teams={teams}
            selectedAgentId={selectedAgentId}
            onSelectAgent={id => setSelectedAgentId(id)}
          />

          {/* Quick Inspector Footer for Selected Node */}
          {currentAgent && (
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center text-lg font-bold shadow-md">
                  {currentAgent.category === 'orchestration' ? '👑' :
                   currentAgent.category === 'research' ? '🔬' :
                   currentAgent.category === 'engineering' ? '📐' :
                   currentAgent.category === 'growth' ? '📢' : '🛡️'}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-slate-900 text-sm">{currentAgent.role}</h3>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${getHierarchyBadge(currentAgent.hierarchyLevel).color}`}>
                      {getHierarchyBadge(currentAgent.hierarchyLevel).label}
                    </span>
                    <span className="text-[10px] font-mono text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded font-semibold">
                      {currentAgent.modelId}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 max-w-xl truncate">{currentAgent.description}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setActiveTab('editor');
                    setActiveEditorSubTab('ame');
                  }}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-semibold transition-colors"
                >
                  Modifier Ame.md & Job.md ➔
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* VIEW 1: 5-LEVEL ENTERPRISE HIERARCHY (C-LEVEL -> VP -> HEAD -> LEAD -> EXPERT) */}
      {activeTab === 'hierarchy' && (
        <div className="space-y-6">
          
          {/* Top Bar for Flow simulation & Team Filter */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-bold text-slate-900">Filtrer par Équipe :</span>
              <button
                onClick={() => setSelectedTeamFilter('all')}
                className={`px-2.5 py-1 rounded-lg border font-medium transition-colors ${
                  selectedTeamFilter === 'all' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                Toutes ({agents.length})
              </button>
              {teams.map(t => (
                <button
                  key={t.id}
                  onClick={() => setSelectedTeamFilter(t.id)}
                  className={`px-2.5 py-1 rounded-lg border font-medium transition-colors flex items-center gap-1 ${
                    selectedTeamFilter === t.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <span>{t.icon}</span>
                  <span>{t.name}</span>
                </button>
              ))}
            </div>

          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Visual Organigram Canvas (Left 2 Cols) */}
            <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <span className="font-bold text-slate-900 text-sm">Organigramme d'Entreprise (5 Niveaux Hiérarchiques)</span>
                <span className="text-xs text-indigo-600 font-mono font-medium">Cloudflare Agents Protocol</span>
              </div>

              <div className="space-y-4">
                
                {/* 1. C-LEVEL */}
                {filteredAgents.filter(a => a.hierarchyLevel === 'c_level').length > 0 && (
                  <div className="p-4 rounded-xl bg-purple-50/70 border border-purple-200 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-purple-900 uppercase font-mono tracking-wider flex items-center gap-1.5">
                        <span>👑</span>
                        <span>Niveau 1 : C-Level & Vision Stratégique</span>
                      </span>
                      {/* Ici figurait une liste de modèles écrite en dur, sans rapport
                          avec ceux réellement attribués — chaque carte porte le sien. */}
                      <span className="text-[10px] text-purple-700 bg-purple-100 px-2 py-0.5 rounded font-mono font-semibold">
                        {filteredAgents.filter(a => a.hierarchyLevel === 'c_level').length} agents
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {filteredAgents.filter(a => a.hierarchyLevel === 'c_level').map(a => (
                        <div
                          key={a.id}
                          onClick={() => setSelectedAgentId(a.id)}
                          className={`p-3 bg-white rounded-lg border text-left cursor-pointer transition-all ${
                            selectedAgentId === a.id ? 'border-purple-600 ring-2 ring-purple-600/30' : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-slate-900 text-xs truncate">{a.role}</span>
                            <span className="text-[9px] text-purple-700 bg-purple-50 px-1.5 rounded">{a.teamName || 'Stratégie'}</span>
                          </div>
                          <div className="text-[10px] text-slate-500 font-mono mt-1 truncate">{a.modelId}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 2. VP LEVEL */}
                {filteredAgents.filter(a => a.hierarchyLevel === 'vp').length > 0 && (
                  <div className="p-4 rounded-xl bg-indigo-50/70 border border-indigo-200 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-indigo-900 uppercase font-mono tracking-wider flex items-center gap-1.5">
                        <span>💼</span>
                        <span>Niveau 2 : Vice-Presidents (VP Direction Métier)</span>
                      </span>
                      <span className="text-[10px] text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded font-mono font-semibold">
                        {filteredAgents.filter(a => a.hierarchyLevel === 'vp').length} agents
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {filteredAgents.filter(a => a.hierarchyLevel === 'vp').map(a => (
                        <div
                          key={a.id}
                          onClick={() => setSelectedAgentId(a.id)}
                          className={`p-3 bg-white rounded-lg border text-left cursor-pointer transition-all ${
                            selectedAgentId === a.id ? 'border-indigo-600 ring-2 ring-indigo-600/30' : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-slate-900 text-xs truncate">{a.role}</span>
                            <span className="text-[9px] text-indigo-700 bg-indigo-50 px-1.5 rounded">{a.teamName || 'Direction'}</span>
                          </div>
                          <div className="text-[10px] text-slate-500 font-mono mt-1 truncate">{a.modelId}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 3. HEAD OF LEVEL */}
                {filteredAgents.filter(a => a.hierarchyLevel === 'head_of').length > 0 && (
                  <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-200 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-blue-900 uppercase font-mono tracking-wider flex items-center gap-1.5">
                        <span>🎖️</span>
                        <span>Niveau 3 : Heads of (Responsables Départementaux)</span>
                      </span>
                      <span className="text-[10px] text-blue-700 bg-blue-100 px-2 py-0.5 rounded font-mono font-semibold">
                        Découpage Tactique
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {filteredAgents.filter(a => a.hierarchyLevel === 'head_of').map(a => (
                        <div
                          key={a.id}
                          onClick={() => setSelectedAgentId(a.id)}
                          className={`p-3 bg-white rounded-lg border text-left cursor-pointer transition-all ${
                            selectedAgentId === a.id ? 'border-blue-600 ring-2 ring-blue-600/30' : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-slate-900 text-xs truncate">{a.role}</span>
                            <span className="text-[9px] text-blue-700 bg-blue-50 px-1.5 rounded">{a.teamName}</span>
                          </div>
                          <div className="text-[10px] text-slate-500 font-mono mt-1 truncate">{a.modelId}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 4. LEAD LEVEL */}
                {filteredAgents.filter(a => a.hierarchyLevel === 'lead').length > 0 && (
                  <div className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-emerald-900 uppercase font-mono tracking-wider flex items-center gap-1.5">
                        <span>📐</span>
                        <span>Niveau 4 : Leads Techniques & Spécialistes</span>
                      </span>
                      <span className="text-[10px] text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded font-mono font-semibold">
                        Specs Micro-Tâches &lt; 50 lignes
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {filteredAgents.filter(a => a.hierarchyLevel === 'lead').map(a => (
                        <div
                          key={a.id}
                          onClick={() => setSelectedAgentId(a.id)}
                          className={`p-3 bg-white rounded-lg border text-left cursor-pointer transition-all ${
                            selectedAgentId === a.id ? 'border-emerald-600 ring-2 ring-emerald-600/30' : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-slate-900 text-xs truncate">{a.role}</span>
                            <span className="text-[9px] text-emerald-700 bg-emerald-50 px-1.5 rounded">{a.teamName}</span>
                          </div>
                          <div className="text-[10px] text-slate-500 font-mono mt-1 truncate">{a.modelId}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 5. EXPERT / WORKER LEVEL */}
                {filteredAgents.filter(a => a.hierarchyLevel === 'expert').length > 0 && (
                  <div className="p-4 rounded-xl bg-teal-50/70 border border-teal-200 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-teal-900 uppercase font-mono tracking-wider flex items-center gap-1.5">
                        <span>⚡</span>
                        <span>Niveau 5 : Experts & Workers d'Exécution Atomique</span>
                      </span>
                      <span className="text-[10px] text-teal-700 bg-teal-100 px-2 py-0.5 rounded font-mono font-semibold">
                        DeepSeek V3 / Qwen Coder / Gemini Flash (~$0.15/M)
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      {filteredAgents.filter(a => a.hierarchyLevel === 'expert').map(a => (
                        <div
                          key={a.id}
                          onClick={() => setSelectedAgentId(a.id)}
                          className={`p-3 bg-white rounded-lg border text-left cursor-pointer transition-all ${
                            selectedAgentId === a.id ? 'border-teal-600 ring-2 ring-teal-600/30' : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div className="font-bold text-slate-900 text-xs truncate">{a.role}</div>
                          <div className="text-[10px] text-slate-500 font-mono mt-0.5 truncate">{a.modelId}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            </div>

            {/* Channels & Hierarchy Inspector (Right 1 Col) */}
            <div className="space-y-4">
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-900 text-sm">Canaux Inter-Niveaux ({channels.length})</h3>
                  <span className="text-[10px] font-mono text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded font-semibold">
                    RPC & Queues
                  </span>
                </div>
                <p className="text-xs text-slate-500">Cliquez sur un canal pour inspecter son protocole.</p>

                <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                  {channels.map((ch) => {
                    return (
                      <div
                        key={ch.id}
                        onClick={() => setSelectedChannelId(ch.id)}
                        className={`p-3 rounded-lg border text-left cursor-pointer transition-all text-xs space-y-1.5 ${
                          selectedChannelId === ch.id
                            ? 'bg-slate-50 border-indigo-500'
                            : 'bg-white border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-900 text-[11px] truncate">
                            {ch.sourceName.split(' ')[0]} → {ch.targetName.split(' ')[0]}
                          </span>
                          <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-700 font-semibold">
                            {ch.protocol}
                          </span>
                        </div>

                        <div className="text-[11px] text-slate-600 line-clamp-1">{ch.triggerEvent}</div>

                        <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono pt-1 border-t border-slate-100">
                          <span>{ch.payloadType}</span>
                          <span className={ch.enabled ? 'text-emerald-600 font-semibold' : 'text-slate-400'}>
                            {ch.enabled ? '● Actif' : '○ Coupé'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Selected Channel Detailed Inspector Card */}
              {selectedChannel && (
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3 text-xs">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                    <span className="font-bold text-slate-900">Détails du Protocole</span>
                    <button
                      onClick={() => handleToggleChannel(selectedChannel.id)}
                      className={`text-[11px] px-2 py-0.5 rounded font-semibold transition-colors ${
                        selectedChannel.enabled
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {selectedChannel.enabled ? 'Canal Actif' : 'Canal Désactivé'}
                    </button>
                  </div>

                  <div className="space-y-1.5 text-slate-700">
                    <div>
                      <span className="text-slate-400 block text-[10px]">Émetteur → Récepteur</span>
                      <strong className="text-slate-900">{selectedChannel.sourceName}</strong> → <strong className="text-slate-900">{selectedChannel.targetName}</strong>
                    </div>

                    <div>
                      <span className="text-slate-400 block text-[10px]">Déclencheur d'Événement</span>
                      <p className="font-medium text-slate-800">{selectedChannel.triggerEvent}</p>
                    </div>

                    <div>
                      <span className="text-slate-400 block text-[10px]">Format de Données</span>
                      <code className="text-indigo-600 font-mono bg-slate-50 px-1.5 py-0.5 rounded text-[11px]">
                        {selectedChannel.payloadType}
                      </code>
                    </div>

                    <div>
                      <span className="text-slate-400 block text-[10px]">Description</span>
                      <p className="text-slate-600 text-[11px] leading-relaxed">{selectedChannel.description}</p>
                    </div>
                  </div>
                </div>
              )}

            </div>

          </div>
        </div>
      )}

      {/* VIEW 2: TEAMS HUB (COMPOSABLE TEAM MODULES) */}
      {activeTab === 'teams' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {teams.map(team => {
              const teamAgents = agents.filter(a => a.teamId === team.id);
              return (
                <div key={team.id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4 flex flex-col justify-between">
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{team.icon}</span>
                        <div>
                          <h3 className="font-bold text-slate-900 text-sm">{team.name}</h3>
                          <span className="text-[10px] text-slate-400 font-mono">{teamAgents.length} Agents assignés</span>
                        </div>
                      </div>
                    </div>

                    <p className="text-xs text-slate-500 leading-snug">{team.description}</p>

                    {/* Team Members List */}
                    <div className="space-y-1.5 pt-2 border-t border-slate-100">
                      {teamAgents.map(ag => {
                        const badge = getHierarchyBadge(ag.hierarchyLevel);
                        return (
                          <div
                            key={ag.id}
                            onClick={() => {
                              setSelectedAgentId(ag.id);
                              setActiveTab('editor');
                            }}
                            className="p-2 rounded-lg bg-slate-50 hover:bg-indigo-50 border border-slate-200/80 hover:border-indigo-300 cursor-pointer transition-colors flex items-center justify-between text-xs"
                          >
                            <div className="truncate pr-2">
                              <span className="font-bold text-slate-900 truncate block">{ag.role}</span>
                              <span className="text-[10px] text-slate-400 font-mono truncate">{ag.modelId}</span>
                            </div>
                            <span className={`text-[9px] font-semibold px-1.5 py-0.2 rounded border whitespace-nowrap ${badge.color}`}>
                              {badge.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setSelectedTeamFilter(team.id);
                      setActiveTab('hierarchy');
                    }}
                    className="w-full py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-semibold transition-colors"
                  >
                    Voir dans l'Organigramme ➔
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* VIEW 3: MARKDOWN PERSONA EDITOR (Ame.md & Job.md & Hierarchy Level) */}
      {activeTab === 'editor' && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-2 lg:col-span-1">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 font-mono px-2 block mb-1">
              Agents Disponibles ({agents.length})
            </span>

            <div className="space-y-1 max-h-[550px] overflow-y-auto pr-1">
              {agents.map(ag => {
                const badge = getHierarchyBadge(ag.hierarchyLevel);
                return (
                  <button
                    key={ag.id}
                    onClick={() => setSelectedAgentId(ag.id)}
                    className={`w-full p-2.5 rounded-lg border text-left transition-colors ${
                      selectedAgentId === ag.id
                        ? 'bg-indigo-50 border-indigo-600 ring-1 ring-indigo-600'
                        : 'bg-white border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 text-xs truncate pr-1">{ag.role}</span>
                      <span className={`text-[9px] font-semibold px-1 py-0.2 rounded border whitespace-nowrap ${badge.color}`}>
                        {badge.label}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400 font-mono mt-1 truncate">
                      {ag.modelId}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/*
            La fiche de l'agent.

            Le titre et ses deux badges partageaient une seule ligne avec le
            groupe d'onglets, chacun tirant sur la largeur : l'identifiant de
            modèle se coupait au milieu d'un mot, et les onglets, aux libellés
            longs, se repliaient sur trois lignes. Le `justify-between` de la
            carte creusait par-dessus un grand vide entre l'en-tête et le
            formulaire. Ici : l'identité d'abord, les onglets ensuite, chacun
            sur sa ligne.
          */}
          <div className="lg:col-span-3 bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <div className="space-y-3 border-b border-slate-200 pb-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-bold text-slate-900">{currentAgent.role}</h2>
                  <span
                    className={`shrink-0 whitespace-nowrap rounded border px-2 py-0.5 text-[11px] font-semibold ${
                      getHierarchyBadge(currentAgent.hierarchyLevel).color
                    }`}
                  >
                    {getHierarchyBadge(currentAgent.hierarchyLevel).label}
                  </span>
                  <span className="shrink-0 whitespace-nowrap rounded bg-indigo-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-indigo-600">
                    {currentAgent.modelId}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{currentAgent.description}</p>
              </div>

              <div className="inline-flex flex-wrap gap-0.5 rounded-lg border border-slate-300 bg-slate-50 p-0.5 text-xs">
                {[
                  { id: 'ame' as const, label: 'Âme.md', hint: 'Identité et principes' },
                  { id: 'job' as const, label: 'Job.md', hint: 'Missions et livrables' },
                  { id: 'params' as const, label: 'Rôle & modèle', hint: 'Niveau, équipe, modèle, réglages' }
                ].map((sub) => (
                  <button
                    key={sub.id}
                    onClick={() => setActiveEditorSubTab(sub.id)}
                    title={sub.hint}
                    className={`whitespace-nowrap rounded-md px-3 py-1 font-semibold transition-colors ${
                      activeEditorSubTab === sub.id
                        ? 'bg-white text-indigo-700 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {sub.label}
                  </button>
                ))}
              </div>
            </div>

            {activeEditorSubTab === 'ame' && (
              <div className="space-y-2 flex-1">
                <div className="flex items-center justify-between text-xs">
                  <label className="font-semibold text-slate-700">
                    Fichier : <code className="text-indigo-600 font-mono">/agents/{currentAgent.id}/Ame.md</code>
                  </label>
                  <span className="text-slate-400 text-[11px]">Markdown GFM supporté</span>
                </div>
                <textarea
                  rows={14}
                  value={currentAgent.ameMd}
                  onChange={e => handleUpdateCurrentAgent({ ameMd: e.target.value })}
                  className="w-full p-4 rounded-xl border border-slate-300 bg-slate-900 text-slate-100 font-mono text-xs leading-relaxed focus:outline-none focus:ring-1 focus:ring-indigo-600 shadow-inner"
                />
              </div>
            )}

            {activeEditorSubTab === 'job' && (
              <div className="space-y-2 flex-1">
                <div className="flex items-center justify-between text-xs">
                  <label className="font-semibold text-slate-700">
                    Fichier : <code className="text-indigo-600 font-mono">/agents/{currentAgent.id}/Job.md</code>
                  </label>
                  <span className="text-slate-400 text-[11px]">Markdown GFM supporté</span>
                </div>
                <textarea
                  rows={14}
                  value={currentAgent.jobMd}
                  onChange={e => handleUpdateCurrentAgent({ jobMd: e.target.value })}
                  className="w-full p-4 rounded-xl border border-slate-300 bg-slate-900 text-slate-100 font-mono text-xs leading-relaxed focus:outline-none focus:ring-1 focus:ring-indigo-600 shadow-inner"
                />
              </div>
            )}

            {activeEditorSubTab === 'params' && (
              <div className="space-y-5 p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                
                {/* 5-Level Hierarchy Selection */}
                <div className="space-y-2">
                  <label className="block font-semibold text-slate-700">Niveau de Profondeur Hiérarchique :</label>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    {[
                      { level: 'c_level' as HierarchyLevel, label: '👑 C-Level', desc: 'Arbitrage P&L' },
                      { level: 'vp' as HierarchyLevel, label: '💼 VP', desc: 'Direction Métier' },
                      { level: 'head_of' as HierarchyLevel, label: '🎖️ Head of', desc: 'Découpage' },
                      { level: 'lead' as HierarchyLevel, label: '📐 Lead', desc: 'Specs atomiques' },
                      { level: 'expert' as HierarchyLevel, label: '⚡ Expert', desc: 'Exécution Worker' }
                    ].map(h => (
                      <button
                        key={h.level}
                        type="button"
                        onClick={() => handleUpdateCurrentAgent({ hierarchyLevel: h.level })}
                        className={`p-2.5 rounded-lg border text-left font-medium transition-colors ${
                          currentAgent.hierarchyLevel === h.level
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <div className="font-bold text-xs">{h.label}</div>
                        <div className={`text-[10px] ${currentAgent.hierarchyLevel === h.level ? 'text-indigo-100' : 'text-slate-400'}`}>
                          {h.desc}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Team Selection */}
                <div className="space-y-2 pt-3 border-t border-slate-200">
                  <label className="block font-semibold text-slate-700">Équipe d'Appartenance :</label>
                  <select
                    value={currentAgent.teamId || teams[0].id}
                    onChange={e => {
                      const found = teams.find(t => t.id === e.target.value);
                      handleUpdateCurrentAgent({ teamId: e.target.value, teamName: found?.name || 'Équipe' });
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-900 font-medium text-xs focus:outline-none"
                  >
                    {teams.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.icon} {t.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Model Combobox (OpenRouter Live Models) */}
                <div className="space-y-2 pt-3 border-t border-slate-200">
                  <label className="block font-semibold text-slate-700">Modèle OpenRouter Assigné :</label>
                  <ModelCombobox
                    value={currentAgent.modelId}
                    onChange={newModelId => handleUpdateCurrentAgent({ modelId: newModelId })}
                    models={modelsList}
                    isLoading={isLoadingModels}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-slate-200">
                  <div>
                    <div className="flex justify-between font-semibold text-slate-700 mb-1">
                      <span>Température :</span>
                      <span className="text-indigo-600 font-mono">{currentAgent.temperature}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={currentAgent.temperature}
                      onChange={e => handleUpdateCurrentAgent({ temperature: parseFloat(e.target.value) })}
                      className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Max Output Tokens :</label>
                    <input
                      type="number"
                      value={currentAgent.maxTokens}
                      onChange={e => handleUpdateCurrentAgent({ maxTokens: parseInt(e.target.value || '2048') })}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-900 font-mono text-xs"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* VIEW 4: OPENROUTER CONFIGURATION */}
      {activeTab === 'openrouter_config' && (
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-slate-900 text-base">Clé API OpenRouter & Catalogue en Direct</h3>
                  <span className="text-xs font-mono text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded font-semibold">
                    {modelsList.length} modèles actifs
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">Votre clé permet d'utiliser n'importe quel LLM mondial (Gemini, Claude, Grok, DeepSeek, Qwen).</p>
              </div>

              <span className={`px-2.5 py-1 rounded text-xs font-semibold ${
                keyStatus === 'valid' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                keyStatus === 'invalid' ? 'bg-red-50 text-red-700 border border-red-200' :
                'bg-slate-100 text-slate-600'
              }`}>
                {keyStatus === 'valid' ? '✓ Clé API Connectée' : keyStatus === 'invalid' ? '✗ Clé Invalide' : 'Non Connecté'}
              </span>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="password"
                placeholder="sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                value={openRouterKey}
                onChange={e => {
                  setOpenRouterKey(e.target.value);
                  setKeyStatus('none');
                }}
                className="flex-1 px-3 py-2.5 rounded-lg border border-slate-300 bg-slate-50 text-slate-900 font-mono text-xs focus:bg-white focus:outline-none focus:border-indigo-600"
              />
              <button
                onClick={handleTestOpenRouterKey}
                disabled={isTestingKey}
                className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-medium text-xs rounded-lg transition-colors disabled:opacity-50"
              >
                {isTestingKey ? 'Test...' : 'Vérifier & Actualiser'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW: CULTURE — injectée en tête de chaque appel d'agent */}
      {activeTab === 'culture' && <CultureEditor />}

    </div>
  );
};
