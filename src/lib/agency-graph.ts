/**
 * L'organisation de l'agence, vue du serveur.
 *
 * Le graphe se construit dans le studio : niveaux, équipes, modèles, Âme.md et
 * Job.md. Il vivait dans le navigateur, donc le serveur l'ignorait — il faisait
 * travailler douze rôles livrés en dur pendant que le studio en affichait
 * vingt-six. L'état ayant déménagé en base, ce module va le chercher là où il
 * est désormais, sans en faire une seconde copie : le graphe reste **un**
 * document, pas une table de plus qui divergerait de lui.
 *
 * Il répond aussi à la question que personne n'avait posée jusqu'ici : **qui est
 * le responsable de qui ?** Aucun agent ne le déclare. Il faut le déduire — et
 * la déduction naïve casse dès le graphe livré.
 */

import { SHARED_ROLES } from './agent-roster';
import { HIERARCHY_ROWS, normalizeLevel, type HierarchyRow } from './hierarchy';
import { readOne } from './state-store';

export interface AgencyAgent {
  id: string;
  role: string;
  level: HierarchyRow;
  teamId?: string;
  teamName?: string;
  category?: string;
  modelId?: string;
  description?: string;
  temperature?: number;
  maxTokens?: number;
  ameMd?: string;
  jobMd?: string;
}

/**
 * Les clés successives du graphe.
 *
 * Le studio a changé de version plusieurs fois sans migration : on lit la plus
 * récente qui contienne quelque chose, comme le fait déjà le navigateur.
 */
const GRAPH_KEYS = ['omniventure_custom_agents_v5', 'omniventure_custom_agents_v4', 'omniventure_custom_agents_v3'];

const toAgent = (raw: any): AgencyAgent => ({
  id: String(raw?.id ?? ''),
  role: String(raw?.role ?? raw?.name ?? 'Agent'),
  level: normalizeLevel(raw?.hierarchyLevel),
  teamId: raw?.teamId ? String(raw.teamId) : undefined,
  teamName: raw?.teamName ? String(raw.teamName) : undefined,
  category: raw?.category ? String(raw.category) : undefined,
  modelId: raw?.modelId ? String(raw.modelId) : undefined,
  description: raw?.description ? String(raw.description) : undefined,
  temperature: typeof raw?.temperature === 'number' ? raw.temperature : undefined,
  maxTokens: typeof raw?.maxTokens === 'number' ? raw.maxTokens : undefined,
  ameMd: raw?.ameMd ? String(raw.ameMd) : undefined,
  jobMd: raw?.jobMd ? String(raw.jobMd) : undefined
});

/** Le roster livré, quand la base n'a encore rien. */
export const defaultAgency = (): AgencyAgent[] => SHARED_ROLES.map(toAgent).filter((agent) => agent.id);

/**
 * Le graphe tel que le studio l'a laissé, ou celui livré à défaut.
 *
 * On ne se fie pas au niveau écrit tel quel : le générateur par IA et l'import
 * .zip produisent « C-Level », « Worker », « Vice President ». `normalizeLevel`
 * les reconnaît tous — c'est le même correctif qui avait rendu le graphe
 * affichable.
 */
export async function readAgency(db: any): Promise<AgencyAgent[]> {
  if (!db) return defaultAgency();

  for (const key of GRAPH_KEYS) {
    try {
      const raw = await readOne(db, key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) continue;
      const agents = parsed.map(toAgent).filter((agent) => agent.id && agent.role);
      if (agents.length > 0) return agents;
    } catch {
      /* entrée illisible : on essaie la clé précédente */
    }
  }

  return defaultAgency();
}

/* ------------------------------------------------------------------ */
/* La chaîne hiérarchique                                              */
/* ------------------------------------------------------------------ */

/** Du plus haut au plus bas. `autre` ferme la marche : on ne remonte pas vers lui. */
const RANKS: HierarchyRow[] = HIERARCHY_ROWS.filter((row) => row !== 'autre');

const rankOf = (level: HierarchyRow): number => {
  const index = RANKS.indexOf(level);
  /*
   * Un niveau non reconnu est logé au rang des experts, pas en dessous. Le
   * mettre plus bas lui aurait donné un expert pour responsable — or un expert
   * n'encadre personne, et un agent mal classé doit remonter à un lead comme
   * les autres.
   */
  return index === -1 ? RANKS.length - 1 : index;
};

/**
 * Le responsable d'un agent.
 *
 * La règle évidente — « le niveau juste au-dessus, dans mon équipe » — ne tient
 * pas trois secondes sur le graphe livré : `frontend_agent` est *lead* dans une
 * équipe sans *head of*, et il n'existe aucun VP.
 *
 * Le premier essai remontait niveau par niveau en préférant, à chaque niveau,
 * la même équipe. Résultat : le lead front-end se retrouvait rattaché au
 * Product Manager — le seul *head of* dans l'ordre de la liste — plutôt qu'à
 * son propre CTO. C'était privilégier la proximité de rang sur l'appartenance,
 * l'inverse de ce que dit un organigramme.
 *
 * On cherche donc d'abord **le plus proche au-dessus de soi dans sa propre
 * équipe**, quitte à sauter des niveaux ; puis dans sa catégorie ; puis
 * n'importe où. Un C-Level n'a pas de responsable — au-dessus de lui, c'est vous.
 */
export function responsableDe(agent: AgencyAgent, roster: AgencyAgent[]): AgencyAgent | null {
  const mine = rankOf(agent.level);
  if (mine <= 0) return null;

  const above = roster.filter((entry) => entry.id !== agent.id && rankOf(entry.level) < mine);
  if (above.length === 0) return null;

  /** Le plus bas des supérieurs d'un ensemble : on ne saute pas la ligne. */
  const closest = (pool: AgencyAgent[]): AgencyAgent | undefined =>
    [...pool].sort((a, b) => rankOf(b.level) - rankOf(a.level))[0];

  if (agent.teamId) {
    const team = closest(above.filter((entry) => entry.teamId === agent.teamId));
    if (team) return team;
  }
  if (agent.category) {
    const family = closest(above.filter((entry) => entry.category === agent.category));
    if (family) return family;
  }
  return closest(above) ?? null;
}

/** Ceux dont un agent a la charge : l'inverse exact de `responsableDe`. */
export const subordonnesDe = (agent: AgencyAgent, roster: AgencyAgent[]): AgencyAgent[] =>
  roster.filter((entry) => responsableDe(entry, roster)?.id === agent.id);

/**
 * Ce qu'un niveau a le droit de faire de sa propre initiative.
 *
 * Un expert ne s'attribue pas une mission : il demande. C'est ce qui distingue
 * une agence d'une foule d'agents qui décident chacun dans leur coin.
 */
export interface Rights {
  /** Créer des tâches, et pour qui. */
  creerTache: 'non' | 'soi-et-equipe' | 'pole';
  /** Convoquer une réunion, et jusqu'où. */
  convoquer: 'non' | 'equipe' | 'pole' | 'agence';
  /** Écrire dans la feuille de route. */
  roadmap: boolean;
  /** Solliciter le CEO — vous. */
  saisirLeCeo: boolean;
}

export const RIGHTS: Record<HierarchyRow, Rights> = {
  expert: { creerTache: 'non', convoquer: 'non', roadmap: false, saisirLeCeo: false },
  autre: { creerTache: 'non', convoquer: 'non', roadmap: false, saisirLeCeo: false },
  lead: { creerTache: 'soi-et-equipe', convoquer: 'equipe', roadmap: false, saisirLeCeo: false },
  head_of: { creerTache: 'pole', convoquer: 'pole', roadmap: false, saisirLeCeo: false },
  vp: { creerTache: 'pole', convoquer: 'agence', roadmap: true, saisirLeCeo: false },
  c_level: { creerTache: 'pole', convoquer: 'agence', roadmap: true, saisirLeCeo: true }
};

export const rightsOf = (agent: AgencyAgent): Rights => RIGHTS[agent.level] ?? RIGHTS.autre;
