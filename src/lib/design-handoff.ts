/**
 * Le relais entre le graphiste et la designeuse.
 *
 * Les deux ateliers vivaient dans une même page, et la palette passait de l'un
 * à l'autre par un simple état React. En les séparant en deux vues — parce
 * qu'ils concernent le produit et méritent chacun leur place dans la barre —
 * cet état disparaissait à la navigation.
 *
 * Le relais est donc écrit. Effet secondaire bienvenu : il survit à un
 * rechargement, ce que l'état en mémoire ne faisait pas. On l'efface après
 * lecture, sinon une palette d'il y a trois semaines reviendrait s'imposer à la
 * prochaine ouverture.
 */

import { readLocal, removeLocal, writeLocal } from './local';

const KEY = 'omniventure_design_handoff';

export interface DesignSeed {
  palette: string[];
  logoAssetId?: string;
  at: number;
}

export function sendToDesigner(palette: string[], logoAssetId?: string): void {
  writeLocal(KEY, JSON.stringify({ palette, logoAssetId, at: Date.now() } satisfies DesignSeed));
}

/**
 * Récupère le relais, et le consomme.
 *
 * Passé une heure, on l'ignore : une palette envoyée hier ne correspond plus à
 * ce qu'on est en train de faire aujourd'hui.
 */
export function takeSeed(): { palette: string[]; logoAssetId?: string } | null {
  const raw = readLocal(KEY);
  if (!raw) return null;
  removeLocal(KEY);

  try {
    const seed = JSON.parse(raw) as DesignSeed;
    if (!seed?.at || Date.now() - seed.at > 3_600_000) return null;
    return { palette: seed.palette ?? [], logoAssetId: seed.logoAssetId };
  } catch {
    return null;
  }
}
