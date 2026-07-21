import 'dotenv/config';
const { GoogleGenAI } = require("@google/genai");

if (!process.env.GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY environment variable is required');
}

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

export async function getEmbedding(text: string): Promise<number[]> {
  let lastError: any;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await ai.models.embedContent({
        model: 'gemini-embedding-2',
        contents: text.substring(0, 8000),
        config: { outputDimensionality: 768 },
      });
      return result.embeddings[0].values;
    } catch (err: any) {
      lastError = err;
      if (err?.status === 503 || err?.status === 429) {
        const waitMs = attempt * 2000;
        console.log(`Gemini unavailable, retrying in ${waitMs}ms (attempt ${attempt}/3)`);
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
