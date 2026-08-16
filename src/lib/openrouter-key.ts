/**
 * D'où le serveur tire la clé OpenRouter.
 *
 * Elle vivait dans le navigateur et voyageait à chaque démarrage de chantier.
 * Tant que c'était le navigateur qui appelait le modèle, cela se défendait ;
 * depuis que la boucle est côté serveur, ce trajet n'a plus de raison d'être —
 * et une clé qui circule est une clé qui finit dans un journal.
 *
 * Trois sources, dans cet ordre de confiance :
 *   1. la variable d'environnement du Worker, quand vous l'avez posée ;
 *   2. le coffre, où vous la rangez une fois depuis l'interface ;
 *   3. ce que l'appelant transmet — le repli qui garde l'application utilisable
 *      avant que le coffre soit rempli.
 */

import { decryptSecret, getSecret } from './vault';

/** Le nom sous lequel la clé est rangée dans le coffre. */
export const OPENROUTER_SECRET = 'OPENROUTER_API_KEY';

const looksValid = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().startsWith('sk-or-');

export async function resolveOpenRouterKey(env: any, provided?: string): Promise<string | null> {
  if (looksValid(env?.OPENROUTER_API_KEY)) return env.OPENROUTER_API_KEY.trim();

  try {
    const record = await getSecret(env, OPENROUTER_SECRET);
    if (record?.value) {
      const plain = await decryptSecret(env, record.value);
      if (looksValid(plain)) return plain.trim();
    }
  } catch {
    /* coffre indisponible ou clé de chiffrement absente : on essaie la suite */
  }

  return looksValid(provided) ? provided.trim() : null;
}
