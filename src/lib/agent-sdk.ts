/**
 * SDK d'agents OmniVenture.
 *
 * De quoi décrire un agent autonome (persona, modèle, outils) et le faire
 * tourner en boucle : le modèle décide, appelle des outils, lit leurs
 * résultats, recommence, jusqu'à produire une réponse finale.
 *
 * Volontairement isomorphe : la même définition s'exécute côté navigateur
 * (où l'agent peut piloter le pont local et animer le bureau) et côté Worker
 * (où il n'a que le réseau et la base). L'appelant fournit la clé et, au
 * besoin, son propre `fetch`.
 */

export interface ToolContext {
  /** Trace lisible, remontée dans le résultat du run. */
  log: (message: string) => void;
  signal?: AbortSignal;
}

export interface AgentTool<A = Record<string, unknown>> {
  name: string;
  description: string;
  /** JSON Schema des paramètres, transmis tel quel au modèle. */
  parameters: Record<string, unknown>;
  execute: (args: A, ctx: ToolContext) => Promise<unknown>;
}

export interface AgentDefinition {
  id: string;
  role: string;
  model: string;
  /** Persona (Ame.md) et fiche de poste (Job.md), comme dans le studio d'agents. */
  ame?: string;
  job?: string;
  temperature?: number;
  /** Nombre maximum d'allers-retours avec outils avant de rendre la main. */
  maxSteps?: number;
  tools?: AgentTool[];
}

export interface AgentStep {
  kind: 'tool' | 'message';
  name?: string;
  input?: unknown;
  output?: unknown;
  at: number;
}

export interface AgentRunResult {
  text: string;
  steps: AgentStep[];
  tokensInput: number;
  tokensOutput: number;
  modelUsed: string;
}

export interface RunOptions {
  openRouterKey: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  onStep?: (step: AgentStep) => void;
}

/** Petit helper de typage : `defineAgent` ne fait que valider la forme. */
export function defineAgent(definition: AgentDefinition): AgentDefinition {
  if (!definition.id) throw new Error('Un agent doit avoir un identifiant');
  if (!definition.model) throw new Error(`Agent ${definition.id} : modèle manquant`);
  return { temperature: 0.4, maxSteps: 6, tools: [], ...definition };
}

function systemPrompt(def: AgentDefinition): string {
  return [
    def.ame?.trim() || `Tu es ${def.role}, un agent autonome de l'agence OmniVenture.`,
    def.job?.trim(),
    "Tu réponds en français. Tu utilises les outils disponibles quand ils t'évitent de deviner.",
    'Quand tu as la réponse, formule-la directement, sans méta-commentaire sur ton raisonnement.'
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Exécute l'agent. La boucle s'arrête dès que le modèle répond sans demander
 * d'outil, ou au bout de `maxSteps` allers-retours.
 */
export async function runAgent(
  def: AgentDefinition,
  input: string,
  options: RunOptions
): Promise<AgentRunResult> {
  const http = options.fetchImpl ?? fetch;
  const tools = def.tools ?? [];
  const steps: AgentStep[] = [];
  const record = (step: AgentStep) => {
    steps.push(step);
    options.onStep?.(step);
  };
  const ctx: ToolContext = {
    signal: options.signal,
    log: (message) => record({ kind: 'message', output: message, at: Date.now() })
  };

  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: systemPrompt(def) },
    { role: 'user', content: input }
  ];

  let tokensInput = 0;
  let tokensOutput = 0;
  let modelUsed = def.model;

  for (let step = 0; step < (def.maxSteps ?? 6); step++) {
    const response = await http('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: options.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.openRouterKey}`,
        'HTTP-Referer': 'https://factory.dev',
        'X-Title': 'OmniVenture AI — Agent SDK'
      },
      body: JSON.stringify({
        model: def.model,
        messages,
        temperature: def.temperature ?? 0.4,
        max_tokens: 1600,
        ...(tools.length > 0
          ? {
              tools: tools.map((tool) => ({
                type: 'function',
                function: { name: tool.name, description: tool.description, parameters: tool.parameters }
              }))
            }
          : {})
      })
    });

    if (!response.ok) {
      throw new Error(`OpenRouter ${response.status} : ${(await response.text()).slice(0, 200)}`);
    }

    const completion = (await response.json()) as any;
    modelUsed = completion.model ?? modelUsed;
    tokensInput += completion.usage?.prompt_tokens ?? 0;
    tokensOutput += completion.usage?.completion_tokens ?? 0;

    const choice = completion.choices?.[0]?.message;
    if (!choice) throw new Error('Réponse vide du modèle');
    messages.push(choice);

    const calls = choice.tool_calls as Array<{ id: string; function: { name: string; arguments: string } }> | undefined;
    if (!calls || calls.length === 0) {
      return { text: String(choice.content ?? '').trim(), steps, tokensInput, tokensOutput, modelUsed };
    }

    for (const call of calls) {
      const tool = tools.find((t) => t.name === call.function.name);
      let output: unknown;
      let args: Record<string, unknown> = {};
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        args = {};
      }
      try {
        output = tool
          ? await tool.execute(args as never, ctx)
          : { error: `Outil inconnu : ${call.function.name}` };
      } catch (err) {
        output = { error: err instanceof Error ? err.message : 'Échec de l’outil' };
      }
      record({ kind: 'tool', name: call.function.name, input: args, output, at: Date.now() });
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(output).slice(0, 8000)
      });
    }
  }

  return {
    text: 'Limite d’étapes atteinte sans réponse finale.',
    steps,
    tokensInput,
    tokensOutput,
    modelUsed
  };
}

/* ------------------------------------------------------------------ */
/* Outils fournis                                                      */
/* ------------------------------------------------------------------ */

/** Lecture d'une page web (texte brut tronqué). Fonctionne partout. */
export const webFetchTool: AgentTool<{ url: string }> = {
  name: 'web_fetch',
  description: "Récupère le contenu textuel d'une URL publique.",
  parameters: {
    type: 'object',
    properties: { url: { type: 'string', description: 'URL absolue à lire' } },
    required: ['url']
  },
  async execute({ url }) {
    const res = await fetch(url, { headers: { 'User-Agent': 'OmniVenture-Agent/1.0' } });
    const text = await res.text();
    return {
      status: res.status,
      // Un dégraissage grossier suffit : le modèle n'a pas besoin du balisage.
      content: text
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .slice(0, 6000)
    };
  }
};

/**
 * Confie une tâche de code à un harnais local (Claude Code, Codex, opencode…).
 * Disponible uniquement côté navigateur : le pont écoute en 127.0.0.1.
 */
export function harnessTool(deps: {
  startRun: (harnessId: string, prompt: string, cwd?: string) => Promise<string>;
}): AgentTool<{ harness: string; task: string; cwd?: string }> {
  return {
    name: 'delegate_to_harness',
    description:
      "Confie une tâche de développement à un agent CLI local (claude, codex, opencode…). Renvoie l'identifiant du run à suivre.",
    parameters: {
      type: 'object',
      properties: {
        harness: { type: 'string', description: 'Identifiant du harnais : claude, codex, opencode, gemini…' },
        task: { type: 'string', description: 'Consigne complète et autoportante' },
        cwd: { type: 'string', description: 'Dossier de travail relatif au projet (optionnel)' }
      },
      required: ['harness', 'task']
    },
    async execute({ harness, task, cwd }) {
      const runId = await deps.startRun(harness, task, cwd);
      return { runId, dispatched: true };
    }
  };
}

/**
 * Fait apparaître l'activité dans le bureau virtuel : l'agent émetteur traverse
 * le plateau pour porter la tâche au destinataire. Navigateur uniquement.
 */
export function officeBroadcastTool(deps: {
  broadcast: (activity: {
    fromAgentId: string;
    fromAgentName: string;
    toAgentId: string;
    toAgentName: string;
    actionSummary: string;
    bubbleText?: string;
    payloadSummary: string;
    costUsd: number;
    modelUsed?: string;
  }) => void;
}): AgentTool<{ toAgentId: string; summary: string; bubble?: string }> {
  return {
    name: 'notify_office',
    description: "Signale une tâche à un collègue : l'échange devient visible dans le bureau virtuel.",
    parameters: {
      type: 'object',
      properties: {
        toAgentId: { type: 'string', description: "Identifiant de l'agent destinataire" },
        summary: { type: 'string', description: 'Résumé court de la tâche transmise' },
        bubble: { type: 'string', description: 'Texte affiché dans la bulle (optionnel)' }
      },
      required: ['toAgentId', 'summary']
    },
    async execute({ toAgentId, summary, bubble }) {
      deps.broadcast({
        fromAgentId: 'master',
        fromAgentName: 'Victoria (CEO)',
        toAgentId,
        toAgentName: toAgentId,
        actionSummary: summary,
        bubbleText: bubble,
        payloadSummary: JSON.stringify({ summary }),
        costUsd: 0
      });
      return { delivered: true };
    }
  };
}
