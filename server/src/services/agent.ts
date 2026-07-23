import { StateGraph, MessagesAnnotation, END } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { tool } from '@langchain/core/tools';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { AIMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { query } from '../db';
import { LogHybridRetriever } from './hybridRetriever';

if (!process.env.GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY is required');
}

// Initialize OpenAI-compatible model for the agent
const model = new ChatOpenAI({
  modelName: 'openai/gpt-4o-mini',
  apiKey: process.env.GEMINI_API_KEY,
  temperature: 0,
  configuration: {
    baseURL: process.env.AICREDITS_BASE_URL || 'https://api.aicredits.in/v1',
  },
});

// Tool 1: Search logs using hybrid retriever
const searchLogsTool = tool(
  async ({ query: searchQuery, service, mode = 'hybrid' }, config) => {
    const projectId = config?.configurable?.projectId;
    if (!projectId) return 'Error: No project ID provided';

    try {
      const retriever = new LogHybridRetriever({
        projectId,
        topK: 8,
        semanticWeight: mode === 'keyword' ? 0 : mode === 'semantic' ? 1 : 0.6,
        keywordWeight: mode === 'keyword' ? 1 : mode === 'semantic' ? 0 : 0.4,
        service: service || undefined,
      });

      const docs = await retriever.invoke(searchQuery);
      if (docs.length === 0) return 'No relevant logs found for this query.';

      const results = docs.map(doc =>
        `[${doc.metadata.timestamp}] [${doc.metadata.level}] [${doc.metadata.service}] ${doc.pageContent}`
      ).join('\n');

      return `Found ${docs.length} relevant logs:\n${results}`;
    } catch (err) {
      return `Search failed: ${err}`;
    }
  },
  {
    name: 'search_logs',
    description: 'Search through application logs using natural language or keywords. Use this to find specific errors, events, or patterns in logs.',
    schema: z.object({
      query: z.string().describe('The search query to find relevant logs'),
      service: z.string().optional().describe('Optional: filter by specific service name like payment-api, auth-api, order-api'),
      mode: z.enum(['hybrid', 'semantic', 'keyword']).optional().describe('Search mode: hybrid (default), semantic, or keyword'),
    }),
  }
);

// Tool 2: Get statistics and error rates
const getStatsTool = tool(
  async ({ hours = 24 }, config) => {
    const projectId = config?.configurable?.projectId;
    if (!projectId) return 'Error: No project ID provided';

    try {
      const errorRates = await query<{
        service: string;
        errors: number;
        total: number;
        error_rate_pct: number;
      }>(
        `SELECT 
          service,
          COUNT(*) FILTER (WHERE level = 'ERROR') as errors,
          COUNT(*) as total,
          ROUND(COUNT(*) FILTER (WHERE level = 'ERROR') * 100.0 / COUNT(*), 2) as error_rate_pct
         FROM logs
         WHERE project_id = $1
           AND timestamp > NOW() - ($2::int * INTERVAL '1 hour')
         GROUP BY service
         ORDER BY error_rate_pct DESC`,
        [projectId, hours]
      );

      if (errorRates.length === 0) return 'No statistics available for this time period.';

      const summary = errorRates.map(r =>
        `${r.service}: ${r.errors} errors out of ${r.total} total logs (${r.error_rate_pct}% error rate)`
      ).join('\n');

      return `Service statistics for last ${hours} hours:\n${summary}`;
    } catch (err) {
      return `Stats query failed: ${err}`;
    }
  },
  {
    name: 'get_stats',
    description: 'Get error rates and log volume statistics for all services. Use this when asked about overall system health, which service has most errors, or performance metrics.',
    schema: z.object({
      hours: z.number().optional().describe('Time window in hours to analyze (default: 24)'),
    }),
  }
);

// Tool 3: Check anomalies
const checkAnomaliesTool = tool(
  async ({ service }, config) => {
    const projectId = config?.configurable?.projectId;
    if (!projectId) return 'Error: No project ID provided';

    try {
      const conditions = ['project_id = $1', 'is_anomaly = TRUE'];
      const params: any[] = [projectId];
      let paramIndex = 2;

      if (service) {
        conditions.push(`service = $${paramIndex++}`);
        params.push(service);
      }

      const anomalies = await query<{
        id: number;
        service: string;
        level: string;
        message: string;
        timestamp: Date;
        anomaly_score: number;
      }>(
        `SELECT id, service, level, message, timestamp, anomaly_score
         FROM logs
         WHERE ${conditions.join(' AND ')}
         ORDER BY anomaly_score DESC
         LIMIT 10`,
        params
      );

      if (anomalies.length === 0) {
        return service
          ? `No anomalies detected for ${service} service.`
          : 'No anomalies detected across any service.';
      }

      const results = anomalies.map(a =>
        `[${a.timestamp}] [${a.service}] [score: ${Number(a.anomaly_score).toFixed(3)}] ${a.message}`
      ).join('\n');

      return `Found ${anomalies.length} anomalous logs:\n${results}`;
    } catch (err) {
      return `Anomaly check failed: ${err}`;
    }
  },
  {
    name: 'check_anomalies',
    description: 'Check for semantically anomalous logs that deviate from normal patterns. Use this when asked about unusual behavior, unexpected events, or anomalies.',
    schema: z.object({
      service: z.string().optional().describe('Optional: check anomalies for a specific service only'),
    }),
  }
);

// Tool 4: Get list of services
const getServicesTool = tool(
  async (_, config) => {
    const projectId = config?.configurable?.projectId;
    if (!projectId) return 'Error: No project ID provided';

    try {
      const services = await query<{
        service: string;
        log_count: number;
        last_seen: Date;
      }>(
        `SELECT service, COUNT(*) as log_count, MAX(timestamp) as last_seen
         FROM logs
         WHERE project_id = $1
         GROUP BY service
         ORDER BY last_seen DESC`,
        [projectId]
      );

      if (services.length === 0) return 'No services found.';

      const results = services.map(s =>
        `${s.service}: ${s.log_count} logs, last active at ${s.last_seen}`
      ).join('\n');

      return `Active services:\n${results}`;
    } catch (err) {
      return `Services query failed: ${err}`;
    }
  },
  {
    name: 'get_services',
    description: 'Get a list of all active services sending logs, with their log counts and last activity time.',
    schema: z.object({}),
  }
);

const tools = [searchLogsTool, getStatsTool, checkAnomaliesTool, getServicesTool];
const toolNode = new ToolNode(tools);
const modelWithTools = model.bindTools(tools);

// Agent decision function
async function callAgent(state: typeof MessagesAnnotation.State) {
  const response = await modelWithTools.invoke(state.messages);
  return { messages: [response] };
}

// Routing function: continue to tools or end
function shouldContinue(state: typeof MessagesAnnotation.State) {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
  if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
    return 'tools';
  }
  return END;
}

// Build the LangGraph
const workflow = new StateGraph(MessagesAnnotation)
  .addNode('agent', callAgent)
  .addNode('tools', toolNode)
  .addEdge('__start__', 'agent')
  .addConditionalEdges('agent', shouldContinue)
  .addEdge('tools', 'agent');

export const logAnalysisAgent = workflow.compile();

// Main function to run the agent
export async function runLogAnalysisAgent(
  question: string,
  projectId: string
): Promise<{ answer: string; toolsUsed: string[] }> {
  const systemPrompt = `You are an expert log analysis assistant for a software development team.
You have access to tools to search logs, get statistics, check for anomalies, and list services.

When answering questions:
1. Use the appropriate tools to gather information first
2. You can call multiple tools if needed
3. Be specific about times, error counts, and service names
4. At the end, always provide a brief plain-English summary

Always use tools to get real data before answering. Never make up log data.`;

  const result = await logAnalysisAgent.invoke(
    {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question },
      ],
  },
  {
    configurable: { projectId },
    recursionLimit: 8,
  }
);

  // Extract the final answer from the last AI message
  const messages = result.messages;
  const finalMessage = messages[messages.length - 1];
  const answer = typeof finalMessage.content === 'string'
    ? finalMessage.content
    : Array.isArray(finalMessage.content)
    ? finalMessage.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('')
    : String(finalMessage.content);

  // Track which tools were called
  const toolsUsed: string[] = [];
  for (const msg of messages) {
    const aiMsg = msg as AIMessage;
    if (aiMsg.tool_calls) {
      for (const tc of aiMsg.tool_calls) {
        if (!toolsUsed.includes(tc.name)) {
          toolsUsed.push(tc.name);
        }
      }
    }
  }

  return { answer, toolsUsed };
}
