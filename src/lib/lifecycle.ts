/**
 * Où en est le produit, et ce que ça change pour ceux qui travaillent dessus.
 *
 * La chaîne de valeur dit *comment* on travaille, la feuille de route *quoi*
 * faire, le sprint *quand*. Il manquait la question qui commande les trois :
 * à quel moment de sa vie ce produit se trouve-t-il ?
 *
 * Un agent qui l'ignore travaille dans le vide. Optimiser un tunnel de
 * conversion avant d'avoir un produit qui marche est du gaspillage ; refondre
 * l'architecture d'une vache à lait qui rapporte sans effort est pire. Les
 * mêmes tâches, aux mêmes personnes, ont une valeur opposée selon l'étape.
 *
 * D'où ce fichier : des étapes avec un objectif unique, des sous-étapes avec un
 * critère de sortie vérifiable, et — surtout — ce qu'il faut **refuser de
 * faire** à chaque moment. Le refus est la partie utile : sans lui, chaque
 * étape déborde sur la suivante.
 */

import { stackFor, type StackId } from './stacks';
import { getStoredVentures } from './store';

export type StageId = 'mvp' | 'traction' | 'scale' | 'cash-cow' | 'sunset';

export interface SubStage {
  id: string;
  label: string;
  /** Ce qu'on cherche à obtenir. */
  goal: string;
  /** Comment on sait que c'est fini. Vérifiable, pas ressenti. */
  done: string;
}

export interface Stage {
  id: StageId;
  label: string;
  icon: string;
  /** La seule question qui compte à cette étape. */
  question: string;
  /** Ce sur quoi l'effort doit porter. */
  focus: string[];
  /** Ce qu'on refuse de faire maintenant, même si c'est tentant. */
  refuse: string[];
  subStages: SubStage[];
}

export const STAGES: Stage[] = [
  {
    id: 'mvp',
    label: 'MVP',
    icon: '🌱',
    question: 'Est-ce que ça marche, et est-ce que quelqu’un peut payer ?',
    focus: [
      'le parcours principal, de bout en bout, sans détour',
      'un encaissement qui fonctionne sans intervention humaine',
      'une mise en ligne réelle, à une adresse publique'
    ],
    refuse: [
      'les tests A/B : il n’y a pas encore de trafic à découper',
      'la montée en charge : personne ne vient encore',
      'les fonctionnalités secondaires, l’internationalisation, le mode sombre',
      'la refonte du design system : ce qui existe suffit à valider'
    ],
    subStages: [
      {
        id: 'construire',
        label: 'Construire le produit',
        goal: 'Le parcours principal fonctionne de bout en bout, pour de vrai.',
        done: 'Un inconnu peut accomplir la promesse du produit sans aide et sans bug bloquant.'
      },
      {
        id: 'paiement',
        label: 'Brancher le paiement',
        goal: 'Encaisser sans intervention humaine.',
        done: 'Un paiement de test aboutit, le webhook est reçu, l’accès s’ouvre automatiquement.'
      },
      {
        id: 'mise-en-ligne',
        label: 'Mettre en ligne',
        goal: 'Le produit existe à son adresse, accessible à tous.',
        done: 'Le domaine répond, le tunnel complet passe en production, la mesure remonte.'
      }
    ]
  },
  {
    id: 'traction',
    label: 'Traction',
    icon: '📈',
    question: 'Est-ce que des inconnus paient, et est-ce qu’ils restent ?',
    focus: [
      'les premiers clients payants qui ne sont pas des proches',
      'la rétention : reviennent-ils, et pourquoi',
      'un canal d’acquisition qu’on sait refaire'
    ],
    refuse: [
      'la publicité payante à grande échelle avant de connaître la rétention',
      'l’embauche : on ne recrute pas pour compenser un produit qui ne retient pas',
      'la dette technique qui ne gêne pas encore'
    ],
    subStages: [
      {
        id: 'premiers-clients',
        label: 'Premiers clients payants',
        goal: 'Vendre à des gens qu’on ne connaît pas.',
        done: 'Dix paiements provenant d’inconnus, sans geste commercial manuel.'
      },
      {
        id: 'retention',
        label: 'Comprendre la rétention',
        goal: 'Savoir qui reste, qui part, et pourquoi.',
        done: 'La rétention à trente jours est mesurée et la cause principale des départs est nommée.'
      },
      {
        id: 'canal',
        label: 'Trouver un canal répétable',
        goal: 'Un canal d’acquisition qu’on sait rejouer.',
        done: 'Un canal apporte des clients deux mois de suite avec un coût d’acquisition connu.'
      }
    ]
  },
  {
    id: 'scale',
    label: 'Passage à l’échelle',
    icon: '🚀',
    question: 'Est-ce qu’on peut mettre un euro et en récupérer trois ?',
    focus: [
      'l’acquisition payante, mesurée au coût d’acquisition',
      'la conversion : c’est ici que les tests A/B deviennent utiles',
      'tenir la charge sans que la qualité se dégrade'
    ],
    refuse: [
      'les nouveaux marchés tant que celui-ci n’est pas saturé',
      'la diversification produit : un produit qui marche mérite qu’on l’exploite',
      'la réécriture technique motivée par le confort'
    ],
    subStages: [
      {
        id: 'acquisition-payante',
        label: 'Acquisition payante rentable',
        goal: 'Acheter du trafic et gagner de l’argent dessus.',
        done: 'Le coût d’acquisition est inférieur au tiers de la valeur client sur douze mois.'
      },
      {
        id: 'conversion',
        label: 'Optimiser la conversion',
        goal: 'Faire passer plus de visiteurs à l’acte.',
        done: 'Trois tests A/B concluants, et le tunnel a gagné un point de conversion.'
      },
      {
        id: 'charge',
        label: 'Tenir la charge',
        goal: 'Encaisser dix fois le trafic sans dégrader l’expérience.',
        done: 'Un test de charge à dix fois le pic passe, et le coût par utilisateur reste stable.'
      }
    ]
  },
  {
    id: 'cash-cow',
    label: 'Vache à lait',
    icon: '🐄',
    question: 'Comment ça rapporte le plus, en demandant le moins ?',
    focus: [
      'la marge : réduire ce que chaque client coûte',
      'l’exploitation automatique : le produit tourne sans surveillance',
      'ce qu’on réinvestit ailleurs'
    ],
    refuse: [
      'les grandes refontes : elles remettent en jeu ce qui fonctionne',
      'les fonctionnalités qui augmentent le coût de maintenance sans augmenter le revenu',
      'l’attention de l’équipe au-delà du strict nécessaire'
    ],
    subStages: [
      {
        id: 'marge',
        label: 'Améliorer la marge',
        goal: 'Chaque client coûte moins cher qu’avant.',
        done: 'Le coût variable par client baisse de vingt pour cent sans perte de qualité.'
      },
      {
        id: 'automatiser',
        label: 'Automatiser l’exploitation',
        goal: 'Le produit tourne sans intervention quotidienne.',
        done: 'Aucune tâche manuelle récurrente ne subsiste ; les incidents connus se réparent seuls.'
      },
      {
        id: 'capitaliser',
        label: 'Capitaliser',
        goal: 'Ce qui a été appris sert au produit suivant.',
        done: 'Les briques réutilisables sont extraites et documentées.'
      }
    ]
  },
  {
    id: 'sunset',
    label: 'Extinction',
    icon: '🌙',
    question: 'Comment on s’arrête proprement ?',
    focus: [
      'prévenir les clients honnêtement et à l’avance',
      'leur permettre de récupérer leurs données',
      'éteindre sans laisser de dette ni de coût résiduel'
    ],
    refuse: ['tout nouveau développement', 'toute promesse qu’on ne tiendra pas'],
    subStages: [
      {
        id: 'decision',
        label: 'Acter l’arrêt',
        goal: 'La décision est prise et écrite, avec ses raisons.',
        done: 'La note d’arrêt existe et la date est fixée.'
      },
      {
        id: 'sortie-clients',
        label: 'Sortie des clients',
        goal: 'Personne ne se retrouve coincé.',
        done: 'Les clients sont prévenus, l’export de leurs données fonctionne, les abonnements sont arrêtés.'
      },
      {
        id: 'extinction',
        label: 'Éteindre',
        goal: 'Plus rien ne tourne, plus rien ne coûte.',
        done: 'Les services sont supprimés, le domaine est libéré ou redirigé.'
      }
    ]
  }
];

export const stageById = (id: StageId): Stage => STAGES.find((stage) => stage.id === id) ?? STAGES[0];
export const stageIndex = (id: StageId): number => STAGES.findIndex((stage) => stage.id === id);

/* ------------------------------------------------------------------ */
/* État par produit                                                    */
/* ------------------------------------------------------------------ */

export interface LifecycleState {
  stage: StageId;
  subStage: string;
  stack: StackId;
  since: number;
  /** Les passages successifs : d'où vient ce produit. */
  history: Array<{ stage: StageId; subStage: string; at: number; note?: string }>;
}

const STORE_KEY = 'omniventure_lifecycle_v1';
export const LIFECYCLE_EVENT = 'omniventure_lifecycle_updated';

type Store = Record<string, LifecycleState>;

function read(): Store {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function write(store: Store): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* stockage plein */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(LIFECYCLE_EVENT));
}

/** Un produit sans état déclaré commence au premier jour d'un MVP. */
export function readLifecycle(ventureId: string, ventureType?: string): LifecycleState {
  const stored = read()[ventureId];
  if (stored) return stored;
  return {
    stage: 'mvp',
    subStage: STAGES[0].subStages[0].id,
    stack: stackFor(ventureType),
    since: Date.now(),
    history: []
  };
}

export function setLifecycle(ventureId: string, patch: Partial<LifecycleState>, note?: string): LifecycleState {
  const store = read();
  const current = store[ventureId] ?? readLifecycle(ventureId);
  const next: LifecycleState = { ...current, ...patch };

  const moved = next.stage !== current.stage || next.subStage !== current.subStage;
  if (moved) {
    next.since = Date.now();
    next.history = [{ stage: next.stage, subStage: next.subStage, at: Date.now(), note }, ...current.history].slice(0, 40);
  }

  store[ventureId] = next;
  write(store);
  return next;
}

/** Sous-étape suivante, ou première sous-étape de l'étape suivante. */
export function nextStep(state: LifecycleState): { stage: StageId; subStage: string } | null {
  const stage = stageById(state.stage);
  const position = stage.subStages.findIndex((sub) => sub.id === state.subStage);

  if (position >= 0 && position < stage.subStages.length - 1) {
    return { stage: stage.id, subStage: stage.subStages[position + 1].id };
  }
  const following = STAGES[stageIndex(state.stage) + 1];
  return following ? { stage: following.id, subStage: following.subStages[0].id } : null;
}

export function resetLifecycle(ventureId: string): void {
  const store = read();
  delete store[ventureId];
  write(store);
}

/* ------------------------------------------------------------------ */
/* Ce qu'on dit aux agents                                             */
/* ------------------------------------------------------------------ */

export function subStageOf(state: LifecycleState): SubStage {
  const stage = stageById(state.stage);
  return stage.subStages.find((sub) => sub.id === state.subStage) ?? stage.subStages[0];
}

/**
 * Le bloc injecté dans chaque consigne.
 *
 * L'interdit vient avant le reste : c'est ce qui évite qu'un agent compétent
 * fasse consciencieusement un travail qui ne sert à rien maintenant.
 */
export function lifecycleBlock(state: LifecycleState): string {
  const stage = stageById(state.stage);
  const sub = subStageOf(state);

  return [
    `[OÙ EN EST LE PRODUIT] ${stage.icon} ${stage.label} — ${sub.label}`,
    `La seule question qui compte à ce stade : ${stage.question}`,
    '',
    `Objectif de la sous-étape : ${sub.goal}`,
    `Elle est finie quand : ${sub.done}`,
    '',
    'Ce sur quoi l’effort doit porter :',
    ...stage.focus.map((entry) => `- ${entry}`),
    '',
    'Ce qu’on refuse de faire maintenant, même si c’est tentant :',
    ...stage.refuse.map((entry) => `- ${entry}`),
    '',
    'Si la tâche qu’on te confie appartient à la liste des refus, dis-le dans ton compte rendu au lieu de la faire à moitié.'
  ].join('\n');
}

/**
 * L'état d'un produit désigné par son nom.
 *
 * Plusieurs modules ne connaissent que le nom du produit — le sprint, les
 * rituels. Le stockage reste indexé par identifiant : un nom se renomme, un
 * identifiant non.
 */
export function lifecycleOfVenture(ventureName: string): LifecycleState {
  const venture = getStoredVentures().find((entry) => entry.name === ventureName);
  return readLifecycle(venture?.id ?? ventureName, venture?.type);
}
