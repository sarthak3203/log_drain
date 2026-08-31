import 'dotenv/config';
import { OpenAIEmbeddings } from '@langchain/openai';
import { performance } from 'node:perf_hooks';

const timingEnabled = process.env.DEBUG_TIMING === 'true';
let providerRequestSequence = 0;

async function getRequestBodyText(input: string | URL | Request, init?: RequestInit): Promise<string | null> {
  if (typeof init?.body === 'string') return init.body;
  if (input instanceof Request) return input.clone().text();
  return null;
}

function describeEmbeddingPayload(bodyText: string | null): Record<string, unknown> {
  if (!bodyText) return { body_type: 'unavailable' };
  try {
    const body = JSON.parse(bodyText) as Record<string, unknown>;
    const input = body.input;
    const inputs = Array.isArray(input) ? input : [input];
    return {
      json_bytes: Buffer.byteLength(bodyText, 'utf8'),
      keys: Object.keys(body).sort(),
      model: body.model,
      input_shape: Array.isArray(input) ? 'array' : typeof input,
      input_count: inputs.length,
      input_utf8_bytes: inputs.map((value) => Buffer.byteLength(String(value), 'utf8')),
      dimensions: body.dimensions ?? null,
      encoding_format: body.encoding_format ?? null,
    };
  } catch {
    return { body_type: 'non-json', body_bytes: Buffer.byteLength(bodyText, 'utf8') };
  }
}

const embeddingFetch: typeof fetch = async (input, init) => {
  if (!timingEnabled) return globalThis.fetch(input, init);

  const requestNumber = ++providerRequestSequence;
  const bodyText = await getRequestBodyText(input, init);
  console.log(
    `[DEBUG_TIMING] embedding provider request #${requestNumber} payload: ` +
    JSON.stringify(describeEmbeddingPayload(bodyText)),
  );

  const startedAt = performance.now();
  try {
    const response = await globalThis.fetch(input, init);
    console.log(
      `[DEBUG_TIMING] embedding provider HTTP request #${requestNumber}: ` +
      `${(performance.now() - startedAt).toFixed(3)} ms, status ${response.status}`,
    );
    if (!response.ok) {
      console.log(
        `[DEBUG_TIMING] embedding provider request #${requestNumber} failed with HTTP ${response.status}; ` +
        'a following provider request would indicate an SDK retry.',
      );
    }
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(
      `[DEBUG_TIMING] embedding provider HTTP request #${requestNumber} threw after ` +
      `${(performance.now() - startedAt).toFixed(3)} ms: ${message}; ` +
      'a following provider request would indicate an SDK retry.',
    );
    throw error;
  }
};

if (!process.env.GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY environment variable is required');
}

const embeddings = new OpenAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  modelName: 'text-embedding-3-small',
  configuration: {
    baseURL: process.env.AICREDITS_BASE_URL || 'https://api.aicredits.in/v1',
    fetch: embeddingFetch,
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
        const reason = err?.message || `HTTP ${err.status}`;
        const prefix = timingEnabled ? '[DEBUG_TIMING] ' : '';
        console.log(`${prefix}Embedding API retry ${attempt}/3 in ${waitMs}ms: ${reason}`);
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
