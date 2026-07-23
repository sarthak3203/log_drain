import { Router } from 'express';
import { apiKeyAuth } from '../middleware/apiKey';
import { runLogAnalysisAgent } from '../services/agent';

const router = Router();

// POST /api/v1/agent/query
// The agent decides what tools to call based on the question
router.post('/agent/query', apiKeyAuth, async (req, res) => {
  const project_id = req.project_id!;
  const { question } = req.body;

  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'question field is required' });
  }

  if (question.length > 500) {
    return res.status(400).json({ error: 'Question too long (max 500 chars)' });
  }

  try {
    console.log(`Agent query: "${question}" for project ${project_id}`);
    const result = await runLogAnalysisAgent(question, project_id);

    res.json({
      answer: result.answer,
      tools_used: result.toolsUsed,
      question,
    });
  } catch (err) {
    console.error('Agent error:', err);
    res.status(500).json({ error: 'Agent query failed' });
  }
});

export default router;
