/**
 * Ce que l'agence dépense, et jusqu'où elle a le droit d'aller.
 *
 * Deux manques, et le second est le plus grave.
 *
 * Le serveur appelait OpenRouter — la chaîne, les réunions, le battement — **sans
 * rien compter**. Aucune trace : impossible de savoir ce qu'un passage avait
 * coûté, ni quel agent ou quel modèle pesait.
 *
 * Et le plafond journalier existait dans la configuration sans jamais être lu.
 * Une boucle autonome sans frein, qu'on lance en fermant l'onglet : c'est
 * exactement le genre de chose qui se découvre sur une facture.
 *
 * Le coût vient d'OpenRouter lui-même (`usage.include`), pas d'une table de
 * tarifs à tenir à jour. Quand il ne le dit pas, la ligne est enregistrée avec
 * un coût inconnu plutôt qu'avec une estimation inventée — et le plafond ne
 * s'appuie que sur ce qui est su.
 */

export type SpendKind = 'tache' | 'passation' | 'reunion' | 'tour' | 'reponse';

const DDL = [
  `CREATE TABLE IF NOT EXISTS agency_spend (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venture_id TEXT NOT NULL,
    at INTEGER NOT NULL,
    kind TEXT NOT NULL,
    agent_id TEXT,
    agent_name TEXT,
    model TEXT,
    tokens_in INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL,
    label TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_spend_venture ON agency_spend(venture_id, at DESC)`
];

const ensured = new WeakSet<object>();

async function ensureSpendTable(db: any): Promise<void> {
  if (!db || ensured.has(db)) return;
  for (const statement of DDL) {
    try {
      await db.prepare(statement).run();
    } catch {
      /* table déjà créée */
    }
  }
  ensured.add(db);
}

export interface SpendEntry {
  ventureId: string;
  kind: SpendKind;
  agentId?: string;
  agentName?: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number | null;
  label?: string;
}

/** Consigne un appel. Ne lève jamais : compter ne doit pas casser le travail. */
export async function recordSpend(db: any, entry: SpendEntry): Promise<void> {
  try {
    await ensureSpendTable(db);
    await db
      .prepare(
        `INSERT INTO agency_spend (venture_id, at, kind, agent_id, agent_name, model, tokens_in, tokens_out, cost_usd, label)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        entry.ventureId,
        Date.now(),
        entry.kind,
        entry.agentId ?? null,
        entry.agentName ?? null,
        entry.model ?? null,
        entry.tokensIn ?? 0,
        entry.tokensOut ?? 0,
        entry.costUsd ?? null,
        (entry.label ?? '').slice(0, 200)
      )
      .run();
  } catch {
    /* la comptabilité n'est pas une raison d'interrompre l'agence */
  }
}

export interface Spent {
  costUsd: number;
  calls: number;
  /** Appels dont le fournisseur n'a pas donné le prix. */
  unpriced: number;
}

export async function spentSince(db: any, ventureId: string, since: number): Promise<Spent> {
  try {
    await ensureSpendTable(db);
    const row = await db
      .prepare(
        `SELECT COALESCE(SUM(cost_usd), 0) AS total, COUNT(*) AS calls,
                SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS unpriced
         FROM agency_spend WHERE venture_id = ? AND at >= ?`
      )
      .bind(ventureId, since)
      .first();
    return {
      costUsd: Number((row as any)?.total ?? 0),
      calls: Number((row as any)?.calls ?? 0),
      unpriced: Number((row as any)?.unpriced ?? 0)
    };
  } catch {
    return { costUsd: 0, calls: 0, unpriced: 0 };
  }
}

/** Une journée d'agence : une heure réelle. C'est l'unité du plafond. */
const AGENCY_DAY_MS = 60 * 60 * 1000;

export interface BudgetVerdict {
  allowed: boolean;
  spent: number;
  ceiling: number;
  reason?: string;
}

/**
 * Reste-t-il de la marge ?
 *
 * Un plafond à zéro veut dire « sans limite » — c'est un choix explicite, pas
 * un oubli de configuration.
 */
export async function checkBudget(db: any, ventureId: string, ceiling: number): Promise<BudgetVerdict> {
  if (!ceiling || ceiling <= 0) return { allowed: true, spent: 0, ceiling: 0 };

  const spent = await spentSince(db, ventureId, Date.now() - AGENCY_DAY_MS);
  if (spent.costUsd < ceiling) return { allowed: true, spent: spent.costUsd, ceiling };

  return {
    allowed: false,
    spent: spent.costUsd,
    ceiling,
    reason: `Plafond atteint : ${spent.costUsd.toFixed(2)} $ dépensés sur la dernière journée d'agence (limite ${ceiling.toFixed(2)} $). Relevez-le dans les réglages pour continuer.`
  };
}

/** Le détail des dernières dépenses, pour l'afficher. */
export async function recentSpend(db: any, ventureId: string, limit = 40): Promise<any[]> {
  try {
    await ensureSpendTable(db);
    const result = await db
      .prepare(
        `SELECT at, kind, agent_name, model, tokens_in, tokens_out, cost_usd, label
         FROM agency_spend WHERE venture_id = ? ORDER BY at DESC LIMIT ?`
      )
      .bind(ventureId, limit)
      .all();
    return (result?.results ?? []) as any[];
  } catch {
    return [];
  }
}
