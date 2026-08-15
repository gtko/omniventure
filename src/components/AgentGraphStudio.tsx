import React, { useState, useEffect, useRef } from 'react';
import { ModelCombobox, type OpenRouterModelItem } from './ModelCombobox';
import { VirtualOffice2D } from './VirtualOffice2D';
import { exportGraphToZip, importGraphFromZip, downloadBlobAsFile, type CommunicationChannel } from '../lib/zip-manager';

export interface AgentCustomData {
  id: string;
  role: string;
  tier: 1 | 2 | 3;
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

const INITIAL_AGENTS_DATA: AgentCustomData[] = [
  // TIER 1: ORCHESTRATION & STRATEGY
  {
    id: 'master',
    role: 'Orchestrateur Stratégique Suprême',
    tier: 1,
    category: 'orchestration',
    modelId: 'x-ai/grok-2',
    description: 'Analyse le speech, coordonne l\'ensemble des agents de recherche et d\'ingénierie en DAG de micro-tâches (< 50 lignes).',
    temperature: 0.7,
    maxTokens: 4096,
    ameMd: `# Ame.md — Orchestrateur Stratégique\n\n## Identité & Philosophie\nTu es le Cerveau Central du système OmniVenture.\nTon unique mission est la rentabilité maximale et la réduction drastique des coûts d'inférence.\n\n## Principes Fondamentaux :\n1. Zéro code direct : Tu découpes les projets en sous-tâches atomiques de moins de 50 lignes.\n2. Économie de tokens : Déléguer les recherches et calculs lourds aux agents de Tier 2 et 3.\n3. Orientation Business : Tunnel Trial $0.50 (48h) obligatoire.`,
    jobMd: `# Job.md — Cahier des Charges & Missions\n\n## 1. Inputs Reçus\n- Speech du projet, Niche & Dossier de marché\n\n## 2. Workflow\n1. Interrogation des agents de recherche (Scraper & Sentiment).\n2. Découpage en 5 composants majeurs.\n3. Distribution des sous-tâches à DeepSeek V3 / Qwen Coder.\n4. Déclenchement de l'audit QA.`
  },
  {
    id: 'market_agent',
    role: 'Orchestrateur Veille Concurrentielle & Niche',
    tier: 1,
    category: 'research',
    modelId: 'google/gemini-2.5-flash',
    description: 'Pilote les investigations de marché, délègue le scraping et l\'analyse de sentiment aux sous-agents de recherche.',
    temperature: 0.2,
    maxTokens: 2048,
    ameMd: `# Ame.md — Veille Concurrentielle & Niche\n\n## Identité & Philosophie\nTu es le Détective Stratégique d'OmniVenture.\nTon obsession est de dénicher les points faibles critiques des concurrents et les opportunités de marché inexploitées sans gaspiller de ressources.\n\n## Principes Directeurs :\n1. Économie Maximale : Utilise Gemini 2.5 Flash / DeepSeek V3 pour un coût infime ($0.15/M tokens).\n2. Délégation : Pilote les agents de recherche de Niveau 2 pour extraire les faits bruts.\n3. Angle d'Attaque : Toujours formuler un angle d'attaque à micro-prix ($0.50 trial 48h puis $29/mois).`,
    jobMd: `# Job.md — Analyse de Marché\n\n## 1. Entrées Reçues (Inputs)\n- URL / Domaine du concurrent OU Mots-clés de niche.\n\n## 2. Workflow Séquentiel\n1. Déclencher l'agent de scraping (Tier 2) pour inspecter les tarifs.\n2. Déclencher l'agent d'analyse de sentiment (Tier 2) pour identifier les frustrations.\n3. Structurer le plan d'attaque tarifaire et les spécifications du MVP challenger.`
  },
  {
    id: 'planner',
    role: 'Planificateur & Gestion de Crise',
    tier: 1,
    category: 'operations',
    modelId: 'qwen/qwen-2.5-72b-instruct',
    description: 'Validation de résilience Edge et arbitrage Hotfix vs Rollback en cas d\'incident critique.',
    temperature: 0.3,
    maxTokens: 2048,
    ameMd: `# Ame.md — Sentinelle & Gestion de Crise\n\nTu es le gardien de la résilience Edge. Si erreur isolée : Hotfix en < 30s. Si menace Stripe : Rollback 0ms.`,
    jobMd: `# Job.md — Protocole Incident\n\nSurveillance des alertes 5xx et déclenchement de la procédure d'urgence.`
  },

  // TIER 2: SPECIALIZED RESEARCHERS & ARCHITECTS
  {
    id: 'market_scraper_agent',
    role: 'Agent Scraper & Extraction Web (Recherche)',
    tier: 2,
    category: 'research',
    modelId: 'google/gemini-2.5-flash',
    description: 'Sous-agent de recherche activé par l\'orchestrateur d\'analyse pour crawler les pages de pricing et caractéristiques concurrentes.',
    temperature: 0.1,
    maxTokens: 2048,
    ameMd: `# Ame.md — Agent Scraper & Extraction Web\n\nTu es l'œil de l'usine sur le web public. Tu extrais les grilles tarifaires, limites de plans et fonctionnalités techniques avec une précision chirurgicale.`,
    jobMd: `# Job.md — Extraction de Faits\n\n1. Parcourir la landing page et la page /pricing.\n2. Normaliser les devises, périodes d'essai et forfaits payants.\n3. Renvoyer un payload structuré JSON à l'Orchestrateur d'analyse.`
  },
  {
    id: 'sentiment_agent',
    role: "Agent Analyseur d'Avis & Frustrations (Recherche)",
    tier: 2,
    category: 'research',
    modelId: 'deepseek/deepseek-chat',
    description: 'Sous-agent de recherche analysant les avis négatifs, plaintes Reddit et retours Trustpilot/G2 pour isoler les bugs et mécontentements.',
    temperature: 0.2,
    maxTokens: 2048,
    ameMd: `# Ame.md — Analyseur de Frustrations\n\nTu traques le ressentiment des utilisateurs envers les outils établis : bugs récurrents, tarifs prohibitifs, complexité inutile.`,
    jobMd: `# Job.md — Détection de Frustrations\n\n1. Catégoriser les 4 plus grandes plaintes utilisateurs.\n2. Révéler les 3 fonctionnalités réclamées mais refusées par le concurrent.\n3. Synthétiser en arguments de vente pour le challenger.`
  },
  {
    id: 'lead_dev',
    role: 'Lead Architecte & Sécurité',
    tier: 2,
    category: 'engineering',
    modelId: 'google/gemini-2.5-flash',
    description: 'Architecture globale Astro SSR, intégration Stripe Checkout & Webhooks, schéma D1.',
    temperature: 0.2,
    maxTokens: 4096,
    ameMd: `# Ame.md — Lead Architecte\n\nIngénieur en chef Astro 5 & Cloudflare Edge. 0 dépendance superflue.`,
    jobMd: `# Job.md — Architecture\n\nConception des endpoints critiques (/api/checkout-trial.ts) et schémas D1 SQL.`
  },
  {
    id: 'copywriter_agent',
    role: 'Agent Copywriting & Accroches Ads',
    tier: 2,
    category: 'growth',
    modelId: 'google/gemini-2.5-flash',
    description: 'Rédige les textes publicitaires Meta, Google, TikTok et les articles SEO ciblant les mots-clés du concurrent.',
    temperature: 0.5,
    maxTokens: 2048,
    ameMd: `# Ame.md — Copywriter Persuasif\n\nMaître du marketing direct et de la conversion. Tu écris des accroches impossibles à ignorer.`,
    jobMd: `# Job.md — Copywriting\n\nGénération d'annonces Google Search, scripts TikTok 9:16 et articles de blog SEO.`
  },

  // TIER 3: ATOMIC WORKERS, QA & EDGE OPERATIONS
  {
    id: 'worker_dev',
    role: 'Worker Développeur (Micro-Tasks)',
    tier: 3,
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
    role: 'Agent QA & Recette Automatique',
    tier: 3,
    category: 'operations',
    modelId: 'google/gemini-2.5-flash',
    description: 'Compilation TypeScript, audit Lighthouse et simulation de transition Stripe 48h.',
    temperature: 0.1,
    maxTokens: 2048,
    ameMd: `# Ame.md — Auditeur Qualité\n\nInspecteur impitoyable. 0 erreur tolérée.`,
    jobMd: `# Job.md — Recette\n\nExécution de astro check et validation Lighthouse 100/100.`
  },
  {
    id: 'devops_agent',
    role: 'DevOps & Canary Deployer',
    tier: 3,
    category: 'operations',
    modelId: 'qwen/qwen-2.5-72b-instruct',
    description: 'Gestion du trafic progressif (10% → 100%) sur Cloudflare Workers Versioning.',
    temperature: 0.1,
    maxTokens: 2048,
    ameMd: `# Ame.md — Opérateur Edge\n\nMaître du trafic mondial Cloudflare.`,
    jobMd: `# Job.md — Rollout\n\nRoutage progressif 10% -> 100% et alerte 5xx.`
  },
  {
    id: 'cro_agent',
    role: 'Agent CRO & A/B Testing',
    tier: 3,
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
    sourceName: 'Orchestrateur Veille & Marché',
    targetId: 'market_scraper_agent',
    targetName: 'Agent Scraper Web',
    protocol: 'RPC Synchrone',
    payloadType: 'URL cible & Sélecteurs',
    triggerEvent: 'Analyse Domaine Concurrent',
    description: 'Délégation du scraping des prix et fonctionnalités techniques sans charger le modèle maître.',
    enabled: true
  },
  {
    id: 'ch-market-sentiment',
    sourceId: 'market_agent',
    sourceName: 'Orchestrateur Veille & Marché',
    targetId: 'sentiment_agent',
    targetName: 'Agent Analyseur d\'Avis',
    protocol: 'RPC Synchrone',
    payloadType: 'Recherche Mots-clés & Frustrations',
    triggerEvent: 'Analyse Niche ou Concurrent',
    description: 'Extraction des plaintes utilisateurs et points de friction pour bâtir le positionnement.',
    enabled: true
  },
  {
    id: 'ch-market-master',
    sourceId: 'market_agent',
    sourceName: 'Orchestrateur Veille & Marché',
    targetId: 'master',
    targetName: 'Orchestrateur Stratégique Suprême',
    protocol: 'RPC Synchrone',
    payloadType: 'Dossier Benchmark Validé (JSON)',
    triggerEvent: 'Création du Micro-SaaS Challenger',
    description: 'Transmission de l\'angle d\'attaque tarifaire et du blueprint produit au cerveau de production.',
    enabled: true
  },
  {
    id: 'ch-master-lead',
    sourceId: 'master',
    sourceName: 'Orchestrateur Stratégique Suprême',
    targetId: 'lead_dev',
    targetName: 'Lead Architecte',
    protocol: 'RPC Synchrone',
    payloadType: 'DAG Schema (JSON)',
    triggerEvent: 'Nouveau Projet / Analyse Speech',
    description: 'Transmission du plan d\'architecture globale, routes requises et contrats d\'interfaces.',
    enabled: true
  },
  {
    id: 'ch-master-copy',
    sourceId: 'master',
    sourceName: 'Orchestrateur Stratégique Suprême',
    targetId: 'copywriter_agent',
    targetName: 'Agent Copywriting & Ads',
    protocol: 'Queue Asynchrone',
    payloadType: 'Brief Produit & Angles Marketing',
    triggerEvent: 'Génération de Campagnes',
    description: 'Déclenchement asynchrone des publicités et pages de vente.',
    enabled: true
  },
  {
    id: 'ch-lead-worker',
    sourceId: 'lead_dev',
    sourceName: 'Lead Architecte',
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
    targetName: 'Agent QA & Recette',
    protocol: 'RPC Synchrone',
    payloadType: 'Code Source & Tests',
    triggerEvent: 'Fin de Génération de Code',
    description: 'Soumission des fichiers générés pour vérification TypeScript stricte et audit de sécurité.',
    enabled: true
  },
  {
    id: 'ch-qa-devops',
    sourceId: 'qa_agent',
    sourceName: 'Agent QA & Recette',
    targetId: 'devops_agent',
    targetName: 'DevOps Canary Deployer',
    protocol: 'RPC Synchrone',
    payloadType: 'Build Artifacts Validés',
    triggerEvent: 'Validation QA 100%',
    description: 'Ordre de déploiement Canary immédiat sur 10% du réseau mondial Cloudflare.',
    enabled: true
  },
  {
    id: 'ch-devops-crisis',
    sourceId: 'devops_agent',
    sourceName: 'DevOps Canary Deployer',
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
    sourceName: 'Agent CRO & A/B Test',
    targetId: 'master',
    targetName: 'Orchestrateur Stratégique Suprême',
    protocol: 'Queue Asynchrone',
    payloadType: 'Statistiques Multi-Armed Bandit',
    triggerEvent: 'Cycle d\'Optimisation 24h',
    description: 'Rétroaction des prix gagnants (Trial 0.50$ vs 1.00$) pour ajuster les futurs projets.',
    enabled: true
  }
];

export const AgentGraphStudio: React.FC = () => {
  const [openRouterKey, setOpenRouterKey] = useState<string>('');
  const [agents, setAgents] = useState<AgentCustomData[]>(INITIAL_AGENTS_DATA);
  const [channels, setChannels] = useState<CommunicationChannel[]>(INITIAL_CHANNELS);
  const [modelsList, setModelsList] = useState<OpenRouterModelItem[]>(FALLBACK_MODELS);
  const [isLoadingModels, setIsLoadingModels] = useState<boolean>(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('market_agent');
  const [selectedChannelId, setSelectedChannelId] = useState<string>('ch-market-scraper');
  const [activeTab, setActiveTab] = useState<'flow' | 'virtual_office' | 'editor' | 'openrouter_config'>('flow');
  const [activeEditorSubTab, setActiveEditorSubTab] = useState<'ame' | 'job' | 'params'>('ame');
  const [keyStatus, setKeyStatus] = useState<'none' | 'valid' | 'invalid'>('none');
  const [isTestingKey, setIsTestingKey] = useState<boolean>(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [simulationActive, setSimulationActive] = useState<boolean>(false);
  const [activeSimulationStep, setActiveSimulationStep] = useState<number>(-1);

  // AI Graph Generator Modal State
  const [isAiModalOpen, setIsAiModalOpen] = useState<boolean>(false);
  const [aiPrompt, setAiPrompt] = useState<string>('');
  const [aiModel, setAiModel] = useState<string>('google/gemini-2.5-flash');
  const [isGeneratingGraph, setIsGeneratingGraph] = useState<boolean>(false);
  const [generatedGraphPreview, setGeneratedGraphPreview] = useState<{ summary: string; agents: AgentCustomData[]; channels: CommunicationChannel[] } | null>(null);

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
            localStorage.setItem('omniventure_openrouter_models_cache', JSON.stringify(mapped));
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
      const savedKey = localStorage.getItem('omniventure_openrouter_key');
      if (savedKey) {
        setOpenRouterKey(savedKey);
        setKeyStatus('valid');
      }

      const savedAgents = localStorage.getItem('omniventure_custom_agents_v4');
      if (savedAgents) {
        setAgents(JSON.parse(savedAgents));
      } else {
        localStorage.setItem('omniventure_custom_agents_v4', JSON.stringify(INITIAL_AGENTS_DATA));
      }

      const savedChannels = localStorage.getItem('omniventure_channels_v3');
      if (savedChannels) {
        setChannels(JSON.parse(savedChannels));
      } else {
        localStorage.setItem('omniventure_channels_v3', JSON.stringify(INITIAL_CHANNELS));
      }

      const cachedModels = localStorage.getItem('omniventure_openrouter_models_cache');
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
    localStorage.setItem('omniventure_custom_agents_v4', JSON.stringify(updated));
  };

  const handleToggleChannel = (channelId: string) => {
    const updated = channels.map(c => c.id === channelId ? { ...c, enabled: !c.enabled } : c);
    setChannels(updated);
    localStorage.setItem('omniventure_channels_v3', JSON.stringify(updated));
    setNotification('Canal de communication mis à jour.');
    setTimeout(() => setNotification(null), 2500);
  };

  const handleSaveAll = () => {
    try {
      localStorage.setItem('omniventure_openrouter_key', openRouterKey);
      localStorage.setItem('omniventure_custom_agents_v4', JSON.stringify(agents));
      localStorage.setItem('omniventure_channels_v3', JSON.stringify(channels));
      setNotification('Graphe multi-niveaux, Ame.md, Job.md et canaux enregistrés avec succès !');
      setTimeout(() => setNotification(null), 3500);
    } catch (e) {
      console.error(e);
    }
  };

  // ZIP EXPORT
  const handleExportZip = async () => {
    try {
      setNotification('Génération de l\'archive .zip du graphe...');
      const blob = await exportGraphToZip(agents, channels);
      const filename = `omniventure-graph-${new Date().toISOString().split('T')[0]}.zip`;
      downloadBlobAsFile(blob, filename);
      setNotification(`Archive ${filename} téléchargée avec succès (${agents.length} agents) !`);
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
      setAgents(imported.agents);
      if (imported.channels && imported.channels.length > 0) {
        setChannels(imported.channels);
      }
      setSelectedAgentId(imported.agents[0].id);

      localStorage.setItem('omniventure_custom_agents_v4', JSON.stringify(imported.agents));
      if (imported.channels && imported.channels.length > 0) {
        localStorage.setItem('omniventure_channels_v3', JSON.stringify(imported.channels));
      }

      setNotification(`✓ Succès ! ${imported.agents.length} agents et ${imported.channels?.length || 0} canaux importés depuis le .zip.`);
      setTimeout(() => setNotification(null), 4000);
    } catch (err: any) {
      setNotification(`Erreur lors de l'import : ${err.message || err}`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // AI GRAPH GENERATION
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
          model: aiModel
        })
      });

      if (res.ok) {
        const json = await res.json() as any;
        if (json && json.data) {
          setGeneratedGraphPreview(json.data);
          setNotification('Nouveau graphe généré ! Vérifiez l\'aperçu ci-dessous.');
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
    setAgents(generatedGraphPreview.agents);
    setChannels(generatedGraphPreview.channels);
    setSelectedAgentId(generatedGraphPreview.agents[0].id);

    localStorage.setItem('omniventure_custom_agents_v4', JSON.stringify(generatedGraphPreview.agents));
    localStorage.setItem('omniventure_channels_v3', JSON.stringify(generatedGraphPreview.channels));

    setIsAiModalOpen(false);
    setGeneratedGraphPreview(null);
    setAiPrompt('');
    setNotification('Nouveau graphe d\'agents appliqué avec succès !');
    setTimeout(() => setNotification(null), 3500);
  };

  const handleSimulateFlow = () => {
    setSimulationActive(true);
    setActiveSimulationStep(0);

    const interval = setInterval(() => {
      setActiveSimulationStep(prev => {
        if (prev >= channels.length - 1) {
          clearInterval(interval);
          setTimeout(() => {
            setSimulationActive(false);
            setActiveSimulationStep(-1);
          }, 1500);
          return prev;
        }
        return prev + 1;
      });
    }, 800);
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
        localStorage.setItem('omniventure_openrouter_key', openRouterKey);
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

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Graphe & Topologie d'Agents Multi-Niveaux</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Orchestration modulaire : exportez, importez en .zip ou demandez à l'IA de concevoir un graphe complet sur-mesure.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* AI Graph Generator Button */}
          <button
            onClick={() => setIsAiModalOpen(true)}
            className="px-3 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-all flex items-center gap-1.5"
          >
            <span>✨</span>
            <span>Générer par IA (Prompt)</span>
          </button>

          {/* Export Zip Button */}
          <button
            onClick={handleExportZip}
            className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg shadow-xs transition-colors flex items-center gap-1.5"
            title="Exporter tous les agents, Ame.md, Job.md et canaux dans une archive .zip"
          >
            <span>📦</span>
            <span>Exporter .zip</span>
          </button>

          {/* Import Zip Button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg shadow-xs transition-colors flex items-center gap-1.5"
            title="Importer une configuration complète depuis un fichier .zip"
          >
            <span>📥</span>
            <span>Importer .zip</span>
          </button>

          <div className="inline-flex rounded-lg border border-slate-300 p-0.5 bg-white text-xs">
            <button
              onClick={() => setActiveTab('flow')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                activeTab === 'flow' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              📊 Organigramme & Flux
            </button>
            <button
              onClick={() => setActiveTab('virtual_office')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                activeTab === 'virtual_office' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              🏢 Bureau Virtuel 2D
            </button>
            <button
              onClick={() => setActiveTab('editor')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                activeTab === 'editor' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              📝 Éditeur Ame.md & Job.md
            </button>
            <button
              onClick={() => setActiveTab('openrouter_config')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                activeTab === 'openrouter_config' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              ⚙️ Clés & Modèles
            </button>
          </div>

          <button
            onClick={handleSaveAll}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors"
          >
            Enregistrer
          </button>
        </div>
      </div>

      {/* AI GRAPH GENERATOR MODAL */}
      {isAiModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-2xl rounded-2xl border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-purple-50 to-indigo-50">
              <div className="flex items-center gap-2.5">
                <span className="text-xl">✨</span>
                <div>
                  <h2 className="text-base font-bold text-slate-900">Générateur de Graphe d'Agents par IA</h2>
                  <p className="text-xs text-slate-500">Décrivez votre besoin métier : l'IA va architecturer l'ensemble des agents, Ame.md, Job.md et canaux.</p>
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
              
              {/* Inspiration Pills */}
              <div className="space-y-1.5">
                <span className="text-slate-500 font-semibold block">Idées de prompts rapides :</span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    "SaaS B2B d'Extraction Comptable & Rapprochement Bancaire",
                    "Usine de Scraping Immobilier avec calcul de Rentabilité & Alertes",
                    "Graphe E-Commerce & Dropshipping avec recherche de Produits Gagnants",
                    "Système d'Audit SEO & Rédacteur de Contenus Programmatiques"
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
                <label className="font-semibold text-slate-800 block">Description détaillée du Graphe souhaité :</label>
                <textarea
                  rows={4}
                  value={aiPrompt}
                  onChange={e => setAiPrompt(e.target.value)}
                  placeholder="Ex: Crée un graphe spécialisé dans l'analyse de cold emails avec un agent scraper de LinkedIn, un rédacteur d'icebreakers personnalisés et un agent de relance automatique..."
                  className="w-full p-3 rounded-xl border border-slate-300 bg-slate-50 focus:bg-white text-slate-900 font-mono text-xs focus:outline-none focus:border-indigo-600 shadow-inner"
                />
              </div>

              {/* Model Choice for Generation */}
              <div className="flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-200">
                <span className="text-slate-700 font-semibold">Modèle IA Architecte :</span>
                <select
                  value={aiModel}
                  onChange={e => setAiModel(e.target.value)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-900 font-mono text-xs focus:outline-none"
                >
                  <option value="google/gemini-2.5-flash">Gemini 2.5 Flash (Ultra-Rapide)</option>
                  <option value="x-ai/grok-2">Grok 2 (Raisonnement Élargi)</option>
                  <option value="deepseek/deepseek-chat">DeepSeek V3 (Économique)</option>
                  <option value="anthropic/claude-3.7-sonnet">Claude 3.7 Sonnet (Expertise Max)</option>
                </select>
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
                    {generatedGraphPreview.agents.map(ag => (
                      <div key={ag.id} className="p-2 bg-white rounded-lg border border-purple-200 text-[11px] space-y-0.5">
                        <div className="font-bold text-slate-900 truncate">{ag.role}</div>
                        <div className="text-[10px] text-purple-700 font-mono">Niveau {ag.tier} • {ag.modelId.split('/')[1] || ag.modelId}</div>
                      </div>
                    ))}
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
                    ✓ Appliquer ce Graphe au Système
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleGenerateAiGraph}
                    disabled={isGeneratingGraph || !aiPrompt.trim()}
                    className="px-5 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    <span>{isGeneratingGraph ? '🧠 Conception du Graphe...' : '✨ Générer l\'Architecture'}</span>
                  </button>
                )}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* VIEW 1: VISUAL MULTI-TIER ORGANIGRAM & COMMUNICATION FLOWS */}
      {activeTab === 'flow' && (
        <div className="space-y-6">
          
          {/* Top Bar for Flow simulation */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-xs text-slate-600">
              <span className="font-bold text-slate-900">Graphe Actif : </span>
              <span>{agents.length} Agents Spécialisés • {channels.length} Canaux Inter-Niveaux (RPC & Queues)</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleSimulateFlow}
                disabled={simulationActive}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-lg shadow-sm transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                <span>{simulationActive ? '⚡ Simulation en cours...' : '▶ Simuler les Échanges en Direct'}</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Visual Organigram Canvas (Left 2 Cols) */}
            <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <span className="font-bold text-slate-900 text-sm">Organigramme Multi-Niveaux & Canaux Croisés</span>
                <span className="text-xs text-indigo-600 font-mono font-medium">Cloudflare Agents Protocol</span>
              </div>

              <div className="space-y-6">
                
                {/* TIER 1: Orchestration & Stratégie */}
                <div className="p-4 rounded-xl bg-purple-50/50 border border-purple-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-purple-900 uppercase font-mono tracking-wider">
                      Niveau 1 : Cerveaux Stratégiques & Décisionnels
                    </span>
                    <span className="text-[10px] text-purple-700 bg-purple-100 px-2 py-0.5 rounded font-mono">
                      Grok 2 / Gemini 2.5 Flash / Qwen 72B
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {agents.filter(a => a.tier === 1).map(a => (
                      <div
                        key={a.id}
                        onClick={() => setSelectedAgentId(a.id)}
                        className={`p-3 bg-white rounded-lg border text-left cursor-pointer transition-all ${
                          selectedAgentId === a.id ? 'border-purple-600 ring-2 ring-purple-600/30' : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="font-bold text-slate-900 text-xs truncate">{a.role}</div>
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5 truncate">{a.modelId}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Connection Flow Indicator 1 */}
                <div className="text-center font-mono text-[11px] text-slate-400 flex items-center justify-center gap-2">
                  <span className="h-4 w-px bg-slate-300"></span>
                  <span className={`px-2.5 py-0.5 rounded-full border ${
                    activeSimulationStep <= 2 ? 'bg-indigo-600 text-white font-bold animate-pulse' : 'bg-slate-100 text-slate-600 border-slate-200'
                  }`}>
                    ↕ Délégation de Recherche (Scraping & Sentiment) & Architecture
                  </span>
                  <span className="h-4 w-px bg-slate-300"></span>
                </div>

                {/* TIER 2: Recherche Spécialisée, Scrapers & Architectes */}
                <div className="p-4 rounded-xl bg-indigo-50/50 border border-indigo-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-indigo-900 uppercase font-mono tracking-wider">
                      Niveau 2 : Agents de Recherche, Scrapers & Spécialistes Métier
                    </span>
                    <span className="text-[10px] text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded font-mono">
                      Recherche à Coût Infime ($0.15/1M)
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {agents.filter(a => a.tier === 2).map(a => (
                      <div
                        key={a.id}
                        onClick={() => setSelectedAgentId(a.id)}
                        className={`p-3 bg-white rounded-lg border text-left cursor-pointer transition-all ${
                          selectedAgentId === a.id ? 'border-indigo-600 ring-2 ring-indigo-600/30' : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="font-bold text-slate-900 text-xs truncate">{a.role}</div>
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5 truncate">{a.modelId}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Connection Flow Indicator 2 */}
                <div className="text-center font-mono text-[11px] text-slate-400 flex items-center justify-center gap-2">
                  <span className="h-4 w-px bg-slate-300"></span>
                  <span className={`px-2.5 py-0.5 rounded-full border ${
                    activeSimulationStep >= 3 && activeSimulationStep <= 6 ? 'bg-indigo-600 text-white font-bold animate-pulse' : 'bg-slate-100 text-slate-600 border-slate-200'
                  }`}>
                    ↓ Distribution Atomique (&lt; 50 lignes) → Audit QA & Canary
                  </span>
                  <span className="h-4 w-px bg-slate-300"></span>
                </div>

                {/* TIER 3: Exécution Atomique, QA & Edge Operations */}
                <div className="p-4 rounded-xl bg-emerald-50/50 border border-emerald-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-emerald-900 uppercase font-mono tracking-wider">
                      Niveau 3 : Exécution Atomique, Recette QA & Opérations Edge
                    </span>
                    <span className="text-[10px] text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded font-mono">
                      DeepSeek V3 / Qwen Coder / Gemini
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {agents.filter(a => a.tier === 3).map(a => (
                      <div
                        key={a.id}
                        onClick={() => setSelectedAgentId(a.id)}
                        className={`p-3 bg-white rounded-lg border text-left cursor-pointer transition-all ${
                          selectedAgentId === a.id ? 'border-emerald-600 ring-2 ring-emerald-600/30' : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="font-bold text-slate-900 text-xs truncate">{a.role}</div>
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5 truncate">{a.modelId}</div>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            </div>

            {/* Channels & Cross-Tier Inspector (Right 1 Col) */}
            <div className="space-y-4">
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-900 text-sm">Canaux Inter-Niveaux ({channels.length})</h3>
                  <span className="text-[10px] font-mono text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded font-semibold">
                    RPC & Queues
                  </span>
                </div>
                <p className="text-xs text-slate-500">Cliquez sur un canal pour inspecter ou modifier son protocole.</p>

                <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                  {channels.map((ch, idx) => {
                    const isSimActive = activeSimulationStep === idx;
                    return (
                      <div
                        key={ch.id}
                        onClick={() => setSelectedChannelId(ch.id)}
                        className={`p-3 rounded-lg border text-left cursor-pointer transition-all text-xs space-y-1.5 ${
                          isSimActive
                            ? 'bg-indigo-50 border-indigo-600 ring-2 ring-indigo-600 animate-pulse'
                            : selectedChannelId === ch.id
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
                      <span className="text-slate-400 block text-[10px]">Format de Données Échangé</span>
                      <code className="text-indigo-600 font-mono bg-slate-50 px-1.5 py-0.5 rounded text-[11px]">
                        {selectedChannel.payloadType}
                      </code>
                    </div>

                    <div>
                      <span className="text-slate-400 block text-[10px]">Description Opérationnelle</span>
                      <p className="text-slate-600 text-[11px] leading-relaxed">{selectedChannel.description}</p>
                    </div>
                  </div>
                </div>
              )}

            </div>

          </div>
        </div>
      )}

      {/* VIEW: 2D GRAPHIC VIRTUAL OFFICE */}
      {activeTab === 'virtual_office' && (
        <VirtualOffice2D initialMissionName="Orchestration & Échanges Multi-Agents en Direct" autoPlay={true} />
      )}

      {/* VIEW 2: MARKDOWN PERSONA EDITOR (Ame.md & Job.md & Dynamic Tier) */}
      {activeTab === 'editor' && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-2 lg:col-span-1">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 font-mono px-2 block mb-1">
              Agents Disponibles ({agents.length})
            </span>

            <div className="space-y-1">
              {agents.map(ag => (
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
                    <span className={`text-[9px] uppercase font-mono px-1.5 py-0.2 rounded font-semibold ${
                      ag.tier === 1 ? 'bg-purple-50 text-purple-700' :
                      ag.tier === 2 ? 'bg-indigo-50 text-indigo-700' :
                      'bg-emerald-50 text-emerald-700'
                    }`}>
                      Niveau {ag.tier}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono mt-1 truncate">
                    {ag.modelId}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="lg:col-span-3 bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4 flex flex-col justify-between">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-slate-900">{currentAgent.role}</h2>
                  <span className="text-xs font-mono text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded font-semibold">
                    {currentAgent.modelId}
                  </span>
                  <span className="text-xs font-mono bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-semibold">
                    Niveau {currentAgent.tier}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">{currentAgent.description}</p>
              </div>

              <div className="inline-flex rounded-lg border border-slate-300 p-0.5 bg-slate-50 text-xs">
                <button
                  onClick={() => setActiveEditorSubTab('ame')}
                  className={`px-3 py-1 rounded-md font-semibold transition-colors ${
                    activeEditorSubTab === 'ame' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  🧬 Ame.md (Identité)
                </button>
                <button
                  onClick={() => setActiveEditorSubTab('job')}
                  className={`px-3 py-1 rounded-md font-semibold transition-colors ${
                    activeEditorSubTab === 'job' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  📋 Job.md (Missions)
                </button>
                <button
                  onClick={() => setActiveEditorSubTab('params')}
                  className={`px-3 py-1 rounded-md font-semibold transition-colors ${
                    activeEditorSubTab === 'params' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  ⚙️ Niveau & Modèle
                </button>
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
                
                {/* Tier Selection */}
                <div className="space-y-2">
                  <label className="block font-semibold text-slate-700">Niveau Hiérarchique dans le Graphe :</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[1, 2, 3].map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => handleUpdateCurrentAgent({ tier: t as 1 | 2 | 3 })}
                        className={`p-2.5 rounded-lg border text-left font-medium transition-colors ${
                          currentAgent.tier === t
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <div className="font-bold text-xs">Niveau {t}</div>
                        <div className={`text-[10px] ${currentAgent.tier === t ? 'text-indigo-100' : 'text-slate-400'}`}>
                          {t === 1 ? 'Orchestration & Décision' : t === 2 ? 'Recherche & Architecture' : 'Exécution & QA Edge'}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

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

      {/* VIEW 3: OPENROUTER CONFIGURATION */}
      {activeTab === 'openrouter_config' && (
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-slate-900 text-base">Clé API OpenRouter & Catalogue</h3>
                  <span className="text-xs font-mono text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded font-semibold">
                    {modelsList.length} modèles actifs
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">Votre clé permet d'utiliser n'importe quel LLM mondial.</p>
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

    </div>
  );
};
