/**
 * Où fait-on tourner le chantier ?
 *
 * En production, dans un Durable Object : il a des réveils programmés et une
 * durée de vie propre. Mais `astro dev` déclare les liaisons sans héberger les
 * classes — le premier appel remonte une « internal error » de miniflare. Le
 * chantier serait donc injoignable sur la machine de développement, c'est-à-dire
 * précisément là où on travaille.
 *
 * D'où ce module : **la même classe, deux hôtes**. Quand le Durable Object
 * répond, on l'utilise. Sinon on instancie le chantier dans le processus du
 * serveur de développement, avec un stockage en mémoire et des réveils par
 * minuterie.
 *
 * Ce n'est pas un mode dégradé au rabais : l'état vit dans D1 dans les deux cas,
 * donc le comportement est le même, et le travail survit au rechargement de la
 * page comme il le doit — le processus du serveur, lui, ne meurt pas quand
 * l'onglet se ferme.
 *
 * La seule différence tient à la durée de vie de l'hôte : un Worker de
 * production est éphémère, ce repli n'y survivrait pas. Il ne s'y déclenche
 * jamais, puisque le Durable Object y répond.
 */

import { WorksiteRunner } from '../agents/WorksiteRunner';

interface Shim {
  runner: WorksiteRunner;
  store: Map<string, unknown>;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Un chantier par produit, gardé dans la portée du module.
 *
 * C'est ce qui lui donne sa continuité dans le serveur de développement : les
 * requêtes vont et viennent, l'instance reste.
 */
const hosted = new Map<string, Shim>();

function localRunner(env: any, ventureId: string): WorksiteRunner {
  const existing = hosted.get(ventureId);
  if (existing) return existing.runner;

  const shim: Shim = { runner: null as unknown as WorksiteRunner, store: new Map(), timer: null };

  const state = {
    storage: {
      async get(key: string) {
        return shim.store.has(key) ? shim.store.get(key) : undefined;
      },
      async put(key: string, value: unknown) {
        shim.store.set(key, value);
      },
      async delete(key: string) {
        shim.store.delete(key);
      },
      async setAlarm(at: number) {
        if (shim.timer) clearTimeout(shim.timer);
        shim.timer = setTimeout(() => {
          shim.timer = null;
          // Une alarme qui échoue ne doit pas abattre le serveur de
          // développement : le chantier consigne déjà ses propres échecs.
          void shim.runner.alarm().catch(() => undefined);
        }, Math.max(0, at - Date.now()));
      },
      async deleteAlarm() {
        if (shim.timer) clearTimeout(shim.timer);
        shim.timer = null;
      }
    }
  };

  shim.runner = new WorksiteRunner(state as unknown as DurableObjectState, env);
  hosted.set(ventureId, shim);
  return shim.runner;
}

export interface HostedCall {
  response: Response;
  /** Où la demande a réellement été traitée, pour le dire à l'écran. */
  host: 'durable-object' | 'processus-local';
}

/**
 * Adresse une requête au chantier d'un produit, quel que soit son hôte.
 *
 * On tente d'abord le Durable Object ; son échec vaut détection.
 */
export async function callWorksite(env: any, ventureId: string, path: string, body?: unknown): Promise<HostedCall> {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {})
  };

  if (env?.WORKSITE_RUNNER) {
    try {
      const stub = env.WORKSITE_RUNNER.get(env.WORKSITE_RUNNER.idFromName(`worksite:${ventureId}`));
      const response = await stub.fetch(`https://worksite/${path}`, init);
      return { response, host: 'durable-object' };
    } catch {
      /* pas d'hôte persistant ici : on prend le relais dans ce processus */
    }
  }

  const runner = localRunner(env, ventureId);
  const response = await runner.fetch(new Request(`https://worksite/${path}`, init));
  return { response, host: 'processus-local' };
}
