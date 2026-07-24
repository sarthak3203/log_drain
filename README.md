# Log Drain

Log ingestion, hybrid retrieval, LLM-assisted analysis, and IsolationForest anomaly scoring over PostgreSQL-backed application logs.

<p align="center">
  <strong>Runtime composition:</strong> React dashboard, Express API, Redis-backed workers, PostgreSQL with pgvector, and a FastAPI ML service.
</p>

<p align="center">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6.x-3178C6?logo=typescript&logoColor=white">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-Express-339933?logo=node.js&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111">
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-pgvector-4169E1?logo=postgresql&logoColor=white">
  <img alt="Redis" src="https://img.shields.io/badge/Redis-Queue-DC382D?logo=redis&logoColor=white">
  <img alt="FastAPI" src="https://img.shields.io/badge/FastAPI-ML_Service-009688?logo=fastapi&logoColor=white">
  <img alt="Docker" src="https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white">
</p>

> The ingestion path accepts logs through an authenticated Express API, buffers them in Redis, bulk-writes them to PostgreSQL, enriches them with `vector(1536)` embeddings, and uses separate search, agent, and anomaly-detection paths over the stored data.

## System Summary

Log Drain implements an observability pipeline where write ingestion, embedding generation, search, LLM analysis, and anomaly detection are separate execution paths. The API returns `202 Accepted` after queueing logs in Redis, workers perform durable writes and enrichment asynchronously, PostgreSQL stores both relational fields and pgvector embeddings, and a Python FastAPI service runs request-scoped IsolationForest scoring over recent service-level embeddings.

The repository is structured to expose the system-design boundaries: API server, worker process, React client, database schema, Redis queues, and Python ML service are separate directories or entrypoints. The current implementation favors inspectable local infrastructure over managed services; Kafka, Kubernetes, CI/CD, cloud deployment, and full monitoring are explicitly planned rather than present.

---

## Problem Statement

Log search becomes less useful when developers need to ask about symptoms rather than exact strings. A query such as "database connectivity errors after deploy" may map to log messages with different wording, services, timestamps, and metadata; plain keyword search only covers the lexical match case.

Synchronous ingestion also couples API latency to database write latency. If every log request waits for a row insert and downstream enrichment, ingestion throughput is constrained by the slowest dependency in the request path.

Anomaly detection is a different workload from ingestion and retrieval. It needs batches of comparable events, numeric features, and scoring logic that can be evolved independently from the API server.

Log Drain addresses these constraints by separating ingestion from persistence, persistence from embedding, embedding from retrieval, and anomaly scoring from the TypeScript backend. The tradeoff is more moving parts: Redis queue state, worker retry behavior, model service availability, and schema/index maintenance become part of the operational model.

---

## High-Level Architecture

The system has four application components and two infrastructure dependencies in the current repository.

| Component | Current entrypoint | Responsibility |
| --- | --- | --- |
| React client | `client/src/main.tsx` | Browser UI for project creation, API-key login, log stream, stats, hybrid search, agent questions, alert rules, and recent alerts. |
| Express API | `server/src/index.ts` | HTTP API for project/API-key management, log ingestion, log retrieval, search, stats, alerts, and the LangGraph agent endpoint. |
| Worker process | `server/src/workers/index.ts` | Starts flush, embedding, anomaly-detection, and retention jobs in one Node.js process. |
| Python ML service | `python-ml/app/main.py` | FastAPI service exposing `/health`, `/`, `/docs`, and `/detect-anomalies` for IsolationForest scoring. |
| PostgreSQL | `pgvector/pgvector:pg16` in `server/docker-compose.yml` | Stores projects, API keys, logs, embeddings, alert rules, and alert events. |
| Redis | `redis:7-alpine` in `server/docker-compose.yml` | Stores the `log_buffer` ingestion list and `embedding_queue` enrichment list. |

### Data Flow

1. `POST /api/v1/projects` inserts a project row, generates a `log_` API key, hashes the key with bcrypt, stores only the hash and prefix, and returns the raw key once.
2. `POST /api/v1/logs` authenticates the bearer key, validates the payload, normalizes a single log or an array, and pushes JSON entries into Redis `log_buffer`.
3. `startFlushWorker()` starts a timer that calls `flushLogs()` every 2 seconds. `flushLogs()` reads up to 5,000 entries from `log_buffer`, bulk-inserts them into `logs`, trims Redis after a successful transaction, and pushes inserted IDs into `embedding_queue`.
4. `startEmbeddingWorker()` starts a timer that calls `processEmbeddings()` every 10 seconds. The worker pops up to 100 items, calls the configured OpenAI-compatible embedding API, and updates `logs.embedding` with a pgvector string.
5. Search routes instantiate `LogHybridRetriever`, which can run pgvector semantic search, PostgreSQL full-text search, or both. Hybrid mode fuses ranks with Reciprocal Rank Fusion.
6. LLM search responses use `google/gemini-3.5-flash` through an OpenAI-compatible endpoint. The agent path uses `openai/gpt-4o-mini` through LangGraph.
7. `startAnomalyWorker()` calls `detectAnomalies()` immediately and every 5 minutes. The worker checks Python ML `/health`, selects recent embedded logs by project and service, and posts embeddings to `/detect-anomalies`.
8. The Python service normalizes embeddings, fits `IsolationForest`, converts decision scores into a 0-1 anomaly score, and returns per-log anomaly flags.
9. The anomaly worker updates only anomalous rows with `anomaly_score` and `is_anomaly = TRUE`, then fires active alert rules whose condition type is `anomaly`.
10. The React dashboard polls logs, stats, services, alert rules, and alert events through the API. Search streaming uses Server-Sent Events from `/api/v1/search/stream`.

```mermaid
flowchart LR
  Producer[Log producers] -->|POST /api/v1/logs + Bearer key| API[Express API]
  Dashboard[React dashboard] -->|REST + SSE| API

  API -->|RPUSH log_buffer| Redis[(Redis)]
  Redis -->|LRANGE batch| Flush[flushLogs worker]
  Flush -->|BEGIN + bulk INSERT + COMMIT| Postgres[(PostgreSQL + pgvector)]
  Flush -->|LTRIM after successful insert| Redis
  Flush -->|RPUSH embedding_queue| Redis

  Redis -->|LPOP up to 100| Embeddings[processEmbeddings worker]
  Embeddings -->|embedDocuments| EmbeddingProvider[OpenAI-compatible embeddings]
  Embeddings -->|UPDATE logs.embedding| Postgres

  API -->|pgvector + tsvector queries| Retriever[LogHybridRetriever]
  Retriever --> Postgres
  API -->|chat completions / streaming| LLM[OpenAI-compatible LLM]
  API -->|LangGraph invoke| Agent[logAnalysisAgent]
  Agent -->|search_logs / get_stats / check_anomalies / get_services| Postgres

  Anomaly[detectAnomalies worker] -->|GET /health| PythonML[FastAPI ML service]
  Anomaly -->|POST /detect-anomalies| PythonML
  PythonML -->|IsolationForest results| Anomaly
  Anomaly -->|UPDATE anomaly_score, is_anomaly| Postgres
  Anomaly -->|fireAlert webhook| Webhook[External webhook URL]

  WorkerIndex[server/src/workers/index.ts] --> Flush
  WorkerIndex --> Embeddings
  WorkerIndex --> Anomaly
  WorkerIndex --> Retention[cron: delete logs older than 30 days]
```

---

## Features

### Log Ingestion

| Capability | Implementation detail |
| --- | --- |
| Project-scoped ingestion | `apiKeyAuth` attaches `project_id` and `api_key_id` to authenticated Express requests. |
| Single and batch payloads | `POST /logs` accepts either one log object or an array and caps each request at 1,000 logs. |
| Fast request acknowledgement | The ingestion route writes to Redis and returns `202 Accepted`; Postgres writes happen in `flushWorker.ts`. |
| Durable database flush | The flush worker bulk-inserts logs inside a transaction and trims Redis only after the insert succeeds. |
| Embedding queue fan-out | Inserted log IDs and messages are pushed into `embedding_queue` for separate enrichment. |

### Retrieval and Analysis

| Capability | Implementation detail |
| --- | --- |
| Semantic retrieval | `LogHybridRetriever` embeds the query and orders logs by pgvector cosine distance. |
| Keyword retrieval | PostgreSQL generated `fts_vector` and `plainto_tsquery('english', q)` support exact-term retrieval. |
| Hybrid mode | Reciprocal Rank Fusion combines semantic and keyword rankings with default weights `0.6` and `0.4`. |
| Search modes | `mode=hybrid`, `mode=semantic`, and `mode=keyword` change retriever weights without changing the endpoint contract. |
| Natural-language analysis | `/api/v1/search` sends retrieved logs to the configured chat model and returns an answer plus evidence logs. |
| Structured analysis | `/api/v1/search/structured` validates LLM output against `SearchAnswerSchema` using Zod. |
| Streaming analysis | `/api/v1/search/stream` emits `logs`, `chunk`, `done`, and `error` SSE events. |

### Agent Workflow

| Capability | Implementation detail |
| --- | --- |
| Tool selection | LangGraph routes from the agent node to a tool node when the last AI message contains tool calls. |
| Log search tool | `search_logs` uses `LogHybridRetriever` with optional service and search-mode controls. |
| Stats tool | `get_stats` computes service error rates over a configurable hour window. |
| Anomaly lookup tool | `check_anomalies` reads rows where `is_anomaly = TRUE` and orders by `anomaly_score`. |
| Service discovery tool | `get_services` lists active services by count and last-seen timestamp. |
| Run metadata | `logAnalysisAgent.invoke` sets `runName`, `tags`, `projectId`, `question`, and timestamp metadata. |

### Machine Learning Anomaly Detection

| Capability | Implementation detail |
| --- | --- |
| Health-gated scoring | The anomaly worker skips detection if `GET ${PYTHON_ML_URL}/health` fails within 3 seconds. |
| Service-level batches | Recent embeddings are selected by `project_id`, `service`, and `timestamp > NOW() - INTERVAL '1 hour'`. |
| Embedding validation | The worker accepts only parsed arrays with length `1536`. |
| IsolationForest scoring | FastAPI converts embeddings to NumPy, L2-normalizes them, fits `IsolationForest`, and returns per-log results. |
| Database persistence | Only anomalous results update `logs.anomaly_score` and `logs.is_anomaly`. |

### Alerting and Dashboard

| Capability | Implementation detail |
| --- | --- |
| Alert rule storage | `alert_rules` stores project ID, condition JSON, service, webhook URL, email field, active flag, and creation time. |
| Alert event storage | `fireAlert()` inserts each fired event into `alert_events`. |
| Webhook notification | If `notify_url` is set, `fireAlert()` posts event details with a 5-second timeout. |
| Dashboard polling | `Dashboard.tsx` refreshes logs, stats, services, and alerts every 10 seconds. |
| UI filtering | The dashboard filters log retrieval by level and service through query parameters. |

---

## Tech Stack

| Category | Current | Planned / Notes |
| --- | --- | --- |
| Backend | Node.js, Express 5, TypeScript, LangChain, LangGraph | Server Dockerfile is not present. |
| Frontend | React 19, Vite, Tailwind CSS 4, Recharts, Lucide React, React Markdown | The client is a Vite SPA. |
| Database | PostgreSQL 16 through `pgvector/pgvector:pg16`; schema uses `vector(1536)` and generated `tsvector` | Migration tooling is not present. |
| Message Queue | Redis lists through `ioredis`: `log_buffer` and `embedding_queue` | Kafka and consumer groups are not implemented. |
| Cache | Redis is provisioned and used as queue/buffer state | Dedicated response caching is not implemented. |
| Containerization | `server/docker-compose.yml` starts Postgres, Redis, and Python ML; `python-ml/Dockerfile` builds the ML service | API and client Dockerfiles are not present. |
| Monitoring | API `/health`, Python `/health`, Morgan request logs, slow-query warnings, LangChain tracing env vars | Prometheus/Grafana are not present. |
| Logging | Morgan for HTTP access logs; worker and database errors use `console`; user logs persist in Postgres | Centralized internal logging is not implemented. |
| Machine Learning | FastAPI, scikit-learn IsolationForest, NumPy, Pydantic models, normalized embeddings | Persisted model registry/versioning is not implemented. |
| CI/CD | Not present in repository | GitHub Actions or equivalent is planned. |
| Cloud | Not present in repository | Cloud deployment configuration is planned. |
| Infrastructure | Local Compose file under `server/docker-compose.yml` | Kubernetes manifests or Helm charts are planned. |

---

## Project Structure

```text
.
|-- client/
|   |-- public/
|   |   |-- favicon.svg
|   |   `-- icons.svg
|   |-- src/
|   |   |-- pages/
|   |   |   |-- Dashboard.tsx
|   |   |   `-- Login.tsx
|   |   |-- utils/
|   |   |   `-- api.ts
|   |   |-- App.tsx
|   |   |-- index.css
|   |   `-- main.tsx
|   |-- package.json
|   `-- vite.config.ts
|-- python-ml/
|   |-- app/
|   |   |-- __init__.py
|   |   `-- main.py
|   |-- Dockerfile
|   `-- requirements.txt
|-- server/
|   |-- src/
|   |   |-- db/
|   |   |   |-- index.ts
|   |   |   `-- schema.sql
|   |   |-- middleware/
|   |   |   `-- apiKey.ts
|   |   |-- routes/
|   |   |   |-- agent.ts
|   |   |   |-- alerts.ts
|   |   |   |-- auth.ts
|   |   |   |-- logs.ts
|   |   |   |-- search.ts
|   |   |   `-- stats.ts
|   |   |-- services/
|   |   |   |-- agent.ts
|   |   |   |-- embedding.ts
|   |   |   |-- hybridRetriever.ts
|   |   |   `-- llm.ts
|   |   |-- types/
|   |   |   `-- index.ts
|   |   |-- workers/
|   |   |   |-- anomalyWorker.ts
|   |   |   |-- embeddingWorker.ts
|   |   |   |-- flushWorker.ts
|   |   |   `-- index.ts
|   |   `-- index.ts
|   |-- docker-compose.yml
|   |-- package.json
|   `-- tsconfig.json
`-- README.md
```

| Directory | Implementation role |
| --- | --- |
| `client/` | Vite React application; stores API key in `localStorage` and calls the Express API through `client/src/utils/api.ts`. |
| `client/src/pages/` | `Login.tsx` handles project creation/API-key entry; `Dashboard.tsx` renders stats, log rows, search results, agent output, alert rules, and alert events. |
| `server/` | TypeScript API and worker package with build, dev, start, and worker npm scripts. |
| `server/src/routes/` | Express route modules mounted under `/api/v1`. |
| `server/src/workers/` | Timer-driven background jobs started from `server/src/workers/index.ts`. |
| `server/src/services/` | Embedding client, LLM answer generation, hybrid retrieval, and LangGraph agent logic. |
| `server/src/db/` | PostgreSQL pool wrapper and SQL schema. |
| `python-ml/` | FastAPI service and Dockerfile for the IsolationForest scoring endpoint. |

---

## Architecture Decisions

### Express and TypeScript

Express keeps request routing and middleware explicit. TypeScript is used for route, worker, and service code so request augmentation (`project_id`, `api_key_id`), worker payloads, and database row shapes can be represented in the codebase.

Tradeoff: Express does not provide dependency injection, migrations, request schema validation, or module boundaries by default. This repository keeps those concerns simple; a production version would add a validation layer and migration runner before increasing route count.

### Redis Lists for Queueing

The ingestion route pushes log entries into Redis `log_buffer`, which removes Postgres write latency from the API request path. The flush worker trims the list only after a successful database transaction, so a database failure leaves queued logs available for a later retry.

Tradeoff: Redis lists are simple but do not provide Kafka-style partitioning, consumer group offsets, replay windows, or dead-letter topics. Multiple flush workers would require careful coordination to avoid competing `LRANGE`/`LTRIM` behavior.

### Bulk Inserts

`flushLogs()` builds one multi-row `INSERT INTO logs (...) VALUES ... RETURNING id, message` statement for each batch. The returned IDs feed the embedding queue, which keeps database persistence and embedding generation decoupled.

Tradeoff: Larger batches reduce database round trips but increase transaction size and memory pressure. The current cap is 5,000 logs per flush cycle.

### PostgreSQL with pgvector

PostgreSQL stores relational log fields, JSON metadata, full-text search data, and embeddings in one database. The `logs` table uses `embedding vector(1536)` and a generated `fts_vector` column so semantic and keyword retrieval can share project/time/service filters.

Tradeoff: A single database reduces local operational complexity but concentrates write load, vector search, text search, and dashboard reads. A larger deployment may split hot log ingestion, long-term retention, and vector retrieval into separate storage systems.

### Hybrid Retrieval

`LogHybridRetriever` runs vector retrieval when semantic weight is greater than zero and full-text retrieval when keyword weight is greater than zero. Hybrid mode merges the two ranked lists using Reciprocal Rank Fusion with `k = 60`.

Tradeoff: RRF avoids model-specific score calibration between cosine similarity and `ts_rank`, but it does not account for recency, severity, service priority, or click feedback.

### Worker Process Boundary

`server/src/workers/index.ts` starts `startFlushWorker()`, `startEmbeddingWorker()`, `startAnomalyWorker()`, and a nightly retention cron in one process. This isolates expensive or slow operations from API handlers while keeping local development simple.

Tradeoff: One worker process couples unrelated jobs for deployment and failure recovery. Production deployment would usually run flush, embedding, anomaly detection, and retention as separate worker deployments.

### Python ML Service

Anomaly detection runs in Python because the current algorithm uses scikit-learn and NumPy. The TypeScript worker handles data selection, validation, database updates, and alert firing; FastAPI handles scoring.

Tradeoff: The service boundary adds HTTP timeouts and availability checks. The worker skips anomaly detection when `/health` is unavailable instead of blocking other workers.

### LangChain and LangGraph

LangChain provides embedding and chat model wrappers, and LangGraph provides the agent control flow. The agent exposes database-backed tools instead of letting the model answer from prompt context alone.

Tradeoff: Agent calls add LLM latency and require bounded recursion. The current invoke config uses `recursionLimit: 8` and attaches run metadata for tracing.

---

## Machine Learning Pipeline

### Feature Extraction

The embedding worker reads `{ log_id, message }` records from Redis `embedding_queue`. It batches up to 100 messages, truncates each message to 8,000 characters, calls `OpenAIEmbeddings.embedDocuments`, and updates `logs.embedding` with a pgvector-compatible string.

The schema stores embeddings as `vector(1536)`, matching the current validation in `anomalyWorker.ts` and the HNSW index in `schema.sql`.

### Training

There is no persistent offline training job in the repository. The Python service fits an `IsolationForest` for each `/detect-anomalies` request using the embeddings provided by the Node.js worker.

The current request batch is service-scoped and time-scoped: the worker selects at most 200 embedded logs from the last hour for each distinct `(project_id, service)` pair. Batches with fewer than 10 valid embeddings are skipped.

### Inference

The Python service converts request embeddings into a NumPy `float32` array, normalizes rows with L2 normalization, fits `IsolationForest(contamination=req.contamination, n_estimators=100, random_state=42, n_jobs=-1)`, and calls both `decision_function()` and `predict()`.

Predictions of `-1` are returned as anomalies. Raw decision scores are normalized into a 0-1 scale where higher values represent more anomalous rows.

The Node.js worker persists only positive anomaly results:

```sql
UPDATE logs
SET anomaly_score = $1, is_anomaly = TRUE
WHERE id = $2 AND is_anomaly = FALSE
```

### Model Versioning

Model versioning is not implemented. The API response includes `algorithm: "IsolationForest"` and `contamination_used`, but the database does not store model artifacts, scoring run IDs, parameter snapshots, or embedding-model versions.

Planned model-versioning work includes storing scoring metadata, algorithm parameters, embedding model identifiers, and drift metrics with each anomaly run.

### Future ML Improvements

- Persist anomaly scoring runs and associate each updated log row with a run ID.
- Store embedding model version and dimensions with the scoring metadata.
- Use historical baselines per service instead of only the most recent one-hour window.
- Add seasonality handling for services with time-of-day traffic patterns.
- Compare IsolationForest with Local Outlier Factor, One-Class SVM, and clustering over embeddings.
- Add human feedback from acknowledged incidents and false positives.

---

## Scalability

The API server is stateless after it receives configuration from environment variables. Horizontal scaling is possible if all instances share the same PostgreSQL database, Redis instance, model provider, and Python ML endpoint.

The worker model scales by separating job types rather than by adding threads inside the API process. Flush throughput depends on Redis read/trim behavior, Postgres insert throughput, and the `BATCH_SIZE` of 5,000. Embedding throughput depends on the `BATCH_SIZE` of 100 and the external embedding provider's rate limits.

The current Redis-list implementation is adequate for one flush worker and one embedding worker. Kafka is planned for a production queue design because topics, partitions, offsets, retention, replay, and consumer groups map better to independent horizontally scaled workers.

The database schema includes indexes for the main read paths: HNSW over embeddings for vector search, GIN over `fts_vector` for text search, and composite indexes for project/service/time and project/level/time filters.

Docker Compose currently starts Postgres, Redis, and Python ML for local infrastructure. Future Kubernetes deployment would split the API, flush worker, embedding worker, anomaly worker, retention job, Redis, PostgreSQL, and Python ML service into separately managed workloads.

Planned scaling work:

- Add Kafka topics for ingestion, embedding, anomaly scoring, and dead-letter records.
- Use Kafka consumer groups to scale workers without duplicate queue consumption.
- Split the combined worker process into separately deployable jobs.
- Add Kubernetes manifests or Helm charts.
- Add autoscaling based on queue depth, API latency, and worker lag.
- Add table partitioning or tiered storage for large log volumes.

---

## Security

### Authentication

API authentication is bearer-token based. `POST /api/v1/projects` generates a raw key with a `log_` prefix, stores only a bcrypt hash plus a 12-character prefix, and returns the raw key once.

`apiKeyAuth` uses the prefix to narrow candidate rows, then uses `bcrypt.compare()` against non-revoked keys. On success it attaches `project_id` and `api_key_id` to the Express request and asynchronously updates `last_used`.

### Authorization

Project isolation is implemented through route-level query scoping. Log retrieval, service listing, stats, search, alert rules, alert events, API-key creation/listing/revocation, and agent tools all use the authenticated `project_id`.

The current project model does not include users, organizations, roles, or membership records. RBAC is planned.

### Secrets Management

The server loads configuration with `dotenv/config`, and `server/.gitignore` excludes `.env` files. The current repository does not include a managed secret store integration.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string for API and workers. |
| `REDIS_URL` | Redis connection string for ingestion and embedding queues. |
| `PORT` | Express API port. |
| `FRONTEND_URL` | CORS origin used by Express and SSE responses. |
| `GEMINI_API_KEY` | API key for the OpenAI-compatible model provider. |
| `AICREDITS_BASE_URL` | OpenAI-compatible model provider base URL. |
| `PYTHON_ML_URL` | Base URL for the FastAPI ML service. |
| `LANGCHAIN_TRACING_V2` | Optional LangChain tracing toggle. |
| `LANGCHAIN_API_KEY` | Optional LangChain/LangSmith API key. |
| `LANGCHAIN_PROJECT` | Optional tracing project name. |
| `LANGCHAIN_ENDPOINT` | Optional tracing endpoint. |

### Input Validation

Implemented validation is route-local. Log ingestion requires `message`, caps each request at 1,000 logs, defaults missing `level` to `INFO`, defaults missing `service` to `unknown`, and uses a 5 MB Express JSON limit.

Search routes require `q`, validate `from` and `to` as dates, and cap `limit` at 50. Log retrieval validates date filters and caps `limit` at 200. The agent route requires a string `question` and caps it at 500 characters.

### Rate Limiting

Rate limiting is not implemented. Planned controls include per-key ingestion limits, tighter limits for LLM-backed routes, webhook signing, delivery retry policy, audit logging for key lifecycle events, and centralized request schema validation.

---

## Performance

### Throughput

Ingestion throughput is protected from Postgres latency by Redis buffering. The request path serializes each log, pipelines `RPUSH` commands, and returns after Redis accepts the entries.

Database write throughput is improved by `flushWorker.ts`, which turns up to 5,000 queued log entries into one multi-row insert. The worker uses a transaction so Redis trimming is tied to database success.

Embedding throughput is bounded by 100 messages per worker interval and external embedding API behavior. Failed embedding batches are pushed back to Redis so transient provider failures do not permanently drop enrichment work.

### Latency

The ingestion endpoint optimizes acknowledgement latency rather than end-to-end availability of searchable embeddings. A log is accepted before it is visible in Postgres, before embedding generation, and before anomaly scoring.

Search latency depends on query embedding generation, pgvector/full-text queries, and LLM completion time. The streaming endpoint reduces perceived latency by emitting answer chunks with Server-Sent Events after logs are retrieved.

Anomaly detection is intentionally off the request path. The worker runs every 5 minutes and uses a 30-second timeout for ML scoring, so anomaly flags are eventually updated rather than synchronously computed during ingestion.

### Bottlenecks

- Embedding provider rate limits can slow `embedding_queue` drain rate.
- HNSW vector search and full-text search share PostgreSQL resources with writes and dashboard reads.
- Redis `LRANGE`/`LTRIM` list handling limits safe horizontal scaling of flush workers.
- The Python ML service fits a model per request, so CPU cost grows with service batch size and embedding dimension.
- LLM-backed endpoints add external model latency and provider failure modes.

### Optimizations Present

- HNSW index on `logs.embedding`.
- GIN index on generated `logs.fts_vector`.
- Composite indexes on `(project_id, service, timestamp DESC)` and `(project_id, level, timestamp DESC)`.
- Cursor pagination for `GET /api/v1/logs`.
- Slow-query logging for database calls above 1 second.
- Embedding retry behavior for `503` and `429`.
- Payload and result-size caps on ingestion, search, logs, and agent routes.

---

## Installation

### Prerequisites

| Tool | Why it is needed |
| --- | --- |
| Node.js and npm | Run the Express API, worker process, and React client. |
| Docker and Docker Compose | Start PostgreSQL, Redis, and the Python ML service from `server/docker-compose.yml`. |
| PostgreSQL client tools | Apply `server/src/db/schema.sql` manually because no migration runner is present. |
| Python 3.11 | Optional if running `python-ml` outside Docker. |
| OpenAI-compatible API key | Required by `server/src/services/embedding.ts`, `server/src/services/llm.ts`, and `server/src/services/agent.ts`. |

### 1. Enter the Repository

```bash
cd log_drain
```

### 2. Start Infrastructure and ML Service

`server/docker-compose.yml` starts `postgres`, `redis`, and `python-ml`.

```bash
cd server
docker compose up -d
```

### 3. Configure Server Environment

Create `server/.env` with values matching the local Compose ports.

```bash
DATABASE_URL=postgresql://logdrain:logdrain123@localhost:5433/logdrain_db
REDIS_URL=redis://localhost:6379
PORT=3000
FRONTEND_URL=http://localhost:5173
GEMINI_API_KEY=your_openai_compatible_api_key
AICREDITS_BASE_URL=https://api.aicredits.in/v1
PYTHON_ML_URL=http://localhost:8000
LANGCHAIN_TRACING_V2=false
LANGCHAIN_API_KEY=
LANGCHAIN_PROJECT=log-drain
LANGCHAIN_ENDPOINT=
```

### 4. Apply Database Schema

The schema file creates `vector`, `projects`, `api_keys`, `logs`, indexes, `alert_rules`, and `alert_events`.

```bash
psql "postgresql://logdrain:logdrain123@localhost:5433/logdrain_db" -f server/src/db/schema.sql
```

If the current shell is already in `server/`, use:

```bash
psql "postgresql://logdrain:logdrain123@localhost:5433/logdrain_db" -f src/db/schema.sql
```

### 5. Install Server Dependencies

```bash
cd server
npm install
```

### 6. Install Client Dependencies

```bash
cd ../client
npm install
```

### 7. Optional: Run Python ML Without Docker

```bash
cd python-ml
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

On Windows PowerShell:

```powershell
cd python-ml
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

---

## Running the Project

### Local Development

Run the API server:

```bash
cd server
npm run dev
```

Run the combined worker process:

```bash
cd server
npm run worker
```

Run the React client:

```bash
cd client
npm run dev
```

| Runtime | Default URL or port |
| --- | --- |
| React client | `http://localhost:5173` |
| Express API | `http://localhost:3000` |
| Python ML service | `http://localhost:8000` |
| Python ML OpenAPI docs | `http://localhost:8000/docs` |
| PostgreSQL host port | `localhost:5433` |
| Redis host port | `localhost:6379` |

### Docker

The current Compose file does not start the API server or client. It starts Postgres, Redis, and the Python ML service.

```bash
cd server
docker compose up -d
```

### Production Build

The server build compiles TypeScript from `server/src` into `server/dist`.

```bash
cd server
npm run build
npm start
```

The client build runs TypeScript project references and Vite bundling.

```bash
cd client
npm run build
npm run preview
```

Server/client Dockerfiles and cloud deployment manifests are not present in the repository.

---

## API Documentation

### Authentication

Authenticated endpoints require a bearer API key created by `POST /api/v1/projects` or `POST /api/v1/api-keys`.

```http
Authorization: Bearer log_<api_key>
```

### Health

| Method | Endpoint | Auth | Handler behavior |
| --- | --- | --- | --- |
| `GET` | `/health` | No | Returns JSON with `status: "ok"` and the current timestamp. |

Response:

```json
{
  "status": "ok",
  "timestamp": "2026-07-24T00:00:00.000Z"
}
```

### Projects and API Keys

| Method | Endpoint | Auth | Handler behavior |
| --- | --- | --- | --- |
| `POST` | `/api/v1/projects` | No | Inserts a project, creates the first bcrypt-hashed API key, and returns the raw key once. |
| `POST` | `/api/v1/api-keys` | Yes | Creates an additional bcrypt-hashed API key for the authenticated project. |
| `GET` | `/api/v1/api-keys` | Yes | Returns key metadata: `id`, `name`, `created_at`, `last_used`, and `revoked`. |
| `DELETE` | `/api/v1/api-keys/:id` | Yes | Sets `revoked = TRUE` for a key scoped to the authenticated project. |

Create project request:

```json
{
  "name": "Payments Platform"
}
```

Create project response shape:

```json
{
  "project": {
    "id": "uuid",
    "name": "Payments Platform"
  },
  "api_key": "log_generated_key",
  "message": "Save your API key; it will not be shown again"
}
```

### Logs

| Method | Endpoint | Auth | Handler behavior |
| --- | --- | --- | --- |
| `POST` | `/api/v1/logs` | Yes | Validates log payloads, pushes entries into Redis `log_buffer`, and returns `202`. |
| `GET` | `/api/v1/logs` | Yes | Reads logs scoped by project with optional filters and cursor pagination. |
| `GET` | `/api/v1/services` | Yes | Groups logs by service and returns log count plus last-seen timestamp. |

Ingest one log:

```json
{
  "level": "ERROR",
  "message": "Database connection refused",
  "service": "api",
  "timestamp": "2026-07-24T00:00:00.000Z",
  "metadata": {
    "region": "us-east-1"
  }
}
```

Ingestion response:

```json
{
  "accepted": 1,
  "message": "Logs accepted for processing"
}
```

Log retrieval query parameters:

| Parameter | Behavior |
| --- | --- |
| `level` | Adds `level = $n` after converting the value to uppercase. |
| `service` | Adds `service = $n`. |
| `from` | Adds `timestamp >= $n` after date validation. |
| `to` | Adds `timestamp <= $n` after date validation. |
| `cursor` | Adds `id < $n` for cursor pagination. |
| `limit` | Defaults to `50` and is capped at `200`. |

Log retrieval response shape:

```json
{
  "logs": [
    {
      "id": 1,
      "level": "ERROR",
      "message": "Database connection refused",
      "service": "api",
      "timestamp": "2026-07-24T00:00:00.000Z",
      "metadata": {},
      "is_anomaly": false,
      "anomaly_score": null
    }
  ],
  "next_cursor": null,
  "has_more": false
}
```

### Search

| Method | Endpoint | Auth | Handler behavior |
| --- | --- | --- | --- |
| `GET` | `/api/v1/search` | Yes | Runs hybrid retrieval and returns an LLM-generated answer with evidence logs. |
| `GET` | `/api/v1/search/structured` | Yes | Runs hybrid retrieval and validates structured LLM output with Zod. |
| `GET` | `/api/v1/search/stream` | Yes | Runs hybrid retrieval and streams answer chunks through SSE. |

Search query parameters:

| Parameter | Behavior |
| --- | --- |
| `q` | Required user query string. |
| `from` | Optional start timestamp filter with date validation. |
| `to` | Optional end timestamp filter with date validation. |
| `service` | Optional exact service filter. |
| `limit` | Defaults to `10` and is capped at `50`. |
| `mode` | `hybrid`, `semantic`, or `keyword`; defaults to `hybrid`. |

Search response shape:

```json
{
  "answer": "Natural-language analysis of the retrieved logs.",
  "logs": [
    {
      "id": 1,
      "level": "ERROR",
      "message": "Database connection refused",
      "service": "api",
      "timestamp": "2026-07-24T00:00:00.000Z",
      "metadata": {},
      "rrf_score": 0.0163934426
    }
  ],
  "query": "why is the api failing",
  "mode": "hybrid",
  "logs_searched": 1
}
```

Structured search response shape:

```json
{
  "structured": {
    "answer": "Detailed analysis answering the question.",
    "severity": "high",
    "affected_services": ["api"],
    "error_count": 3,
    "time_range": {
      "start": "2026-07-24T00:00:00.000Z",
      "end": "2026-07-24T00:10:00.000Z"
    },
    "summary": "Plain-English summary.",
    "recommendations": ["Investigate database connectivity."]
  },
  "logs": [],
  "query": "why is the api failing",
  "mode": "hybrid",
  "logs_searched": 10
}
```

Streaming search emits these SSE event names:

| Event | Payload |
| --- | --- |
| `logs` | Retrieved logs and selected search mode. |
| `chunk` | Incremental answer text. |
| `done` | Completion metadata with `logs_searched`. |
| `error` | Failure message. |

### Agent

| Method | Endpoint | Auth | Handler behavior |
| --- | --- | --- | --- |
| `POST` | `/api/v1/agent/query` | Yes | Validates `question`, calls `runLogAnalysisAgent`, and returns answer plus tool names. |

Request:

```json
{
  "question": "Were there anomalies in the payment service in the last day?"
}
```

Response shape:

```json
{
  "answer": "Agent-generated answer based on tool calls.",
  "tools_used": ["search_logs", "check_anomalies"],
  "question": "Were there anomalies in the payment service in the last day?"
}
```

### Stats

| Method | Endpoint | Auth | Handler behavior |
| --- | --- | --- | --- |
| `GET` | `/api/v1/stats` | Yes | Returns log volume grouped by hour/service/level, error rates by service, and 24-hour anomaly count. |

Query parameters:

| Parameter | Behavior |
| --- | --- |
| `hours` | Defaults to `24` and is capped at `168` for volume data. |

Response shape:

```json
{
  "volume_by_hour": [],
  "error_rates": [],
  "anomaly_count_24h": 0
}
```

### Alert Rules and Alerts

| Method | Endpoint | Auth | Handler behavior |
| --- | --- | --- | --- |
| `POST` | `/api/v1/alert-rules` | Yes | Inserts an alert rule for the authenticated project. |
| `GET` | `/api/v1/alert-rules` | Yes | Lists alert rules ordered by `created_at DESC`. |
| `GET` | `/api/v1/alerts` | Yes | Joins `alert_events` to `alert_rules` and returns the 50 most recent events. |

Create alert rule request:

```json
{
  "name": "Payment API anomaly alert",
  "condition": {
    "type": "anomaly"
  },
  "service": "payment-api",
  "notify_url": "https://example.com/webhook",
  "notify_email": ""
}
```

### Python ML Service

| Method | Endpoint | Handler behavior |
| --- | --- | --- |
| `GET` | `/` | Returns service metadata and endpoint names. |
| `GET` | `/health` | Returns `status`, `service`, and `algorithm`. |
| `POST` | `/detect-anomalies` | Validates request shape, runs IsolationForest, and returns scoring results. |
| `GET` | `/docs` | FastAPI-generated OpenAPI UI. |

Detect anomalies request shape:

```json
{
  "project_id": "uuid",
  "service": "api",
  "log_ids": [1, 2, 3],
  "embeddings": [[0.1, 0.2]],
  "contamination": 0.1
}
```

Detect anomalies response shape:

```json
{
  "service": "api",
  "project_id": "uuid",
  "total_logs": 200,
  "anomalies_found": 20,
  "results": [
    {
      "log_id": 1,
      "anomaly_score": 0.9123,
      "is_anomaly": true
    }
  ],
  "algorithm": "IsolationForest",
  "contamination_used": 0.1
}
```

---

## Screenshots

Screenshots are not committed. The README reserves paths for the UI and service surfaces that exist in the repository.

| Area | Placeholder path |
| --- | --- |
| Dashboard | `docs/screenshots/dashboard.png` |
| Logs | `docs/screenshots/log-stream.png` |
| API | `docs/screenshots/api-response.png` |
| ML | `docs/screenshots/ml-detection.png` |

---

## Roadmap

### Completed

- [x] Project creation with one-time API key return.
- [x] Bcrypt-hashed API keys with prefix lookup.
- [x] API-key-authenticated log ingestion.
- [x] Redis-backed ingestion buffer.
- [x] Bulk log flush worker.
- [x] Embedding worker with retry and queue reinsert on failure.
- [x] PostgreSQL schema with pgvector and full-text search.
- [x] HNSW vector index.
- [x] Hybrid semantic and keyword search.
- [x] LLM-generated search answers.
- [x] Structured AI search response.
- [x] Streaming AI search response through SSE.
- [x] LangGraph log analysis agent.
- [x] Python FastAPI ML service.
- [x] IsolationForest anomaly detection.
- [x] Anomaly alert rules and alert events.
- [x] Webhook alert delivery.
- [x] React dashboard with stats, logs, search, agent UI, and alert-rule creation.
- [x] 30-day retention cleanup worker.
- [x] Docker Compose for Postgres, Redis, and Python ML service.

### Planned

- [ ] Backend Dockerfile.
- [ ] Frontend Dockerfile.
- [ ] Root-level Docker Compose for full-stack startup.
- [ ] Database migration tool.
- [ ] Test suite for API routes, workers, retriever, and ML service.
- [ ] Kafka-based ingestion pipeline with consumer groups.
- [ ] Prometheus metrics and Grafana dashboard.
- [ ] Centralized service logs.
- [ ] Request rate limiting.
- [ ] RBAC and multi-user project membership.
- [ ] Signed webhooks and delivery retries.
- [ ] Model registry and anomaly scoring run history.
- [ ] Kubernetes manifests or Helm chart.
- [ ] CI/CD pipeline.
- [ ] Cloud deployment configuration.

---

## Future Enhancements

- Kafka topics would replace Redis-list queue coordination for durable retention, replay, partitioning, and independent consumer groups.
- Dead-letter queues would separate malformed payloads and permanently failing enrichment jobs from retryable queue items.
- OpenTelemetry spans would connect API requests, database queries, worker cycles, embedding calls, LLM calls, and Python ML requests.
- Prometheus metrics would expose ingestion rate, queue depth, flush latency, embedding latency, search latency, anomaly scoring latency, and webhook failures.
- Partitioned log tables or tiered storage would reduce index pressure for large retention windows.
- RBAC would add users, organizations, memberships, and role-scoped authorization checks.
- Webhook delivery would add retries, exponential backoff, signing, and delivery status.
- Integration tests would start Postgres and Redis from Docker Compose and exercise ingestion through worker persistence.
- Load tests would measure `POST /api/v1/logs`, flush throughput, embedding backlog behavior, and search latency under indexed data volume.
- Kubernetes manifests would split API, worker types, and Python ML into independently scaled deployments.

---

## Lessons Learned

- Returning `202 Accepted` after Redis enqueue reduces ingestion latency but makes read-after-write consistency eventual.
- Trimming Redis after a successful Postgres transaction protects queued logs from database failures, but Redis lists still require stricter coordination for multiple flush workers.
- Storing relational filters, full-text data, and vector embeddings in PostgreSQL simplifies local operation while concentrating write, search, and dashboard read load.
- Validating LLM structured output with Zod prevents downstream code from assuming the model returned the requested JSON shape.
- Moving IsolationForest scoring to FastAPI keeps ML dependencies out of the Node.js runtime while adding HTTP health checks, timeouts, and fallback behavior.
- Persisting anomaly flags on the `logs` table makes dashboard retrieval simple but does not preserve scoring run history.
- Project-scoped API keys keep route authorization simple, but multi-user access requires a separate user and membership model.

---

## Key Engineering Highlights

- Designed a Redis-buffered ingestion path that decouples API acknowledgement from PostgreSQL persistence.
- Implemented transactional bulk flush from Redis to PostgreSQL with queue trimming after commit.
- Implemented asynchronous embedding enrichment with retry and queue reinsert behavior.
- Built hybrid retrieval over pgvector semantic search and PostgreSQL full-text search using Reciprocal Rank Fusion.
- Added LLM analysis endpoints with standard, structured, and SSE streaming response modes.
- Built a LangGraph agent with database-backed tools for search, stats, anomaly lookup, and service discovery.
- Integrated FastAPI and scikit-learn IsolationForest as a separate anomaly-scoring service.
- Persisted anomaly flags and scores on log rows and alert events in a separate table.
- Implemented project-scoped bearer API-key authentication with bcrypt hashing, prefix lookup, revocation, and `last_used` updates.
- Provisioned Postgres, Redis, and Python ML through Docker Compose for local infrastructure startup.
- Built a React dashboard that reads the implemented API surfaces: logs, stats, services, alert rules, alert events, streaming search, and agent responses.
- Added operational controls including payload limits, result limits, cursor pagination, slow-query logging, model-provider retries, and ML-service timeouts.

---

## Engineering Scope

The repository contains multiple implementation boundaries that are common in observability systems: ingestion API, queue buffer, bulk writer, enrichment worker, vector/text retrieval, LLM analysis, agent tooling, ML scoring service, alert persistence, webhook notification, and dashboard reads.

Compared with a single-table CRUD service, this codebase adds consistency and scaling decisions: queued writes create eventual consistency, embedding generation creates asynchronous enrichment, hybrid search requires ranking fusion, anomaly scoring requires batch selection and model-service fallback, and alerting requires idempotency considerations that are not fully solved in the current code.

The current codebase is local-first rather than production-complete. The documented planned work identifies the missing production pieces: Kafka, migrations, tests, rate limiting, observability metrics, worker separation, backend/client containerization, CI/CD, Kubernetes, and cloud deployment configuration.

---

## License

`server/package.json` declares the ISC license. A root `LICENSE` file is not present.

---

## Acknowledgements

The implementation depends on Node.js, Express, TypeScript, React, Vite, Tailwind CSS, Recharts, PostgreSQL, pgvector, Redis, FastAPI, NumPy, scikit-learn, LangChain, LangGraph, Docker, and Docker Compose.

---

## Contact

Maintainer contact information is not committed in this repository.
