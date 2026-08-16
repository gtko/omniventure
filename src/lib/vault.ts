/**
 * Coffre-fort de l'agence — côté serveur uniquement.
 *
 * Trois exigences tenues ici :
 *   1. les valeurs sont chiffrées au repos (AES-GCM), jamais stockées en clair ;
 *   2. l'opérateur peut les revoir quand il en a besoin, explicitement ;
 *   3. les agents connaissent les NOMS et à quoi ils servent, mais ne voient
 *      jamais les valeurs — celles-ci sont substituées au dernier moment, dans
 *      la requête sortante, jamais dans le contexte d'un modèle.
 *
 * Le troisième point est la raison d'être du coffre : un secret qui entre dans
 * le contexte d'un modèle est un secret publié.
 */

export interface SecretRecord {
  name: string;
  description: string;
  category: string;
  /** Chiffré, format « iv:ciphertext » en base64. */
  value: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
  lastUsedBy: string | null;
  /** Rappel de rotation, en jours. 0 = pas de rappel. */
  rotationDays: number;
}

export interface SecretSummary {
  name: string;
  description: string;
  category: string;
  /** Aperçu masqué : de quoi reconnaître la clé sans la révéler. */
  preview: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
  lastUsedBy: string | null;
  rotationDays: number;
  /** Vrai quand la rotation est dépassée. */
  rotationDue: boolean;
}

const MASTER_KEY_KV = 'vault_master_key_v1';

/* ------------------------------------------------------------------ */
/* Chiffrement                                                         */
/* ------------------------------------------------------------------ */

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

/**
 * Clé maîtresse. On privilégie une variable d'environnement — c'est le
 * cloisonnement le plus net. À défaut, une clé est générée une fois et
 * conservée dans KV : moins étanche, mais toujours mieux que du clair en base.
 */
async function masterKey(env: any): Promise<{ key: CryptoKey; source: 'env' | 'kv' } | null> {
  const fromEnv = env?.VAULT_MASTER_KEY;
  if (typeof fromEnv === 'string' && fromEnv.length >= 32) {
    const raw = fromBase64(fromEnv).slice(0, 32);
    return { key: await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']), source: 'env' };
  }

  if (!env?.KV_SECRETS) return null;
  let stored = await env.KV_SECRETS.get(MASTER_KEY_KV);
  if (!stored) {
    const generated = crypto.getRandomValues(new Uint8Array(32));
    stored = toBase64(generated);
    await env.KV_SECRETS.put(MASTER_KEY_KV, stored);
  }
  const raw = fromBase64(stored).slice(0, 32);
  return { key: await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']), source: 'kv' };
}

export async function encryptSecret(env: any, plain: string): Promise<string> {
  const master = await masterKey(env);
  if (!master) throw new Error('Coffre indisponible : ni VAULT_MASTER_KEY ni espace KV.');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, master.key, new TextEncoder().encode(plain));
  return `${toBase64(iv)}:${toBase64(new Uint8Array(cipher))}`;
}

export async function decryptSecret(env: any, stored: string): Promise<string> {
  const master = await masterKey(env);
  if (!master) throw new Error('Coffre indisponible : ni VAULT_MASTER_KEY ni espace KV.');
  const [ivPart, cipherPart] = stored.split(':');
  if (!ivPart || !cipherPart) throw new Error('Secret illisible');
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(ivPart) },
    master.key,
    fromBase64(cipherPart)
  );
  return new TextDecoder().decode(plain);
}

export async function vaultStatus(env: any): Promise<{ ready: boolean; keySource: 'env' | 'kv' | null }> {
  try {
    const master = await masterKey(env);
    return { ready: !!master, keySource: master?.source ?? null };
  } catch {
    return { ready: false, keySource: null };
  }
}

/* ------------------------------------------------------------------ */
/* Persistance                                                         */
/* ------------------------------------------------------------------ */

export async function ensureVaultTable(db: any): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS vault_secrets (
        name TEXT PRIMARY KEY,
        description TEXT,
        category TEXT,
        value TEXT NOT NULL,
        created_at INTEGER,
        updated_at INTEGER,
        last_used_at INTEGER,
        last_used_by TEXT,
        rotation_days INTEGER DEFAULT 0
      )`
    )
    .run();
}

const rowToRecord = (row: any): SecretRecord => ({
  name: row.name,
  description: row.description ?? '',
  category: row.category ?? 'divers',
  value: row.value,
  createdAt: Number(row.created_at ?? 0),
  updatedAt: Number(row.updated_at ?? 0),
  lastUsedAt: row.last_used_at ? Number(row.last_used_at) : null,
  lastUsedBy: row.last_used_by ?? null,
  rotationDays: Number(row.rotation_days ?? 0)
});

export async function listSecrets(env: any): Promise<SecretRecord[]> {
  if (!env?.DB) return [];
  await ensureVaultTable(env.DB);
  const result = await env.DB.prepare('SELECT * FROM vault_secrets ORDER BY category, name').all();
  return ((result?.results ?? []) as any[]).map(rowToRecord);
}

export async function getSecret(env: any, name: string): Promise<SecretRecord | null> {
  if (!env?.DB) return null;
  await ensureVaultTable(env.DB);
  const row = await env.DB.prepare('SELECT * FROM vault_secrets WHERE name = ?').bind(name).first();
  return row ? rowToRecord(row) : null;
}

export async function upsertSecret(
  env: any,
  entry: { name: string; value?: string; description?: string; category?: string; rotationDays?: number }
): Promise<void> {
  if (!env?.DB) throw new Error('Base indisponible');
  await ensureVaultTable(env.DB);

  const existing = await getSecret(env, entry.name);
  const value = entry.value ? await encryptSecret(env, entry.value) : existing?.value;
  if (!value) throw new Error('Aucune valeur à enregistrer');

  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO vault_secrets (name, description, category, value, created_at, updated_at, last_used_at, last_used_by, rotation_days)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET
       description = excluded.description,
       category = excluded.category,
       value = excluded.value,
       updated_at = excluded.updated_at,
       rotation_days = excluded.rotation_days`
  )
    .bind(
      entry.name,
      entry.description ?? existing?.description ?? '',
      entry.category ?? existing?.category ?? 'divers',
      value,
      existing?.createdAt ?? now,
      now,
      existing?.lastUsedAt ?? null,
      existing?.lastUsedBy ?? null,
      entry.rotationDays ?? existing?.rotationDays ?? 0
    )
    .run();
}

export async function deleteSecret(env: any, name: string): Promise<void> {
  if (!env?.DB) return;
  await ensureVaultTable(env.DB);
  await env.DB.prepare('DELETE FROM vault_secrets WHERE name = ?').bind(name).run();
}

async function markUsed(env: any, name: string, by: string): Promise<void> {
  if (!env?.DB) return;
  await env.DB.prepare('UPDATE vault_secrets SET last_used_at = ?, last_used_by = ? WHERE name = ?')
    .bind(Date.now(), by.slice(0, 60), name)
    .run();
}

/* ------------------------------------------------------------------ */
/* Vue publique et substitution                                        */
/* ------------------------------------------------------------------ */

/** Aperçu masqué : assez pour reconnaître la clé, pas pour s'en servir. */
export function maskValue(plain: string): string {
  if (plain.length <= 8) return '••••';
  return `${plain.slice(0, 4)}••••${plain.slice(-4)} (${plain.length})`;
}

export async function summarize(env: any, records: SecretRecord[]): Promise<SecretSummary[]> {
  const now = Date.now();
  const summaries: SecretSummary[] = [];
  for (const record of records) {
    let preview = '••••';
    try {
      preview = maskValue(await decryptSecret(env, record.value));
    } catch {
      preview = '⚠ illisible';
    }
    summaries.push({
      name: record.name,
      description: record.description,
      category: record.category,
      preview,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      lastUsedAt: record.lastUsedAt,
      lastUsedBy: record.lastUsedBy,
      rotationDays: record.rotationDays,
      rotationDue: record.rotationDays > 0 && now - record.updatedAt > record.rotationDays * 86_400_000
    });
  }
  return summaries;
}

/**
 * Catalogue destiné aux agents : les noms et leur usage, jamais les valeurs.
 *
 * C'est ce qui répond à « les agents ne doivent pas les oublier » : ils savent
 * en permanence quels secrets existent et à quoi ils servent, et n'ont qu'à
 * écrire {{secret:NOM}} là où la valeur doit apparaître.
 */
export function catalogueForAgents(records: SecretRecord[]): string {
  if (records.length === 0) return '[COFFRE] Aucun secret enregistré.';
  const lines = records.map(
    (record) => `- {{secret:${record.name}}} — ${record.description || 'sans description'} (${record.category})`
  );
  return [
    '[COFFRE DE L’AGENCE — secrets disponibles]',
    "N'écris JAMAIS une valeur de secret. Utilise le marqueur, il sera remplacé au dernier moment, hors de ta vue.",
    ...lines
  ].join('\n');
}

const MARKER = /\{\{secret:([A-Z0-9_.-]+)\}\}/gi;

/**
 * Remplace les marqueurs par les vraies valeurs, juste avant l'envoi.
 * Renvoie aussi les noms utilisés, pour la traçabilité.
 */
export async function resolveSecrets(
  env: any,
  text: string,
  usedBy = 'agent'
): Promise<{ text: string; used: string[]; missing: string[] }> {
  const used: string[] = [];
  const missing: string[] = [];
  const names = [...new Set([...text.matchAll(MARKER)].map((match) => match[1]))];
  if (names.length === 0) return { text, used, missing };

  let resolved = text;
  for (const name of names) {
    const record = await getSecret(env, name);
    if (!record) {
      missing.push(name);
      continue;
    }
    try {
      const plain = await decryptSecret(env, record.value);
      resolved = resolved.split(`{{secret:${name}}}`).join(plain);
      used.push(name);
      await markUsed(env, name, usedBy);
    } catch {
      missing.push(name);
    }
  }
  return { text: resolved, used, missing };
}
