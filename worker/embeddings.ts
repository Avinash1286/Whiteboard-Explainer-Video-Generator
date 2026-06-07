import { GoogleAuth } from "google-auth-library";

/**
 * Vertex AI text embeddings (model from EMBED_MODEL, default gemini-embedding-001,
 * 768-dim). Used to index the OpenMoji + Excalidraw sets and to embed concept
 * queries for nearest-neighbour icon lookup. IMPORTANT: EMBED_MODEL must stay the
 * SAME model the prebuilt embedding indexes under assets/vendor were built with,
 * or query/doc vectors won't be comparable.
 */

export const EMBED_DIM = 768;

function hasCredentials(): boolean {
  return Boolean(process.env.GOOGLE_CLOUD_PROJECT && process.env.GOOGLE_APPLICATION_CREDENTIALS);
}

let authClient: Awaited<ReturnType<GoogleAuth["getClient"]>> | null = null;
async function getToken(): Promise<string> {
  if (!authClient) {
    const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
    authClient = await auth.getClient();
  }
  const token = await authClient.getAccessToken();
  if (!token.token) throw new Error("Failed to obtain Google access token for embeddings");
  return token.token;
}

export function embeddingsAvailable(): boolean {
  return hasCredentials();
}

/**
 * Embed a batch of texts. `taskType` is RETRIEVAL_DOCUMENT for the icon index and
 * RETRIEVAL_QUERY for concept lookups. Returns L2-normalised vectors so that
 * cosine similarity is a plain dot product.
 */
export async function embedTexts(
  texts: string[],
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" = "RETRIEVAL_QUERY",
  onProgress?: (done: number, total: number) => void,
): Promise<number[][]> {
  if (!texts.length) return [];
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.VERTEX_EMBED_LOCATION || "us-central1";
  const model = process.env.EMBED_MODEL || "gemini-embedding-001";
  const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:predict`;
  const token = await getToken();

  const batchSize = model.includes("gemini") ? 100 : 25;
  // The project's embedding quota rejects bursts, so pace requests apart.
  const delayMs = model.includes("gemini") ? Number(process.env.EMBED_DELAY_MS ?? 3000) : 0;
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const slice = texts.slice(i, i + batchSize);
    const data = await postWithRetry(endpoint, token, {
      instances: slice.map((content) => ({ content, task_type: taskType })),
      parameters: { outputDimensionality: EMBED_DIM },
    });
    for (const pred of data.predictions ?? []) {
      out.push(normalize(pred.embeddings?.values ?? []));
    }
    onProgress?.(Math.min(i + batchSize, texts.length), texts.length);
    if (delayMs > 0 && i + batchSize < texts.length) await sleep(delayMs);
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function postWithRetry(
  endpoint: string,
  token: string,
  body: unknown,
): Promise<{ predictions?: { embeddings?: { values?: number[] } }[] }> {
  let delay = 4000;
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) return response.json() as Promise<{ predictions?: { embeddings?: { values?: number[] } }[] }>;
    // Back off on rate-limit / transient errors.
    if (response.status === 429 || response.status === 503 || response.status === 500) {
      await response.text();
      await sleep(delay);
      delay = Math.min(delay * 1.7, 30000);
      continue;
    }
    throw new Error(`Vertex embeddings failed: ${response.status} ${await response.text()}`);
  }
  throw new Error("Vertex embeddings failed after retries (rate limited)");
}

function normalize(vec: number[]): number[] {
  let sum = 0;
  for (const v of vec) sum += v * v;
  const norm = Math.sqrt(sum) || 1;
  return vec.map((v) => v / norm);
}
