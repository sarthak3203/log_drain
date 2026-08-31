import 'dotenv/config';
import OpenAI from 'openai';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { Log } from '../types';
import { z } from 'zod';
import { performance } from 'node:perf_hooks';

const timingEnabled = process.env.DEBUG_TIMING === 'true';

function startTiming(label: string): () => void {
  if (!timingEnabled) return () => undefined;
  const startedAt = performance.now();
  return () => console.log(`[DEBUG_TIMING] ${label}: ${(performance.now() - startedAt).toFixed(3)} ms`);
}

if (!process.env.GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY environment variable is required');
}

// Raw OpenAI client - only for streaming (LangChain streaming is complex)
const streamClient = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY!,
  baseURL: process.env.AICREDITS_BASE_URL || 'https://api.aicredits.in/v1',
});

// LangChain wrapper - for all non-streaming calls, auto-traced by LangSmith
const chatModel = new ChatOpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  modelName: 'google/gemini-3.5-flash',
  maxTokens: 3000,
  configuration: {
    baseURL: process.env.AICREDITS_BASE_URL || 'https://api.aicredits.in/v1',
  },
});

const SYSTEM_PROMPT = `You are a log analysis assistant. Analyze these log entries and answer the developer question concisely. Be specific about times, services, and error counts. If you cannot determine something from the logs, say so explicitly.

At the end of your answer, always add a "## Summary" section with 1-2 lines in very simple plain English that a non-technical person can understand. No jargon.`;

export const SearchAnswerSchema = z.object({
  answer: z.string().describe('Main analysis of the logs answering the question'),
  severity: z.enum(['low', 'medium', 'high', 'critical']).describe('Overall severity of the issues found'),
  affected_services: z.array(z.string()).describe('List of service names that are affected'),
  error_count: z.number().describe('Total number of errors found'),
  time_range: z.object({
    start: z.string().nullable().describe('Earliest timestamp of relevant logs'),
    end: z.string().nullable().describe('Latest timestamp of relevant logs'),
  }),
  summary: z.string().describe('1-2 sentence plain English summary for non-technical people'),
  recommendations: z.array(z.string()).describe('List of 1-3 actionable recommendations'),
});

export type SearchAnswer = z.infer<typeof SearchAnswerSchema>;

function extractTextFromResponse(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('');
  }
  return String(content);
}

export async function generateSearchAnswer(
  question: string,
  relevantLogs: Log[]
): Promise<string> {
  const logContext = relevantLogs
    .map(log => `[${log.timestamp}] [${log.level}] [${log.service}] ${log.message}`)
    .join('\n');

  try {
    const response = await chatModel.invoke([
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(`Log entries:\n${logContext}\n\nQuestion: ${question}`),
    ]);
    return extractTextFromResponse(response.content);
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
    const stream = await streamClient.chat.completions.create({
      model: 'google/gemini-3.5-flash',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Log entries:\n${logContext}\n\nQuestion: ${question}` },
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
): Promise<SearchAnswer> {
  const logContext = relevantLogs
    .map(log => `[${log.timestamp}] [${log.level}] [${log.service}] ${log.message}`)
    .join('\n');

  const prompt = `You are a log analysis assistant. Analyze these log entries and answer the question.

Log entries:
${logContext}

Question: ${question}

Respond with ONLY a valid JSON object, no markdown, no explanation:
{
  "answer": "detailed analysis answering the question with specific times and counts",
  "severity": "low|medium|high|critical",
  "affected_services": ["service1", "service2"],
  "error_count": 0,
  "time_range": {
    "start": "earliest timestamp or null",
    "end": "latest timestamp or null"
  },
  "summary": "1-2 sentence plain English summary",
  "recommendations": ["recommendation 1", "recommendation 2"]
}`;

  try {
    const endLlmCall = startTiming('structured search: LLM call');
    const response = await chatModel.invoke([
      new HumanMessage(prompt),
    ]);
    endLlmCall();

    const rawText = extractTextFromResponse(response.content);

    let jsonText = rawText
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    const jsonStart = jsonText.indexOf('{');
    const jsonEnd = jsonText.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) {
      jsonText = jsonText.slice(jsonStart, jsonEnd + 1);
    }

    const parsed = JSON.parse(jsonText);
    const validated = SearchAnswerSchema.parse(parsed);
    return validated;
  } catch (err) {
    console.error('Structured answer error:', err);
    return {
      answer: `Found ${relevantLogs.length} relevant logs. Most recent: [${relevantLogs[0]?.level}] ${relevantLogs[0]?.message}.`,
      severity: 'medium',
      affected_services: [...new Set(relevantLogs.map((l: any) => l.service).filter(Boolean))],
      error_count: relevantLogs.filter((l: any) => l.level === 'ERROR').length,
      time_range: {
        start: relevantLogs[relevantLogs.length - 1]?.timestamp?.toString() || null,
        end: relevantLogs[0]?.timestamp?.toString() || null,
      },
      summary: 'AI structured analysis unavailable. Showing raw log results below.',
      recommendations: ['Review the relevant logs shown below for details'],
    };
  }
}
