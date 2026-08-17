/**
 * Ce que le bureau montre vient de ce que le serveur fait.
 *
 * Le plateau 2D s'animait uniquement quand le navigateur travaillait : chaque
 * appel d'outil poussait une bulle au passage. Depuis que la chaîne et le
 * battement tournent côté serveur, ce navigateur ne travaille plus — et le
 * bureau était devenu un décor immobile pendant que l'agence, elle, avançait.
 *
 * Ce module rebranche les deux : il écoute le journal d'événements, et transforme
 * chaque ligne en bulle. Rien n'est stocké — c'est de l'affichage, dérivé de la
 * seule source de vérité.
 */

import { saveRealAgentLog } from './agent-bus';

interface JournalEntry {
  id: number;
  at: number;
  kind: string;
  message: string;
}

/** À quoi ressemble chaque genre d'événement au-dessus d'un personnage. */
const BUBBLE: Record<string, { icon: string; who: string }> = {
  demarrage: { icon: '▶', who: 'Direction' },
  etape: { icon: '📍', who: 'Chantier' },
  tache: { icon: '🔧', who: 'Chantier' },
  livraison: { icon: '📦', who: 'Chantier' },
  passation: { icon: '➜', who: 'Chantier' },
  reprise: { icon: '↻', who: 'Chantier' },
  'echec-tache': { icon: '⚠️', who: 'Chantier' },
  echec: { icon: '⛔', who: 'Chantier' },
  quota: { icon: '🛑', who: 'Chantier' },
  attente: { icon: '⏸', who: 'Chantier' },
  arret: { icon: '⏹', who: 'Direction' },
  fin: { icon: '✓', who: 'Chantier' },
  battement: { icon: '💓', who: 'Agence' },
  demande: { icon: '💬', who: 'Agence' },
  reunion: { icon: '🗣️', who: 'Agence' }
};

let stream: EventSource | null = null;
let watching: string | null = null;

/**
 * Suit le journal d'un produit et en fait des bulles.
 *
 * Le flux se reconnecte tout seul, et reprend au dernier événement reçu : rien
 * ne se perd quand on change de page.
 */
export function watchOffice(ventureId: string): void {
  if (typeof window === 'undefined' || watching === ventureId) return;
  stopOffice();
  watching = ventureId;

  try {
    stream = new EventSource(`/api/worksite/stream?ventureId=${encodeURIComponent(ventureId)}`);
  } catch {
    watching = null;
    return;
  }

  stream.addEventListener('journal', (event) => {
    try {
      const entry = JSON.parse((event as MessageEvent).data) as JournalEntry;
      const style = BUBBLE[entry.kind] ?? { icon: '·', who: 'Agence' };

      /*
       * Le message porte souvent « Rôle : ce qu'il fait ». On sépare pour que la
       * bulle s'affiche au-dessus du bon personnage plutôt qu'au-dessus d'un
       * « Agence » générique.
       */
      const [head, ...rest] = entry.message.split(' : ');
      const named = rest.length > 0 && head.length < 60;
      const who = named ? head : style.who;
      const said = readable(named ? rest.join(' : ') : entry.message);

      /*
       * Une réunion envoie les personnages en salle.
       *
       * Le plateau écoutait cet événement depuis la version navigateur de
       * `hold()`, qui ne tourne plus : les salles restaient vides pendant que
       * l'agence se réunissait pour de bon.
       */
      if (entry.kind === 'reunion') {
        window.dispatchEvent(
          new CustomEvent('omniventure_meeting_live', {
            detail: { room: 'Salle Nord', ids: [], titre: said.slice(0, 60) }
          })
        );
      }

      saveRealAgentLog({
        fromAgentId: who.toLowerCase().replace(/[^a-z]/g, '_').slice(0, 40),
        fromAgentName: who,
        toAgentId: 'master',
        toAgentName: 'Direction',
        actionSummary: entry.message.slice(0, 200),
        bubbleText: `${style.icon} ${said.slice(0, 38)}`,
        payloadSummary: said.slice(0, 300),
        costUsd: 0,
        modelUsed: ''
      });
    } catch {
      /* trame incomplète : la suivante arrivera */
    }
  });

  // Une fin de passage n'est pas une fin d'agence : on garde l'oreille tendue,
  // le battement continue de produire des événements.
  stream.addEventListener('error', () => undefined);
}

/**
 * Une bulle se lit d'un coup d'œil.
 *
 * Le journal garde le détail technique — c'est son rôle, on y cherche la cause
 * d'une panne. Mais au-dessus d'un personnage, une charge utile JSON brute
 * (« {"error":{"message":"Missing Authentic… ») n'apprend rien à personne.
 */
function readable(text: string): string {
  const trimmed = text.trim();
  const brace = trimmed.indexOf('{');
  const cleaned = brace >= 0 ? trimmed.slice(0, brace).trim() : trimmed;
  return cleaned.length >= 3 ? cleaned : 'incident technique';
}

export function stopOffice(): void {
  stream?.close();
  stream = null;
  watching = null;
}
