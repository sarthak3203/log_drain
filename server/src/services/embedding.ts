import 'dotenv/config';
import { OpenAIEmbeddings } from '@langchain/openai';

if (!process.env.GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY environment variable is required');
}

const embeddings = new OpenAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  modelName: 'text-embedding-3-small',
  configuration: {
    baseURL: process.env.AICREDITS_BASE_URL || 'https://api.aicredits.in/v1',
  },
});

export async function getEmbedding(text: string): Promise<number[]> {
  let lastError: any;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await embeddings.embedQuery(text.substring(0, 8000));
      return result;
    } catch (err: any) {
      lastError = err;
      if (err?.status === 503 || err?.status === 429) {
        const waitMs = attempt * 2000;
        console.log(`Embedding API unavailable, retrying in ${waitMs}ms (attempt ${attempt}/3)`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
      } else {
        throw err;
      }
    }
  }
  throw lastError;
}

export async function getBatchEmbeddings(texts: string[]): Promise<number[][]> {
  let lastError: any;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const results = await embeddings.embedDocuments(
        texts.map(t => t.substring(0, 8000))
      );
      return results;
    } catch (err: any) {
      lastError = err;
      if (err?.status === 503 || err?.status === 429) {
        const waitMs = attempt * 2000;
        console.log(`Batch embedding unavailable, retrying in ${waitMs}ms (attempt ${attempt}/3)`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
      } else {
        throw err;
      }
    }
  }
  throw lastError;
}

export { embeddings as openAIEmbeddings };
