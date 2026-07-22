import "dotenv/config";
import { z } from "zod";
const { GoogleGenAI } = require("@google/genai");
import { Log } from "../types";

export const SearchAnswerSchema = z.object({
  answer: z.string().describe("Main analysis of the logs answering the question"),
  severity: z.enum(["low", "medium", "high", "critical"]).describe("Overall severity of the issues found"),
  affected_services: z.array(z.string()).describe("List of service names that are affected"),
  error_count: z.number().describe("Total number of errors found"),
  time_range: z.object({
    start: z.string().nullable().describe("Earliest timestamp of relevant logs"),
    end: z.string().nullable().describe("Latest timestamp of relevant logs"),
  }),
  summary: z.string().describe("1-2 sentence plain English summary for non-technical people"),
  recommendations: z.array(z.string()).describe("List of 1-3 actionable recommendations"),
});

export type SearchAnswer = z.infer<typeof SearchAnswerSchema>;

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY environment variable is required");
}

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

export async function generateSearchAnswer(
  question: string,
  relevantLogs: Log[],
): Promise<string> {
  const logContext = relevantLogs
    .map(
      (log) =>
        `[${log.timestamp}] [${log.level}] [${log.service}] ${log.message}`,
    )
    .join("\n");

  try {
    const result = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `You are a log analysis assistant. Analyze these log entries and answer the developer question concisely. Be specific about times, services, and error counts. If you cannot determine something from the logs, say so explicitly.

At the end of your answer, always add a "Summary" section with 1-2 lines in very simple plain English that a non-technical person can understand. No jargon. Just what happened and how bad it is.

Log entries:
${logContext}

Question: ${question}`,
    });
    return result.text || "";
  } catch (err) {
    console.error("LLM answer error:", err);
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
  onChunk: (text: string) => void,
): Promise<void> {
  const logContext = relevantLogs
    .map(
      (log) =>
        `[${log.timestamp}] [${log.level}] [${log.service}] ${log.message}`,
    )
    .join("\n");

  try {
    const stream = await ai.models.generateContentStream({
      model: "gemini-3.5-flash",
      contents: `You are a log analysis assistant. Analyze these log entries and answer the developer question concisely. Be specific about times, services, and error counts. If you cannot determine something from the logs, say so explicitly.

At the end of your answer, always add a "Summary" section with 1-2 lines in very simple plain English that a non-technical person can understand. No jargon. Just what happened and how bad it is.

Log entries:
${logContext}

Question: ${question}`,
    });

    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) {
        onChunk(text);
      }
    }
  } catch (err) {
    console.error("Stream LLM error:", err);
    onChunk(
      `Found ${relevantLogs.length} relevant logs. Most recent: [${relevantLogs[0]?.level}] ${relevantLogs[0]?.message}. AI summary unavailable.`,
    );
  }
}

export async function generateStructuredAnswer(
  question: string,
  relevantLogs: any[],
): Promise<SearchAnswer> {
  const logContext = relevantLogs
    .map(
      (log) =>
        `[${log.timestamp}] [${log.level}] [${log.service}] ${log.message}`,
    )
    .join("\n");

  const prompt = `You are a log analysis assistant. Analyze these log entries and answer the question.

Log entries:
${logContext}

Question: ${question}

Respond with ONLY a valid JSON object matching this exact structure, no markdown, no explanation:
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
    const result = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
    });

    const rawText = result.text || "";

    const jsonText = rawText
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    const parsed = JSON.parse(jsonText);
    const validated = SearchAnswerSchema.parse(parsed);
    return validated;
  } catch (err) {
    console.error("Structured answer error:", err);
    return {
      answer: `Found ${relevantLogs.length} relevant logs. Most recent: [${relevantLogs[0]?.level}] ${relevantLogs[0]?.message}.`,
      severity: "medium",
      affected_services: [...new Set(relevantLogs.map((l) => l.service).filter(Boolean))],
      error_count: relevantLogs.filter((l) => l.level === "ERROR").length,
      time_range: {
        start: relevantLogs[relevantLogs.length - 1]?.timestamp?.toString() || null,
        end: relevantLogs[0]?.timestamp?.toString() || null,
      },
      summary: "AI structured analysis unavailable. Showing raw log results below.",
      recommendations: ["Review the relevant logs shown below for details"],
    };
  }
}
