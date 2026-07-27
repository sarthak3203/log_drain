# Log Drain

AI-powered log analysis platform. Send logs from any application 
with one HTTP call — search them in plain English, detect anomalies 
automatically, and get instant AI-generated answers about what went wrong.

> Built to demonstrate production-grade AI engineering: hybrid search, 
> streaming LLM responses, LangGraph agents, and ML anomaly detection 
> across a polyglot Node.js + Python architecture.

---

## Live Demo

> Dashboard: [your-render-url]  
> ML Service: [your-render-url/docs]

---

## What It Does

Instead of searching logs with keywords like `level=ERROR AND message LIKE '%database%'`, you ask in plain English:

> *"Show me database connection failures from last night"*

The system understands meaning — not just keywords. It finds all relevant logs even if they use different words, then generates a plain-English summary with severity, affected services, and recommendations.

---

## Key Features

| Feature | Description |
|---|---|
| 🔍 **Hybrid Search** | BM25 keyword + semantic vector search combined with Reciprocal Rank Fusion |
| 🤖 **AI Agent** | LangGraph ReAct agent that calls multiple tools automatically to answer complex questions |
| ⚡ **Streaming Answers** | LLM responses stream word-by-word via Server-Sent Events |
| 📊 **Structured Output** | Zod-validated AI responses with severity, error count, and recommendations |
| 🧠 **Anomaly Detection** | IsolationForest ML model in a Python FastAPI microservice detects unusual logs |
| 📡 **Observability** | Full LangSmith tracing of every agent step, tool call, and LLM decision |
| 🚀 **Buffered Ingestion** | Redis buffer + bulk PostgreSQL insert handles log storms without DB pressure |

---

## Architecture

Your App → POST /logs → Redis Buffer → Postgres + pgvector
↓
Embedding Worker (OpenAI)
↓
Anomaly Worker → Python FastAPI (IsolationForest)

User → Search Query → LangChain Hybrid Retriever → Gemini LLM → Answer
User → Agent Question → LangGraph Agent → Tools → Synthesized Answer
↓
LangSmith Traces


**Three separate processes:**
- **API Server** (Node.js + Express) — handles all HTTP requests
- **Worker Process** (Node.js) — flush, embedding, anomaly detection, retention
- **ML Service** (Python + FastAPI) — IsolationForest anomaly scoring

---

## Tech Stack

### Backend
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?logo=express&logoColor=white)
![LangChain](https://img.shields.io/badge/LangChain-1C3C3C?logo=langchain&logoColor=white)
![LangGraph](https://img.shields.io/badge/LangGraph-1C3C3C?logo=langchain&logoColor=white)

### ML & AI
![Python](https://img.shields.io/badge/Python-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)
![scikit-learn](https://img.shields.io/badge/scikit--learn-F7931E?logo=scikit-learn&logoColor=white)
![OpenAI](https://img.shields.io/badge/OpenAI_Compatible-412991?logo=openai&logoColor=white)

### Database & Infrastructure
![PostgreSQL](https://img.shields.io/badge/PostgreSQL_+_pgvector-4169E1?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?logo=redis&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)

### Frontend
![React](https://img.shields.io/badge/React_19-61DAFB?logo=react&logoColor=111)
![Tailwind](https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white)

---

## How Hybrid Search Works

Most log search tools use exact keyword matching. This misses logs 
phrased differently but meaning the same thing.

This project combines two retrieval methods and merges them using 
Reciprocal Rank Fusion:

Query: "database connection failures"
↓
┌─────────────────────┐ ┌──────────────────────────┐
│ Semantic Search │ │ BM25 Keyword Search │
│ (pgvector HNSW) │ │ (PostgreSQL tsvector) │
│ │ │ │
│ Finds: "DB down" │ │ Finds: "database" │
│ "postgres refused" │ │ exact matches │
│ "connection failed"│ │ │
└─────────────────────┘ └──────────────────────────┘
↓
Reciprocal Rank Fusion (RRF)
↓
Best 10 results, ranked by combined relevance
↓
Gemini LLM generates plain-English answer


---

## How the AI Agent Works

When you ask a complex question like *"Were there anomalies last 
night and what caused them?"*, the LangGraph agent decides what 
to do:

Question
↓
Agent thinks: "I need stats AND anomaly data"
↓
Calls get_stats tool → Calls check_anomalies tool
↓ ↓
Gets error rates Gets flagged logs with scores
↓
Agent synthesizes comprehensive answer
↓
LangSmith records every step (visible at smith.langchain.com)


**Available tools:**
- `search_logs` — hybrid search over log messages
- `get_stats` — error rates and log volume by service
- `check_anomalies` — fetch ML-flagged anomalous logs
- `get_services` — list active services and last activity

---

## Anomaly Detection Pipeline

Every 5 minutes:

Node.js worker
↓
Fetches last 200 embeddings per service from Postgres
↓
POST /detect-anomalies → Python FastAPI
↓
IsolationForest fits on normalized embeddings (sklearn)
↓
Returns per-log anomaly scores (0-1 scale)
↓
Node.js marks anomalous logs in Postgres
↓
Fires webhook alerts if rules configured


**Why IsolationForest over simple centroid detection:**
Centroid-based detection assumes one "normal" pattern. 
IsolationForest handles multiple normal patterns — for example, 
a service that behaves differently during business hours vs 
overnight batch jobs.

---

## Ingestion Architecture

The ingestion endpoint returns `202 Accepted` in under 5ms 
regardless of database load:

POST /logs
↓ (< 5ms)
Redis RPUSH (log_buffer)
↓ 202 Accepted returned immediately

Every 2 seconds:
Redis LRANGE → Bulk INSERT → Postgres
Redis LTRIM (only after successful commit)
↓
IDs pushed to embedding_queue
↓
Embedding worker processes 100 at a time


This handles log storms (5,000+ logs/second) without 
overwhelming Postgres.

---

## Key Engineering Decisions

**Why pgvector instead of Pinecone?**
Keeping vectors in Postgres means filtering by `service`, `level`, 
and time range happens in the same query as similarity search. 
With a separate vector DB you'd need two round trips and a join 
in application code.

**Why HNSW over IVFFlat?**
HNSW gives better recall and faster queries. IVFFlat requires 
tuning `lists` and `probes` parameters and degrades on small datasets.

**Why Python for anomaly detection?**
scikit-learn, NumPy, and scipy are the standard stack for this. 
Running it as a separate FastAPI microservice keeps Python 
dependencies out of the Node.js runtime and reflects how real 
AI companies separate API/business logic (Node.js/Go) from 
ML workloads (Python).

**Why LangChain wrappers instead of raw OpenAI SDK?**
Using `ChatOpenAI` and `OpenAIEmbeddings` from LangChain means 
LangSmith automatically traces every LLM and embedding call — 
zero extra instrumentation code needed.

**Why cursor pagination over offset?**
`WHERE id < last_id LIMIT 50` uses the B-tree index directly. 
`OFFSET 1000` scans and discards 1000 rows first — O(n) 
that gets slower as you page deeper.

---

## Running Locally

### Prerequisites
- Node.js 20+
- Docker Desktop
- An OpenAI-compatible API key (aicredits.in works with UPI payment)

### Setup

```bash
# 1. Clone and start infrastructure
git clone <repo-url>
cd log_drain/server
docker compose up -d

# 2. Apply database schema  
Get-Content src/db/schema.sql | docker exec -i logdrain-postgres psql -U logdrain -d logdrain_db

# 3. Configure environment
# Create server/.env with your API keys (see .env.example)

# 4. Install dependencies
cd server && npm install
cd ../client && npm install

# 5. Run everything
# Terminal 1:
cd server && npm run dev

# Terminal 2:
cd server && npm run worker

# Terminal 3:
cd client && npm run dev
```

Open `http://localhost:5173` → Create project → Get API key → Send logs

---

## Sending Your First Log

```bash
curl -X POST http://localhost:3000/api/v1/logs \
  -H "Authorization: Bearer log_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{"level":"ERROR","message":"Database connection refused","service":"payment-api"}'
```

Then search at `http://localhost:5173`:
> *"show me database connection failures"*

---

## Project Structure

log_drain/
├── client/ # React 19 dashboard (Vite + Tailwind)
├── server/
│ ├── src/
│ │ ├── routes/ # Express API endpoints
│ │ ├── services/ # Embedding, LLM, hybrid retriever, agent
│ │ ├── workers/ # Flush, embedding, anomaly, retention
│ │ └── db/ # Postgres pool + schema
│ └── docker-compose.yml
└── python-ml/ # FastAPI + scikit-learn ML service
├── app/main.py
├── requirements.txt
└── Dockerfile


---

## What I Learned Building This

- Returning `202 Accepted` after Redis enqueue makes ingestion fast 
  but introduces eventual consistency — logs are searchable only 
  after the flush and embedding workers run
- Hybrid search with RRF gives meaningfully better results than 
  either semantic or keyword search alone — especially for technical 
  log messages that mix domain terms with natural language
- LangGraph's stateful graph model is the right abstraction for 
  multi-step tool-calling agents where the next tool depends on 
  the previous result
- Zod validation on LLM outputs is necessary in production — 
  models occasionally return malformed JSON or missing fields 
  regardless of how precise the prompt is
- Running ML in Python and API logic in TypeScript reflects 
  real production architecture and avoids forcing a round peg 
  into a square hole

---

*Built with Node.js, Python, PostgreSQL, Redis, LangChain, 
LangGraph, LangSmith, FastAPI, and scikit-learn.*
