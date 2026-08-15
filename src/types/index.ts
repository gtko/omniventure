export type VentureType = 'saas' | 'dropship' | 'affiliate' | 'ebook' | 'viral_campaign';
export type BusinessModel = 'trial_rebill' | 'freemium' | 'one_time' | 'affiliate_commission';
export type VentureStatus = 'draft' | 'building' | 'canary' | 'live' | 'paused' | 'error';

export interface Venture {
  id: string;
  name: string;
  slug: string;
  niche: string;
  type: VentureType;
  businessModel: BusinessModel;
  status: VentureStatus;
  domain: string;
  stripeAccountId: string;
  priceTrialCents: number;
  priceRecurringCents: number;
  trialDurationHours: number;
  canaryTrafficPct: number;
  activeVersion: string;
  visitorsCount: number;
  subscribersCount: number;
  mrrCents: number;
  totalRevenueCents: number;
  createdAt: string;
  updatedAt: string;
}

export type LLMModel = 
  | 'Grok 4.6' 
  | 'Qwen 3.8-Max' 
  | 'Gemini 3.7 Flash' 
  | 'DeepSeek V4 Flash'
  | 'MiniMax Video'
  | 'Seedance';

export interface AgentTask {
  id: string;
  ventureId: string;
  ventureName?: string;
  agentRole: string;
  modelName: LLMModel;
  status: 'pending' | 'running' | 'success' | 'failed';
  promptSummary: string;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
  latencyMs: number;
  outputPreview: string;
  createdAt: string;
}

export interface IncidentReport {
  id: string;
  ventureId: string;
  ventureName: string;
  errorType: string;
  errorMessage: string;
  stackTrace: string;
  rootCause: string;
  decision: 'hotfix_applied' | 'instant_rollback' | 'escalated';
  resolvedByModel: LLMModel;
  latencySeconds: number;
  status: 'investigating' | 'resolved' | 'monitoring';
  createdAt: string;
}

export interface ABTest {
  id: string;
  ventureId: string;
  ventureName: string;
  elementTested: 'pricing' | 'trial_duration' | 'hero_headline' | 'cta_button';
  variantALabel: string;
  variantAValue: string;
  variantAImpressions: number;
  variantAConversions: number;
  variantBLabel: string;
  variantBValue: string;
  variantBImpressions: number;
  variantBConversions: number;
  currentWinner: 'A' | 'B' | 'inconclusive';
  autoPromoted: boolean;
  updatedAt: string;
}

export interface MediaAsset {
  id: string;
  ventureId: string;
  ventureName: string;
  assetType: 'tiktok_9_16' | 'youtube_16_9' | 'kdp_cover' | 'kdp_epub' | 'product_banner';
  title: string;
  videoScript?: string;
  audioTtsVoice?: string;
  mediaUrl: string;
  modelUsed: string;
  durationSeconds?: number;
  status: 'generating' | 'ready' | 'failed';
  viewsCount: number;
  clicksCount: number;
  createdAt: string;
}
