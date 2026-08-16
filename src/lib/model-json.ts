/**
 * Demander du JSON à un modèle, sans perdre le travail sur un caprice de format.
 *
 * Deux causes d'échec dominent en pratique :
 *   - la réponse est TRONQUÉE (limite de jetons atteinte au milieu d'un tableau),
 *   - le fournisseur renvoie une erreur passagère (429, 5xx, coupure réseau).
 *
 * On traite les deux : la réponse est d'abord réparée si elle est réparable,
 * et à défaut l'appel est refait — jusqu'à trois tentatives, en demandant à
 * chaque fois une réponse plus compacte. Une clé invalide, elle, ne se répare
 * pas : on abandonne immédiatement plutôt que d'insister trois fois.
 */

export interface AskModelOptions {
  key: string;
  model: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  /** Titre transmis à OpenRouter, pour la lisibilité des relevés. */
  title?: string;
  /** Nombre total de tentatives (défaut : 3). */
  attempts?: number;
  /** Forme attendue à la racine. */
  expect?: 'object' | 'array';
  /** Appelé avant chaque nouvelle tentative — sert à informer l'opérateur. */
  onRetry?: (info: { attempt: number; max: number; reason: string }) => void;
}

export interface AskModelResult {
  data: any;
  model: string;
  tokens: number;
  attempts: number;
}

const DEFAULT_ATTEMPTS = 3;

/** Erreurs qu'il est inutile de réessayer : rien ne changera à la tentative suivante. */
const FATAL = /OpenRouter (400|401|402|403|404)/;

export async function askModelJson(options: AskModelOptions): Promise<AskModelResult> {
  const max = Math.max(1, Math.min(5, options.attempts ?? DEFAULT_ATTEMPTS));
  const expect = options.expect ?? 'object';
  let reason = 'échec inconnu';

  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      // À chaque reprise : un peu plus de place, et la consigne d'être plus bref.
      const maxTokens = Math.round((options.maxTokens ?? 2400) * (1 + 0.25 * (attempt - 1)));
      const retryHint =
        attempt === 1
          ? ''
          : `\n\n[REPRISE ${attempt}/${max}]\nTa réponse précédente n'était pas exploitable (${reason.slice(0, 120)}).\nRenvoie UNIQUEMENT le JSON, complet et refermé. Sois plus concis : moins d'éléments et des phrases plus courtes valent mieux qu'une réponse coupée.`;

      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${options.key}`,
          'HTTP-Referer': 'https://factory.dev',
          'X-Title': options.title ?? 'OmniVenture AI'
        },
        body: JSON.stringify({
          model: options.model,
          messages: [{ role: 'user', content: options.prompt + retryHint }],
          temperature: options.temperature ?? 0.5,
          max_tokens: maxTokens,
          ...(expect === 'object' ? { response_format: { type: 'json_object' } } : {})
        })
      });

      if (!res.ok) {
        throw new Error(`OpenRouter ${res.status} : ${(await res.text()).slice(0, 160)}`);
      }

      const completion = (await res.json()) as any;
      const raw: string = completion.choices?.[0]?.message?.content ?? '';

      return {
        data: parseModelJson(raw, options.model, expect),
        model: completion.model || options.model,
        tokens: (completion.usage?.completion_tokens ?? 0) + (completion.usage?.prompt_tokens ?? 0),
        attempts: attempt
      };
    } catch (error) {
      reason = error instanceof Error ? error.message : 'échec';
      if (FATAL.test(reason)) break;
      if (attempt < max) {
        options.onRetry?.({ attempt, max, reason });
        // Petite pause croissante : utile surtout face à une limitation de débit.
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }
  }

  throw new Error(reason);
}

/* ------------------------------------------------------------------ */
/* Lecture tolérante                                                   */
/* ------------------------------------------------------------------ */

/**
 * Extrait le JSON d'une réponse de modèle, en réparant ce qui est réparable :
 * balises de code autour, bavardage, virgules traînantes, structure laissée
 * ouverte par une troncature.
 */
export function parseModelJson(raw: string, model = 'modèle', expect: 'object' | 'array' = 'object'): any {
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const opener = expect === 'array' ? '[' : '{';
  const closer = expect === 'array' ? ']' : '}';

  const start = cleaned.indexOf(opener);
  if (start < 0) throw new Error(`${model} : réponse sans ${expect === 'array' ? 'tableau' : 'objet'} JSON`);

  const end = cleaned.lastIndexOf(closer);
  const candidates: string[] = [];
  if (end > start) candidates.push(cleaned.slice(start, end + 1));
  candidates.push(cleaned.slice(start));

  for (const candidate of candidates) {
    for (const attempt of [candidate, dropTrailingCommas(candidate), closeTruncated(candidate)]) {
      try {
        return JSON.parse(attempt);
      } catch {
        /* on essaie la réparation suivante */
      }
    }
  }
  throw new Error(`${model} : JSON invalide même après réparation`);
}

const dropTrailingCommas = (text: string) => text.replace(/,\s*([}\]])/g, '$1');

/**
 * Referme une réponse coupée en cours de route.
 *
 * On parcourt le texte en suivant les chaînes et leurs échappements — sans ça,
 * une accolade écrite à l'intérieur d'un texte fausserait tout le comptage —,
 * on tronque l'élément laissé à moitié, puis on referme ce qui reste ouvert.
 */
function closeTruncated(text: string): string {
  let inString = false;
  let escaped = false;
  let depth = 0;
  /** Dernière position sûre : juste après un élément complet. */
  let safe = -1;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{' || char === '[') depth++;
    else if (char === '}' || char === ']') {
      depth--;
      safe = i;
    } else if (char === ',') safe = i - 1;
  }

  if (depth === 0 && !inString) return text;

  const trimmed = safe >= 0 ? text.slice(0, safe + 1) : text;
  const open: string[] = [];
  let stringOpen = false;
  let stringEscape = false;
  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (stringOpen) {
      if (stringEscape) stringEscape = false;
      else if (char === '\\') stringEscape = true;
      else if (char === '"') stringOpen = false;
      continue;
    }
    if (char === '"') stringOpen = true;
    else if (char === '{') open.push('}');
    else if (char === '[') open.push(']');
    else if (char === '}' || char === ']') open.pop();
  }

  const closers: string[] = [];
  while (open.length > 0) closers.push(open.pop() as string);
  return dropTrailingCommas(trimmed) + closers.join('');
}
