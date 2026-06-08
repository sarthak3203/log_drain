import OpenAI from 'openai';
import { Log } from '../types';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
export async function generateSearchAnswer(
 question: string,
 relevantLogs: Log[]
): Promise<string> {
 const logContext = relevantLogs.map(log =>
 `[${log.timestamp}] [${log.level}] [${log.service}] ${log.message}`
 ).join('\n');
 try {
 const response = await openai.chat.completions.create({
 model: 'gpt-4o-mini',
 messages: [
 {
 role: 'system',
 content: `You are a log analysis assistant. Analyze the provided log entries
and answer the developer's question concisely. Be specific about times, services, and
error counts.`,
 },
 {
 role: 'user',
 content: `Log entries:\n${logContext}\n\nQuestion: ${question}`,
 },
 ],
 max_tokens: 500,
 });
 return response.choices[0].message.content || 'Unable to generate answer';
 } catch (err) {
 return `Found ${relevantLogs.length} relevant logs. ` +
 `Most recent: [${relevantLogs[0]?.level}] ${relevantLogs[0]?.message}. ` +
 `AI summary unavailable — showing raw results below.`;
 }
}
