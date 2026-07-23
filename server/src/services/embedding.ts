import OpenAI from 'openai';
import 'dotenv/config';

if (!process.env.GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY environment variable is required');
}

const client = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: process.env.AICREDITS_BASE_URL || 'https://api.aicredits.in/v1',
});

export async function getEmbedding(text: string): Promise<number[]> {
  let lastError: any;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await client.embeddings.create({
        model: 'text-embedding-3-small',
        input: text.substring(0, 8000),
      });
      return response.data[0].embedding;
    } catch (err: any) {
      lastError = err;
      if (err?.status === 503 || err?.status === 429) {
        const waitMs = attempt * 2000;
        console.log(`API unavailable, retrying in ${waitMs}ms (attempt ${attempt}/3)`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
      } else {
        throw err;
      }
    }
  }
  throw lastError;
}

export async function getBatchEmbeddings(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];
  for (const text of texts) {
    const embedding = await getEmbedding(text);
    embeddings.push(embedding);
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  return embeddings;
}
