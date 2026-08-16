/**
 * La chaîne de valeur d'un produit.
 *
 * Une file de tâches à plat ne fait pas une entreprise : le designer ne peut
 * pas maquetter avant que le PM ait spécifié, et le PM ne peut pas spécifier
 * avant que la direction ait tranché. Ce fichier écrit cet ordre, et surtout
 * les **passations** — le moment où le responsable de l'étape suivante lit ce
 * qui vient d'être produit et en tire son propre travail.
 *
 * La chaîne se referme : la mesure ne conclut pas, elle rouvre la discovery.
 * C'est ce qui distingue un produit vivant d'un projet livré une fois.
 *
 *   vision → discovery → design → build → deploy → measure ─┐
 *      ▲                                                     │
 *      └──────────────── boucle d'amélioration ──────────────┘
 */

import type { ArtifactKind } from './artifacts';

export type PhaseId = 'vision' | 'discovery' | 'design' | 'build' | 'deploy' | 'measure';

export interface Phase {
  id: PhaseId;
  label: string;
  icon: string;
  /** Qui tient l'étape — le premier de la liste présent dans le graphe. */
  owners: string[];
  /** Ce que l'étape suivante attend : dit à l'agent qui exécute la tâche. */
  deliverable: string;
  /**
   * Ce que l'étape doit **fabriquer**, pas décrire.
   *
   * Un compte rendu bien tourné n'est pas un livrable : la chaîne vérifie
   * qu'un artefact de l'une de ces natures existe réellement avant de
   * considérer la tâche comme faite.
   */
  produces: ArtifactKind[];
  /** Étape suivante, ou null si la boucle décide de la suite. */
  next: PhaseId | null;
  /**
   * Consigne de passation : ce que le responsable de l'étape suivante doit
   * tirer des livrables de celle-ci. C'est le cœur du dispositif — sans ça,
   * chaque étape produirait dans le vide.
   */
  handoff: string;
}

export const PHASES: Phase[] = [
  {
    id: 'vision',
    label: 'Vision',
    icon: '🧭',
    owners: ['cpo_agent', 'cto_agent', 'master', 'planner'],
    produces: ['memo'] as ArtifactKind[],
    deliverable:
      'la directive produit : la cible, le problème résolu mieux que les concurrents, trois résultats visés avec leur mesure, et ce qui est explicitement hors périmètre. Puis le cadre technique : pile retenue, contraintes non négociables, dette acceptée.',
    next: 'discovery',
    handoff:
      "Tu es Product Manager. À partir de la directive produit et du cadre technique ci-dessus, découpe le travail de discovery : un élément par fonctionnalité à spécifier. Chaque élément doit être spécifiable seul, en une session."
  },
  {
    id: 'discovery',
    label: 'Discovery',
    icon: '🔍',
    owners: ['pm_agent', 'market_agent', 'planner'],
    produces: ['spec'] as ArtifactKind[],
    deliverable:
      "la spécification : problème utilisateur, parcours attendu écran par écran, critères d'acceptation vérifiables, hors périmètre de l'itération. Nomme les écrans dont le design aura besoin.",
    next: 'design',
    handoff:
      "Tu es Head of Design. À partir des spécifications ci-dessus, liste le travail de design : un élément par écran, composant ou visuel à PRODUIRE — des images, pas des notes de cadrage. Si la marque n'a pas encore de logo, mets-le en premier. Ne liste que ce que les spécifications réclament vraiment."
  },
  {
    id: 'design',
    label: 'Design',
    icon: '🎨',
    owners: ['design_lead', 'ui_designer', 'graphic_agent', 'design_system_agent'],
    produces: ['maquette', 'design', 'visuel'] as ArtifactKind[],
    deliverable:
      "des images, pas des descriptions : le logo de la marque, l'aspect de chaque écran demandé, et les illustrations nécessaires — générés avec produire_visuel. Plus le design system (tokens et composants) quand il n'existe pas encore. Une maquette qu'on ne peut pas regarder ne sert à personne.",
    next: 'build',
    handoff:
      "Tu es Head of Architecture. À partir des maquettes et des spécifications ci-dessus, découpe le développement : un élément par unité livrable et testable. Sépare le back du front quand ça a du sens."
  },
  {
    id: 'build',
    label: 'Développement',
    icon: '⚙️',
    owners: ['lead_dev', 'frontend_agent', 'worker_dev'],
    produces: ['code'] as ArtifactKind[],
    deliverable:
      "le code de l'unité demandée, conforme aux critères d'acceptation, avec ce qu'il faut pour le vérifier.",
    next: 'deploy',
    handoff:
      "Tu es Head of DevOps. À partir de ce qui vient d'être développé, liste les étapes de mise en ligne : vérifications avant bascule, déploiement, contrôle après bascule, retour arrière possible."
  },
  {
    id: 'deploy',
    label: 'Mise en ligne',
    icon: '🚀',
    owners: ['devops_agent', 'lead_dev'],
    produces: ['code', 'memo'] as ArtifactKind[],
    deliverable: "la mise en ligne effectuée ou décrite pas à pas, avec le contrôle d'après bascule et la procédure de retour arrière.",
    next: 'measure',
    handoff:
      "Tu es responsable de la qualité et de la mesure. Liste ce qu'il faut vérifier et mesurer maintenant que c'est en ligne : recette fonctionnelle, écarts avec les résultats visés, points de friction dans le parcours."
  },
  {
    id: 'measure',
    label: 'Mesure & QA',
    icon: '📊',
    owners: ['qa_agent', 'cro_agent', 'data_agent', 'sentiment_agent'],
    produces: ['mesure', 'article'] as ArtifactKind[],
    deliverable:
      "le constat mesuré : ce qui marche, ce qui ne marche pas, l'écart chiffré avec le résultat visé, et la friction la plus coûteuse. Pas d'avis sans chiffre ou sans observation.",
    // Fin de chaîne : c'est la boucle qui décide de rouvrir ou de s'arrêter.
    next: null,
    handoff:
      "Tu es CPO. À partir des constats de mesure ci-dessus, décide de la suite : liste les améliorations et les nouvelles fonctionnalités qui valent le prochain cycle, classées par impact sur les résultats visés. Écarte sans détour ce qui ne les sert pas."
  }
];

export const phaseById = (id: PhaseId): Phase => PHASES.find((phase) => phase.id === id) ?? PHASES[0];

export const phaseIndex = (id: PhaseId): number => PHASES.findIndex((phase) => phase.id === id);

/** Première étape de la chaîne à laquelle une tâche non classée est rattachée. */
export const DEFAULT_PHASE: PhaseId = 'discovery';

/**
 * Demande de passation adressée au responsable de l'étape suivante.
 *
 * On lui donne le projet, ce qui vient d'être produit, et on exige une liste
 * JSON : un texte libre serait joli et inexploitable.
 */
export function handoffPrompt(phase: Phase, ventureName: string, deliverables: string): string {
  return [
    `[PROJET] ${ventureName}`,
    '',
    `[CE QUI VIENT D'ÊTRE PRODUIT — étape « ${phase.label} »]`,
    deliverables.slice(0, 8000),
    '',
    phase.handoff,
    '',
    'Réponds UNIQUEMENT par un objet JSON, sans commentaire ni bloc de code :',
    '{"taches":[{"titre":"…","detail":"…","priorite":"urgente|haute|moyenne|basse"}]}',
    '',
    'Entre 2 et 6 tâches. Chaque titre tient en une ligne et dit ce qui doit exister à la fin.',
    "Si les livrables ci-dessus ne justifient aucune suite, renvoie une liste vide."
  ].join('\n');
}
