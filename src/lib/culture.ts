/**
 * Culture d'OmniVenture.
 *
 * Ces piliers ne sont pas un texte de façade : ils sont injectés en tête de
 * CHAQUE appel d'agent, avant sa persona. Un agent qui ne les respecte pas
 * produit un travail hors-culture, ce qui est aussi grave qu'un travail faux.
 *
 * Ils sont modifiables depuis le studio d'agents ; la valeur par défaut sert de
 * repli côté serveur, pour qu'aucun appel ne parte sans culture.
 */

export interface CulturePillar {
  id: string;
  title: string;
  detail: string;
}

export const DEFAULT_PILLARS: CulturePillar[] = [
  {
    id: 'benchmark',
    title: 'Copier, égaler, dépasser',
    detail:
      "On part toujours de ce que font les concurrents : on copie ce qui marche, on l'égale, puis on le dépasse sur un axe précis. Rien ne se conçoit dans le vide."
  },
  {
    id: 'truth',
    title: 'Toujours la vérité, la data décide',
    detail:
      "Aucune affirmation sans donnée. On cite la source, on distingue ce qui est mesuré de ce qui est supposé, et on dit « je ne sais pas » plutôt que d'inventer un chiffre."
  },
  {
    id: 'process',
    title: 'Process power',
    detail:
      "On documente absolument tout : décisions, méthode, écueils. Le travail doit être reprenable par quelqu'un d'autre demain — le bus factor est un risque, pas une fatalité."
  }
];

const STORAGE_KEY = 'omniventure_culture_v1';
export const CULTURE_UPDATED_EVENT = 'omniventure_culture_updated';

export function readCulture(): CulturePillar[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PILLARS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_PILLARS;
    return parsed
      .filter((entry) => entry && typeof entry.title === 'string')
      .map((entry, index) => ({
        id: String(entry.id ?? `pilier-${index}`),
        title: String(entry.title).slice(0, 120),
        detail: String(entry.detail ?? '').slice(0, 1000)
      }));
  } catch {
    return DEFAULT_PILLARS;
  }
}

export function writeCulture(pillars: CulturePillar[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pillars));
  } catch {
    return;
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CULTURE_UPDATED_EVENT, { detail: { count: pillars.length } }));
  }
}

export function resetCulture(): CulturePillar[] {
  writeCulture(DEFAULT_PILLARS);
  return DEFAULT_PILLARS;
}

/**
 * Bloc à placer en tête de prompt. Fonctionne aussi côté serveur : sans piliers
 * transmis, on retombe sur ceux d'origine.
 */
export function cultureBlock(pillars?: CulturePillar[] | null): string {
  const list = pillars && pillars.length > 0 ? pillars : DEFAULT_PILLARS;
  return [
    "[CULTURE OMNIVENTURE — elle prime sur ta persona et sur tes habitudes]",
    ...list.map((pillar, index) => `${index + 1}. ${pillar.title} — ${pillar.detail}`),
    "Un travail qui ignore ces principes est à refaire, même s'il est brillant."
  ].join('\n');
}
