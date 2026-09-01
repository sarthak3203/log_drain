# Log Drain

AI-powered log observability platform that turns application logs into searchable, actionable insights. Send logs through a project-scoped API, investigate incidents in natural language, detect anomalies, and manage alerts from a single dashboard.

**Deployment:** AWS EC2 · Docker Compose · Caddy · Neon PostgreSQL/pgvector · Upstash Redis

## Live application

| Resource | Link |
| --- | --- |
| Frontend / Dashboard | [13-233-126-133.nip.io](https://13-233-126-133.nip.io/) |
| Backend API | [13-233-126-133.nip.io/api/v1](https://13-233-126-133.nip.io/api/v1) |

## What it demonstrates

- **Production-style ingestion:** logs are queued in Redis and processed asynchronously, returning `202 Accepted` without waiting for database or AI work.
- **Reliable background processing:** distributed worker lock, idempotent writes, retryable queues, dead-letter handling, batched embeddings, and 30-day retention.
- **Hybrid AI search:** pgvector semantic search plus PostgreSQL full-text search, ranked with Reciprocal Rank Fusion (RRF).
- **AI investigation:** streamed answers, structured incident summaries, and a LangGraph agent with search, statistics, anomaly, and service-discovery tools.
- **ML anomaly detection:** a Python/FastAPI microservice runs IsolationForest against recent service embeddings every five minutes.
- **Secure multi-project access:** JWT user sessions, bcrypt-hashed API keys, ownership-scoped projects, revocation, CORS, Helmet, and rate limiting.

## Architecture

```text
Application --> Express API --> Upstash Redis --> Worker --> Neon PostgreSQL + pgvector
                                                         |
                                                         +--> Embeddings + IsolationForest ML service

Browser --> Caddy (HTTPS) --> React dashboard / Nginx --> Express API
```

The EC2 Compose stack runs schema migration, API, worker, dashboard, ML service, and Caddy. Neon PostgreSQL and Upstash Redis are managed external services.

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, Recharts |
| Backend | Node.js 20, Express 5, TypeScript |
| AI | LangChain, LangGraph, OpenAI-compatible LLM and embeddings |
| ML | Python 3.11, FastAPI, scikit-learn |
| Data & deployment | Neon PostgreSQL, pgvector, Upstash Redis, Docker Compose, Caddy, AWS EC2 |

## Send logs

```text
POST https://13-233-126-133.nip.io/api/v1/logs
```

Create a project in the dashboard and save its API key. Use it to send a log:

```bash
curl -X POST https://13-233-126-133.nip.io/api/v1/logs \
  -H "Authorization: Bearer log_your_project_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "level": "ERROR",
    "message": "Database connection refused",
    "service": "payment-api",
    "metadata": { "requestId": "req_123" }
  }'
```

`message` is required. `level`, `service`, `timestamp`, and `metadata` are optional. The endpoint accepts either one log object or an array of up to 1,000 logs.

## Selected API endpoints

All project-data endpoints require `Authorization: Bearer <project-api-key>`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/auth/register`, `/auth/login` | User account access and session JWTs |
| `POST` | `/projects` | Create a project and its first API key |
| `POST` / `GET` | `/logs` | Asynchronous ingestion and filtered log retrieval |
| `GET` | `/search`, `/search/stream`, `/search/structured` | Hybrid AI search and analysis |
| `POST` | `/agent/query` | Agent-led log investigation |
| `GET` | `/stats`, `/services` | Operational metrics and active services |
| `GET` / `POST` | `/alert-rules` | Anomaly alert management |

## Run locally

**Prerequisites:** Node.js 20+, Docker Compose, and an OpenAI-compatible API key.

```bash
# Configure the API (set DATABASE_URL, GEMINI_API_KEY, and JWT_SECRET)
cp server/.env.example server/.env

# Start local PostgreSQL, Redis, and ML service
cd server && docker compose up -d
docker exec -i logdrain-postgres psql -U logdrain -d logdrain_db < src/db/schema.sql

# In separate terminals
cd server && npm ci && npm run dev
cd server && npm run worker
cd client && npm ci && npm run dev
```

On PowerShell, copy the environment file with `Copy-Item server/.env.example server/.env` and apply the schema with `Get-Content src/db/schema.sql | docker exec -i logdrain-postgres psql -U logdrain -d logdrain_db`.

Open `http://localhost:5173` to register, create a project, and obtain an API key.

## Deploy to AWS EC2

Configure a root `.env` from [`server/.env.production.example`](server/.env.production.example) with Neon, Upstash, JWT, frontend-origin, and LLM-provider values. Then run:

```bash
docker compose -f docker-compose.aws.yml --env-file .env up --build -d
docker compose -f docker-compose.aws.yml ps
```

[`docker-compose.aws.yml`](docker-compose.aws.yml) publishes only Caddy on ports 80 and 443. Caddy serves `13-233-126-133.nip.io` over HTTPS, while the client’s Nginx proxy forwards `/api/` requests to the internal Express service.

## Project structure

```text
client/                 React dashboard and Nginx configuration
server/                 Express API, workers, retrieval, auth, and database schema
python-ml/              FastAPI IsolationForest service
docker-compose.aws.yml  AWS EC2 deployment stack
Caddyfile               HTTPS reverse-proxy configuration
```

## Validation

```bash
cd server && npm test
cd client && npm run lint && npm run build
```

Built with TypeScript, React, Node.js, Python, PostgreSQL/pgvector, Redis, LangChain, LangGraph, FastAPI, Docker Compose, and AWS EC2.
