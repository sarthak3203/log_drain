CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(100),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique_idx
  ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name        VARCHAR(100) NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- `CREATE TABLE IF NOT EXISTS` does not alter installations created before
-- user ownership existed. Legacy rows stay available for an explicit owner
-- backfill, while new installations enforce an owner immediately.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'projects_owner_id_fkey'
      AND conrelid = 'projects'::regclass
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_owner_id_fkey
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM projects WHERE owner_id IS NULL) THEN
    ALTER TABLE projects ALTER COLUMN owner_id SET NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS projects_owner_created_idx
  ON projects (owner_id, created_at DESC);

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
  ingestion_id  UUID NOT NULL DEFAULT gen_random_uuid(),
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

-- Every accepted ingestion payload has a stable ID. The worker uses this
-- alongside project_id to make retries and processing-queue recovery safe.
ALTER TABLE logs ADD COLUMN IF NOT EXISTS ingestion_id UUID;
UPDATE logs SET ingestion_id = gen_random_uuid() WHERE ingestion_id IS NULL;
ALTER TABLE logs ALTER COLUMN ingestion_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS logs_project_ingestion_unique_idx
  ON logs (project_id, ingestion_id);

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
