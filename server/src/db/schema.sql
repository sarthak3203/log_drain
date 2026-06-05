-- Enable pgvector extension
-- This adds the "vector" column type to Postgres
CREATE EXTENSION IF NOT EXISTS vector;
-- Projects table
-- Every log belongs to a project. Multi-tenancy.
CREATE TABLE IF NOT EXISTS projects (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 name VARCHAR(100) NOT NULL,
 created_at TIMESTAMPTZ DEFAULT NOW()
);
-- API Keys table
-- One project can have multiple API keys
-- Keys are hashed with bcrypt before storage (like passwords)
CREATE TABLE IF NOT EXISTS api_keys (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 key_hash VARCHAR(255) NOT NULL, -- bcrypt hash, never store raw key
 name VARCHAR(100),
 created_at TIMESTAMPTZ DEFAULT NOW(),
 last_used TIMESTAMPTZ,
 revoked BOOLEAN DEFAULT FALSE
);
-- The main logs table
-- embedding vector(384) is the pgvector column
-- all-MiniLM-L6-v2 produces 384-dim vectors; OpenAI text-embedding-3-small also
supports 384
CREATE TABLE IF NOT EXISTS logs (
 id BIGSERIAL PRIMARY KEY, -- BIGSERIAL because you might have billions
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 level VARCHAR(10), -- error, warn, info, debug
 message TEXT NOT NULL,
 service VARCHAR(100), -- which microservice sent this
 timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 metadata JSONB, -- arbitrary extra fields
 embedding vector(384), -- the semantic vector; NULL until embedding
worker runs
 anomaly_score FLOAT, -- distance from centroid; NULL until anomaly
worker runs
 is_anomaly BOOLEAN DEFAULT FALSE
);
-- IVFFlat index for fast vector similarity search
-- Without this, pgvector does a full table scan on every search query
-- lists=100 is a good starting point; tune based on your data size
-- Rule of thumb: lists = sqrt(number_of_rows)
CREATE INDEX IF NOT EXISTS logs_embedding_idx
 ON logs USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
-- Index for time-range queries and service filtering
-- This is hit every time someone does GET /logs?service=payment-api&from=...&to=...
CREATE INDEX IF NOT EXISTS logs_service_time_idx
 ON logs (project_id, service, timestamp DESC);
-- Index for level filtering
CREATE INDEX IF NOT EXISTS logs_level_idx
 ON logs (project_id, level, timestamp DESC);
-- Alert rules table
-- Teams define thresholds here
CREATE TABLE IF NOT EXISTS alert_rules (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 name VARCHAR(100),
 condition JSONB NOT NULL, -- {"type": "error_count", "threshold": 50,
"window_minutes": 5}
 service VARCHAR(100),
 notify_url TEXT, -- webhook URL
 notify_email TEXT,
 active BOOLEAN DEFAULT TRUE,
 created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Alert history
-- When did which rule fire and why?
CREATE TABLE IF NOT EXISTS alert_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 rule_id UUID REFERENCES alert_rules(id),
 project_id UUID NOT NULL,
 fired_at TIMESTAMPTZ DEFAULT NOW(),
 details JSONB -- the logs that triggered it
);