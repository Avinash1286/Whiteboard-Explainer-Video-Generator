import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Nearest-neighbour icon lookup over the OpenMoji embedding index
 * (built by scripts/build-openmoji-embeddings.ts). The async query embedding is
 * done in the pipeline (worker/iconWarm.ts) and the resulting top matches are
 * cached to disk, so the render-time resolver stays synchronous.
 */

export type IconMatch = { hexcode: string; svgPath: string; label: string; score: number };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const binPath = path.join(root, "assets", "vendor", "openmoji", "embeddings.bin");
const metaPath = path.join(root, "assets", "vendor", "openmoji", "embeddings-meta.json");
const queryCachePath = path.join(root, "assets", "generated", "icon-query-cache.json");

type Meta = { dim: number; entries: { hexcode: string; label: string; svgPath: string }[] };

type Index = { dim: number; entries: Meta["entries"]; vectors: Float32Array };
let indexCache: Index | null | undefined;

export function embeddingIndexAvailable(): boolean {
  return existsSync(binPath) && existsSync(metaPath);
}

function loadIndex(): Index | null {
  if (indexCache !== undefined) return indexCache;
  if (!embeddingIndexAvailable()) {
    indexCache = null;
    return null;
  }
  const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Meta;
  const buf = readFileSync(binPath);
  const vectors = new Float32Array(buf.buffer, buf.byteOffset, meta.entries.length * meta.dim);
  indexCache = { dim: meta.dim, entries: meta.entries, vectors };
  return indexCache;
}

export function normalizeQuery(key: string, label?: string): string {
  return [key, label ?? ""]
    .join(" ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[^\w\s-]/g, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Top-k OpenMoji matches for a (already L2-normalised) query vector. */
export function matchVector(queryVec: number[], topK = 8): IconMatch[] {
  const index = loadIndex();
  if (!index) return [];
  const { dim, entries, vectors } = index;
  const scored: IconMatch[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    let dot = 0;
    const base = i * dim;
    for (let d = 0; d < dim; d += 1) dot += queryVec[d] * vectors[base + d];
    scored.push({ hexcode: entries[i].hexcode, svgPath: entries[i].svgPath, label: entries[i].label, score: dot });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

// ---- disk-backed query → matches cache (so render-time stays sync) ----
let queryCache: Record<string, IconMatch[]> | undefined;

function loadQueryCache(): Record<string, IconMatch[]> {
  if (queryCache) return queryCache;
  queryCache = existsSync(queryCachePath)
    ? (JSON.parse(readFileSync(queryCachePath, "utf8")) as Record<string, IconMatch[]>)
    : {};
  return queryCache;
}

export function cachedMatches(queryKey: string): IconMatch[] | null {
  return loadQueryCache()[queryKey] ?? null;
}

export function setQueryMatches(queryKey: string, matches: IconMatch[]): void {
  const cache = loadQueryCache();
  cache[queryKey] = matches;
}

export function saveQueryCache(): void {
  if (!queryCache) return;
  mkdirSync(path.dirname(queryCachePath), { recursive: true });
  writeFileSync(queryCachePath, JSON.stringify(queryCache, null, 0));
}
