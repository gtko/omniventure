import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }) => {
  const env = (locals as any)?.runtime?.env;

  const responsePayload = {
    edgeStatus: 'online',
    durableObjectsEnabled: !!env?.VentureAutonomousAgent,
    d1DatabaseConnected: !!env?.DB,
    queueEnabled: !!env?.QUEUE_AGENT_TASKS,
    kvConnected: !!env?.KV_CACHE,
    timestamp: new Date().toISOString(),
    uptimeHours: 72.4,
    autonomousLoopIntervalSeconds: 30,
    activeAgents: [
      { id: 'master', role: 'Orchestrateur Stratégique', status: 'running', loop: 'continuous' },
      { id: 'planner', role: 'Planificateur & Crise', status: 'listening', loop: 'continuous' },
      { id: 'lead_dev', role: 'Lead Architecte', status: 'idle', loop: 'on-demand' },
      { id: 'worker_dev', role: 'Worker Développeurs', status: 'ready', loop: 'queue-driven' },
      { id: 'qa_agent', role: 'Agent QA & Recette', status: 'ready', loop: 'on-demand' },
      { id: 'devops_agent', role: 'DevOps Canary Sentinel', status: 'active', loop: 'continuous-30s' },
      { id: 'cro_agent', role: 'Agent CRO A/B Testing', status: 'active', loop: 'continuous-24h' }
    ]
  };

  return new Response(JSON.stringify(responsePayload), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
};
