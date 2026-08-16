/**
 * Le battement de l'agence.
 *
 * Jusqu'ici, **rien ne demandait jamais à un agent ce qu'il voulait faire**. Ils
 * étaient toujours appelés : par le chantier qui leur confie une tâche, par un
 * rituel qui leur pose un créneau. Aucun canal pour prendre une initiative, d'où
 * l'impression — juste — qu'ils n'interagissent pas et ne font rien avancer.
 *
 * Ce module donne son tour à chacun. Mais **un agent tient son rang** : il ne
 * s'attribue pas une mission. Un expert qui ne sait pas quoi faire interroge son
 * responsable ; celui-ci répond, ou fait remonter. Le travail descend, les
 * questions montent — comme dans une agence.
 *
 * Deux séparations qui décident de la justesse de l'ensemble :
 *
 *   - **le chantier produit, le battement coordonne.** Le chantier exécute les
 *     tâches et fabrique les livrables ; le battement fait circuler la parole et
 *     crée le travail. Sans cette séparation, les deux se disputeraient les
 *     mêmes tâches et les exécuteraient deux fois.
 *
 *   - **une tranche tournante, pas tout le monde à chaque fois.** Réveiller
 *     vingt agents toutes les cinq minutes, ce sont des centaines d'appels par
 *     heure passés à s'entendre répondre « rien à signaler ». Cinq par tour
 *     suffisent : chacun a le sien en une demi-heure réelle, soit une journée
 *     de travail d'agence.
 */

import { runAgent, type AgentTool } from '../lib/agent-sdk';
import { readAgency, responsableDe, rightsOf, subordonnesDe, type AgencyAgent } from '../lib/agency-graph';
import { holdMeeting } from '../lib/agency-meeting';
import {
  agencyNow,
  answerRequest,
  answersFor,
  ask,
  busyAgents,
  dueMeetings,
  escalate,
  pendingFor,
  meetingsOf,
  readConfig,
  recordTurn,
  scheduleMeeting,
  turnOrder,
  WORK_START,
  WORK_END,
  type RequestRow
} from '../lib/agency-store';
import { resolveOpenRouterKey } from '../lib/openrouter-key';
import { parseModelJson } from '../lib/model-json';

export interface Env {
  DB: D1Database;
  OPENROUTER_API_KEY?: string;
}

interface StartPayload {
  ventureId: string;
  ventureName: string;
  openRouterKey?: string;
}

/** Au plus une réunion par battement : c'est ce qui coûte le plus cher. */
const MEETINGS_PER_TICK = 1;

export class AgencyHeartbeat {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/start')) {
      return this.json(await this.start((await request.json()) as StartPayload));
    }
    if (url.pathname.endsWith('/stop')) {
      return this.json(await this.stop());
    }
    return this.json({ error: 'Route inconnue' }, 404);
  }

  /* ------------------------------------------------------------------ */
  /* Marche et arrêt                                                     */
  /* ------------------------------------------------------------------ */

  private async start(payload: StartPayload): Promise<{ started: boolean; error?: string }> {
    const key = await resolveOpenRouterKey(this.env, payload.openRouterKey);
    if (!key) return { started: false, error: 'Clé OpenRouter absente : le battement ne peut rien demander à personne.' };

    await this.state.storage.put('ventureId', payload.ventureId);
    await this.state.storage.put('ventureName', payload.ventureName);
    await this.state.storage.put('key', key);
    await this.state.storage.put('running', true);

    await this.log(payload.ventureId, 'battement', "L'agence est en marche : chacun aura son tour.");
    await this.state.storage.setAlarm(Date.now() + 2000);
    return { started: true };
  }

  private async stop(): Promise<{ stopped: boolean }> {
    const ventureId = await this.state.storage.get<string>('ventureId');
    await this.state.storage.put('running', false);
    await this.state.storage.deleteAlarm();
    await this.state.storage.delete('key');
    if (ventureId) await this.log(ventureId, 'battement', "L'agence s'arrête : plus personne n'est sollicité.");
    return { stopped: true };
  }

  /* ------------------------------------------------------------------ */
  /* Le battement                                                        */
  /* ------------------------------------------------------------------ */

  async alarm(): Promise<void> {
    const running = await this.state.storage.get<boolean>('running');
    const ventureId = await this.state.storage.get<string>('ventureId');
    const key = await this.state.storage.get<string>('key');
    if (!running || !ventureId || !key) return;

    const config = await readConfig(this.env.DB, ventureId);

    try {
      await this.tick(ventureId, key, config.agentsPerTick);
    } catch (error) {
      await this.log(ventureId, 'battement', `Battement interrompu : ${error instanceof Error ? error.message : '—'}`);
    }

    // La cadence est relue à chaque fois : la modifier prend effet au tour
    // suivant, sans rien redémarrer.
    if (await this.state.storage.get<boolean>('running')) {
      await this.state.storage.setAlarm(Date.now() + config.tickSeconds * 1000);
    }
  }

  private async tick(ventureId: string, key: string, slice: number): Promise<void> {
    const roster = await readAgency(this.env.DB);
    const ventureName = (await this.state.storage.get<string>('ventureName')) ?? '';

    /* — Les réunions dues d'abord : c'est là que les décisions se prennent — */
    const due = await dueMeetings(this.env.DB, ventureId);
    for (const meeting of due.slice(0, MEETINGS_PER_TICK)) {
      await holdMeeting({
        db: this.env.DB,
        meeting,
        roster,
        openRouterKey: key,
        log: (kind, message) => this.log(ventureId, kind, message)
      });
    }

    /* — Hors des heures ouvrées, l'agence dort — */
    const { hour } = await agencyNow(this.env.DB);
    if (hour < WORK_START || hour >= WORK_END) return;

    /* — Qui est disponible — */
    const busy = new Set((await busyAgents(this.env.DB, ventureId)).map((entry) => entry.agentId));
    const inMeeting = new Set(due.slice(0, MEETINGS_PER_TICK).flatMap((meeting) => meeting.participantIds));
    const working = await this.workingAgents(ventureName);

    const idle = roster.filter(
      (agent) => !busy.has(agent.id) && !inMeeting.has(agent.id) && !working.has(agent.id)
    );
    if (idle.length === 0) return;

    /* — Le tour de parole : les plus anciens d'abord — */
    const order = await turnOrder(this.env.DB, ventureId, idle.map((agent) => agent.id));
    for (const agentId of order.slice(0, slice)) {
      const agent = roster.find((entry) => entry.id === agentId);
      if (!agent) continue;
      await recordTurn(this.env.DB, ventureId, agentId);
      try {
        await this.turn(ventureId, ventureName, agent, roster, key);
      } catch (error) {
        /*
         * L'échec d'un agent ne prive pas les autres de leur tour. Le premier
         * jet remontait l'erreur jusqu'au battement, et une seule exception
         * suspendait toute l'agence pour ce tour-là — un défaut invisible,
         * puisque le journal se contentait de dire « battement interrompu ».
         */
        await this.log(ventureId, 'battement', `${agent.role} n'a pas pu jouer son tour : ${error instanceof Error ? error.message : '—'}`);
      }
    }
  }

  /** Ceux que le chantier fait déjà travailler : on ne les dérange pas. */
  private async workingAgents(ventureName: string): Promise<Set<string>> {
    try {
      const result = await this.env.DB.prepare(
        `SELECT DISTINCT agent_id FROM worksite_tasks WHERE venture_name = ? AND status = 'doing' AND agent_id IS NOT NULL`
      )
        .bind(ventureName)
        .all();
      return new Set(((result?.results ?? []) as any[]).map((row) => String(row.agent_id)));
    } catch {
      return new Set();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Le tour d'un agent                                                  */
  /* ------------------------------------------------------------------ */

  /**
   * L'ordre est déterministe : aucun appel au modèle pour choisir quoi faire.
   * Le modèle n'écrit que le contenu de l'action retenue.
   *
   * Répondre à ceux qui attendent passe avant tout : c'est ce qui fait qu'une
   * question posée obtient une réponse au lieu de rester en l'air.
   */
  private async turn(
    ventureId: string,
    ventureName: string,
    agent: AgencyAgent,
    roster: AgencyAgent[],
    key: string
  ): Promise<void> {
    const waiting = await pendingFor(this.env.DB, ventureId, agent.id);
    if (waiting.length > 0) {
      await this.answer(ventureId, agent, roster, waiting[0], key);
      return;
    }

    const received = await answersFor(this.env.DB, ventureId, agent.id);
    await this.initiative(ventureId, ventureName, agent, roster, received, key);
  }

  /** Répondre à un subordonné, ou faire monter quand on ne sait pas trancher. */
  private async answer(
    ventureId: string,
    agent: AgencyAgent,
    roster: AgencyAgent[],
    request: RequestRow,
    key: string
  ): Promise<void> {
    const chief = responsableDe(agent, roster);

    const result = await this.speak(
      agent,
      key,
      [
        `[DEMANDE] ${request.fromName} te demande : « ${request.subject} »`,
        request.body ? `[DÉTAIL] ${request.body}` : '',
        '',
        `Tu es ${agent.role}. Réponds à ta charge, pas au-delà.`,
        "Si tu sais quoi lui faire faire, donne-lui une consigne exécutable en une session : un intitulé, un résultat attendu.",
        chief
          ? `Si la décision te dépasse, fais remonter à ${chief.role} en disant pourquoi.`
          : "Tu es au sommet : tranche, ou dis franchement que la question doit revenir au CEO.",
        '',
        'Réponds UNIQUEMENT par un objet JSON :',
        '{"action":"repondre|remonter","reponse":"…","motif":"…"}'
      ]
        .filter(Boolean)
        .join('\n')
    );

    const parsed = parseModelJson(result, agent.role) as { action?: string; reponse?: string; motif?: string };
    const action = String(parsed?.action ?? 'repondre');

    if (action.startsWith('remont') && chief) {
      await escalate(this.env.DB, request.id, chief.id, chief.role, String(parsed?.motif ?? 'Décision hors de ma portée.'));
      await this.log(ventureId, 'demande', `${agent.role} fait remonter « ${request.subject} » à ${chief.role}.`);
      return;
    }

    const answer = String(parsed?.reponse ?? '').trim() || 'Pas de consigne particulière pour le moment.';
    await answerRequest(this.env.DB, request.id, answer);
    await this.log(ventureId, 'demande', `${agent.role} répond à ${request.fromName} : ${answer.slice(0, 100)}`);
  }

  /**
   * Rien n'attend : l'agent agit selon son rang, et pas au-delà.
   *
   * `passer_son_tour` est une réponse valable, explicitement offerte. Sans elle,
   * un agent sans travail en invente, et l'agence s'occupe au lieu d'avancer.
   */
  private async initiative(
    ventureId: string,
    ventureName: string,
    agent: AgencyAgent,
    roster: AgencyAgent[],
    received: RequestRow[],
    key: string
  ): Promise<void> {
    const rights = rightsOf(agent);
    const chief = responsableDe(agent, roster);
    const team = subordonnesDe(agent, roster);

    const options = [
      chief ? '- "demander" : demander une directive à ton responsable' : '',
      chief ? '- "signaler" : lui signaler un blocage' : '',
      rights.creerTache !== 'non' ? '- "tache" : créer une tâche (pour toi ou ton équipe)' : '',
      rights.convoquer !== 'non' ? '- "reunion" : convoquer une réunion' : '',
      '- "rien" : passer ton tour'
    ].filter(Boolean);

    const { day, hour } = await agencyNow(this.env.DB);

    /*
     * Ce qui est déjà au calendrier.
     *
     * Sans cette ligne, un agent reproposait la même réunion à chaque tour :
     * elle était refusée comme doublon, mais l'appel au modèle, lui, était bien
     * payé. Un agent qui sait ce qui est prévu ne le redemande pas.
     */
    const planned = (await meetingsOf(this.env.DB, ventureId, 12)).filter((entry) => entry.status === 'prevu');

    const result = await this.speak(
      agent,
      key,
      [
        `[PRODUIT] ${ventureName}`,
        `[QUAND] jour ${day}, ${hour} h`,
        `[TOI] ${agent.role}`,
        planned.length > 0
          ? `[DÉJÀ AU CALENDRIER] ${planned.map((entry) => `« ${entry.title} » (${entry.organiserName}, jour ${entry.day})`).join(' · ')}`
          : '',
        chief ? `[TON RESPONSABLE] ${chief.role}` : '[TU ES AU SOMMET]',
        team.length > 0 ? `[TON ÉQUIPE] ${team.map((entry) => entry.role).join(', ')}` : '',
        received.length > 0
          ? `[CE QU'ON T'A RÉPONDU]\n${received.map((entry) => `${entry.toName} : ${entry.answer ?? ''}`).join('\n')}`
          : '',
        '',
        "Tu n'as rien en cours. Que fais-tu, à ta place dans l'agence ?",
        "Tu ne t'attribues pas une mission de ton propre chef : si tu ne sais pas quoi faire, demande.",
        // Une consigne reçue et non transformée en travail est une consigne
        // perdue : c'est ce qui faisait reposer indéfiniment la même question.
        received.length > 0
          ? "On vient de te répondre : agis en conséquence. Ne repose pas la question que l'on vient de te régler."
          : '',
        received.length > 0 && rights.creerTache !== 'non'
          ? 'Transforme cette consigne en tâche concrète plutôt que de la garder pour toi.'
          : '',
        '',
        'Actions possibles :',
        ...options,
        '',
        "Passer ton tour est une réponse honnête : ne fabrique pas de travail pour t'occuper.",
        '',
        'Réponds UNIQUEMENT par un objet JSON :',
        '{"action":"…","sujet":"…","detail":"…","participants":["id"]}'
      ]
        .filter(Boolean)
        .join('\n')
    );

    const parsed = parseModelJson(result, agent.role) as {
      action?: string;
      sujet?: string;
      detail?: string;
      participants?: string[];
    };
    const action = String(parsed?.action ?? 'rien').toLowerCase();
    const subject = String(parsed?.sujet ?? '').trim();
    const detail = String(parsed?.detail ?? '').trim();

    if (action.startsWith('rien') || subject.length < 4) return;

    if ((action.startsWith('demand') || action.startsWith('signal')) && chief) {
      const posted = await ask(this.env.DB, {
        ventureId,
        fromId: agent.id,
        fromName: agent.role,
        toId: chief.id,
        toName: chief.role,
        kind: action.startsWith('signal') ? 'blocage' : 'directive',
        subject,
        body: detail
      });
      if (posted) await this.log(ventureId, 'demande', `${agent.role} → ${chief.role} : ${subject}`);
      return;
    }

    if (action.startsWith('tache') && rights.creerTache !== 'non') {
      const owner = team.find((entry) => entry.id === parsed?.participants?.[0]) ?? agent;
      const now = Date.now();
      await this.env.DB.prepare(
        `INSERT INTO worksite_tasks (id, run_id, venture_name, phase, title, detail, status, agent_id, agent_name, priority, created_at, updated_at)
         VALUES (?, '', ?, 'discovery', ?, ?, 'todo', ?, ?, 'moyenne', ?, ?)`
      )
        .bind(
          `wt-${now.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
          ventureName,
          subject.slice(0, 200),
          `${detail}\n\nCréée par ${agent.role}.`.trim().slice(0, 2000),
          owner.id,
          owner.role,
          now,
          now
        )
        .run();
      await this.log(ventureId, 'tache', `${agent.role} crée « ${subject} » pour ${owner.role}.`);
      return;
    }

    if (action.startsWith('reunion') && rights.convoquer !== 'non') {
      const invited = (parsed?.participants ?? [])
        .map((id) => roster.find((entry) => entry.id === id))
        .filter((entry): entry is AgencyAgent => !!entry && entry.id !== agent.id)
        .slice(0, 4);
      const withTeam = invited.length > 0 ? invited : team.slice(0, 2);
      if (withTeam.length === 0) return;

      const slot = Math.max(WORK_START, Math.min(WORK_END - 1, hour + 1));
      const { meeting, error } = await scheduleMeeting(this.env.DB, {
        ventureId,
        ventureName,
        title: subject.slice(0, 160),
        kind: 'revue',
        topic: detail || subject,
        organiserId: agent.id,
        organiserName: agent.role,
        participantIds: withTeam.map((entry) => entry.id),
        day: slot > hour ? day : day + 1,
        hour: slot,
        duration: 1
      });
      await this.log(
        ventureId,
        'reunion',
        meeting ? `${agent.role} convoque « ${subject} » (${meeting.room}).` : `Réunion refusée : ${error}`
      );
    }
  }

  /* ------------------------------------------------------------------ */
  /* Outillage                                                           */
  /* ------------------------------------------------------------------ */

  private async speak(agent: AgencyAgent, key: string, prompt: string, tools: AgentTool[] = []): Promise<string> {
    const result = await runAgent(
      {
        id: agent.id,
        role: agent.role,
        model: agent.modelId ?? 'google/gemini-2.5-flash',
        ame: agent.ameMd,
        job: agent.jobMd,
        temperature: agent.temperature ?? 0.4,
        maxTokens: agent.maxTokens,
        maxSteps: 1,
        tools
      },
      prompt,
      { openRouterKey: key }
    );
    return result.text ?? '';
  }

  /**
   * Le journal du battement rejoint celui du chantier.
   *
   * Le flux d'événements existe déjà et le navigateur l'écoute : y verser ces
   * lignes les affiche sans qu'aucun écran ne change.
   */
  private async log(ventureId: string, kind: string, message: string): Promise<void> {
    try {
      const row = await this.env.DB.prepare(
        'SELECT id FROM worksite_runs WHERE venture_id = ? ORDER BY started_at DESC LIMIT 1'
      )
        .bind(ventureId)
        .first();
      const runId = row ? String((row as any).id) : `agence:${ventureId}`;
      await this.env.DB.prepare(
        'INSERT INTO worksite_events (run_id, at, kind, message, payload) VALUES (?, ?, ?, ?, NULL)'
      )
        .bind(runId, Date.now(), kind, message.slice(0, 500))
        .run();
    } catch {
      /* le journal n'est pas une raison d'arrêter l'agence */
    }
  }

  private json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }
}
