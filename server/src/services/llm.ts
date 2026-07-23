import OpenAI from 'openai';
import 'dotenv/config';
import { Log } from '../types';

if (!process.env.GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY environment variable is required');
}

const client = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: process.env.AICREDITS_BASE_URL || 'https://api.aicredits.in/v1',
});

export async function generateSearchAnswer(
  question: string,
  relevantLogs: Log[]
): Promise<string> {
  const logContext = relevantLogs
    .map(log => `[${log.timestamp}] [${log.level}] [${log.service}] ${log.message}`)
    .join('\n');

  try {
    const response = await client.chat.completions.create({
      model: 'google/gemini-3.5-flash',
      messages: [
        {
          role: 'system',
          content: `You are a log analysis assistant. Analyze these log entries and answer the developer question concisely. Be specific about times, services, and error counts. If you cannot determine something from the logs, say so explicitly.

At the end of your answer, always add a "## Summary" section with 1-2 lines in very simple plain English that a non-technical person can understand. No jargon.`,
        },
        {
          role: 'user',
          content: `Log entries:\n${logContext}\n\nQuestion: ${question}`,
        },
      ],
      max_tokens: 3000,
    });
    return response.choices[0]?.message?.content || 'Unable to generate answer';
  } catch (err) {
    console.error('LLM answer error:', err);
    return (
      `Found ${relevantLogs.length} relevant logs. ` +
      `Most recent: [${relevantLogs[0]?.level}] ${relevantLogs[0]?.message}. ` +
      `AI summary unavailable — showing raw results below.`
    );
  }
}

export async function streamSearchAnswer(
  question: string,
  relevantLogs: any[],
  onChunk: (text: string) => void
): Promise<void> {
  const logContext = relevantLogs
    .map(log => `[${log.timestamp}] [${log.level}] [${log.service}] ${log.message}`)
    .join('\n');

  try {
    const stream = await client.chat.completions.create({
      model: 'google/gemini-3.5-flash',
      messages: [
        {
          role: 'system',
          content: `You are a log analysis assistant. Analyze these log entries and answer the developer question concisely. Be specific about times, services, and error counts.

At the end of your answer, always add a "## Summary" section with 1-2 lines in very simple plain English that a non-technical person can understand. No jargon.`,
        },
        {
          role: 'user',
          content: `Log entries:\n${logContext}\n\nQuestion: ${question}`,
        },
      ],
      max_tokens: 3000,
      stream: true,
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) onChunk(text);
    }
  } catch (err) {
    console.error('Stream LLM error:', err);
    onChunk(
      `Found ${relevantLogs.length} relevant logs. ` +
      `Most recent: [${relevantLogs[0]?.level}] ${relevantLogs[0]?.message}. ` +
      `AI summary unavailable.`
    );
  }
}

export async function generateStructuredAnswer(
  question: string,
  relevantLogs: any[]
): Promise<any> {
  const logContext = relevantLogs
    .map(log => `[${log.timestamp}] [${log.level}] [${log.service}] ${log.message}`)
    .join('\n');

  const prompt = `You are a log analysis assistant. Analyze these log entries and answer the question.

Log entries:
${logContext}

Question: ${question}

Respond with ONLY a valid JSON object, no markdown, no explanation:
{
  "answer": "detailed analysis",
  "severity": "low|medium|high|critical",
  "affected_services": ["service1"],
  "error_count": 0,
  "time_range": { "start": "timestamp or null", "end": "timestamp or null" },
  "summary": "1-2 sentence plain English summary",
  "recommendations": ["recommendation 1"]
}`;

  try {
    const response = await client.chat.completions.create({
      model: 'google/gemini-3.5-flash',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 800,
    });

    const rawText = response.choices[0]?.message?.content || '';
    // More aggressive JSON extraction
    let jsonText = rawText
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    // Find JSON object start and end
    const jsonStart = jsonText.indexOf('{');
    const jsonEnd = jsonText.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) {
      jsonText = jsonText.slice(jsonStart, jsonEnd + 1);
    }

    const parsed = JSON.parse(jsonText);
    return parsed;
  } catch (err) {
    console.error('Structured answer error:', err);
    return {
      answer: `Found ${relevantLogs.length} relevant logs.`,
      severity: 'medium',
      affected_services: [...new Set(relevantLogs.map((l: any) => l.service).filter(Boolean))],
      error_count: relevantLogs.filter((l: any) => l.level === 'ERROR').length,
      time_range: { start: null, end: null },
      summary: 'AI structured analysis unavailable.',
      recommendations: ['Review the relevant logs shown below for details'],
    };
  }
}
