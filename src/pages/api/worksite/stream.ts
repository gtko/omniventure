/**
 * Le flux du chantier.
 *
 * Le navigateur s'abonne et reçoit ce qui se passe : les tâches prises, les
 * livrables rendus, les passations, les échecs. Il ne pilote rien.
 *
 * Le journal étant en base, une page rechargée reprend là où elle en était :
 * elle annonce le dernier événement qu'elle connaît (`Last-Event-ID`, que le
 * navigateur renvoie tout seul à la reconnexion) et reçoit la suite. C'est
 * précisément ce qui manquait — l'onglet n'est plus le propriétaire du travail,
 * juste une fenêtre dessus.
 */

import type { APIRoute } from 'astro';
import { eventsSince, runById, latestRun } from '../../../lib/worksite-store';

export const prerender = false;

/** Cadence de relecture du journal. Assez vive pour paraître direct. */
const POLL_MS = 1200;
/**
 * Durée maximale d'un abonnement.
 *
 * Un Worker ne tient pas une connexion indéfiniment. On rend la main avant
 * d'être coupé ; le navigateur se reconnecte de lui-même avec son dernier
 * identifiant, sans rien perdre.
 */
const MAX_MS = 4 * 60 * 1000;

export const GET: APIRoute = async ({ url, request, locals }) => {
  const env = (locals as any)?.runtime?.env;
  const ventureId = url.searchParams.get('ventureId') ?? '';
  if (!env?.DB) return new Response('D1 indisponible', { status: 503 });

  const asked = url.searchParams.get('run');
  const run = asked ? await runById(env.DB, asked) : await latestRun(env.DB, ventureId);
  if (!run) return new Response('Aucun chantier', { status: 404 });

  const resumeFrom = Number(request.headers.get('Last-Event-ID') ?? url.searchParams.get('since') ?? 0) || 0;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const startedAt = Date.now();
      let lastId = resumeFrom;
      let closed = false;

      const send = (event: string, data: unknown, id?: number) => {
        if (closed) return;
        const lines = [
          id != null ? `id: ${id}` : '',
          `event: ${event}`,
          `data: ${JSON.stringify(data)}`,
          '',
          ''
        ]
          .filter((line, index) => line !== '' || index > 0)
          .join('\n');
        controller.enqueue(encoder.encode(lines));
      };

      // L'état complet d'abord : une page qui arrive doit tout savoir sans
      // attendre le prochain événement.
      send('etat', await runById(env.DB, run.id));

      try {
        while (!closed && Date.now() - startedAt < MAX_MS) {
          const events = await eventsSince(env.DB, run.id, lastId);
          for (const entry of events) {
            lastId = entry.id;
            send('journal', entry, entry.id);
          }

          const current = await runById(env.DB, run.id);
          if (current) send('etat', current);

          if (!current || current.status !== 'en-cours') {
            send('fin', { status: current?.status ?? 'inconnu' });
            break;
          }

          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        }
      } catch {
        /* le client est parti : rien à signaler */
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* déjà fermé */
        }
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  });
};
