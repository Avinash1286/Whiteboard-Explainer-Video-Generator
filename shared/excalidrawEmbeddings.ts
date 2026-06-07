import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Nearest-neighbour lookup over the Excalidraw hand-drawn asset index
 * (built by scripts/excalidraw/build-embeddings.ts), mirroring the OpenMoji
 * index so their cosine scores are directly comparable. The pipeline embeds each
 * concept query once (worker/iconWarm.ts) and caches the top matches to disk, so
 * the render-time resolver stays synchronous.
 */

export type ExcaliMatch = { id: string; name: string; svgPath: string; score: number };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const binPath = path.join(root, "assets", "vendor", "excalidraw", "embeddings.bin");
const metaPath = path.join(root, "assets", "vendor", "excalidraw", "embeddings-meta.json");
const queryCachePath = path.join(root, "assets", "generated", "excalidraw-query-cache.json");

type Meta = { dim: number; entries: { id: string; name: string; svgPath: string }[] };
type Index = { dim: number; entries: Meta["entries"]; vectors: Float32Array };

let indexCache: Index | null | undefined;

export function excaliIndexAvailable(): boolean {
  return existsSync(binPath) && existsSync(metaPath);
}

function loadIndex(): Index | null {
  if (indexCache !== undefined) return indexCache;
  if (!excaliIndexAvailable()) {
    indexCache = null;
    return null;
  }
  const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Meta;
  const buf = readFileSync(binPath);
  const vectors = new Float32Array(buf.buffer, buf.byteOffset, meta.entries.length * meta.dim);
  indexCache = { dim: meta.dim, entries: meta.entries, vectors };
  return indexCache;
}

/** Top-k Excalidraw matches for a (already L2-normalised) query vector. */
export function matchExcaliVector(queryVec: number[], topK = 8): ExcaliMatch[] {
  const index = loadIndex();
  if (!index) return [];
  const { dim, entries, vectors } = index;
  const scored: ExcaliMatch[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    let dot = 0;
    const base = i * dim;
    for (let d = 0; d < dim; d += 1) dot += queryVec[d] * vectors[base + d];
    scored.push({ id: entries[i].id, name: entries[i].name, svgPath: entries[i].svgPath, score: dot });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

// ---- disk-backed query → matches cache (so render-time stays sync) ----
let queryCache: Record<string, ExcaliMatch[]> | undefined;

function loadQueryCache(): Record<string, ExcaliMatch[]> {
  if (queryCache) return queryCache;
  queryCache = existsSync(queryCachePath)
    ? (JSON.parse(readFileSync(queryCachePath, "utf8")) as Record<string, ExcaliMatch[]>)
    : {};
  return queryCache;
}

export function cachedExcaliMatches(queryKey: string): ExcaliMatch[] | null {
  return loadQueryCache()[queryKey] ?? null;
}

export function setExcaliMatches(queryKey: string, matches: ExcaliMatch[]): void {
  loadQueryCache()[queryKey] = matches;
}

export function saveExcaliCache(): void {
  if (!queryCache) return;
  mkdirSync(path.dirname(queryCachePath), { recursive: true });
  writeFileSync(queryCachePath, JSON.stringify(queryCache, null, 0));
}
