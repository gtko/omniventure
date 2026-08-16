/**
 * L'agenda de l'agence, côté serveur.
 *
 * Les réunions étaient dans le navigateur : celles que les agents convoquent
 * d'eux-mêmes, depuis que le battement existe, y étaient donc invisibles. Deux
 * agendas coexistaient — le vôtre et le leur.
 *
 * Celui-ci est le seul. Il sert aussi ce qui remonte jusqu'à vous : une demande
 * adressée au CEO n'est pas une tâche de plus, c'est une décision qui sort de
 * l'agence et qu'elle ne peut pas prendre seule.
 */

import type { APIRoute } from 'astro';
import { readAgency } from '../../lib/agency-graph';
import { holdMeeting } from '../../lib/agency-meeting';
import {
  agencyNow,
  answerRequest,
  dueMeetings,
  meetingsOf,
  scheduleMeeting,
  setMeetingStatus
} from '../../lib/agency-store';
import { resolveOpenRouterKey } from '../../lib/openrouter-key';

export const prerender = false;

export const GET: APIRoute = async ({ url, locals }) => {
  const env = (locals as any)?.runtime?.env;
  const ventureId = url.searchParams.get('ventureId') ?? '';
  if (!env?.DB || !ventureId) return json({ meetings: [], ceo: [], now: { day: 1, hour: 9 } });

  try {
    const [meetings, due, now] = await Promise.all([
      meetingsOf(env.DB, ventureId),
      dueMeetings(env.DB, ventureId),
      agencyNow(env.DB)
    ]);

    // Ce qui vous attend, vous : les demandes qu'un C-Level a fait remonter.
    const ceo = await env.DB.prepare(
      `SELECT * FROM agency_requests WHERE venture_id = ? AND to_id = 'ceo' AND status = 'attente' ORDER BY created_at DESC`
    )
      .bind(ventureId)
      .all();

    return json({
      meetings,
      due: due.map((entry) => entry.id),
      ceo: (ceo?.results ?? []).map((row: any) => ({
        id: String(row.id),
        from: String(row.from_name ?? ''),
        subject: String(row.subject),
        body: String(row.body ?? ''),
        at: Number(row.created_at ?? 0)
      })),
      now
    });
  } catch (error) {
    return json({ meetings: [], ceo: [], now: { day: 1, hour: 9 }, error: String(error) });
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any)?.runtime?.env;
  if (!env?.DB) return json({ error: 'Base indisponible.' }, 503);

  const body = (await request.json().catch(() => ({}))) as any;
  const action = String(body?.action ?? '');
  const ventureId = String(body?.ventureId ?? '');
  if (!ventureId) return json({ error: 'Produit manquant.' }, 400);

  try {
    if (action === 'convoquer') {
      const roster = await readAgency(env.DB);
      const organiser = roster.find((agent) => agent.id === body?.organiserId) ?? roster[0];
      const now = await agencyNow(env.DB);
      const { meeting, error } = await scheduleMeeting(env.DB, {
        ventureId,
        ventureName: String(body?.ventureName ?? ''),
        title: String(body?.title ?? 'Réunion'),
        kind: String(body?.kind ?? 'revue'),
        topic: String(body?.topic ?? ''),
        organiserId: organiser?.id ?? 'ceo',
        organiserName: organiser?.role ?? 'CEO',
        participantIds: Array.isArray(body?.participantIds) ? body.participantIds.map(String) : [],
        day: Number(body?.day) || now.day,
        hour: Number(body?.hour) || Math.max(9, now.hour),
        duration: Math.max(1, Math.min(4, Number(body?.duration) || 1))
      });
      return json(meeting ? { meeting } : { error });
    }

    if (action === 'tenir') {
      const key = await resolveOpenRouterKey(env, body?.openRouterKey);
      if (!key) return json({ error: 'Clé OpenRouter absente.' }, 400);

      const meetings = await meetingsOf(env.DB, ventureId);
      const meeting = meetings.find((entry) => entry.id === body?.meetingId);
      if (!meeting) return json({ error: 'Réunion introuvable.' }, 404);

      const result = await holdMeeting({
        db: env.DB,
        meeting,
        roster: await readAgency(env.DB),
        openRouterKey: key
      });
      return json({ held: true, outcomes: result.outcomes.length });
    }

    if (action === 'annuler') {
      await setMeetingStatus(env.DB, String(body?.meetingId ?? ''), 'annule');
      return json({ cancelled: true });
    }

    if (action === 'repondre') {
      await answerRequest(env.DB, String(body?.requestId ?? ''), String(body?.answer ?? ''));
      return json({ answered: true });
    }

    return json({ error: `Action inconnue : ${action}` }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Échec' }, 500);
  }
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
