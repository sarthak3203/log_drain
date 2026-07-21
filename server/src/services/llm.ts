import "dotenv/config";
const { GoogleGenAI } = require("@google/genai");
import { Log } from "../types";

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
