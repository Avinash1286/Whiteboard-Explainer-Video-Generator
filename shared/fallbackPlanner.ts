import { composeSceneGraphPlan, type SceneGraphPlan } from "./sceneGraph";
import type { Storyboard } from "./storyboard";

function cleanTopic(prompt: string): string {
  const text = prompt.replace(/\s+/g, " ").trim();
  if (!text) return "A Simple System";
  return text
    .replace(/^explain\s+/i, "")
    .replace(/[?.!]+$/g, "")
    .slice(0, 54);
}

function titleCase(input: string): string {
  return input
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Deterministic, offline scene-graph plan used by dev tooling (e.g. the frame
 * preview script) to exercise the full layout + render path WITHOUT calling the
 * LLM director. It is NOT used by the production pipeline — that throws if the
 * director fails so the user gets a Resume/Regenerate, rather than canned content.
 * It deliberately uses every arrangement primitive so layout regressions surface.
 */
export function createFallbackStoryboard(prompt: string): Storyboard {
  const topic = titleCase(cleanTopic(prompt));
  const shortTopic = topic.length > 30 ? `${topic.slice(0, 27)}...` : topic;

  const plan: SceneGraphPlan = {
    title: shortTopic,
    durationSeconds: 96,
    scenes: [
      {
        title: "THE BIG PICTURE",
        beats: [
          { narration: `${topic} turns a raw input into a useful result.` },
          { narration: "First the raw signal is gathered and prepared." },
          { narration: "Then a core process transforms it step by step." },
          { narration: "Finally it produces a clear, usable outcome." },
        ],
        nodes: [
          { id: "in", kind: "icon", concept: "input", caption: "INPUT", role: "normal", beat: 0 },
          { id: "gather", kind: "icon", concept: "data", caption: "GATHER", role: "normal", beat: 1 },
          { id: "proc", kind: "icon", concept: "gear", caption: "PROCESS", role: "normal", beat: 2 },
          { id: "out", kind: "icon", concept: "output", caption: "RESULT", role: "normal", beat: 3 },
        ],
        zones: [{ arrange: "flow", nodes: ["in", "gather", "proc", "out"] }],
        edges: [],
      },
      {
        title: "TWO FORCES",
        beats: [
          { narration: "Every system like this balances two competing forces." },
          { narration: "One side wants to move fast and reach a result quickly." },
          { narration: "The other wants it to stay safe, stable, and correct." },
        ],
        nodes: [
          { id: "l1", kind: "icon", concept: "rocket", caption: "SPEED", role: "normal", beat: 0 },
          { id: "r1", kind: "icon", concept: "shield", caption: "SAFETY", role: "normal", beat: 0 },
          { id: "l2", kind: "icon", concept: "lightbulb", caption: "BOLD", role: "normal", beat: 1 },
          { id: "r2", kind: "icon", concept: "lock", caption: "CAREFUL", role: "normal", beat: 2 },
        ],
        zones: [
          { arrange: "column", nodes: ["l1", "l2"] },
          { arrange: "column", nodes: ["r1", "r2"] },
        ],
        edges: [],
      },
      {
        title: "THE CORE IDEA",
        beats: [
          { narration: "At the center sits one core idea everything connects to." },
          { narration: "It draws on data and a set of rules." },
          { narration: "And it learns from feedback to keep improving." },
        ],
        nodes: [
          { id: "core", kind: "icon", concept: "brain", caption: "CORE IDEA", role: "hero", beat: 0 },
          { id: "data", kind: "icon", concept: "database", caption: "DATA", role: "normal", beat: 1 },
          { id: "rules", kind: "icon", concept: "gear", caption: "RULES", role: "normal", beat: 1 },
          { id: "fb", kind: "icon", concept: "feedback", caption: "FEEDBACK", role: "normal", beat: 2 },
        ],
        zones: [{ arrange: "radial", nodes: ["core", "data", "rules", "fb"] }],
        edges: [],
      },
      {
        title: "THE KEY DECISION",
        beats: [
          { narration: "At each step the system reaches a decision point." },
          { narration: "It weighs the evidence and chooses a path." },
          { narration: "If confident it acts; if not, it waits for more." },
        ],
        nodes: [
          { id: "sig", kind: "icon", concept: "input", caption: "SIGNAL", role: "normal", beat: 0 },
          { id: "dec", kind: "icon", concept: "gear", caption: "CONFIDENT", role: "normal", beat: 1 },
          { id: "act", kind: "icon", concept: "check", caption: "ACT", role: "normal", beat: 2 },
          { id: "wait", kind: "icon", concept: "warning", caption: "WAIT", role: "normal", beat: 2 },
        ],
        zones: [{ arrange: "branch", nodes: ["sig", "dec", "act", "wait"] }],
        edges: [],
      },
      {
        title: "BY THE NUMBERS",
        beats: [
          { narration: "The impact of getting this right is striking." },
          { narration: "It already reaches a huge and growing audience." },
          { narration: "And the trend keeps climbing every quarter." },
        ],
        nodes: [
          { id: "n1", kind: "value", concept: "rocket", caption: "FASTER", value: "10X", role: "normal", beat: 0 },
          { id: "n2", kind: "value", concept: "person", caption: "REACHED", value: "2M", count: 6, role: "normal", beat: 1 },
          { id: "n3", kind: "value", concept: "chart", caption: "GROWTH", value: "+40%", role: "normal", beat: 2 },
        ],
        zones: [{ arrange: "row", nodes: ["n1", "n2", "n3"] }],
        edges: [],
      },
      {
        title: "WHAT TO REMEMBER",
        beats: [
          { narration: "A few simple takeaways remain." },
          { narration: "It is a structured flow, not a single magic step." },
          { narration: "It balances opposing forces and keeps improving." },
        ],
        nodes: [
          { id: "c1", kind: "icon", concept: "lightbulb", caption: "CLEAR IDEA", role: "normal", beat: 0 },
          { id: "c2", kind: "icon", concept: "pipeline", caption: "STRUCTURED", role: "normal", beat: 1 },
          { id: "c3", kind: "icon", concept: "shield", caption: "BALANCED", role: "normal", beat: 2 },
          { id: "c4", kind: "icon", concept: "rocket", caption: "IMPROVING", role: "normal", beat: 2 },
        ],
        zones: [{ arrange: "grid", nodes: ["c1", "c2", "c3", "c4"] }],
        edges: [],
      },
    ],
  };

  return composeSceneGraphPlan(plan);
}
