/**
 * Entrée du Worker.
 *
 * Astro produit un gestionnaire de requêtes, mais un Worker qui déclare des
 * Durable Objects doit AUSSI les exporter depuis son point d'entrée — sinon le
 * déploiement échoue. Ce fichier fait les deux : il réexporte le gestionnaire
 * d'Astro et les classes persistantes.
 *
 * Sans lui, `wrangler deploy` refusait de publier :
 *   « Your Worker depends on the following Durable Objects, which are not
 *     exported in your entrypoint file »
 *
 * Ordre de construction : `npm run build` d'abord (il produit dist/), puis
 * `wrangler deploy` qui empaquette ce fichier.
 */

// Produit par la construction d'Astro : présent seulement après `npm run build`.
// @ts-ignore
import astro from '../dist/_worker.js/index.js';

/** Agents persistants de l'agence. */
export { OrchestratorAgent, VentureAutonomousAgent, WorksiteRunner } from '../src/agents';

/**
 * Bac à sable d'exécution : un conteneur piloté depuis le Worker.
 * C'est lui qui permet aux agents de coder sans machine locale allumée.
 */
export { Sandbox } from '@cloudflare/sandbox';

export default astro;
