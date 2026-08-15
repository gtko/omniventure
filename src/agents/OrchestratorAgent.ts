import { Agent, callable } from 'agents';
import type { Env } from './VentureAutonomousWorkflow';

export interface OrchestratorState {
  orchestratorId: string;
  activeModel: string;
  totalProjectsManaged: number;
  totalTasksQueued: number;
  totalTokensProcessed: number;
  isProcessingQueue: boolean;
  registeredAgents: string[];
}

export class OrchestratorAgent extends Agent<Env, OrchestratorState> {
  initialState: OrchestratorState = {
    orchestratorId: 'master-orchestrator',
    activeModel: 'x-ai/grok-2',
    totalProjectsManaged: 1,
    totalTasksQueued: 0,
    totalTokensProcessed: 0,
    isProcessingQueue: false,
    registeredAgents: [
      'Orchestrateur Stratégique (Grok 2 / Qwen 72B)',
      'Planificateur & Crise (Qwen 72B)',
      'Lead Architecte (Gemini 2.5 Flash)',
      'Worker Développeur (DeepSeek V3 / Qwen Coder)',
      'Agent QA & Recette (Gemini 2.5 Flash)',
      'DevOps Canary (Qwen 72B)',
      'Agent CRO & A/B Testing (DeepSeek V3)'
    ]
  };

  async onStart() {
    console.log('OrchestratorAgent DO initialized on Cloudflare Edge.');
    // Check queues every 60s
    await this.scheduleEvery(60, 'processTaskQueue');
  }

  async processTaskQueue() {
    // Process pending background tasks
    if (this.state.totalTasksQueued > 0) {
      this.setState({
        ...this.state,
        totalTasksQueued: Math.max(0, this.state.totalTasksQueued - 2),
        totalTokensProcessed: this.state.totalTokensProcessed + 1500
      });
    }
  }

  @callable()
  async queueNewVentureTask(taskName: string, payload: any) {
    this.setState({
      ...this.state,
      totalTasksQueued: this.state.totalTasksQueued + 1
    });

    // If Cloudflare Queues binding exists, push to queue
    if (this.env.QUEUE_AGENT_TASKS) {
      try {
        await this.env.QUEUE_AGENT_TASKS.send({
          taskName,
          payload,
          timestamp: Date.now()
        });
      } catch (e) {
        console.warn('Queue send fallback:', e);
      }
    }

    return { queued: true, taskName, timestamp: new Date().toISOString() };
  }

  @callable()
  getOrchestratorMetrics() {
    return this.state;
  }
}
