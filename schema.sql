-- Cloudflare D1 Database Schema for OmniVenture AI

CREATE TABLE IF NOT EXISTS ventures (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    niche TEXT NOT NULL,
    type TEXT CHECK(type IN ('saas', 'dropship', 'affiliate', 'ebook', 'viral_campaign')) NOT NULL,
    business_model TEXT CHECK(business_model IN ('trial_rebill', 'freemium', 'one_time', 'affiliate_commission')) NOT NULL,
    status TEXT CHECK(status IN ('draft', 'building', 'canary', 'live', 'paused', 'error')) DEFAULT 'draft',
    domain TEXT,
    stripe_account_id TEXT,
    price_trial_cents INTEGER DEFAULT 50,
    price_recurring_cents INTEGER DEFAULT 2900,
    trial_duration_hours INTEGER DEFAULT 48,
    canary_traffic_pct INTEGER DEFAULT 0,
    active_version TEXT DEFAULT 'v1.0.0',
    visitors_count INTEGER DEFAULT 0,
    subscribers_count INTEGER DEFAULT 0,
    mrr_cents INTEGER DEFAULT 0,
    total_revenue_cents INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_tasks (
    id TEXT PRIMARY KEY,
    venture_id TEXT,
    agent_role TEXT NOT NULL,
    model_name TEXT NOT NULL,
    status TEXT CHECK(status IN ('pending', 'running', 'success', 'failed')) DEFAULT 'pending',
    prompt_summary TEXT,
    tokens_input INTEGER DEFAULT 0,
    tokens_output INTEGER DEFAULT 0,
    cost_usd REAL DEFAULT 0.0,
    latency_ms INTEGER DEFAULT 0,
    output_preview TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(venture_id) REFERENCES ventures(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS incident_reports (
    id TEXT PRIMARY KEY,
    venture_id TEXT NOT NULL,
    error_type TEXT NOT NULL,
    error_message TEXT NOT NULL,
    stack_trace TEXT,
    root_cause TEXT,
    decision TEXT CHECK(decision IN ('hotfix_applied', 'instant_rollback', 'escalated')) NOT NULL,
    resolved_by_model TEXT,
    latency_seconds INTEGER DEFAULT 0,
    status TEXT CHECK(status IN ('investigating', 'resolved', 'monitoring')) DEFAULT 'resolved',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(venture_id) REFERENCES ventures(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ab_tests (
    id TEXT PRIMARY KEY,
    venture_id TEXT NOT NULL,
    element_tested TEXT CHECK(element_tested IN ('pricing', 'trial_duration', 'hero_headline', 'cta_button')) NOT NULL,
    variant_a_label TEXT NOT NULL,
    variant_a_value TEXT NOT NULL,
    variant_a_impressions INTEGER DEFAULT 0,
    variant_a_conversions INTEGER DEFAULT 0,
    variant_b_label TEXT NOT NULL,
    variant_b_value TEXT NOT NULL,
    variant_b_impressions INTEGER DEFAULT 0,
    variant_b_conversions INTEGER DEFAULT 0,
    current_winner TEXT CHECK(current_winner IN ('A', 'B', 'inconclusive')) DEFAULT 'inconclusive',
    auto_promoted BOOLEAN DEFAULT FALSE,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(venture_id) REFERENCES ventures(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS media_assets (
    id TEXT PRIMARY KEY,
    venture_id TEXT,
    asset_type TEXT CHECK(asset_type IN ('tiktok_9_16', 'youtube_16_9', 'kdp_cover', 'kdp_epub', 'product_banner')) NOT NULL,
    title TEXT NOT NULL,
    video_script TEXT,
    audio_tts_voice TEXT,
    media_url TEXT,
    model_used TEXT,
    duration_seconds INTEGER,
    status TEXT CHECK(status IN ('generating', 'ready', 'failed')) DEFAULT 'ready',
    views_count INTEGER DEFAULT 0,
    clicks_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(venture_id) REFERENCES ventures(id) ON DELETE CASCADE
);

-- ── Bureau virtuel 2D ──────────────────────────────────────────────
-- Position et état de chaque collaborateur, pour reprendre la simulation
-- exactement là où elle s'était arrêtée.
CREATE TABLE IF NOT EXISTS office_agents (
    agent_id TEXT PRIMARY KEY,
    col INTEGER NOT NULL,
    row INTEGER NOT NULL,
    dir INTEGER NOT NULL,
    mode TEXT NOT NULL,
    activity TEXT NOT NULL,
    spot_id TEXT,
    until_at REAL DEFAULT 0,
    decide_at REAL DEFAULT 0,
    partner_id TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Horloge de simulation partagée.
CREATE TABLE IF NOT EXISTS office_runtime (
    id TEXT PRIMARY KEY,
    clock REAL NOT NULL,
    saved_at INTEGER NOT NULL,
    agent_count INTEGER DEFAULT 0
);

-- Banque de sujets de conversation pré-générée (DeepSeek via OpenRouter).
-- Générée une fois, rejouée localement : aucun token pendant l'animation.
CREATE TABLE IF NOT EXISTS office_topics (
    id TEXT PRIMARY KEY,
    topic TEXT NOT NULL,
    theme TEXT,
    model_used TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_vault (
    id TEXT PRIMARY KEY,
    service_name TEXT UNIQUE NOT NULL,
    key_masked TEXT NOT NULL,
    status TEXT CHECK(status IN ('active', 'invalid', 'quota_exceeded')) DEFAULT 'active',
    last_verified DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── Auto-amélioration & télémétrie de coût ────────────────────────
-- Backlog des évolutions proposées par l'organisation elle-même.
-- La colonne `status` matérialise le garde-fou : proposed → dispatched →
-- shipped ne franchit jamais l'étape de relecture humaine automatiquement.
CREATE TABLE IF NOT EXISTS improvement_backlog (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    rationale TEXT,
    impact TEXT,
    effort TEXT,
    score REAL DEFAULT 0,
    prompt TEXT,
    status TEXT DEFAULT 'proposed',
    run_id TEXT,
    created_at INTEGER
);

-- Relevés successifs du compteur cumulé OpenRouter : les coûts par période
-- (7 jours, aujourd'hui, dernière heure) sont des différences entre relevés.
CREATE TABLE IF NOT EXISTS openrouter_usage_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    total_usage REAL NOT NULL,
    total_credits REAL DEFAULT 0
);

-- Navigateurs vus récemment sur l'application : une ligne par onglet ouvert,
-- rafraîchie à chaque relève du panneau de supervision. C'est ce qui rend
-- « utilisateurs actifs » mesuré plutôt qu'estimé.
CREATE TABLE IF NOT EXISTS service_presence (
    client_id TEXT PRIMARY KEY,
    last_seen INTEGER NOT NULL
);

-- Aménagement du bureau : retouches appliquées par-dessus le plan généré.
CREATE TABLE IF NOT EXISTS office_layout (
    id TEXT PRIMARY KEY,
    patches TEXT NOT NULL,
    patch_count INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Coffre-fort : les valeurs sont chiffrées (AES-GCM) avant d'arriver ici.
-- La clé maîtresse vit dans l'environnement (VAULT_MASTER_KEY) ou, à défaut,
-- dans KV — jamais dans cette table.
CREATE TABLE IF NOT EXISTS vault_secrets (
    name TEXT PRIMARY KEY,
    description TEXT,
    category TEXT,
    value TEXT NOT NULL,
    created_at INTEGER,
    updated_at INTEGER,
    last_used_at INTEGER,
    last_used_by TEXT,
    rotation_days INTEGER DEFAULT 0
);
