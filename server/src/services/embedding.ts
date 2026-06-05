import OpenAI from "openai";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// Convert text to a 384-dimensional vector
// Returns an array of 384 floats
export async function getEmbedding(text: string): Promise<number[]> {
  if (process.env.EMBEDDING_MODEL === "openai") {
    return getOpenAIEmbedding(text);
  }
  // For local model, you'd call a local FastAPI server running all-MiniLM-L6-v2
  // That's an optional extension covered in the deployment section
  return getOpenAIEmbedding(text);
}
async function getOpenAIEmbedding(text: string): Promise<number[]> {
  // Truncate long texts — embedding models have token limits
  // 8000 chars is safely under the limit for most models
  const truncated = text.substring(0, 8000);

  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: truncated,
    dimensions: 384, // request 384 dims for compatibility with pgvector setup
  });
  return response.data[0].embedding;
}
// Batch embedding: more efficient than one-at-a-time
// OpenAI's API accepts up to 2048 inputs per request
export async function getBatchEmbeddings(texts: string[]): Promise<number[][]> {
  const truncated = texts.map((t) => t.substring(0, 8000));

  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: truncated,
    dimensions: 384,
  });
  // Sort by index to ensure order matches input
  return response.data
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
}
