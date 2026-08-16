import { readLocal, writeLocal } from './local';
/**
 * Ce que coûte réellement un appel.
 *
 * Jusqu'ici les coûts affichés dans le bureau étaient des constantes écrites à
 * la main — 0,0006 $ par tâche, quel que soit le modèle et la longueur. Un
 * chiffre inventé vaut moins que pas de chiffre du tout : on ne peut rien
 * décider avec.
 *
 * Ici, le tarif vient d'OpenRouter, qui est la seule source de vérité sur ses
 * propres prix. Il est mis en cache une journée : les tarifs bougent, mais pas
 * d'une minute à l'autre, et on ne va pas interroger le catalogue à chaque
 * appel d'agent.
 */

const CACHE_KEY = 'omniventure_model_prices_v1';
const TTL_MS = 24 * 60 * 60 * 1000;

/** Prix par jeton, en dollars. */
export interface ModelPrice {
  prompt: number;
  completion: number;
}

interface PriceCache {
  at: number;
  prices: Record<string, ModelPrice>;
}

/**
 * Repli quand le catalogue est injoignable — les modèles livrés par défaut.
 * Tarifs relevés chez OpenRouter ; ils servent à donner un ordre de grandeur,
 * pas une facture.
 */
const FALLBACK: Record<string, ModelPrice> = {
  'google/gemini-2.5-flash': { prompt: 0.00000015, completion: 0.0000006 },
  'deepseek/deepseek-chat': { prompt: 0.00000014, completion: 0.00000028 },
  'qwen/qwen-2.5-72b-instruct': { prompt: 0.00000035, completion: 0.0000004 },
  'qwen/qwen-2.5-coder-32b-instruct': { prompt: 0.00000007, completion: 0.00000016 },
  'anthropic/claude-3.7-sonnet': { prompt: 0.000003, completion: 0.000015 },
  'x-ai/grok-2': { prompt: 0.000002, completion: 0.00001 },
  'deepseek/deepseek-r1': { prompt: 0.00000055, completion: 0.00000219 },
  'meta-llama/llama-3.3-70b-instruct': { prompt: 0.00000012, completion: 0.0000003 }
};

let memory: Record<string, ModelPrice> | null = null;
let loading: Promise<Record<string, ModelPrice>> | null = null;

function readCache(): Record<string, ModelPrice> | null {
  try {
    const raw = readLocal(CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw) as PriceCache;
    if (!cache?.prices || Date.now() - cache.at > TTL_MS) return null;
    return cache.prices;
  } catch {
    return null;
  }
}

/**
 * Table des tarifs. Le premier appel va chercher le catalogue ; les suivants
 * lisent la mémoire du module.
 */
export async function loadPrices(): Promise<Record<string, ModelPrice>> {
  if (memory) return memory;
  if (loading) return loading;

  const cached = readCache();
  if (cached) {
    memory = { ...FALLBACK, ...cached };
    return memory;
  }

  loading = (async () => {
    try {
      const key = readLocal('omniventure_openrouter_key') ?? '';
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: key ? { Authorization: `Bearer ${key}` } : {}
      });
      if (!res.ok) throw new Error(`OpenRouter ${res.status}`);

      const data = (await res.json()) as { data?: any[] };
      const prices: Record<string, ModelPrice> = {};
      for (const model of data.data ?? []) {
        const prompt = Number(model?.pricing?.prompt ?? 0);
        const completion = Number(model?.pricing?.completion ?? 0);
        if (!model?.id || (!prompt && !completion)) continue;
        prices[String(model.id)] = { prompt, completion };
      }

      writeLocal(CACHE_KEY, JSON.stringify({ at: Date.now(), prices } satisfies PriceCache));
      memory = { ...FALLBACK, ...prices };
    } catch {
      // Catalogue injoignable : on travaille avec ce qu'on sait.
      memory = { ...FALLBACK };
    } finally {
      loading = null;
    }
    return memory as Record<string, ModelPrice>;
  })();

  return loading;
}

/** Tarif connu à cet instant, sans attendre le catalogue. */
export function priceOf(model: string): ModelPrice | null {
  const table = memory ?? FALLBACK;
  return table[model] ?? null;
}

/**
 * Coût d'un appel. Renvoie null quand le tarif du modèle est inconnu — mieux
 * vaut un tiret qu'un zéro trompeur.
 */
export function costOf(model: string, tokensIn: number, tokensOut: number): number | null {
  const price = priceOf(model);
  if (!price) return null;
  return tokensIn * price.prompt + tokensOut * price.completion;
}

/** Écriture d'un montant : les fractions de centime comptent, ici. */
export function formatUsd(amount: number | null): string {
  if (amount == null) return '—';
  if (amount === 0) return '0 $';
  if (amount < 0.01) return `${(amount * 100).toFixed(2)} ¢`;
  return `${amount.toFixed(amount < 1 ? 3 : 2)} $`;
}
