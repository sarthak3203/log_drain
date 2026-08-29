# End-to-End Feature Audit

Audit date: 2026-08-29. This report is based on a source-level trace across the API, middleware, workers, schema, client, Docker configuration, and the requested local build/test commands. No application code or configuration was changed.

## 1. Build health

Commands executed (via `npm.cmd` because this host blocks the PowerShell `npm.ps1` shim):

- `server/`: `npm ci` and `npx tsc -b` both completed successfully. `npm ci` reported only deprecation warnings for transitive packages.
- `client/`: `npm install` and `npm run build` completed successfully. Vite produced the app, but warned that the main JavaScript chunk is 781 kB (239 kB gzip), above its 500 kB advisory threshold.
- `server/`: `npm test` passed: 3/3 tests passed. The suite builds first, then runs only `dist/utils/webhookUrl.test.js`; it does not test HTTP routes, authentication, queues, workers, or UI integration.
- `docker compose -f docker-compose.prod.yml config --quiet` and `docker compose -f docker-compose.aws.yml config --quiet` both exited 0. They warned that the required top-level Compose variables are not set in this checkout, and Docker could not read the user-level Docker config, but the YAML/Compose models are valid.

Verdict: **WORKING END-TO-END** for static build/config validation. Runtime integration remains substantially untested by the existing test suite.

## 2. Auth flow

`POST /api/v1/auth/register` in `server/src/routes/auth.ts` normalizes the email, bcrypt-hashes the password, inserts the user, and returns `{ user, token }`. `POST /auth/login` retrieves the normalized email, bcrypt-compares its password, and returns the same shape. Both issue a seven-day JWT through `createUserToken` in `server/src/middleware/userAuth.ts`, with `sub`, `email`, and `type: 'user'` claims.

`SessionContext` calls these routes through `publicApi`, saves the token under `logdrain.user_jwt`, calls `/auth/me` and `/projects` to establish/restore the session, and constructs all user-authenticated calls with `Authorization: Bearer <JWT>`. `userAuth` requires exactly that prefix, verifies the JWT, requires `type === 'user'`, confirms the user still exists, then sets `req.user_id`. It protects `/auth/me`, all project CRUD/list routes, and owner API-key management routes. `RequireAuth` in `client/src/App.tsx` protects the corresponding browser routes.

Project data routes deliberately use a different bearer credential: the project API key. `client/src/utils/api.ts` also sends it exactly as `Authorization: Bearer <key>`, matching `apiKeyAuth`. `/logs`, `/services`, all search endpoints, stats, alerts, the agent, project-context, and project-key management are protected this way. Public exceptions are `/health`, registration, and login, which is appropriate.

Verdict: **WORKING END-TO-END.** JWT and API-key header formats match the server middleware exactly. There are no route tests covering this flow.

## 3. API key flow

Creating a project from `Projects.tsx` calls `POST /projects` with the user JWT. The server creates a project and default `log_<uuid>` key in one transaction, stores only a bcrypt hash plus the first 12 characters as `key_prefix`, and returns the raw key once. The client stores it for the selected project and displays it in `OneTimeKeyDialog`; the server never returns an existing raw value. Creating a recovery/additional key from `Projects.tsx` or `ApiKeys.tsx` follows the user-authenticated `POST /projects/:projectId/api-keys` path and uses the same dialog.

`apiKeyAuth` takes the bearer value, uses `rawKey.slice(0, 12)` to select non-revoked candidates, then performs `bcrypt.compare(rawKey, key_hash)`. On a match it attaches the candidate's `project_id`, so `POST /logs` writes only to that key's project. The client can also validate a pasted key via `/project-context` before saving it locally.

The frontend response expectations match the server: project creation returns `project`, `api_key`, and `message`; owned-key creation returns `api_key`, `key`, and `message`; the direct project-key creation endpoint returns only `api_key`, as typed by the unused helper.

Verdict: **WORKING END-TO-END.** Raw keys are persisted in browser local storage for the signed-in user, which is a deliberate usability/security trade-off rather than a server-side one-time-display failure.

## 4. Log ingestion pipeline

`POST /api/v1/logs` applies `ingestionLimiter` then `apiKeyAuth`, validates one to 1,000 messages, assigns each an `ingestion_id`, and `RPUSH`es JSON records to Redis `log_buffer` before returning `202`.

The worker entrypoint starts `flushWorker`, `embeddingWorker`, and `anomalyWorker`. Every two seconds, `flushWorker` obtains a Redis lock, returns unacknowledged work from `log_processing` to `log_buffer`, claims up to 500 entries with `LMOVE`, bulk inserts them, and only acknowledges records after queuing their persisted IDs for embeddings. The schema's unique `(project_id, ingestion_id)` index plus `ON CONFLICT` makes retries idempotent. `GET /logs` reads the persisted PostgreSQL rows, including anomaly flags, and `Dashboard.tsx` polls it every ten seconds and renders the returned `logs` array.

The dead-letter queue exists, but it covers malformed queued JSON/fields only. Database failures, embedding-enqueue failures, or a process crash leave records for retry; they are not eventually moved to `log_dead_letter`, so a permanently failing valid record can retry indefinitely. The embedding queue itself uses `LPOP` without a processing/claim queue, so a process crash after popping and before requeueing can lose embedding work.

The global API limiter explicitly skips `POST /logs`, so it does not double-limit this endpoint; the ingestion limiter is the only intentional limit (300 requests/minute). However, Express does not set `trust proxy`; requests routed through the client Nginx container can appear to originate from one proxy IP, causing all external ingesting clients through that proxy to share that 300/minute bucket.

Verdict: **INCOMPLETE** — the normal ingestion-to-dashboard path works, but dead-letter handling is limited to malformed input and the worker queues are not crash-safe end-to-end.

## 5. Search

The Dashboard calls `api.streamSearch`, which sends the project key to `GET /search/stream`. The route creates `LogHybridRetriever`, streams a `logs` SSE event, then streams LLM output as `chunk` events and terminates with `done`. The Dashboard parses the data lines, renders returned logs, and enqueues text fragments for its 80 ms word-by-word animation. Its independent `structuredSearch` call expects and receives `{ structured, logs, query, mode, logs_searched }` from `/search/structured` and renders severity metadata. Those client/server shapes match.

`LogHybridRetriever` scopes every query to the API key's project and optional dates/service. Semantic search generates a query embedding and queries `logs.embedding` with pgvector cosine distance. Keyword search uses PostgreSQL `tsvector`, `plainto_tsquery`, and `ts_rank`; the result sets are combined by weighted reciprocal-rank fusion. This is functional hybrid full-text + vector search + RRF, but it is **not BM25** as described: PostgreSQL `ts_rank` is not a BM25 implementation.

`flushWorker` enqueues persisted IDs in `embedding_queue`; `embeddingWorker` batches them through `getBatchEmbeddings` and updates `logs.embedding` as a pgvector literal. The 1,536-dimension schema and hard-coded `text-embedding-3-small` model agree. Therefore embeddings do populate the column the retriever queries under normal operation.

On an SSE error, the server emits an `error` event but the client ignores the event name/data and may leave `isStreaming` true after the connection closes. It also has no cancellation or user-facing error state for failed search streams.

Verdict: **INCOMPLETE** — the happy path is connected and response formats match, but keyword retrieval is not BM25 and SSE failure handling is broken.

## 6. Agent

`Dashboard.tsx` posts `{ question }` through `api.agentQuery` with the project API key. `/agent/query` validates a nonempty string up to 500 characters and returns `{ answer, tools_used, question }`; the Dashboard reads `answer` and `tools_used` in exactly that format.

`runLogAnalysisAgent` compiles a LangGraph loop: `agent` invokes a tool-bound OpenAI-compatible model, conditionally routes to `ToolNode`, then loops back until no tool calls remain (recursion limit 8). Its tools are all connected: `search_logs` uses `LogHybridRetriever`; `get_stats` queries per-service volume/error rate; `check_anomalies` reads anomaly-marked logs; and `get_services` queries observed services. Each receives `projectId` through LangGraph configurable state and scopes SQL/retrieval correctly.

The route has no integration test and requires the external LLM provider at server module-load time. In a correctly configured deployment it has a complete request/response path; with a missing/invalid provider it returns a generic 500 rather than a useful dependency error.

Verdict: **WORKING END-TO-END** by code path and response contract, contingent on the configured LLM provider.

## 7. Alerts

The Dashboard alert-rule form calls `POST /alert-rules` with `{ name, condition: { type: 'anomaly' }, service, notify_url }`. `alerts.ts` validates a supplied webhook with `validateWebhookUrl` before persisting it. The validator only allows HTTP(S), rejects credentials/local/internal names and private, loopback, link-local, metadata, multicast, and reserved IP ranges, and resolves hostnames before accepting them. The existing three passing tests exercise the block/allow cases.

When `anomalyWorker` receives anomalous ML results, it finds active project rules whose JSON condition has `type = anomaly`, calls `fireAlert`, stores an `alert_events` row, revalidates the saved URL immediately before a five-second Axios POST with redirects disabled, and the Dashboard/Alerts page fetches those events. That is a real webhook-fire path.

However, the worker does not apply the rule's `service` field, threshold, or other condition contents. A rule created for one service fires when any service in the project has anomalies. The schema permits `error_count` rules, but there is no worker that evaluates them. `notify_email` is stored but never delivered. SSRF validation also cannot fully prevent DNS-rebinding between validation and the separate Axios connection.

Verdict: **BROKEN** — anomaly webhooks can fire, but rule conditions are not actually enforced beyond “this project had one or more anomalies.”

## 8. Anomaly detection

Every five minutes, `anomalyWorker` first calls `${PYTHON_ML_URL}/health`, then finds project/service pairs with recent populated embeddings. For each pair with at least 10 valid 1,536-element vectors, it posts IDs and vectors to `/detect-anomalies`. FastAPI's endpoint accepts that exact request shape, uses IsolationForest, and returns `results` containing `log_id`, `anomaly_score`, and `is_anomaly` along with counts.

The worker writes each anomalous result into `logs.anomaly_score` and `logs.is_anomaly`. `GET /logs`, `/stats`, agent `check_anomalies`, Dashboard log rows, the anomaly count card, and alert-event UI all use those stored fields, so anomalies are visible to users. The FastAPI `/health` route returns 200 JSON and the Docker healthcheck requests `http://localhost:8000/health`; these match.

Only anomaly-positive rows have scores written; normal rows retain `NULL` score/`FALSE`, which is consistent with current display. The Python Dockerfile runs Uvicorn with `--reload`, which is a development-oriented operational setting for production.

Verdict: **WORKING END-TO-END** for detection, persistence, and display, with the alert-rule scoping defect documented above.

## 9. Stats / Dashboard data

All dashboard API-backed elements have a server route:

| Dashboard element | Client call | Backend source | Finding |
|---|---|---|---|
| Total logs, volume chart, anomaly count | `/stats` | `routes/stats.ts` | Real PostgreSQL aggregates. |
| Services count/filter | `/services` | `routes/logs.ts` | Real project-scoped aggregate. |
| “Error rate” card | `/stats` | `routes/stats.ts` | Real data, but the UI shows the first unordered service's error rate rather than a global/project-wide rate. |
| Log stream/filter | `/logs` | `routes/logs.ts` | Real data; client only requests the first page (default 50) and has no pagination control. |
| Search and structured metadata | `/search/stream`, `/search/structured` | `routes/search.ts` | Real retrieval/LLM data. |
| Agent panel | `/agent/query` | `routes/agent.ts` | Real agent response. |
| Rules and events | `/alert-rules`, `/alerts` | `routes/alerts.ts` | Real persisted data. |

No dashboard chart/number is hard-coded mock data. The fallback `logs.length` for an absent/zero total is derived from a real `GET /logs` response, not a mock. The “Live” badge in `AppLayout` is static UI text; it does not represent a websocket/SSE connection or health check.

Verdict: **INCOMPLETE** — the data sources are real, but the error-rate card is semantically wrong, log pagination is missing, and the Live indicator is only a placeholder state.

## 10. Environment variable consistency

Direct code references are:

| Area | Variables referenced |
|---|---|
| `server/src` | `DATABASE_URL`, `REDIS_URL`, `PORT`, `FRONTEND_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `GEMINI_API_KEY`, `AICREDITS_BASE_URL`, `PYTHON_ML_URL` |
| `python-ml` | None. It calls `load_dotenv()` but does not read an environment variable. |
| `client/src` | `VITE_API_URL` |

`server/.env.example` covers all server variables except `JWT_EXPIRES_IN`; it additionally documents `NODE_ENV`, `EMBEDDING_MODEL`, and four LangChain tracing variables that project source does not directly read. `server/.env.production.example` covers Compose credentials, `JWT_SECRET`, `FRONTEND_URL`, provider values, and `VITE_API_URL`, but omits `DATABASE_URL`, `REDIS_URL`, `PYTHON_ML_URL`, `PORT`, and `JWT_EXPIRES_IN`. The two root Compose files construct the first three internally, default PORT to 3000, set `PYTHON_ML_URL` internally, and do not pass `JWT_EXPIRES_IN`.

Both Compose files require top-level `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `FRONTEND_URL`, `JWT_SECRET`, `GEMINI_API_KEY`, and `AICREDITS_BASE_URL`, and optionally use `VITE_API_URL` with `/api/v1` default. Their required Postgres variables appear only in `server/.env.production.example`, not the development example. `EMBEDDING_MODEL` is documentation-only because the embedding model is hard-coded. Python's old `DATABASE_URL` import/dependency is unused.

Verdict: **INCOMPLETE** — `JWT_EXPIRES_IN` is used but undocumented everywhere, production env documentation does not fully describe non-Compose execution, and several documented variables are unused by application code.

## 11. Dead code / orphans

Static reference tracing found these definite or likely orphans:

- `getEmbedding` in `server/src/services/embedding.ts` is exported but never used; all production embedding work calls `getBatchEmbeddings`.
- `AuthenticatedRequest` and `AuthenticatedUserRequest` in `server/src/types/index.ts` are exported but never used; middleware augments `Express.Request` directly instead.
- `getApiKeys`, `createApiKey`, `revokeApiKey`, and non-streaming `search` in `client/src/utils/api.ts` have matching backend routes but no client caller. The UI uses owner-authenticated project-key methods and streamed/structured search instead.
- The direct API-key management routes (`/api-keys` and `/api-keys/:id`) and non-streaming `/search` route are reachable public API surface but currently have no UI path. `POST /logs` is intentionally external ingestion surface rather than an orphan.

Every API method in `client/src/utils/api.ts` has a matching mounted backend route. All route modules are imported and mounted by `server/src/index.ts`; no frontend API call targets a nonexistent route.

Verdict: **INCOMPLETE** — no client/server route mismatch was found, but unused helpers and exposed routes add redundant maintenance surface.

## 12. Frontend route coverage

Every file in `client/src/pages` is imported and reachable through `App.tsx`:

- `Login` → `/login`; `Register` → `/register`, both public-only.
- `Projects` → `/projects`, authenticated.
- `ApiKeys` → `/api-keys`, authenticated with a selected project.
- `Dashboard` → `/dashboard`, authenticated with a selected project and saved API key.
- `Alerts` → `/alerts`, authenticated with a selected project and saved API key.

`AppLayout` provides navigation for Dashboard, Projects, API Keys, and Alerts. If a user follows a key-required nav item without a saved key, the route safely redirects to Projects. Login/Register are reachable from each other's links. `/` and unknown paths redirect appropriately.

Verdict: **WORKING END-TO-END.**

## Deployment summary

**Fix these first; this is not yet safe to deploy as a production observability service.**

1. Enforce alert rule service/threshold conditions and either implement or remove `error_count` and `notify_email` semantics.
2. Make ingestion and embedding queues crash-safe and define a policy for dead-lettering permanently failing valid records.
3. Document/provide all required production variables, especially `JWT_EXPIRES_IN`, and create a real root deployment `.env` from the production example without committing secrets.
4. Replace the Caddyfile `VM_IP` placeholder before starting AWS Compose; the Compose check validates YAML, not a usable certificate/domain configuration. Also note that AWS Compose still publishes `server` port 3000 directly, bypassing Caddy/HTTPS.
5. Fix SSE error completion/UI feedback and correct the dashboard's error-rate metric. If BM25 is a promised capability, implement it or rename the current PostgreSQL full-text rank behavior.

The code compiles, the existing security validator tests pass, and the primary happy paths are connected. They should be exercised with a live Postgres/Redis/LLM/ML integration test before deployment.
