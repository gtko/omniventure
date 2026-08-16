/**
 * Remettre un projet au premier jour.
 *
 * Un projet accumule : des tâches, des livrables, des réunions, des sprints,
 * une feuille de route, un état de chantier. Quand on veut recommencer — parce
 * que la direction était mauvaise, ou simplement pour rejouer proprement — il
 * n'y avait aucun moyen de le faire sans vider le stockage du navigateur, ce
 * qui emportait aussi les autres produits.
 *
 * L'opération est destructive et le reste : elle ne se rattrape pas. D'où le
 * décompte préalable — on montre exactement ce qui va disparaître, et on laisse
 * le choix de garder le dossier de lancement et la feuille de route, qui sont
 * du travail de réflexion, pas du travail d'exécution.
 */

import { readAgenda, type Meeting } from './agenda';
import { readLedger, type LedgerEntry } from './agent-ledger';
import { readArtifacts, type Artifact } from './artifacts';
import { resetLifecycle } from './lifecycle';
import { readRoadmap, type RoadmapItem } from './roadmap';
import { readSprints, type Sprint } from './sprint';
import { readDocs, readTasks, writeDocs, writeTasks, type Doc, type Task } from './workspace';

export interface ResetOptions {
  /** Garder le dossier de lancement : c'est l'instruction d'origine. */
  keepDossier: boolean;
  /** Garder la feuille de route : c'est une décision, pas une exécution. */
  keepRoadmap: boolean;
}

export interface ResetCount {
  tasks: number;
  artifacts: number;
  chantierDocs: number;
  dossierDocs: number;
  roadmap: number;
  sprints: number;
  meetings: number;
  ledger: number;
}

/** Est-ce qu'un document appartient au chantier de ce produit ? */
const isChantier = (doc: Doc, name: string) =>
  doc.path.startsWith(`Chantier/${name}`) ||
  doc.path === `Spécifications/${name}` ||
  doc.path === `Contenus/${name}` ||
  doc.path === `Décisions/${name}` ||
  doc.path === `Documentation/${name}`;

const isDossier = (doc: Doc, name: string) => doc.path === `Produits/${name}`;

/** Ce que la remise à zéro supprimerait, sans rien supprimer. */
export function previewReset(ventureName: string): ResetCount {
  const docs = readDocs();
  return {
    tasks: readTasks().filter((task: Task) => task.source === ventureName).length,
    artifacts: readArtifacts().filter((entry: Artifact) => entry.ventureName === ventureName).length,
    chantierDocs: docs.filter((doc) => isChantier(doc, ventureName)).length,
    dossierDocs: docs.filter((doc) => isDossier(doc, ventureName)).length,
    roadmap: readRoadmap().filter((item: RoadmapItem) => item.ventureName === ventureName).length,
    sprints: readSprints().filter((sprint: Sprint) => sprint.ventureName === ventureName).length,
    meetings: readAgenda().filter((meeting: Meeting) => meeting.ventureName === ventureName).length,
    ledger: readLedger().filter((entry: LedgerEntry) => entry.ventureName === ventureName).length
  };
}

/**
 * Remet le projet au premier jour.
 *
 * Le produit lui-même — son nom, son domaine, ses tarifs — n'est pas touché :
 * on remet à zéro son travail, pas son existence. Pour le supprimer, il y a la
 * liste des projets.
 */
export function resetVenture(
  venture: { id: string; name: string },
  options: ResetOptions = { keepDossier: true, keepRoadmap: false }
): ResetCount {
  const before = previewReset(venture.name);
  const { id, name } = venture;

  writeTasks(readTasks().filter((task) => task.source !== name));

  writeDocs(
    readDocs().filter((doc) => {
      if (isChantier(doc, name)) return false;
      if (isDossier(doc, name)) return options.keepDossier;
      // Les réunions et les rétrospectives du produit s'en vont avec lui.
      if (doc.path.startsWith('Réunions/') && doc.body.includes(name)) return false;
      return true;
    })
  );

  drop('omniventure_artifacts_v1', (entry: any) => entry?.ventureName !== name);
  drop('omniventure_sprints_v1', (entry: any) => entry?.ventureName !== name);
  drop('omniventure_agenda_v1', (entry: any) => entry?.ventureName !== name);
  drop('omniventure_ledger_v1', (entry: any) => entry?.ventureName !== name);
  if (!options.keepRoadmap) drop('omniventure_roadmap_v1', (entry: any) => entry?.ventureName !== name);

  // L'état du chantier n'est effacé que s'il porte sur ce produit : un autre
  // projet peut très bien être en cours.
  try {
    const raw = localStorage.getItem('omniventure_worksite_v2');
    if (raw && (JSON.parse(raw) as any)?.ventureId === id) localStorage.removeItem('omniventure_worksite_v2');
  } catch {
    /* état illisible : il sera régénéré */
  }

  resetLifecycle(id);

  // Les rituels reprennent leur cadence à zéro, sinon leur repère « déjà
  // programmé ce jour-là » empêcherait le prochain sprint de poser les siens.
  try {
    const raw = localStorage.getItem('omniventure_rituals_v1');
    if (raw) {
      const rituals = JSON.parse(raw) as any[];
      localStorage.setItem(
        'omniventure_rituals_v1',
        JSON.stringify(rituals.map((ritual) => ({ ...ritual, lastDay: undefined })))
      );
    }
  } catch {
    /* rituels illisibles : ils reviendront à leurs valeurs livrées */
  }

  for (const event of [
    'omniventure_workspace_updated',
    'omniventure_artifacts_updated',
    'omniventure_sprints_updated',
    'omniventure_agenda_updated',
    'omniventure_roadmap_updated',
    'omniventure_ledger_updated',
    'omniventure_worksite_updated',
    'omniventure_lifecycle_updated',
    'omniventure_rituals_updated'
  ]) {
    window.dispatchEvent(new CustomEvent(event));
  }

  return before;
}

/** Filtre une liste stockée, en laissant le reste intact. */
function drop(key: string, keep: (entry: any) => boolean): void {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    localStorage.setItem(key, JSON.stringify(parsed.filter(keep)));
  } catch {
    /* entrée illisible : on n'y touche pas */
  }
}
