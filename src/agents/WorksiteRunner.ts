/**
 * Le chantier qui ne s'arrête pas quand on ferme l'onglet.
 *
 * La chaîne tournait dans le navigateur : la boucle, l'état, et jusqu'aux
 * appels au modèle. Un rechargement la tuait, et le message « interrompu par un
 * rechargement de la page » disait la vérité — l'agence ne travaillait que
 * pendant qu'on la regardait.
 *
 * Ici la boucle est un Durable Object. Elle avance par réveils programmés
 * (`alarm`) : un réveil, une tâche, puis le réveil suivant. Rien ne dépend
 * d'une page ouverte, d'un onglet actif ni d'une machine allumée. Le navigateur
 * lit un journal d'événements et n'en possède plus rien.
 *
 * Pourquoi une tâche par réveil plutôt qu'une longue boucle : un Worker a un
 * temps d'exécution borné. Une chaîne qui dure une heure ne peut pas tenir dans
 * une seule invocation — elle doit se découper en pas courts, chacun laissant
 * derrière lui un état complet dans la base. C'est aussi ce qui la rend
 * reprenable après n'importe quelle interruption.
 */

import { runAgent, type AgentTool } from '../lib/agent-sdk';
import { defaultAgency, readAgency, type AgencyAgent } from '../lib/agency-graph';
import { checkBudget, recordSpend } from '../lib/agency-spend';
import { readConfig } from '../lib/agency-store';
import { resolveOpenRouterKey } from '../lib/openrouter-key';
import { PHASES, phaseById, handoffPrompt, type Phase } from '../lib/pipeline';
import { runSandboxTool, WORKDIR } from '../lib/sandbox-tools';
import { ensureWorksiteTables } from '../lib/worksite-store';

export interface Env {
  DB: D1Database;
  KV_SECRETS?: KVNamespace;
  SANDBOX?: DurableObjectNamespace;
  OPENROUTER_API_KEY?: string;
}

interface StartPayload {
  ventureId: string;
  ventureName: string;
  ventureSlug: string;
  dossier?: string;
  cycles?: number;
  /** Ce que les agents ont le droit de faire dans le conteneur. */
  autonomy?: 'read' | 'write' | 'full';
  openRouterKey?: string;
}

/** Assez court pour que le chantier paraisse vivant, assez long pour respirer. */
const TICK_MS = 3000;
/** Trois tentatives par tâche, comme dans le reste de l'agence. */
const MAX_ATTEMPTS = 3;
/** Borne d'un passage : au-delà, on rend la main plutôt que de courir seul. */
const MAX_TASKS_PER_RUN = 40;

export class WorksiteRunner {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.endsWith('/start')) {
      const payload = (await request.json()) as StartPayload;
      return this.json(await this.start(payload));
    }
    if (url.pathname.endsWith('/stop')) {
      return this.json(await this.stop());
    }
    if (url.pathname.endsWith('/status')) {
      return this.json({ runId: (await this.state.storage.get<string>('runId')) ?? null });
    }
    return this.json({ error: 'Route inconnue' }, 404);
  }

  /* ------------------------------------------------------------------ */
  /* Commandes                                                           */
  /* ------------------------------------------------------------------ */

  private async start(payload: StartPayload): Promise<{ runId: string } | { error: string }> {
    const existing = await this.state.storage.get<string>('runId');
    if (existing) {
      const run = await this.env.DB.prepare('SELECT status FROM worksite_runs WHERE id = ?').bind(existing).first();
      if (run && String((run as any).status) === 'en-cours') return { runId: existing };
    }

    /*
     * La clé vient d'abord de l'environnement, puis du coffre, et seulement à
     * défaut de l'appelant. Elle ne va ni dans la base ni dans le journal :
     * elle reste dans le stockage de l'hôte, que personne d'autre ne lit.
     */
    const key = await resolveOpenRouterKey(this.env, payload.openRouterKey);
    if (!key) {
      return {
        error:
          "Clé OpenRouter absente. Rangez-la dans le coffre (elle y sera chiffrée et le serveur s'en servira seul) ou renseignez-la dans le studio d'agents."
      };
    }

    await ensureWorksiteTables(this.env.DB);

    const runId = `run-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    const now = Date.now();

    await this.env.DB.prepare(
      `INSERT INTO worksite_runs (id, venture_id, venture_name, venture_slug, status, phase, cycle, lanes, autonomy, step, done, failed, started_at, updated_at)
       VALUES (?, ?, ?, ?, 'en-cours', 'vision', 1, 1, ?, 'démarrage', 0, 0, ?, ?)`
    )
      .bind(
        runId,
        payload.ventureId,
        payload.ventureName,
        payload.ventureSlug,
        payload.autonomy ?? 'full',
        now,
        now
      )
      .run();

    /*
     * Les tâches décidées hors chantier — en réunion, alors qu'aucune chaîne ne
     * tournait — attendent au vestiaire. Ce passage les adopte : une décision
     * prise ne doit pas se perdre faute d'un passage ouvert au bon moment.
     */
    const adopted = await this.env.DB.prepare(
      `UPDATE worksite_tasks SET run_id = ?, updated_at = ? WHERE run_id = '' AND venture_name = ? AND status = 'todo'`
    )
      .bind(runId, now, payload.ventureName)
      .run();
    const count = Number(adopted?.meta?.changes ?? 0);

    await this.state.storage.put('runId', runId);
    await this.state.storage.put('key', key);
    await this.state.storage.put('dossier', payload.dossier ?? '');
    await this.state.storage.put('handled', 0);

    await this.log(
      runId,
      'demarrage',
      `Chantier ouvert sur ${payload.ventureName}.${count > 0 ? ` ${count} tâche(s) décidée(s) en réunion reprise(s).` : ''}`
    );
    await this.state.storage.setAlarm(Date.now() + 500);
    return { runId };
  }

  private async stop(): Promise<{ stopped: boolean }> {
    const runId = await this.state.storage.get<string>('runId');
    if (!runId) return { stopped: false };
    await this.patch(runId, { status: 'arrete', step: 'arrêté à la demande', stopped_at: Date.now() });
    await this.log(runId, 'arret', 'Chantier arrêté à la demande.');
    await this.state.storage.deleteAlarm();
    await this.state.storage.delete('runId');
    await this.state.storage.delete('key');
    return { stopped: true };
  }

  /* ------------------------------------------------------------------ */
  /* La boucle                                                           */
  /* ------------------------------------------------------------------ */

  async alarm(): Promise<void> {
    const runId = await this.state.storage.get<string>('runId');
    if (!runId) return;

    // Vous avez pu modifier l'organigramme entre deux réveils.
    this.roster = null;

    try {
      const keepGoing = await this.tick(runId);
      if (keepGoing) await this.state.storage.setAlarm(Date.now() + TICK_MS);
      else await this.finish(runId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Échec inconnu';
      await this.patch(runId, { status: 'echec', error: message, stopped_at: Date.now() });
      await this.log(runId, 'echec', message);
      await this.state.storage.delete('runId');
      await this.state.storage.delete('key');
    }
  }

  /** Un pas de la chaîne. Rend `false` quand il n'y a plus rien à faire. */
  private async tick(runId: string): Promise<boolean> {
    const run = await this.env.DB.prepare('SELECT * FROM worksite_runs WHERE id = ?').bind(runId).first();
    if (!run || String((run as any).status) !== 'en-cours') return false;

    const phase = phaseById(String((run as any).phase) as any);

    /* Le frein : une chaîne autonome sans plafond se découvre sur une facture. */
    const config = await readConfig(this.env.DB, String((run as any).venture_id));
    const budget = await checkBudget(this.env.DB, String((run as any).venture_id), config.dailyBudgetUsd);
    if (!budget.allowed) {
      await this.patch(runId, { error: budget.reason ?? null });
      await this.log(runId, "quota", budget.reason ?? "Plafond de dépense atteint.");
      return false;
    }

    const handled = (await this.state.storage.get<number>('handled')) ?? 0;
    if (handled >= MAX_TASKS_PER_RUN) {
      await this.log(runId, 'quota', `${MAX_TASKS_PER_RUN} tâches sur ce passage — relancez pour continuer.`);
      return false;
    }

    // Une étape sans tâche : on l'amorce, ou on passe à la suivante.
    const next = await this.nextTask(runId, phase.id);
    if (!next) {
      const seeded = await this.openPhase(runId, run, phase);
      if (seeded > 0) return true;
      return this.advance(runId, run, phase);
    }

    await this.runTask(runId, run, phase, next);
    await this.state.storage.put('handled', handled + 1);
    return true;
  }

  private async nextTask(runId: string, phaseId: string): Promise<any | null> {
    const row = await this.env.DB.prepare(
      `SELECT * FROM worksite_tasks WHERE run_id = ? AND phase = ? AND status = 'todo' ORDER BY created_at LIMIT 1`
    )
      .bind(runId, phaseId)
      .first();
    return row ?? null;
  }

  /**
   * Amorce d'une étape.
   *
   * Seule la vision s'amorce à partir du dossier de lancement ; les autres
   * reçoivent leurs tâches de la passation qui les précède.
   */
  private async openPhase(runId: string, run: any, phase: Phase): Promise<number> {
    if (phase.id !== 'vision') return 0;

    const already = await this.env.DB.prepare('SELECT COUNT(*) AS n FROM worksite_tasks WHERE run_id = ? AND phase = ?')
      .bind(runId, phase.id)
      .first();
    if (Number((already as any)?.n ?? 0) > 0) return 0;

    const dossier = (await this.state.storage.get<string>('dossier')) ?? '';
    await this.addTask(runId, String(run.venture_name), phase.id, {
      title: `Directive produit — ${run.venture_name}`,
      detail: dossier || `Poser la direction de ${run.venture_name}.`
    });
    await this.log(runId, 'etape', `${phase.icon} ${phase.label} — amorcée.`);
    return 1;
  }

  /** Passation : le responsable suivant lit ce qui vient d'être produit. */
  private async advance(runId: string, run: any, phase: Phase): Promise<boolean> {
    if (!phase.next) {
      await this.log(runId, 'fin', 'La chaîne a fait le tour : la mesure clôt le cycle.');
      return false;
    }

    const deliverables = await this.deliverablesOf(runId, phase.id);
    const lead = this.pickAgent(phaseById(phase.next as any), await this.agency());
    const key = (await this.state.storage.get<string>('key'))!;

    await this.patch(runId, { step: `passation ${phase.label} → ${phaseById(phase.next as any).label}` });

    const result = await runAgent(
      {
        id: lead.id,
        role: lead.role,
        model: lead.modelId ?? 'google/gemini-2.5-flash',
        ame: lead.ameMd,
        job: lead.jobMd,
        temperature: lead.temperature,
        maxTokens: lead.maxTokens,
        maxSteps: 1,
        tools: []
      },
      handoffPrompt(phase, String(run.venture_name), deliverables),
      { openRouterKey: key }
    );

    await recordSpend(this.env.DB, {
      ventureId: String(run.venture_id),
      kind: 'passation',
      agentId: lead.id,
      agentName: lead.role,
      model: result.modelUsed,
      tokensIn: result.tokensInput,
      tokensOut: result.tokensOutput,
      costUsd: result.costUsd,
      label: `${phase.label} → ${phaseById(phase.next as any).label}`
    });

    const titles = this.parseTitles(result.text);
    if (titles.length === 0) {
      await this.log(runId, 'attente', `Passation sans suite : ${lead.role} n'a listé aucune tâche.`);
      return false;
    }

    for (const title of titles.slice(0, 6)) {
      await this.addTask(runId, String(run.venture_name), phase.next, { title: title.title, detail: title.detail });
    }

    await this.patch(runId, { phase: phase.next, step: `${phaseById(phase.next as any).label} — ${titles.length} tâche(s)` });
    await this.log(runId, 'passation', `${phase.label} → ${phaseById(phase.next as any).label} : ${titles.length} tâche(s).`);
    return true;
  }

  /** Une tâche : un agent, un livrable, un compte rendu. */
  private async runTask(runId: string, run: any, phase: Phase, task: any): Promise<void> {
    const agent = this.pickAgent(phase, await this.agency());
    const attempt = Number(task.attempt ?? 0) + 1;
    const key = (await this.state.storage.get<string>('key'))!;

    await this.env.DB.prepare(
      `UPDATE worksite_tasks SET status = 'doing', agent_id = ?, agent_name = ?, attempt = ?, updated_at = ? WHERE id = ?`
    )
      .bind(agent.id, agent.role, attempt, Date.now(), task.id)
      .run();

    await this.patch(runId, { step: `${phase.label} — ${agent.role}` });
    await this.log(runId, 'tache', `${agent.role} : ${task.title}`, { taskId: task.id, attempt });

    /*
     * Les étapes qui écrivent du code reçoivent le conteneur. Elles ne
     * dépendent donc plus d'une machine allumée : le pont local exigeait la
     * vôtre, le conteneur non.
     */
    const codePhase = phase.id === 'build' || phase.id === 'deploy';
    const autonomy = String(run.autonomy ?? 'read');
    const used = new Set<string>();

    try {
      const result = await runAgent(
        {
          id: agent.id,
          role: agent.role,
          model: agent.modelId ?? 'google/gemini-2.5-flash',
          ame: agent.ameMd,
          job: agent.jobMd,
          temperature: agent.temperature,
          maxTokens: agent.maxTokens,
          maxSteps: codePhase ? 10 : 4,
          tools: codePhase ? this.sandboxTools(String(run.venture_slug), autonomy, used) : []
        },
        [
          `Produit : ${run.venture_name}.`,
          `Étape : ${phase.label}.`,
          `Tâche : ${task.title}`,
          task.detail ? `Précisions : ${task.detail}` : '',
          '',
          `Ce que cette étape doit livrer : ${phase.deliverable}`,
          '',
          codePhase
            ? `Le projet est dans ${WORKDIR}. Lis avant d'écrire, puis écris réellement les fichiers avec fs_write — un compte rendu n'est pas du code. Vérifie avec shell (npm run build) avant de conclure.`
            : "Rends le livrable lui-même, rédigé, pas un plan de ce que tu ferais."
        ]
          .filter(Boolean)
          .join('\n'),
        { openRouterKey: key }
      );

      await recordSpend(this.env.DB, {
        ventureId: String(run.venture_id),
        kind: 'tache',
        agentId: agent.id,
        agentName: agent.role,
        model: result.modelUsed,
        tokensIn: result.tokensInput,
        tokensOut: result.tokensOutput,
        costUsd: result.costUsd,
        label: String(task.title)
      });

      const body = (result.text ?? '').trim();

      /*
       * La preuve du livrable dépend de sa nature. Pour du code, elle n'est pas
       * dans le texte : un agent qui décrit très bien ce qu'il aurait écrit n'a
       * rien écrit. On exige qu'un fichier ait réellement été posé.
       */
      if (codePhase && !used.has('fs_write')) {
        throw new Error(
          "Aucun fichier écrit : cette étape se juge sur le code posé dans le projet, pas sur son récit."
        );
      }

      if (!codePhase && body.length < 80) {
        throw new Error(
          result.finishReason === 'length'
            ? `Réponse coupée au plafond de ${agent.maxTokens ?? 2048} jetons.`
            : 'Livrable trop court pour en être un.'
        );
      }

      const kind = phase.produces[0] ?? 'memo';
      // Pour du code, ce qui compte est ce qui a été touché : on le garde avec
      // le compte rendu, sinon le livrable se résume à un paragraphe.
      const stored = codePhase ? `${body}\n\n— Outils employés : ${[...used].join(', ')}` : body;
      await this.env.DB.prepare(
        `INSERT INTO worksite_artifacts (id, run_id, task_id, venture_name, phase, kind, title, summary, body, agent_id, agent_name, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          `art-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e5).toString(36)}`,
          runId,
          String(task.id),
          String(run.venture_name),
          phase.id,
          kind,
          String(task.title).slice(0, 200),
          stored.slice(0, 300),
          stored.slice(0, 40000),
          agent.id,
          agent.role,
          Date.now()
        )
        .run();

      await this.env.DB.prepare(
        `UPDATE worksite_tasks SET status = 'review', report = ?, updated_at = ? WHERE id = ?`
      )
        .bind(stored.slice(0, 2000), Date.now(), task.id)
        .run();

      await this.patch(runId, { done: Number(run.done ?? 0) + 1 });
      await this.log(runId, 'livraison', `${agent.role} a livré : ${task.title}`, { taskId: task.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Échec inconnu';
      const dead = attempt >= MAX_ATTEMPTS;
      await this.env.DB.prepare(`UPDATE worksite_tasks SET status = ?, report = ?, updated_at = ? WHERE id = ?`)
        .bind(dead ? 'echec' : 'todo', message.slice(0, 500), Date.now(), task.id)
        .run();
      if (dead) await this.patch(runId, { failed: Number(run.failed ?? 0) + 1 });
      await this.log(runId, dead ? 'echec-tache' : 'reprise', `${task.title} — ${message}`, { taskId: task.id, attempt });
    }
  }

  private async finish(runId: string): Promise<void> {
    await this.patch(runId, { status: 'termine', step: 'terminé', stopped_at: Date.now() });
    await this.log(runId, 'fin', 'Passage terminé.');
    await this.state.storage.deleteAlarm();
    await this.state.storage.delete('runId');
    await this.state.storage.delete('key');
  }

  /* ------------------------------------------------------------------ */
  /* Outillage                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * Les outils du conteneur, tels que l'agent les voit.
   *
   * C'est ce qui rend le chantier serveur capable de développer. Le pont local
   * exige une machine allumée ; le conteneur, non — il lit, écrit, compile et
   * lance des commandes depuis le Worker.
   */
  private sandboxTools(workspace: string, autonomy: string, seen: Set<string>): AgentTool[] {
    const call = async (tool: string, args: Record<string, unknown>) => {
      const outcome = await runSandboxTool(this.env, { tool, args, autonomy, workspace });
      // Ce qui a réellement été fait, pour juger le livrable ensuite : un
      // compte rendu ne prouve pas qu'un fichier a été écrit.
      if (!outcome.error) seen.add(tool);
      return outcome.error ? { error: outcome.error } : outcome.result;
    };

    return [
      {
        name: 'fs_list',
        description: "Liste le contenu d'un dossier du projet.",
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
        execute: (args: any) => call('fs_list', args)
      },
      {
        name: 'fs_read',
        description: 'Lit un fichier du projet.',
        parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        execute: (args: any) => call('fs_read', args)
      },
      {
        name: 'fs_search',
        description: 'Cherche un motif dans les fichiers du projet.',
        parameters: {
          type: 'object',
          properties: { pattern: { type: 'string' }, extensions: { type: 'array', items: { type: 'string' } } },
          required: ['pattern']
        },
        execute: (args: any) => call('fs_search', args)
      },
      {
        name: 'fs_write',
        description: `Écrit un fichier du projet (racine ${WORKDIR}).`,
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' }, content: { type: 'string' } },
          required: ['path', 'content']
        },
        execute: (args: any) => call('fs_write', args)
      },
      {
        name: 'shell',
        description: 'Lance une commande dans le projet (npm, node…).',
        parameters: {
          type: 'object',
          properties: { bin: { type: 'string' }, args: { type: 'array', items: { type: 'string' } } },
          required: ['bin']
        },
        execute: (args: any) => call('shell', args)
      },
      {
        name: 'git',
        description: 'Commande git dans le projet.',
        parameters: {
          type: 'object',
          properties: { args: { type: 'array', items: { type: 'string' } } },
          required: ['args']
        },
        execute: (args: any) => call('git', args)
      }
    ];
  }

  /**
   * L'agence telle que vous l'avez construite.
   *
   * Lue une fois par réveil et gardée en mémoire le temps de celui-ci : la
   * relire à chaque tâche coûterait une requête pour rien, et la garder au-delà
   * ferait travailler le chantier avec un organigramme périmé.
   */
  private roster: AgencyAgent[] | null = null;

  private async agency(): Promise<AgencyAgent[]> {
    if (!this.roster) this.roster = await readAgency(this.env.DB);
    return this.roster;
  }

  /**
   * L'étape désigne ses responsables : on prend le premier qui existe dans le
   * graphe. S'il n'y est pas — vous avez pu renommer ou supprimer ce rôle — on
   * se rabat sur un agent du bon niveau plutôt que de refuser d'avancer.
   */
  private pickAgent(phase: Phase, roster: AgencyAgent[]): AgencyAgent {
    for (const id of phase.owners) {
      const found = roster.find((agent) => agent.id === id);
      if (found) return found;
    }
    const senior = roster.find((agent) => agent.level === 'c_level' || agent.level === 'vp');
    return senior ?? roster[0] ?? defaultAgency()[0];
  }

  private async deliverablesOf(runId: string, phaseId: string): Promise<string> {
    const result = await this.env.DB.prepare(
      'SELECT title, body FROM worksite_artifacts WHERE run_id = ? AND phase = ? ORDER BY at'
    )
      .bind(runId, phaseId)
      .all();
    return ((result?.results ?? []) as any[])
      .map((row) => `--- ${row.title} ---\n${String(row.body ?? '').slice(0, 4000)}`)
      .join('\n\n');
  }

  /** Les titres de tâches sortis d'une passation, quel que soit le format rendu. */
  private parseTitles(text: string): Array<{ title: string; detail: string }> {
    const lines = (text ?? '')
      .split('\n')
      .map((line) => line.replace(/^[\s\-*•\d.)]+/, '').trim())
      .filter((line) => line.length > 8 && line.length < 220 && !line.endsWith(':'));

    const seen = new Set<string>();
    const out: Array<{ title: string; detail: string }> = [];
    for (const line of lines) {
      const [head, ...rest] = line.split(/\s+[—–:]\s+/);
      const title = (head ?? line).slice(0, 140).trim();
      const low = title.toLowerCase();
      if (title.length < 8 || seen.has(low)) continue;
      seen.add(low);
      out.push({ title, detail: rest.join(' — ').slice(0, 600) });
    }
    return out;
  }

  private async addTask(
    runId: string,
    ventureName: string,
    phaseId: string,
    task: { title: string; detail: string }
  ): Promise<void> {
    const now = Date.now();
    await this.env.DB.prepare(
      `INSERT INTO worksite_tasks (id, run_id, venture_name, phase, title, detail, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'todo', ?, ?)`
    )
      .bind(
        `wt-${now.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
        runId,
        ventureName,
        phaseId,
        task.title.slice(0, 200),
        task.detail.slice(0, 2000),
        now,
        now
      )
      .run();
  }

  private async patch(runId: string, changes: Record<string, unknown>): Promise<void> {
    const fields = Object.keys(changes);
    if (fields.length === 0) return;
    const set = [...fields.map((field) => `${field} = ?`), 'updated_at = ?'].join(', ');
    await this.env.DB.prepare(`UPDATE worksite_runs SET ${set} WHERE id = ?`)
      .bind(...fields.map((field) => changes[field] as any), Date.now(), runId)
      .run();
  }

  private async log(runId: string, kind: string, message: string, payload?: unknown): Promise<void> {
    await this.env.DB.prepare('INSERT INTO worksite_events (run_id, at, kind, message, payload) VALUES (?, ?, ?, ?, ?)')
      .bind(runId, Date.now(), kind, message.slice(0, 500), payload ? JSON.stringify(payload) : null)
      .run();
  }

  private json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/** Les étapes, exposées pour que l'interface parle le même vocabulaire. */
export const SERVER_PHASES = PHASES.map((phase) => ({ id: phase.id, label: phase.label, icon: phase.icon }));
