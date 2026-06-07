import type { Storyboard } from "../shared/storyboard";
import {
  cachedMatches,
  embeddingIndexAvailable,
  matchVector,
  normalizeQuery,
  saveQueryCache,
  setQueryMatches,
} from "../shared/openMojiEmbeddings";
import {
  cachedExcaliMatches,
  excaliIndexAvailable,
  matchExcaliVector,
  saveExcaliCache,
  setExcaliMatches,
} from "../shared/excalidrawEmbeddings";
import { cachedChoice, saveChoices, setChoice } from "../shared/iconChoice";
import { embeddingsAvailable, embedTexts } from "./embeddings";
import { resolveIconifyIcon } from "./iconify";

// Above this OpenMoji cosine score we trust OpenMoji and skip the Iconify fallback.
// Gemini embedding cosines are compressed (~0.55-0.75), so wrong proxies still
// clear ~0.6; only a clearly-strong match (>=0.66) keeps OpenMoji.
const OPENMOJI_CONFIDENT = 0.66;

type Query = { queryKey: string; text: string; search: string };

function collectQueries(storyboard: Storyboard): Query[] {
  const seen = new Set<string>();
  const queries: Query[] = [];
  const add = (key?: string, label?: string, imagery?: string) => {
    if (!key) return;
    // Must match the render-time resolver's query (normalizeQuery(key, hint)) so
    // the embedding cache HITS for hinted items.
    const queryKey = normalizeQuery(key, label);
    if (!queryKey || seen.has(queryKey)) return;
    seen.add(queryKey);
    // Iconify is keyword-based: prefer the concrete imagery hint, else the concept
    // noun (assetKey), else the caption when the key is a generic placeholder.
    const keyTerm = normalizeQuery(key, "");
    const imageryTerm = normalizeQuery(imagery ?? "", "");
    const search =
      imageryTerm ||
      (!keyTerm || keyTerm === "generic" || keyTerm === "concept" ? normalizeQuery(label ?? "", "") : keyTerm);
    queries.push({ queryKey, text: queryKey, search });
  };
  for (const scene of storyboard.scenes) {
    for (const beat of scene.beats) {
      add(beat.visual.assetKey, beat.visual.label);
      for (const element of beat.elements ?? []) {
        if (element.type === "asset" || element.type === "logo") {
          const hint = element.searchHint ?? element.label ?? element.text;
          add(element.assetKey, hint, element.searchHint);
        }
      }
    }
  }
  return queries;
}

/**
 * Pipeline pre-pass. (1) Embeds each distinct concept and caches its OpenMoji
 * nearest-neighbours. (2) For concepts OpenMoji can't confidently match, pulls a
 * long-tail icon from Iconify and caches the choice. Both feed the synchronous
 * render-time resolver. No-op (harmless) when embeddings/index are unavailable.
 */
export async function warmIconEmbeddings(storyboard: Storyboard): Promise<void> {
  if (!embeddingIndexAvailable()) return;
  const queries = collectQueries(storyboard);

  // (1) Embed each concept once, then cache nearest-neighbours from BOTH the
  // OpenMoji and the Excalidraw indexes (one query vector, two lookups).
  const hasExcali = excaliIndexAvailable();
  const toEmbed = queries.filter((q) => !cachedMatches(q.queryKey) || (hasExcali && !cachedExcaliMatches(q.queryKey)));
  if (toEmbed.length && embeddingsAvailable()) {
    try {
      const vectors = await embedTexts(
        toEmbed.map((q) => q.text),
        "RETRIEVAL_QUERY",
      );
      toEmbed.forEach((query, i) => {
        const vector = vectors[i];
        if (!vector) return;
        setQueryMatches(query.queryKey, matchVector(vector, 8));
        if (hasExcali) setExcaliMatches(query.queryKey, matchExcaliVector(vector, 8));
      });
      saveQueryCache();
      if (hasExcali) saveExcaliCache();
    } catch (error) {
      console.warn(`Icon embedding warm pass failed; using keyword matching. ${String(error)}`);
    }
  }

  // (2) Iconify long-tail fallback — only when NEITHER index has a confident hit.
  let changed = false;
  for (const query of queries) {
    if (cachedChoice(query.queryKey) || !query.search) continue;
    const top = cachedMatches(query.queryKey)?.[0]?.score ?? 0;
    const exTop = cachedExcaliMatches(query.queryKey)?.[0]?.score ?? 0;
    if (Math.max(top, exTop) >= OPENMOJI_CONFIDENT) continue;
    const choice = await resolveIconifyIcon(query.search);
    if (choice) {
      setChoice(query.queryKey, choice);
      changed = true;
    }
  }
  if (changed) saveChoices();
}
