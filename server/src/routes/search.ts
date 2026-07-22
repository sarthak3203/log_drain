import { Router } from 'express';
import { apiKeyAuth } from '../middleware/apiKey';
import { generateSearchAnswer, generateStructuredAnswer, streamSearchAnswer } from '../services/llm';
import { LogHybridRetriever } from '../services/hybridRetriever';

const router = Router();

// GET /api/v1/search/stream
// mode: 'hybrid' (default) | 'semantic' | 'keyword'
router.get('/search/stream', apiKeyAuth, async (req, res) => {
  const project_id = (req as any).project_id;
  const {
    q: userQuery,
    from,
    to,
    service,
    limit = '10',
    mode = 'hybrid',
  } = req.query as Record<string, string>;

  if (!userQuery) {
    res.status(400).json({ error: 'Query parameter q is required' });
    return;
  }

  const parsed = Number.parseInt(limit, 10);
  const limitNum = Number.isFinite(parsed) ? Math.min(parsed, 50) : 10;

  if (from && isNaN(new Date(from).getTime())) {
    res.status(400).json({ error: 'Invalid from date' });
    return;
  }
  if (to && isNaN(new Date(to).getTime())) {
    res.status(400).json({ error: 'Invalid to date' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_URL || 'http://localhost:5173');
  res.flushHeaders();

  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    let semanticWeight = 0.6;
    let keywordWeight = 0.4;

    if (mode === 'semantic') {
      semanticWeight = 1.0;
      keywordWeight = 0.0;
    } else if (mode === 'keyword') {
      semanticWeight = 0.0;
      keywordWeight = 1.0;
    }

    const retriever = new LogHybridRetriever({
      projectId: project_id,
      topK: limitNum,
      semanticWeight,
      keywordWeight,
      fromDate: from ? new Date(from) : undefined,
      toDate: to ? new Date(to) : undefined,
      service: service || undefined,
    });

    const documents = await retriever.invoke(userQuery);

    if (documents.length === 0) {
      sendEvent('logs', { logs: [], mode });
      sendEvent('chunk', { text: 'No relevant logs found for your query.' });
      sendEvent('done', { logs_searched: 0 });
      res.end();
      return;
    }

    const logs = documents.map(doc => ({
      id: doc.metadata.id,
      level: doc.metadata.level,
      message: doc.pageContent,
      service: doc.metadata.service,
      timestamp: doc.metadata.timestamp,
      metadata: doc.metadata.metadata,
      rrf_score: doc.metadata.rrf_score,
    }));

    sendEvent('logs', { logs, mode });

    await streamSearchAnswer(userQuery, logs as any, (chunk: string) => {
      sendEvent('chunk', { text: chunk });
    });

    sendEvent('done', { logs_searched: logs.length });
    res.end();
  } catch (err) {
    console.error('Stream search error:', err);
    sendEvent('error', { message: 'Search failed' });
    res.end();
  }
});

// GET /api/v1/search/structured
// mode: 'hybrid' (default) | 'semantic' | 'keyword'
router.get('/search/structured', apiKeyAuth, async (req, res) => {
  const project_id = (req as any).project_id;
  const {
    q: userQuery,
    from,
    to,
    service,
    limit = '10',
    mode = 'hybrid',
  } = req.query as Record<string, string>;

  if (!userQuery) {
    return res.status(400).json({ error: 'Query parameter q is required' });
  }

  const parsed = Number.parseInt(limit, 10);
  const limitNum = Number.isFinite(parsed) ? Math.min(parsed, 50) : 10;

  if (from && isNaN(new Date(from).getTime())) {
    return res.status(400).json({ error: 'Invalid from date' });
  }
  if (to && isNaN(new Date(to).getTime())) {
    return res.status(400).json({ error: 'Invalid to date' });
  }

  try {
    let semanticWeight = 0.6;
    let keywordWeight = 0.4;

    if (mode === 'semantic') {
      semanticWeight = 1.0;
      keywordWeight = 0.0;
    } else if (mode === 'keyword') {
      semanticWeight = 0.0;
      keywordWeight = 1.0;
    }

    const retriever = new LogHybridRetriever({
      projectId: project_id,
      topK: limitNum,
      semanticWeight,
      keywordWeight,
      fromDate: from ? new Date(from) : undefined,
      toDate: to ? new Date(to) : undefined,
      service: service || undefined,
    });

    const documents = await retriever.invoke(userQuery);

    if (documents.length === 0) {
      return res.json({
        structured: {
          answer: 'No relevant logs found.',
          severity: 'low',
          affected_services: [],
          error_count: 0,
          time_range: { start: null, end: null },
          summary: 'No logs matched your query.',
          recommendations: ['Try a different search query'],
        },
        logs: [],
        query: userQuery,
        mode,
      });
    }

    const logs = documents.map(doc => ({
      id: doc.metadata.id,
      level: doc.metadata.level,
      message: doc.pageContent,
      service: doc.metadata.service,
      timestamp: doc.metadata.timestamp,
      metadata: doc.metadata.metadata,
      rrf_score: doc.metadata.rrf_score,
    }));

    const structured = await generateStructuredAnswer(userQuery, logs);

    res.json({
      structured,
      logs,
      query: userQuery,
      mode,
      logs_searched: logs.length,
    });
  } catch (err) {
    console.error('Structured search error:', err);
    res.status(500).json({ error: 'Structured search failed' });
  }
});

// GET /api/v1/search
// mode: 'hybrid' (default) | 'semantic' | 'keyword'
router.get('/search', apiKeyAuth, async (req, res) => {
  const project_id = (req as any).project_id;
  const {
    q: userQuery,
    from,
    to,
    service,
    limit = '10',
    mode = 'hybrid',
  } = req.query as Record<string, string>;

  if (!userQuery) {
    return res.status(400).json({ error: 'Query parameter q is required' });
  }

  const parsed = Number.parseInt(limit, 10);
  const limitNum = Number.isFinite(parsed) ? Math.min(parsed, 50) : 10;

  // Date validation
  if (from && isNaN(new Date(from).getTime())) {
    return res.status(400).json({ error: 'Invalid from date' });
  }
  if (to && isNaN(new Date(to).getTime())) {
    return res.status(400).json({ error: 'Invalid to date' });
  }

  try {
    // Configure weights based on mode
    let semanticWeight = 0.6;
    let keywordWeight = 0.4;

    if (mode === 'semantic') {
      semanticWeight = 1.0;
      keywordWeight = 0.0;
    } else if (mode === 'keyword') {
      semanticWeight = 0.0;
      keywordWeight = 1.0;
    }

    // Use LangChain custom retriever
    const retriever = new LogHybridRetriever({
      projectId: project_id,
      topK: limitNum,
      semanticWeight,
      keywordWeight,
      fromDate: from ? new Date(from) : undefined,
      toDate: to ? new Date(to) : undefined,
      service: service || undefined,
    });

    const documents = await retriever.invoke(userQuery);

    if (documents.length === 0) {
      return res.json({
        answer: 'No relevant logs found for your query.',
        logs: [],
        query: userQuery,
        mode,
      });
    }

    // Convert Documents back to log format for the LLM and response
    const logs = documents.map(doc => ({
      id: doc.metadata.id,
      level: doc.metadata.level,
      message: doc.pageContent,
      service: doc.metadata.service,
      timestamp: doc.metadata.timestamp,
      metadata: doc.metadata.metadata,
      rrf_score: doc.metadata.rrf_score,
    }));

    // Generate AI answer using retrieved logs
    const answer = await generateSearchAnswer(userQuery, logs as any);

    res.json({
      answer,
      logs,
      query: userQuery,
      mode,
      logs_searched: logs.length,
    });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

export default router;
