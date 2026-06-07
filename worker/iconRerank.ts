import type { Storyboard, VisualElement } from "../shared/storyboard";
import { cachedMatches, normalizeQuery } from "../shared/openMojiEmbeddings";
import { cachedExcaliMatches } from "../shared/excalidrawEmbeddings";
import { isIconRefDenied } from "../shared/openMojiAssets";
import { cachedRerank, setRerank, saveRerank, type RerankChoice } from "../shared/iconRerankCache";
import { callGeminiJson } from "./agents";

/**
 * Context-aware icon RERANK (retrieve -> rerank). Embeddings give broad candidates
 * but can't judge meaning in context ("dog bites man" vs "man bites dog"). Here a
 * fast LLM sees the video title + each concept's scene/narration/caption + the
 * candidate icon NAMES, and picks the one that truly fits. One batched call per
 * video; decisions cached so render-time resolution stays synchronous.
 */

type Candidate = RerankChoice & { score: number };
type ConceptCtx = {
  key: string;
  concept: string;
  caption: string;
  sceneTitle: string;
  narration: string;
  candidates: Candidate[];
};

// Above this cosine the top match is unambiguous enough to skip reranking. Kept
// high so context (not just word similarity) decides most icons.
const SKIP_ABOVE = Number(process.env.RERANK_SKIP_ABOVE ?? 0.9);
const MAX_CONCEPTS = Number(process.env.RERANK_MAX_CONCEPTS ?? 48);
const TOP_K = 6;

function mergedCandidates(queryKey: string): Candidate[] {
  const out: Candidate[] = [];
  for (const m of cachedMatches(queryKey) ?? []) {
    const iconRef = `openmoji:${m.hexcode}`;
    if (isIconRefDenied(iconRef)) continue;
    out.push({ iconRef, svgPath: m.svgPath, label: m.label, source: "local-openmoji", score: m.score });
  }
  for (const m of cachedExcaliMatches(queryKey) ?? []) {
    out.push({ iconRef: `excali:${m.id}`, svgPath: m.svgPath, label: m.name, source: "excalidraw", score: m.score });
  }
  out.sort((a, b) => b.score - a.score);
  // De-duplicate by normalized label so the options read as distinct choices.
  const seen = new Set<string>();
  const distinct: Candidate[] = [];
  for (const c of out) {
    const k = c.label.trim().toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    distinct.push(c);
    if (distinct.length >= TOP_K) break;
  }
  return distinct;
}

function collectConcepts(storyboard: Storyboard): ConceptCtx[] {
  // First pass: gather every distinct concept + its candidates (whole video).
  const all = new Map<string, ConceptCtx>();
  for (const scene of storyboard.scenes) {
    for (const beat of scene.beats) {
      for (const el of beat.elements ?? []) {
        if (el.type !== "asset" && el.type !== "logo") continue;
        const concept = el.assetKey ?? "generic";
        const hint = el.searchHint ?? el.label ?? el.text;
        const key = normalizeQuery(concept, hint);
        if (!key || all.has(key) || cachedRerank(key)) continue;
        const candidates = mergedCandidates(key);
        if (candidates.length < 2) continue;
        all.set(key, {
          key,
          concept,
          caption: (el.label ?? el.text ?? el.searchHint ?? concept).toString(),
          sceneTitle: scene.title,
          narration: beat.narration,
          candidates,
        });
      }
    }
  }
  // A concept's top icon "collides" if another concept would also pick it — those
  // need the LLM to deconflict so different ideas don't share the same glyph.
  const topCount = new Map<string, number>();
  for (const c of all.values()) topCount.set(c.candidates[0].iconRef, (topCount.get(c.candidates[0].iconRef) ?? 0) + 1);
  const selected = [...all.values()].filter(
    (c) => c.candidates[0].score < SKIP_ABOVE || (topCount.get(c.candidates[0].iconRef) ?? 0) > 1,
  );
  return selected.slice(0, MAX_CONCEPTS);
}

function buildPrompt(title: string, concepts: ConceptCtx[]): string {
  const blocks = concepts
    .map((c, i) => {
      const opts = c.candidates.map((cand, j) => `${j + 1}=${cand.label}`).join("  ");
      return `[k${i}] concept "${c.concept}" (caption "${c.caption}")
   scene: "${c.sceneTitle}" — "${c.narration}"
   options: ${opts}`;
    })
    .join("\n");
  return `You are the art director choosing the best hand-drawn ICON for each concept in an explainer
video titled "${title}". Pick the option NUMBER whose icon best represents each concept IN ITS CONTEXT
(the scene + narration reveal the intended meaning — e.g. "bank" could be a riverbank or a money bank;
"mouse" an animal or a computer mouse).

Two rules:
1) CONTEXT FIT: choose what the viewer should picture for THIS concept in THIS scene.
2) VARIETY: different concepts must get DIFFERENT icons — never reuse the same icon for two distinct
   ideas across the video (e.g. don't let a padlock stand for "encryption", "a block", AND "a lock").
   If two concepts are drawn to the same option, give the less-central one its next best DISTINCT fit.
If several options fit equally and there's no clash, prefer option 1. If none fit, use 0.

Return ONLY JSON mapping each key to a number, e.g. {"k0": 2, "k1": 1}. Use these keys exactly:

${blocks}`;
}

export async function rerankIcons(storyboard: Storyboard): Promise<void> {
  let concepts: ConceptCtx[];
  try {
    concepts = collectConcepts(storyboard);
  } catch (error) {
    console.warn(`Icon rerank: candidate collection failed; skipping. ${String(error)}`);
    return;
  }
  if (!concepts.length) return;

  try {
    const model = process.env.RERANK_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const raw = (await callGeminiJson("IconRerank", buildPrompt(storyboard.title, concepts), 0.1, model)) as Record<string, unknown>;
    let changed = false;
    concepts.forEach((c, i) => {
      const pick = Number(raw?.[`k${i}`]);
      if (!Number.isFinite(pick) || pick < 1 || pick > c.candidates.length) return; // 0/invalid => keep embedding
      const chosen = c.candidates[pick - 1];
      setRerank(c.key, { iconRef: chosen.iconRef, svgPath: chosen.svgPath, label: chosen.label, source: chosen.source });
      changed = true;
    });
    if (changed) saveRerank();
    console.log(`Icon rerank: reviewed ${concepts.length} ambiguous concepts.`);
  } catch (error) {
    // Rerank is an enhancement layer — if it fails, embedding resolution still works.
    console.warn(`Icon rerank failed; using embedding matches. ${String(error)}`);
  }
}
