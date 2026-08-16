/**
 * Ce que l'agence produit vraiment.
 *
 * Jusqu'ici, chaque tâche se terminait de la même façon : un compte rendu en
 * markdown rangé dans les documents. Autrement dit, quelle que soit l'étape —
 * développement, design, contenu — le livrable était toujours de la
 * documentation. C'est une confusion coûteuse : la documentation *parle* du
 * travail, elle n'est pas le travail.
 *
 * Un artefact, ici, c'est ce qui existe après coup et qu'on peut ouvrir : des
 * fichiers dans le dépôt du produit, une image dans R2, un design system, un
 * article publiable, une mesure chiffrée. Le compte rendu redevient ce qu'il
 * aurait toujours dû être — une note qui accompagne le livrable, pas le
 * livrable lui-même.
 */

export type ArtifactKind =
  | 'code'
  | 'visuel'
  | 'design'
  | 'maquette'
  | 'memo'
  | 'article'
  | 'spec'
  | 'integration'
  | 'video'
  | 'mesure'
  | 'doc';

export interface ArtifactKindInfo {
  label: string;
  icon: string;
  /** Ce qui doit exister à la fin — dit à l'agent, mot pour mot. */
  expectation: string;
}

export const ARTIFACT_KINDS: Record<ArtifactKind, ArtifactKindInfo> = {
  code: {
    label: 'Code',
    icon: '⚙️',
    expectation: 'des fichiers écrits dans le dépôt du produit, qui compilent et font ce qui est demandé'
  },
  visuel: {
    label: 'Visuel',
    icon: '🖼️',
    expectation: 'une ou plusieurs images réellement générées et stockées'
  },
  design: {
    label: 'Design system',
    icon: '🎨',
    expectation: 'des tokens et des composants exploitables tels quels'
  },
  maquette: {
    label: 'Maquette',
    icon: '📐',
    expectation: "une maquette d'écran en HTML + classes utilitaires, visible dans un navigateur"
  },
  memo: {
    label: 'Mémo',
    icon: '📝',
    expectation: 'une note de décision courte : le choix, ses raisons, ce qu’il exclut'
  },
  article: {
    label: 'Article',
    icon: '📰',
    expectation: 'un texte publiable en l’état, titré, avec son accroche et sa méta description'
  },
  spec: {
    label: 'Spécification',
    icon: '📋',
    expectation: "un parcours écran par écran et des critères d'acceptation vérifiables"
  },
  integration: {
    label: 'Intégration',
    icon: '🔌',
    expectation: 'le branchement effectif d’un service tiers : configuration, clés référencées, appel qui répond'
  },
  video: {
    label: 'Vidéo',
    icon: '🎬',
    expectation: 'un script minuté et un storyboard plan par plan, avec les images clés générées'
  },
  mesure: {
    label: 'Mesure',
    icon: '📊',
    expectation: 'des chiffres avec leur source et l’écart au résultat visé'
  },
  doc: {
    label: 'Documentation',
    icon: '📄',
    expectation: 'une page de documentation à jour'
  }
};

/** Où vit l'artefact : c'est ce qui permet de le rouvrir. */
export interface ArtifactLocation {
  /** Fichiers écrits, chemins relatifs au dépôt du produit. */
  files?: string[];
  /** Identifiants d'images stockées. */
  assetIds?: string[];
  /** Document de l'espace de travail. */
  docId?: string;
  /** Adresse externe, quand le livrable vit ailleurs. */
  url?: string;
}

export interface Artifact {
  id: string;
  at: number;
  kind: ArtifactKind;
  title: string;
  /** Une ligne : ce que c'est, pas comment ça a été fait. */
  summary: string;
  agentId: string;
  agentName: string;
  ventureName: string;
  phase?: string;
  location: ArtifactLocation;
  /** Tâche qui l'a produit. */
  taskId?: string;
}

const STORE_KEY = 'omniventure_artifacts_v1';
export const ARTIFACT_EVENT = 'omniventure_artifacts_updated';
const MAX_ENTRIES = 800;

export function readArtifacts(): Artifact[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addArtifact(artifact: Omit<Artifact, 'id' | 'at'>): Artifact {
  const entry: Artifact = {
    ...artifact,
    id: `art-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    at: Date.now()
  };
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify([entry, ...readArtifacts()].slice(0, MAX_ENTRIES)));
  } catch {
    /* stockage plein : on perd la référence, pas le livrable */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ARTIFACT_EVENT, { detail: entry }));
  }
  return entry;
}

export const artifactsOf = (ventureName: string): Artifact[] =>
  readArtifacts().filter((entry) => entry.ventureName === ventureName);

export const artifactsBy = (agentId: string): Artifact[] =>
  readArtifacts().filter((entry) => entry.agentId === agentId);

/** Combien de chaque sorte : sert au récapitulatif d'un projet. */
export function countByKind(artifacts: Artifact[]): Array<{ kind: ArtifactKind; count: number }> {
  const counts = new Map<ArtifactKind, number>();
  for (const entry of artifacts) counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
  return [...counts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count);
}

/** Description d'un emplacement, en une ligne lisible. */
export function locationLabel(location: ArtifactLocation): string {
  if (location.files?.length) {
    return location.files.length === 1 ? location.files[0] : `${location.files.length} fichiers`;
  }
  if (location.assetIds?.length) {
    return location.assetIds.length === 1 ? '1 image' : `${location.assetIds.length} images`;
  }
  if (location.url) return location.url;
  if (location.docId) return 'document';
  return '—';
}
