import { BaseRetriever } from '@langchain/core/retrievers';
import { Document } from '@langchain/core/documents';
import { CallbackManagerForRetrieverRun } from '@langchain/core/callbacks/manager';
import { openAIEmbeddings } from './embedding';
import { query } from '../db';

export interface HybridSearchParams {
  projectId: string;
  topK?: number;
  semanticWeight?: number;
  keywordWeight?: number;
  fromDate?: Date;
  toDate?: Date;
  service?: string;
}

export class LogHybridRetriever extends BaseRetriever {
  lc_namespace = ['log_drain', 'retrievers', 'hybrid'];

  private params: HybridSearchParams;

  constructor(params: HybridSearchParams) {
    super();
    this.params = params;
  }

  private buildFilterClause() {
    const { projectId, fromDate, toDate, service } = this.params;
    const conditions: string[] = [];
    const params: any[] = [];

    const addCondition = (sql: string, value: any) => {
      params.push(value);
      conditions.push(sql.replace('?', `$${params.length}`));
    };

    addCondition('project_id = ?', projectId);

    if (fromDate) {
      addCondition('timestamp >= ?', fromDate);
    }
    if (toDate) {
      addCondition('timestamp <= ?', toDate);
    }
    if (service) {
      addCondition('service = ?', service);
    }

    return {
      whereClause: conditions.join(' AND '),
      params,
    };
  }

  async _getRelevantDocuments(
    query_text: string,
    runManager?: CallbackManagerForRetrieverRun
  ): Promise<Document[]> {
    const {
      topK = 10,
      semanticWeight = 0.6,
      keywordWeight = 0.4,
    } = this.params;

    const semanticEnabled = semanticWeight > 0;
    const keywordEnabled = keywordWeight > 0;

    let semanticResults: Array<{
      id: number;
      level: string;
      message: string;
      service: string;
      timestamp: Date;
      metadata: any;
      similarity: number;
    }> = [];

    let bm25Results: Array<{
      id: number;
      level: string;
      message: string;
      service: string;
      timestamp: Date;
      metadata: any;
      rank: number;
    }> = [];

    if (semanticEnabled) {
      // Step 1: Semantic search using pgvector
      const queryEmbedding = await openAIEmbeddings.embedQuery(query_text);
      const queryVector = `[${queryEmbedding.join(',')}]`;
      const semanticFilters = this.buildFilterClause();
      const semanticParams = [...semanticFilters.params, queryVector, topK * 2];
      const vectorParam = `$${semanticFilters.params.length + 1}`;
      const limitParam = `$${semanticFilters.params.length + 2}`;

      semanticResults = await query<{
        id: number;
        level: string;
        message: string;
        service: string;
        timestamp: Date;
        metadata: any;
        similarity: number;
      }>(
        `SELECT id, level, message, service, timestamp, metadata,
          1 - (embedding <=> ${vectorParam}::vector) as similarity
         FROM logs
         WHERE ${semanticFilters.whereClause}
           AND embedding IS NOT NULL
         ORDER BY embedding <=> ${vectorParam}::vector
         LIMIT ${limitParam}`,
        semanticParams
      );
    }

    if (keywordEnabled) {
      // Step 2: BM25 keyword search using Postgres full text search
      const keywordFilters = this.buildFilterClause();
      const keywordParams = [...keywordFilters.params, query_text, topK * 2];
      const tsQueryParam = `$${keywordFilters.params.length + 1}`;
      const limitParam = `$${keywordFilters.params.length + 2}`;

      bm25Results = await query<{
        id: number;
        level: string;
        message: string;
        service: string;
        timestamp: Date;
        metadata: any;
        rank: number;
      }>(
        `SELECT id, level, message, service, timestamp, metadata,
          ts_rank(fts_vector, plainto_tsquery('english', ${tsQueryParam})) as rank
         FROM logs
         WHERE ${keywordFilters.whereClause}
           AND fts_vector @@ plainto_tsquery('english', ${tsQueryParam})
         ORDER BY rank DESC
         LIMIT ${limitParam}`,
        keywordParams
      );
    }

    // Step 3: Reciprocal Rank Fusion (RRF)
    // RRF formula: score = sum(1 / (k + rank)) where k=60 is standard
    const k = 60;
    const rrfScores = new Map<number, {
      score: number;
      log: any;
    }>();

    // Add semantic results with their RRF scores
    semanticResults.forEach((log, index) => {
      const rrfScore = semanticWeight * (1 / (k + index + 1));
      rrfScores.set(log.id, {
        score: rrfScore,
        log,
      });
    });

    // Add BM25 results, combining scores if log appears in both
    bm25Results.forEach((log, index) => {
      const rrfScore = keywordWeight * (1 / (k + index + 1));
      if (rrfScores.has(log.id)) {
        rrfScores.get(log.id)!.score += rrfScore;
      } else {
        rrfScores.set(log.id, {
          score: rrfScore,
          log,
        });
      }
    });

    // Step 4: Sort by combined RRF score and take topK
    const sortedResults = Array.from(rrfScores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    // Step 5: Convert to LangChain Documents
    return sortedResults.map(({ score, log }) =>
      new Document({
        pageContent: log.message,
        metadata: {
          id: log.id,
          level: log.level,
          service: log.service,
          timestamp: log.timestamp,
          metadata: log.metadata,
          rrf_score: score,
        },
      })
    );
  }
}
