import { GoogleAuth } from "google-auth-library";
import { assetCatalogPrompt } from "../shared/assetCatalog";
import { composeSceneGraphPlan, sanitizeGraphScene, sanitizeSceneGraphPlan } from "../shared/sceneGraph";
import type { Storyboard } from "../shared/storyboard";

type AgentPlannerSource = "agents";

function hasGoogleCredentials(): boolean {
  return Boolean(process.env.GOOGLE_CLOUD_PROJECT && process.env.GOOGLE_APPLICATION_CREDENTIALS);
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    throw new Error("Gemini response did not contain a JSON object");
  }
  return JSON.parse(candidate.slice(first, last + 1));
}

export async function callGeminiJson(agentName: string, prompt: string, temperature = 0.25, modelOverride?: string): Promise<unknown> {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.VERTEX_LOCATION || "global";
  const model = modelOverride || process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const endpoint = `https://aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();

  // Hard timeout so a hung/slow Vertex response can NEVER block the job forever
  // (which left it silently stuck at "planning"). On timeout we abort and throw,
  // the director retries, and after 2 attempts the job is marked failed.
  const timeoutMs = Number(process.env.GEMINI_TIMEOUT_MS ?? 90000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature,
          responseMimeType: "application/json",
        },
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${agentName} timed out after ${timeoutMs}ms (no response from Vertex)`);
    }
    throw new Error(`${agentName} request failed: ${String(error)}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`${agentName} failed: ${response.status} ${await response.text()}`);
  }
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? "").join("\n");
  if (!text) {
    throw new Error(`${agentName} did not return text`);
  }
  return extractJson(text);
}

// Stage 1 — the SCRIPTWRITER: plan the whole video as a structure + spoken SCRIPT.
// A dedicated designer turns each scene into visuals later.
function outlinePrompt(prompt: string): string {
  return `You are a master explainer-video SCRIPTWRITER — the caliber of the very best science
communicators (3Blue1Brown, Kurzgesagt, Vox). Your job is the STRUCTURE and the spoken SCRIPT. You do
NOT design visuals (a separate designer does that).

Return ONLY JSON:
{
  "title": string,              // <= 60 chars, an intriguing video title (not generic)
  "durationSeconds": integer,   // 90-150
  "scenes": [                   // 5 to 7 scenes; each ONE idea; a single flowing story
    {
      "title": "SHORT SCENE TITLE",   // <= 36 chars heading; evocative, not a bland label
      "intent": "one line: what the viewer must UNDERSTAND here + the clearest way to VISUALISE it
                 (a pipeline, two things compared, one source fanning out, a feedback loop, a hero object)",
      "beats": ["One spoken sentence.", "The next."]   // 2 to 5 beats, in spoken order
    }
  ]
}

WRITE A GREAT SCRIPT — a story, not a fact list:
- HOOK: open scene 1 with a question, a surprise, or a vivid everyday moment that makes the viewer NEED
  the answer. Never a dry definition ("X is a system that...").
- CURIOSITY GAPS: end most scenes by quietly raising the question the NEXT scene answers; open each
  scene paying that off. The viewer should always feel pulled forward.
- ONE GUIDING ANALOGY carried across the whole video, so abstract ideas stay concrete and the video
  feels like a single piece — but let it arise from the topic, don't force a cliché.
- COMPOUNDING UNDERSTANDING: order scenes so each builds on the last toward a satisfying "aha", then a
  resonant one-line TAKEAWAY at the end.
- VOICE: warm, clear, conversational, second person ("you"). Mix short punchy sentences with longer
  ones for rhythm. Concrete and specific over abstract. Show, don't tell. Ground any jargon immediately.
- Each beat is ONE spoken sentence that genuinely advances the story (no filler, no restating the title).
- 5-7 scenes, ONE idea each. No invented facts/numbers unless in the prompt.

VISUAL VARIETY (important — set each scene's "intent" to a DISTINCT visual treatment):
- Across the video, deliberately MIX the visual shapes. Do NOT default most scenes to a left-to-right
  sequence — at most ~2 scenes should be a step-by-step pipeline.
- Choose each scene's treatment from what its idea ACTUALLY is, e.g.: a CONTRAST of two things
  (side-by-side), one CORE IDEA with surrounding parts (hub), a SET of examples (grid), striking
  NUMBERS (big stats), a repeating LOOP (cycle), a single dramatic CONCEPT (one hero object), one
  thing becoming MANY (fan-out), many things becoming ONE (converge), a real DECISION (branch), or a
  genuine SEQUENCE (pipeline). Aim for 4+ different treatments across the video.
- Write "intent" as: what the viewer must understand + the chosen visual treatment.

User prompt:
${prompt}`;
}

// Stage 1b — the SCRIPT EDITOR: a second pass over the whole draft that only an
// editor seeing the FULL script can do — tighten the hook, smooth scene-to-scene
// transitions, keep the analogy consistent, sharpen voice and the closing line.
function scriptEditorPrompt(draft: Outline): string {
  return `You are the SCRIPT EDITOR for a premium explainer video. Below is a draft outline + script.
Rewrite it to be genuinely excellent — the kind of script that keeps someone watching to the end:
- a sharper HOOK in scene 1;
- seamless transitions: each scene should clearly answer the question the previous one raised and tee
  up the next (curiosity gaps);
- a CONSISTENT guiding analogy threaded throughout;
- vivid, concrete, conversational language with varied rhythm; cut every filler word and any sentence
  that just restates the title;
- a memorable, resonant closing TAKEAWAY.
Keep the same JSON shape and a similar scene count; update each "intent" to match the revised beats.

Return ONLY the improved JSON: { "title": string, "durationSeconds": integer, "scenes": [{ "title",
"intent", "beats": [...] }] }.

Draft:
${JSON.stringify({ title: draft.title, durationSeconds: draft.durationSeconds, scenes: draft.scenes })}`;
}

// Shared visual design language used by every per-scene designer.
const DESIGN_LANGUAGE = `You DESIGN the scene's diagram as a GRAPH of nodes + connections — you never
choose pixel coordinates; a deterministic layout engine places nodes, routes connectors, sizes icons
and prevents overlaps. Your job is to choose the RIGHT structure and the RIGHT icons.

Scene JSON shape:
{
  "title": "SHORT SCENE TITLE",            // <= 36 chars
  "beats": [ { "narration": "One spoken sentence." } ],   // keep/refine the given narration; 2-5 beats
  "nodes": [
    {
      "id": "n1",                          // short unique id within THIS scene
      "kind": "icon" | "value" | "note",   // icon=drawn symbol, value=big number, note=text callout
      "concept": "rocket",                 // assetKey-style noun (what to draw) — for icon/value
      "imagery": "concrete drawable object",// OPTIONAL: a literal object to depict an ABSTRACT idea
      "caption": "1-2 WORDS",              // the visible label
      "value": "3.1B",                     // value nodes only: the big number
      "count": 4,                          // OPTIONAL 2-9: draw the icon as a grid (quantity)
      "side": "left" | "right",            // comparison zones only
      "role": "hero" | "normal",           // hero = drawn large (the focal element)
      "beat": 0                            // which beat (0-based) reveals this node
    }
  ],
  "zones": [ { "arrange": "flow", "nodes": ["n1","n2","n3"] } ],  // 1-3 bands stacked TOP->BOTTOM
  "edges": [ { "from": "n3", "to": "n1", "kind": "loop", "label": "REPEAT" } ]  // OPTIONAL
}

DESIGN THE DIAGRAM for THIS idea — choose the ONE clean pattern that makes it INSTANTLY clear. FIRST,
REALIZE THE VISUAL TREATMENT in the scene's "intent": if it describes a contrast use "comparison"; a
core idea with parts -> "radial"; a set of examples -> "grid"; numbers -> "stat" (value nodes); a loop
-> "cycle"; a single concept -> "hero"; one-to-many -> "fanout"; many-to-one -> "convergence"; a real
decision -> "branch". Use a left-to-right "flow" ONLY for a genuine step-by-step SEQUENCE — do NOT
default to flow. A single clean named pattern (one zone) is almost always best; stack a 2nd zone only
when an idea truly has two parts, and keep it simple — a clean diagram always beats a clever-but-busy
one, and NEVER sacrifice clarity for novelty.

Your toolkit (pick the ONE that fits, occasionally combine two):
- "pipeline"/"flow": left-to-right sequence (auto-arrows). Processes, "how it works", steps.
- "comparison": two sides split by a divider. Give each node side:"left"/"right". For a genuine
  side-by-side CONTRAST only (two systems, before vs after, pros vs cons). Give the two sides a
  BALANCED, PAIRED count (2 vs 2, or 3 vs 3) so each left item lines up with a right item — never
  3 vs 1. NEVER put arrows/edges between the two sides. If one thing TURNS INTO another (a
  transformation/sequence), that's a "flow", not a comparison.
- "fanout": one SOURCE (first node) -> many targets (auto-arrows). One thing produces many; scaling.
- "convergence": many sources -> one TARGET (last node). Many inputs -> one result; aggregation.
- "loopback": a LINEAR sequence that cycles back (auto "REPEAT" arc over the top). Feedback loops, iteration.
- "cycle": nodes arranged in a RING with arrows flowing around it — a circular process (the water cycle,
  a 3-4 stage repeating loop). Prefer this over loopback when the steps form a true circle. Vary which
  loop style you use across videos.
- "branch": [action, decision, positiveOutcome, negativeOutcome] -> diamond + 2 outcomes. ONLY a real yes/no.
- "radial": hub-and-spoke; FIRST node is the centre. One core idea + drivers; an ecosystem.
- "ladder": ascending steps. Tiers, levels, growth (great with value nodes).
- "grid": tidy grid of cards. Summaries / sets of examples.
- "hero": one big focal node (role:"hero") + optional small row beneath. A single dramatic object/definition.
- "row"/"column"/"stack": plain line / vertical list (no connectors) — building blocks for composition.

LAYOUT QUALITY (reliability first — make it CLEAN and readable every time):
- 2 to 4 nodes per scene; use 5 only when the idea truly needs it. Keep it to 1 zone (2 at most). Do NOT cram many nodes, zones and edges into
  one scene — that's how layouts get messy and overlap. One clear idea, clearly shown.
- FILL THE FRAME with BIG icons, like a premium whiteboard video. If a scene only has 1-2 ideas, use
  "hero" so the single icon is drawn LARGE and centred — never a small lonely icon in empty space.
- Use "value" nodes only for a real headline number; otherwise use a plain "icon" node.
- For sequences/processes use flow/pipeline so arrows show direction (don't use a plain row).
- Keep at most ONE loop per scene; don't add a loop edge AND a loopback/cycle zone.
- Flow, ladder, fanout, convergence, branch, cycle and loopback zones draw their own connectors. Do NOT add
  duplicate explicit edges between nodes already connected by the chosen zone pattern.
- Don't add stray cross-zone "edges" unless they're essential — they're the main source of clutter.

ICONS:
- captions: a 1-2 word LABEL pulled FROM THIS BEAT'S NARRATION — the on-screen words should be words
  the viewer actually HEARS (e.g. narration "your score rises" -> caption "SCORE RISES"; "pay on time"
  -> "ON TIME"). UPPERCASE-friendly, no punctuation. NEVER the scene title or a full phrase (it
  truncates). Never reuse one concept for two nodes in a scene.
- Use SIMPLE, ICONIC, single-object concepts that read at a glance — prefer the plain noun ("database",
  "server", "key", "clock") over a busy/compound one ("redisDatabaseServer"). A clean recognisable
  symbol beats a detailed scene. Don't depict an abstract count as blank boxes — pick a real object
  (requests -> "envelope", users -> "person", tasks -> "checklist").
- ABSTRACT ideas have no literal icon, so ALSO give "imagery": a concrete object a child could draw
  (classical bit -> "light switch", superposition -> "spinning coin", parameter -> "control knob",
  bandwidth -> "water pipe", latency -> "snail", encryption -> "padlock"). Concrete nouns need no imagery.
- AMBIGUOUS words (bank, cell, mouse, virus, crane, spring, current, bug, web, cloud) mean different
  things in different contexts — set "imagery" to lock in the INTENDED sense for THIS scene:
  bank(finance) -> "piggy bank"; cell(biology) -> "microscope cell"; mouse(computer) -> "computer mouse";
  virus(software) -> "skull warning"; cloud(weather) -> "rain cloud" vs cloud(computing) -> "server cloud".
- value nodes: give "value" + a caption of what it measures. "count" (2-9) draws an icon grid for quantity.
- Do NOT invent facts/numbers not in the source.

Concept vocabulary (key: meaning) — or invent your own lowerCamelCase concept:
${assetCatalogPrompt()}`;

// Stage 2 — design ONE scene in full detail (runs in parallel per scene).
function designScenePrompt(videoTitle: string, scene: { title: string; intent: string; beats: string[] }): string {
  return `${DESIGN_LANGUAGE}

You are designing ONE scene of the video "${videoTitle}". Focus entirely on making THIS scene clear,
intuitive and visually balanced. Return ONLY the scene JSON object (no wrapper).

Scene title: ${scene.title}
Visual intent: ${scene.intent}
The narration below is FIXED (already written and timed) — design the VISUALS that bring it to life;
one node-reveal should track each beat (use the matching "beat" index on your nodes):
${scene.beats.map((b, i) => `  beat ${i}: ${b}`).join("\n")}`;
}

type OutlineScene = { title: string; intent: string; beats: string[] };
type Outline = { title: string; durationSeconds: number; scenes: OutlineScene[] };

function clampStr(v: unknown, max: number, fallback = ""): string {
  const s = typeof v === "string" ? v.trim() : "";
  return (s || fallback).slice(0, max);
}

function sanitizeOutline(raw: any): Outline | null {
  if (!raw || typeof raw !== "object") return null;
  const scenesRaw = Array.isArray(raw.scenes) ? raw.scenes : [];
  const scenes: OutlineScene[] = [];
  for (const s of scenesRaw) {
    if (!s || typeof s !== "object") continue;
    const title = clampStr(s.title, 36);
    if (!title) continue;
    const beats = (Array.isArray(s.beats) ? s.beats : [])
      .map((b: any) => clampStr(typeof b === "string" ? b : b?.narration, 240))
      .filter(Boolean)
      .slice(0, 5);
    if (!beats.length) continue;
    scenes.push({ title, intent: clampStr(s.intent, 200, "explain this clearly"), beats });
  }
  if (scenes.length < 3) return null;
  return {
    title: clampStr(raw.title, 64, "Explainer"),
    durationSeconds: Math.max(60, Math.min(180, Math.round(Number(raw.durationSeconds) || 110))),
    scenes: scenes.slice(0, 8),
  };
}

// Run async tasks with a bounded concurrency pool (so N scene designers fire in
// parallel without exceeding Vertex rate limits).
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

// Honest minimal scene if a designer fails twice: keep the AI's narration and show
// the scene's idea as a single hero icon — degraded layout, NOT canned content.
function fallbackSceneFromOutline(scene: OutlineScene): any {
  const concept = scene.title.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 40) || "idea";
  return {
    title: scene.title,
    beats: scene.beats.map((narration) => ({ narration })),
    nodes: [{ id: "n1", kind: "icon", concept, caption: scene.title.split(/\s+/).slice(0, 2).join(" "), role: "hero", beat: 0 }],
    zones: [{ arrange: "hero", nodes: ["n1"] }],
    edges: [],
  };
}

async function createOutline(prompt: string): Promise<Outline> {
  let detail = "no attempts ran";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await callGeminiJson("Outline", outlinePrompt(prompt), 0.5);
      const outline = sanitizeOutline(raw);
      if (outline) return outline;
      detail = `outline did not match schema (attempt ${attempt + 1})`;
      console.warn(`Outline ${detail}; raw head: ${JSON.stringify(raw).slice(0, 200)}`);
    } catch (error) {
      detail = `call failed (attempt ${attempt + 1}): ${String(error)}`;
      console.warn(`Outline ${detail}`);
    }
  }
  throw new Error(`Outline director could not produce a valid outline — ${detail}`);
}

// Editor pass over the whole draft script. Pure enhancement: if it fails or yields
// fewer scenes, we keep the original draft (never degrade or block the job).
async function polishScript(draft: Outline): Promise<Outline> {
  try {
    const raw = await callGeminiJson("ScriptEditor", scriptEditorPrompt(draft), 0.6);
    const polished = sanitizeOutline(raw);
    if (polished && polished.scenes.length >= Math.min(draft.scenes.length, 4)) return polished;
    console.warn("Script editor output unusable; keeping the draft script.");
  } catch (error) {
    console.warn(`Script editor failed; keeping the draft script. ${String(error)}`);
  }
  return draft;
}

async function designScene(videoTitle: string, scene: OutlineScene): Promise<any> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await callGeminiJson(`Scene:${scene.title}`, designScenePrompt(videoTitle, scene), 0.55);
      const merged = {
        title: scene.title,
        // The (polished) script is authoritative — the designer only chooses VISUALS,
        // so keep the narration verbatim and don't let it be rewritten.
        beats: scene.beats.map((n) => ({ narration: n })),
        nodes: (raw as any)?.nodes,
        zones: (raw as any)?.zones,
        edges: (raw as any)?.edges,
      };
      const sane = sanitizeGraphScene(merged);
      if (sane) return sane;
      console.warn(`Scene designer "${scene.title}" output unusable (attempt ${attempt + 1}).`);
    } catch (error) {
      console.warn(`Scene designer "${scene.title}" failed (attempt ${attempt + 1}): ${String(error)}`);
    }
  }
  console.warn(`Scene designer "${scene.title}" fell back to a minimal hero scene.`);
  return fallbackSceneFromOutline(scene);
}

export async function createAgenticStoryboard(prompt: string): Promise<{
  storyboard: Storyboard;
  source: AgentPlannerSource;
}> {
  if (!hasGoogleCredentials()) {
    throw new Error(
      "Director unavailable: Google Cloud credentials are not configured " +
        "(set GOOGLE_CLOUD_PROJECT and GOOGLE_APPLICATION_CREDENTIALS).",
    );
  }

  // Stage 1: draft the script (fast, reliable). Throws if it can't — no canned
  // fallback, so the job fails cleanly and the user can Resume/Regenerate.
  const draft = await createOutline(prompt);
  // Stage 1b: an editor pass that sees the WHOLE script and polishes flow/voice.
  const outline = await polishScript(draft);

  // Stage 2: design every scene IN PARALLEL — each agent focuses on ONE scene.
  const concurrency = Number(process.env.SCENE_DESIGN_CONCURRENCY ?? 5);
  const designed = await mapWithConcurrency(outline.scenes, concurrency, (scene) => designScene(outline.title, scene));

  const plan = sanitizeSceneGraphPlan({
    title: outline.title,
    durationSeconds: outline.durationSeconds,
    scenes: designed,
  });
  if (!plan) {
    throw new Error("Assembled scene-graph plan was unusable after designing all scenes.");
  }
  return { storyboard: composeSceneGraphPlan(plan), source: "agents" };
}
