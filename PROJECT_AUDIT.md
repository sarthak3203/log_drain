# Project Audit

Generated from the local repository at `D:\log_drain`.

Secrets, API keys, passwords, and credential-bearing URLs are redacted as `<REDACTED>`.

## 1. docker-compose.yml

Source: `server/docker-compose.yml`

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    container_name: logdrain-postgres
    environment:
      POSTGRES_USER: logdrain
      POSTGRES_PASSWORD: <REDACTED>
      POSTGRES_DB: logdrain_db
      POSTGRES_HOST_AUTH_METHOD: md5
    ports:
      - "5433:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    container_name: logdrain-redis
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

  python-ml:
    build:
      context: ../python-ml
      dockerfile: Dockerfile
    container_name: logdrain-python-ml
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql://logdrain:<REDACTED>@postgres:5433/logdrain_db
    depends_on:
      - postgres
    volumes:
      - ../python-ml:/app

volumes:
  postgres_data:
  redis_data:
```

Note: the original file contains a concrete local Postgres password and a credential-bearing `DATABASE_URL`; those values were redacted.

## 2. Environment Variables

### Used by application code or Docker Compose

| Variable | Where used | Purpose | Required/default |
|---|---|---|---|
| `DATABASE_URL` | `server/src/db/index.ts`, `server/docker-compose.yml` for `python-ml`, `server/.env`, `server/.env.example` | Postgres connection string for the Node backend and workers. Also supplied to the Python ML container, though the current Python code does not read it. | Required by Node DB layer. |
| `REDIS_URL` | `server/src/routes/logs.ts`, `server/src/workers/flushWorker.ts`, `server/src/workers/embeddingWorker.ts`, `server/.env`, `server/.env.example` | Redis connection string for ingestion buffering and embedding queue processing. | Required by code via non-null assertion. |
| `PORT` | `server/src/index.ts`, `server/.env`, `server/.env.example` | Express API listen port. | Defaults to `3000`. |
| `FRONTEND_URL` | `server/src/index.ts`, `server/src/routes/search.ts`, `server/.env`, `server/.env.example` | Allowed CORS origin for browser requests and SSE stream responses. | Defaults to `http://localhost:5173`. |
| `PYTHON_ML_URL` | `server/src/workers/anomalyWorker.ts`, `server/.env`, `server/.env.example` | Base URL for the FastAPI anomaly detection service. | Defaults to `http://localhost:8000`. |
| `GEMINI_API_KEY` | `server/src/services/embedding.ts`, `server/src/services/llm.ts`, `server/src/services/agent.ts`, `server/.env`, `server/.env.example` | API key for the OpenAI-compatible LLM/embedding provider. | Required at module load by embedding, LLM, and agent services. |
| `AICREDITS_BASE_URL` | `server/src/services/embedding.ts`, `server/src/services/llm.ts`, `server/src/services/agent.ts`, `server/.env`, `server/.env.example` | OpenAI-compatible provider base URL. | Defaults to `https://api.aicredits.in/v1`. |
| `VITE_API_URL` | `client/src/utils/api.ts` | Browser API base URL baked into the Vite frontend at build time. | Defaults to `http://localhost:3000/api/v1`. |
| `POSTGRES_USER` | `server/docker-compose.yml` | Postgres initialization username. | Compose value: `logdrain`. |
| `POSTGRES_PASSWORD` | `server/docker-compose.yml` | Postgres initialization password. | Compose value redacted. |
| `POSTGRES_DB` | `server/docker-compose.yml` | Postgres initialization database name. | Compose value: `logdrain_db`. |
| `POSTGRES_HOST_AUTH_METHOD` | `server/docker-compose.yml` | Postgres host authentication method. | Compose value: `md5`. |

### Present in env files but not directly read by project source

| Variable | Where present | Notes |
|---|---|---|
| `NODE_ENV` | `server/.env`, `server/.env.example` | Not directly referenced by project source. May affect dependency/library behavior. |
| `JWT_SECRET` | `server/.env`, `server/.env.example` | Not used by current auth implementation. Auth uses hashed API keys, not JWTs. |
| `EMBEDDING_MODEL` | `server/.env`, `server/.env.example` | Not read by current embedding code. `text-embedding-3-small` is hardcoded in `server/src/services/embedding.ts`. |

## 3. Ports

| Component | Port(s) | Source | Notes |
|---|---:|---|---|
| Express API server | `3000` by default, override with `PORT` | `server/src/index.ts` | API routes mounted under `/api/v1`; health endpoint at `/health`. |
| React Vite dev server | `5173` by Vite default | `client/package.json`, README | Started by `npm run dev`; no custom Vite server port is configured. |
| React Vite preview server | `4173` by Vite default | `client/package.json` | Started by `npm run preview`; no custom preview port is configured. |
| PostgreSQL container | host `5433` -> container `5432` | `server/docker-compose.yml` | Uses `pgvector/pgvector:pg16`. |
| Redis container | host `6379` -> container `6379` | `server/docker-compose.yml` | Uses `redis:7-alpine`. |
| Python FastAPI ML service | host `8000` -> container `8000` | `server/docker-compose.yml`, `python-ml/Dockerfile` | Uvicorn runs on `0.0.0.0:8000`. |
| External LLM/embedding API | HTTPS default `443` | `AICREDITS_BASE_URL` fallback | Default base URL is `https://api.aicredits.in/v1`. |

## 4. Hardcoded Localhost / Local Bind References

| Reference | Location | Impact |
|---|---|---|
| `http://localhost:5173` | `server/src/index.ts` | Default CORS origin. Deployed frontend must set `FRONTEND_URL`. |
| `http://localhost:5173` | `server/src/routes/search.ts` | Default SSE `Access-Control-Allow-Origin`. Deployed frontend must set `FRONTEND_URL`. |
| `http://localhost:8000` | `server/src/workers/anomalyWorker.ts` | Default Python ML service URL. On a real server or Compose network, set `PYTHON_ML_URL` to the reachable service URL. |
| `http://localhost:3000/api/v1` | `client/src/utils/api.ts` | Default frontend API base URL. Production builds need `VITE_API_URL`. |
| `http://localhost:3000/api/v1/search/stream` | `client/src/pages/Dashboard.tsx` | Hardcoded streaming search endpoint. This ignores `VITE_API_URL` and will break when the API is not on the user's local machine. |
| `http://localhost:3000/api/v1/logs` | `client/src/pages/Login.tsx` | Example curl text shown in UI. Should be made environment-aware for production docs/UI. |
| `0.0.0.0:8000` | `python-ml/Dockerfile` | Correct for container binding; not a localhost problem. |
| `http://localhost:5173`, `http://localhost:3000` | `README.md` | Local development instructions only. |

## 5. pgvector Image and Extension

- Docker image: `pgvector/pgvector:pg16`
- Postgres extension: `CREATE EXTENSION IF NOT EXISTS vector;` in `server/src/db/schema.sql`
- Vector column: `logs.embedding vector(1536)`
- Vector index: HNSW with cosine ops:

```sql
CREATE INDEX IF NOT EXISTS logs_embedding_idx
  ON logs USING hnsw (embedding vector_cosine_ops);
```

## 6. Frontend Build and Serve

The frontend is a React 19 + TypeScript + Vite app in `client/`.

Scripts from `client/package.json`:

```json
{
  "dev": "vite",
  "build": "tsc -b && vite build",
  "lint": "eslint .",
  "preview": "vite preview"
}
```

Development:

- `npm run dev` starts Vite's dev server, normally on `http://localhost:5173`.
- API requests use `VITE_API_URL` if set, otherwise `http://localhost:3000/api/v1`.

Production:

- `npm run build` type-checks with `tsc -b` and emits static assets to `client/dist`.
- `npm run preview` can preview the built assets locally, normally on port `4173`.
- There is no frontend Dockerfile, Nginx config, Express static serving, or production hosting config in this repo. In production, `client/dist` must be served by an external static host or web server.
- Because Vite env vars are build-time values, `VITE_API_URL` must be set when building the production frontend.

Current issue:

- Most frontend API calls use `client/src/utils/api.ts`, but the streaming search in `client/src/pages/Dashboard.tsx` hardcodes `http://localhost:3000`. That path will not follow `VITE_API_URL` in production.

## 7. Folder Structure

Confirmed source structure, excluding `node_modules`, `.git`, `dist`, and Python cache files:

```text
log_drain/
|-- README.md
|-- PROJECT_AUDIT.md
|-- client/
|   |-- index.html
|   |-- package.json
|   |-- package-lock.json
|   |-- vite.config.ts
|   |-- eslint.config.js
|   |-- tsconfig.json
|   |-- tsconfig.app.json
|   |-- tsconfig.node.json
|   |-- public/
|   |   |-- favicon.svg
|   |   `-- icons.svg
|   `-- src/
|       |-- App.tsx
|       |-- main.tsx
|       |-- index.css
|       |-- assets/
|       |   |-- hero.png
|       |   |-- react.svg
|       |   `-- vite.svg
|       |-- pages/
|       |   |-- Dashboard.tsx
|       |   `-- Login.tsx
|       `-- utils/
|           `-- api.ts
|-- server/
|   |-- .env
|   |-- .env.example
|   |-- docker-compose.yml
|   |-- package.json
|   |-- package-lock.json
|   |-- tsconfig.json
|   `-- src/
|       |-- index.ts
|       |-- db/
|       |   |-- index.ts
|       |   `-- schema.sql
|       |-- middleware/
|       |   `-- apiKey.ts
|       |-- routes/
|       |   |-- agent.ts
|       |   |-- alerts.ts
|       |   |-- auth.ts
|       |   |-- logs.ts
|       |   |-- search.ts
|       |   `-- stats.ts
|       |-- services/
|       |   |-- agent.ts
|       |   |-- embedding.ts
|       |   |-- hybridRetriever.ts
|       |   `-- llm.ts
|       |-- types/
|       |   `-- index.ts
|       `-- workers/
|           |-- anomalyWorker.ts
|           |-- embeddingWorker.ts
|           |-- flushWorker.ts
|           `-- index.ts
`-- python-ml/
    |-- Dockerfile
    |-- requirements.txt
    `-- app/
        |-- __init__.py
        `-- main.py
```

Local generated/install artifacts also exist:

- `client/node_modules/`
- `client/dist/`
- `server/node_modules/`
- `server/dist/`
- `python-ml/app/__pycache__/`

One extra empty-ish source directory was seen: `server/src/utils/`.

## 8. Local-Only / Real Server Breakage Risks

| Area | Current behavior | Why it may break | What to change for deployment |
|---|---|---|---|
| Compose coverage | `server/docker-compose.yml` starts Postgres, Redis, and Python ML only. | Node API, Node worker, and frontend are not containerized or orchestrated by Compose. | Add Compose services or separate deployment units for API, worker, and frontend static hosting. |
| Compose Postgres URL for Python ML | `DATABASE_URL=postgresql://...@postgres:5433/logdrain_db` | Inside Docker Compose, services should use the container port `5432`, not the host-mapped port `5433`. | Use `postgres:5432` for service-to-service traffic. |
| Python ML `DATABASE_URL` | Compose supplies it, but `python-ml/app/main.py` does not read it. | This is harmless now, but misleading. If DB access is added later, the current Compose URL port is wrong. | Either remove it until needed or fix it to `postgres:5432`. |
| CORS | Backend defaults to `http://localhost:5173`. | Browsers on a deployed frontend origin will be blocked unless `FRONTEND_URL` is set exactly. | Set `FRONTEND_URL=https://<frontend-domain>`; consider an allowlist if multiple origins are needed. |
| SSE CORS | `/search/stream` manually sets `Access-Control-Allow-Origin` to `FRONTEND_URL` or localhost. | Same deployment risk as normal CORS; also manually duplicates CORS logic. | Set `FRONTEND_URL`; ideally centralize CORS/SSE origin handling. |
| Frontend API base URL | Shared API client defaults to `http://localhost:3000/api/v1`. | Production users' browsers will call their own machine unless `VITE_API_URL` is set at build time. | Build frontend with `VITE_API_URL=https://<api-domain>/api/v1`. |
| Streaming search endpoint | `Dashboard.tsx` hardcodes `http://localhost:3000/api/v1/search/stream`. | This breaks even when `VITE_API_URL` is configured. | Reuse the same `BASE_URL` from `client/src/utils/api.ts` or expose an API helper for streaming URLs. |
| UI curl example | `Login.tsx` hardcodes `http://localhost:3000/api/v1/logs`. | Production UI will show users a local-only endpoint. | Generate the sample URL from `VITE_API_URL`. |
| Backend default ML URL | `PYTHON_ML_URL` defaults to `http://localhost:8000`. | If the worker runs in a container or separate host, localhost is the wrong target. | Set `PYTHON_ML_URL` to the ML service DNS/name, e.g. `http://python-ml:8000` in Compose. |
| Backend process model | API and worker are separate npm scripts: `npm run dev` / `npm run start` and `npm run worker`. | Running only the API will accept logs but not flush/embed/analyze them. | Deploy API and worker as separate long-running processes. |
| Database schema | Schema is applied manually via README command. | Fresh deployed DB will not have tables/extensions unless migration step runs. | Add a migration command/job or deployment step for `server/src/db/schema.sql`. |
| Postgres credentials | Compose includes local credentials directly. | Real deployments should not commit or bake credentials into Compose. | Use env files, Docker secrets, or platform secret management. |
| Python Docker command | Uvicorn runs with `--reload`. | Reload mode is intended for development and is not ideal for production. | Use a production Uvicorn/Gunicorn command without `--reload`. |
| Frontend production serving | `client/dist` exists, but no production server config exists. | There is no repo-defined way to serve the built frontend in production. | Serve `client/dist` via a static host/CDN/Nginx/etc. |
| Build-time frontend env | Vite embeds `VITE_*` variables at build time. | Changing runtime env after build will not update API URLs. | Set `VITE_API_URL` before `npm run build`. |
| Database SSL | `pg` Pool uses only `connectionString`, no SSL config. | Some managed Postgres providers require SSL. | Add environment-controlled SSL options if needed. |
| Health/dependency readiness | Compose uses `depends_on` without health checks. | Python ML may start before Postgres is ready; API/worker services are not in Compose. | Add health checks and startup/retry behavior if containerizing all services. |
