import os
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import normalize
import psycopg2
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(
    title="Log Drain ML Service",
    description="Python ML microservice for anomaly detection using IsolationForest",
    version="1.0.0"
)

# ── Request / Response models ──────────────────────────────────────────────────

class DetectAnomaliesRequest(BaseModel):
    project_id: str
    service: str
    log_ids: List[int]
    embeddings: List[List[float]]
    contamination: Optional[float] = 0.1  # expected % of anomalies

class AnomalyResult(BaseModel):
    log_id: int
    anomaly_score: float   # higher = more anomalous (0 to 1 scale)
    is_anomaly: bool

class DetectAnomaliesResponse(BaseModel):
    service: str
    project_id: str
    total_logs: int
    anomalies_found: int
    results: List[AnomalyResult]
    algorithm: str = "IsolationForest"
    contamination_used: float

# ── Health check ───────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "python-ml",
        "algorithm": "IsolationForest"
    }

# ── Main anomaly detection endpoint ───────────────────────────────────────────

@app.post("/detect-anomalies", response_model=DetectAnomaliesResponse)
def detect_anomalies(req: DetectAnomaliesRequest):
    """
    Receives log embeddings from Node.js worker.
    Runs IsolationForest to detect anomalous logs.
    Returns anomaly scores and flags.
    
    Why IsolationForest over centroid-based detection:
    - Handles multiple normal patterns (no single centroid assumption)
    - More robust to varying log patterns across time of day
    - Industry standard for unsupervised anomaly detection
    - O(n log n) complexity - scales well
    """

    if len(req.embeddings) < 10:
        raise HTTPException(
            status_code=400,
            detail=f"Need at least 10 logs for meaningful anomaly detection. Got {len(req.embeddings)}"
        )

    if len(req.log_ids) != len(req.embeddings):
        raise HTTPException(
            status_code=400,
            detail="log_ids and embeddings must have the same length"
        )

    # Convert to numpy array for scikit-learn
    X = np.array(req.embeddings, dtype=np.float32)

    # Normalize embeddings to unit vectors
    # This ensures cosine-like distance behavior
    X_normalized = normalize(X, norm='l2')

    # IsolationForest
    # contamination = expected proportion of anomalies
    # n_estimators = number of isolation trees (more = more stable)
    # random_state = reproducible results
    clf = IsolationForest(
        contamination=req.contamination,
        n_estimators=100,
        random_state=42,
        n_jobs=-1  # use all CPU cores
    )

    clf.fit(X_normalized)

    # decision_function returns negative scores for anomalies
    # More negative = more anomalous
    raw_scores = clf.decision_function(X_normalized)

    # predictions: -1 = anomaly, 1 = normal
    predictions = clf.predict(X_normalized)

    # Convert raw scores to 0-1 scale where 1 = most anomalous
    # Raw scores are typically in range [-0.5, 0.5]
    # We normalize to [0, 1] for easier interpretation
    min_score = raw_scores.min()
    max_score = raw_scores.max()
    score_range = max_score - min_score

    results = []
    anomaly_count = 0

    for i, (log_id, raw_score, prediction) in enumerate(
        zip(req.log_ids, raw_scores, predictions)
    ):
        # Normalize score: higher = more anomalous
        if score_range > 0:
            normalized_score = 1.0 - ((raw_score - min_score) / score_range)
        else:
            normalized_score = 0.0

        is_anomaly = prediction == -1
        if is_anomaly:
            anomaly_count += 1

        results.append(AnomalyResult(
            log_id=log_id,
            anomaly_score=round(float(normalized_score), 4),
            is_anomaly=is_anomaly
        ))

    return DetectAnomaliesResponse(
        service=req.service,
        project_id=req.project_id,
        total_logs=len(req.embeddings),
        anomalies_found=anomaly_count,
        results=results,
        algorithm="IsolationForest",
        contamination_used=req.contamination
    )

# ── Stats endpoint ─────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {
        "service": "Log Drain ML Service",
        "version": "1.0.0",
        "endpoints": {
            "health": "GET /health",
            "detect_anomalies": "POST /detect-anomalies",
            "docs": "GET /docs"
        }
    }