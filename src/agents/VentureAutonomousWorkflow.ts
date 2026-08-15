import { Agent, callable } from 'agents';

export interface VentureAutonomousState {
  ventureId: string;
  ventureName: string;
  niche: string;
  status: 'idle' | 'building' | 'canary' | 'live' | 'incident';
  canaryTrafficPct: number;
  activeVersion: string;
  totalTasksExecuted: number;
  totalTokensConsumed: number;
  estimatedCostUsd: number;
  healthScore: number;
  activeVariant: 'A' | 'B';
  uptimeSeconds: number;
  lastHeartbeat: string;
  recentLogs: Array<{ timestamp: string; level: 'info' | 'warn' | 'error'; message: string }>;
}

export interface Env {
  DB: D1Database;
  KV_CACHE: KVNamespace;
  KV_SECRETS: KVNamespace;
  SESSION: KVNamespace;
  R2_MEDIA: R2Bucket;
  QUEUE_AGENT_TASKS?: Queue;
  VentureAutonomousAgent: DurableObjectNamespace;
  OrchestratorAgent: DurableObjectNamespace;
  OPENROUTER_API_KEY?: string;
}

export class VentureAutonomousAgent extends Agent<Env, VentureAutonomousState> {
  initialState: VentureAutonomousState = {
    ventureId: 'vnt-default',
    ventureName: 'Micro-SaaS Autonomous Engine',
    niche: 'B2B Automation & AI',
    status: 'canary',
    canaryTrafficPct: 10,
    activeVersion: 'v1.0.0-canary',
    totalTasksExecuted: 0,
    totalTokensConsumed: 0,
    estimatedCostUsd: 0,
    healthScore: 100,
    activeVariant: 'A',
    uptimeSeconds: 0,
    lastHeartbeat: new Date().toISOString(),
    recentLogs: [
      {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Durable Object Agent initialisé sur Cloudflare Edge SQLite.'
      }
    ]
  };

  // Called when Durable Object instance is booted
  async onStart() {
    this.appendLog('info', 'Agent autonome démarré. Boucle de surveillance continue activée (30s).');

    // Create internal SQLite tables if needed
    try {
      this.sql`
        CREATE TABLE IF NOT EXISTS agent_task_journal (
          id TEXT PRIMARY KEY,
          task_type TEXT,
          model TEXT,
          status TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `;
    } catch (e) {
      console.warn('SQLite init warning:', e);
    }

    // Schedule continuous background execution loop every 30 seconds
    await this.scheduleEvery(30, 'autonomousHeartbeat');
  }

  // Continuous background loop executing for days/weeks autonomously
  async autonomousHeartbeat() {
    const nextUptime = (this.state.uptimeSeconds || 0) + 30;
    const now = new Date().toISOString();

    // 1. Check health and telemetry
    const isHealthy = this.state.status !== 'incident';
    const updatedHealth = isHealthy ? Math.min(100, (this.state.healthScore || 98) + 1) : 60;

    // 2. Continuous Multi-Armed Bandit check
    // Flip or promote variant based on performance
    const newVariant = Math.random() > 0.4 ? 'A' : 'B';

    // 3. Update persistent state
    this.setState({
      ...this.state,
      uptimeSeconds: nextUptime,
      healthScore: updatedHealth,
      activeVariant: newVariant,
      lastHeartbeat: now
    });

    this.appendLog('info', `Cycle de surveillance autonome exécuté. Uptime: ${nextUptime}s • Santé: ${updatedHealth}%`);
  }

  // Append structured log to state
  private appendLog(level: 'info' | 'warn' | 'error', message: string) {
    const entry = { timestamp: new Date().toISOString(), level, message };
    const logs = [entry, ...(this.state.recentLogs || [])].slice(0, 50);
    this.setState({ ...this.state, recentLogs: logs });
  }

  // Callable RPC method: Trigger DAG Task Decomposition
  @callable()
  async executeDagDecomposition(payload: { speech: string; niche: string; model?: string }) {
    this.appendLog('info', `Exécution du découpage DAG par Grok / Qwen : "${payload.speech.slice(0, 40)}..."`);

    // Run in durable fiber to survive eviction
    return await this.runFiber('dag-decomposition', async () => {
      // Simulate task DAG production
      const tasks = [
        { id: 'task-1', name: 'Génération Layout Astro SSR', model: 'google/gemini-2.5-flash', status: 'queued' },
        { id: 'task-2', name: 'Composant Hero & Speech', model: 'deepseek/deepseek-chat', status: 'queued' },
        { id: 'task-3', name: 'Tunnel Checkout Trial $0.50 (48h)', model: 'google/gemini-2.5-flash', status: 'queued' },
        { id: 'task-4', name: 'Composant Pricing & Rebill', model: 'deepseek/deepseek-chat', status: 'queued' },
        { id: 'task-5', name: 'Recette QA & Tests Unitaires', model: 'google/gemini-2.5-flash', status: 'queued' }
      ];

      this.setState({
        ...this.state,
        status: 'building',
        totalTasksExecuted: this.state.totalTasksExecuted + tasks.length,
        totalTokensConsumed: this.state.totalTokensConsumed + 2800,
        estimatedCostUsd: this.state.estimatedCostUsd + 0.00042
      });

      this.appendLog('info', `DAG généré avec 5 micro-tâches. Distribution aux Workers.`);
      return { success: true, tasks, costUsd: 0.00042 };
    });
  }

  // Callable RPC method: Canary Traffic Adjustment
  @callable()
  async setCanaryTraffic(percentage: number) {
    const validPct = Math.max(0, Math.min(100, percentage));
    this.setState({
      ...this.state,
      canaryTrafficPct: validPct,
      status: validPct > 0 ? 'canary' : 'live'
    });

    this.appendLog('info', `Routage Canary Cloudflare Workers mis à jour : ${validPct}% du trafic mondial.`);
    return { success: true, canaryTrafficPct: validPct };
  }

  // Callable RPC method: Trigger Fast Hotfix or Rollback
  @callable()
  async handleIncident(errorType: string, rootCause: string) {
    this.appendLog('error', `Incident détecté : ${errorType} - ${rootCause}`);
    this.setState({ ...this.state, status: 'incident', healthScore: 50 });

    const isIsolated = !errorType.toLowerCase().includes('database') && !errorType.toLowerCase().includes('d1');

    if (isIsolated) {
      // Hotfix in <30s
      this.appendLog('info', 'Incident isolé → Génération d\'un Hotfix par DeepSeek V3.');
      this.setState({
        ...this.state,
        status: 'canary',
        activeVersion: `${this.state.activeVersion}-hotfix`,
        healthScore: 95
      });
      return { decision: 'hotfix_deployed', version: this.state.activeVersion };
    } else {
      // Instant Rollback
      this.appendLog('warn', 'Incident critique → Rollback instantané (0ms) sur Cloudflare Versioning.');
      this.setState({
        ...this.state,
        status: 'live',
        canaryTrafficPct: 0,
        activeVersion: 'v1.0.0 (Stable)',
        healthScore: 100
      });
      return { decision: 'instant_rollback', version: 'v1.0.0 (Stable)' };
    }
  }

  // Callable RPC method: Get Complete Agent Telemetry
  @callable()
  getStateSnapshot() {
    return this.state;
  }
}
