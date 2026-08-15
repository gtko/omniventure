import type { Venture, AgentTask, IncidentReport, ABTest, MediaAsset } from '../types';

export class CloudflareDbService {
  private db: D1Database | null;

  constructor(d1Binding?: D1Database) {
    this.db = d1Binding || null;
  }

  // Ventures (Projects) CRUD
  async listVentures(): Promise<Venture[]> {
    if (!this.db) return [];
    try {
      const { results } = await this.db.prepare(
        'SELECT * FROM ventures ORDER BY created_at DESC'
      ).all();
      return (results as any[]) || [];
    } catch (e) {
      console.warn('D1 Query Error (listVentures):', e);
      return [];
    }
  }

  async saveVenture(v: Venture): Promise<boolean> {
    if (!this.db) return false;
    try {
      await this.db.prepare(`
        INSERT INTO ventures (
          id, name, slug, niche, type, business_model, status, domain,
          stripe_account_id, price_trial_cents, price_recurring_cents,
          trial_duration_hours, canary_traffic_pct, active_version,
          visitors_count, subscribers_count, mrr_cents, total_revenue_cents,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name=excluded.name,
          niche=excluded.niche,
          domain=excluded.domain,
          status=excluded.status,
          canary_traffic_pct=excluded.canary_traffic_pct,
          active_version=excluded.active_version,
          price_trial_cents=excluded.price_trial_cents,
          price_recurring_cents=excluded.price_recurring_cents,
          trial_duration_hours=excluded.trial_duration_hours,
          updated_at=excluded.updated_at
      `).bind(
        v.id, v.name, v.slug, v.niche, v.type, v.businessModel, v.status, v.domain,
        v.stripeAccountId || '', v.priceTrialCents, v.priceRecurringCents,
        v.trialDurationHours, v.canaryTrafficPct, v.activeVersion,
        v.visitorsCount, v.subscribersCount, v.mrrCents, v.totalRevenueCents,
        v.createdAt, v.updatedAt
      ).run();
      return true;
    } catch (e) {
      console.error('D1 Insert/Update Error (saveVenture):', e);
      return false;
    }
  }

  async deleteVenture(id: string): Promise<boolean> {
    if (!this.db) return false;
    try {
      await this.db.prepare('DELETE FROM ventures WHERE id = ?').bind(id).run();
      return true;
    } catch (e) {
      console.error('D1 Delete Error:', e);
      return false;
    }
  }

  // Agent Tasks CRUD
  async recordTask(task: AgentTask): Promise<boolean> {
    if (!this.db) return false;
    try {
      await this.db.prepare(`
        INSERT INTO agent_tasks (
          id, venture_id, venture_name, agent_role, model_name,
          status, prompt_summary, tokens_input, tokens_output,
          cost_usd, latency_ms, output_preview, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        task.id, task.ventureId, task.ventureName, task.agentRole, task.modelName,
        task.status, task.promptSummary, task.tokensInput, task.tokensOutput,
        task.costUsd, task.latencyMs, task.outputPreview, task.createdAt
      ).run();
      return true;
    } catch (e) {
      console.error('D1 Insert Error (recordTask):', e);
      return false;
    }
  }

  // Incident Reports
  async recordIncident(inc: IncidentReport): Promise<boolean> {
    if (!this.db) return false;
    try {
      await this.db.prepare(`
        INSERT INTO incident_reports (
          id, venture_id, venture_name, error_type, error_message,
          stack_trace, root_cause, decision, resolved_by_model,
          latency_seconds, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        inc.id, inc.ventureId, inc.ventureName, inc.errorType, inc.errorMessage,
        inc.stackTrace, inc.rootCause, inc.decision, inc.resolvedByModel,
        inc.latencySeconds, inc.status, inc.createdAt
      ).run();
      return true;
    } catch (e) {
      console.error('D1 Insert Error (recordIncident):', e);
      return false;
    }
  }
}
