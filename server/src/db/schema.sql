CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key_hash    VARCHAR(255) NOT NULL,
  key_prefix  VARCHAR(12),
  name        VARCHAR(100),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  last_used   TIMESTAMPTZ,
  revoked     BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS logs (
  id            BIGSERIAL PRIMARY KEY,
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  level         VARCHAR(10),
  message       TEXT NOT NULL,
  service       VARCHAR(100),
  timestamp     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata      JSONB,
  embedding     vector(1536),
  anomaly_score FLOAT,
  is_anomaly    BOOLEAN DEFAULT FALSE,
  fts_vector    tsvector GENERATED ALWAYS AS (
    to_tsvector('english', 
      coalesce(message, '') || ' ' || 
      coalesce(service, '') || ' ' || 
      coalesce(level, '')
    )
  ) STORED
);

CREATE INDEX IF NOT EXISTS logs_embedding_idx
  ON logs USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS logs_service_time_idx
  ON logs (project_id, service, timestamp DESC);

CREATE INDEX IF NOT EXISTS logs_level_idx
  ON logs (project_id, level, timestamp DESC);

CREATE INDEX IF NOT EXISTS logs_fts_idx ON logs USING GIN (fts_vector);

CREATE TABLE IF NOT EXISTS alert_rules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name          VARCHAR(100),
  condition     JSONB NOT NULL,
  service       VARCHAR(100),
  notify_url    TEXT,
  notify_email  TEXT,
  active        BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alert_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id     UUID REFERENCES alert_rules(id),
  project_id  UUID NOT NULL,
  fired_at    TIMESTAMPTZ DEFAULT NOW(),
  details     JSONB
);
