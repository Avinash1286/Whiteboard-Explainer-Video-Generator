import { test } from "node:test";
import assert from "node:assert/strict";
import {
  composeSceneGraphPlan,
  sanitizeSceneGraphPlan,
  type SceneGraphPlan,
} from "./sceneGraph";
import { flattenBeats, type VisualElement } from "./storyboard";
import { compileVideo } from "./layout";
import { estimateTimepoints } from "./ssml";
import { renderFrameSvg } from "./svgFrame";

// A rich, multi-zone, multi-pattern plan exercising every arrangement + edges.
const PLAN: SceneGraphPlan = {
  title: "How It Works",
  durationSeconds: 110,
  scenes: [
    {
      title: "TWO APPROACHES",
      beats: [{ narration: "Old systems are slow." }, { narration: "New systems are fast." }],
      nodes: [
        { id: "a", kind: "icon", concept: "snail", caption: "OLD", role: "normal", beat: 0 },
        { id: "b", kind: "icon", concept: "rocket", caption: "NEW", role: "normal", beat: 1 },
      ],
      zones: [{ arrange: "row", nodes: ["a", "b"] }],
      edges: [],
    },
    {
      title: "THE PIPELINE",
      beats: [
        { narration: "Data comes in." },
        { narration: "It gets processed." },
        { narration: "Results come out, then repeat." },
      ],
      nodes: [
        { id: "in", kind: "icon", concept: "inbox", caption: "INPUT", role: "normal", beat: 0 },
        { id: "proc", kind: "icon", concept: "gear", caption: "PROCESS", role: "normal", beat: 1 },
        { id: "out", kind: "icon", concept: "outbox", caption: "OUTPUT", role: "normal", beat: 2 },
      ],
      zones: [{ arrange: "flow", nodes: ["in", "proc", "out"] }],
      edges: [{ from: "out", to: "in", kind: "loop", label: "REPEAT" }],
    },
    {
      title: "THE DECISION",
      beats: [
        { narration: "An action happens." },
        { narration: "It hits a check." },
        { narration: "Pass or fail." },
      ],
      nodes: [
        { id: "act", kind: "icon", concept: "play", caption: "ACT", role: "normal", beat: 0 },
        { id: "chk", kind: "icon", concept: "question", caption: "VALID", role: "normal", beat: 1 },
        { id: "yes", kind: "icon", concept: "check", caption: "PASS", role: "normal", beat: 2 },
        { id: "no", kind: "icon", concept: "cross", caption: "FAIL", role: "normal", beat: 2 },
      ],
      zones: [{ arrange: "branch", nodes: ["act", "chk", "yes", "no"] }],
      edges: [],
    },
    {
      title: "BY THE NUMBERS",
      beats: [{ narration: "The scale is huge." }, { narration: "Adoption is growing." }],
      nodes: [
        { id: "s1", kind: "value", concept: "chart", caption: "USERS", value: "3.1B", role: "normal", beat: 0 },
        { id: "s2", kind: "value", concept: "money", caption: "FUNDING", value: "$40B", role: "normal", beat: 1 },
      ],
      zones: [{ arrange: "row", nodes: ["s1", "s2"] }],
      edges: [],
    },
    {
      title: "THE ECOSYSTEM",
      beats: [
        { narration: "A core idea." },
        { narration: "Feeds many things." },
        { narration: "Across the board." },
      ],
      nodes: [
        { id: "core", kind: "icon", concept: "brain", caption: "CORE", role: "hero", beat: 0 },
        { id: "x1", kind: "icon", concept: "globe", caption: "GLOBAL", role: "normal", beat: 1 },
        { id: "x2", kind: "icon", concept: "lock", caption: "SECURE", role: "normal", beat: 1 },
        { id: "x3", kind: "icon", concept: "bolt", caption: "FAST", role: "normal", beat: 2 },
        { id: "note", kind: "note", caption: "ALL CONNECTED", role: "normal", beat: 2 },
      ],
      zones: [
        { arrange: "radial", nodes: ["core", "x1", "x2", "x3"] },
        { arrange: "row", nodes: ["note"] },
      ],
      edges: [],
    },
  ],
};

const RENDER_OPTS = { width: 1920, height: 1080, fps: 12 };

function allElements(storyboard: ReturnType<typeof composeSceneGraphPlan>): VisualElement[] {
  return flattenBeats(storyboard).flatMap((b) => b.elements ?? []);
}

test("composeSceneGraphPlan produces a schema-valid storyboard", () => {
  const sb = composeSceneGraphPlan(PLAN); // validateStoryboard throws on any violation
  assert.equal(sb.scenes.length, 5);
  assert.ok(sb.scenes.every((s) => s.beats.length >= 1));
});

test("every element id is globally unique", () => {
  const sb = composeSceneGraphPlan(PLAN);
  const ids = allElements(sb).map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate element id found");
});

test("every icon node yields an asset element resolvable to its concept", () => {
  const sb = composeSceneGraphPlan(PLAN);
  const assets = allElements(sb).filter((e) => e.type === "asset");
  for (const concept of ["snail", "rocket", "gear", "globe", "brain"]) {
    assert.ok(
      assets.some((e) => e.assetKey === concept),
      `expected an asset element for "${concept}"`,
    );
  }
});

test("imagery becomes a searchHint, captions are drawn", () => {
  const plan: SceneGraphPlan = {
    ...PLAN,
    scenes: [
      {
        title: "ABSTRACT",
        beats: [{ narration: "A qubit is like a spinning coin." }],
        nodes: [{ id: "q", kind: "icon", concept: "qubit", imagery: "spinning coin", caption: "QUBIT", role: "normal", beat: 0 }],
        zones: [{ arrange: "row", nodes: ["q"] }],
        edges: [],
      },
      ...PLAN.scenes.slice(1),
    ],
  };
  const sb = composeSceneGraphPlan(plan);
  const q = allElements(sb).find((e) => e.assetKey === "qubit");
  assert.ok(q, "qubit element missing");
  assert.equal(q?.searchHint, "spinning coin");
  assert.equal(q?.label, "QUBIT");
});

test("all reveal steps are within [0,7]", () => {
  const sb = composeSceneGraphPlan(PLAN);
  for (const e of allElements(sb)) {
    if (typeof e.revealStep === "number") {
      assert.ok(e.revealStep >= 0 && e.revealStep <= 7, `revealStep ${e.revealStep} out of range`);
    }
  }
});

test("branch zone draws a diamond (4 lines) plus connectors", () => {
  const sb = composeSceneGraphPlan(PLAN);
  const scene = sb.scenes.find((s) => s.title.includes("DECISION"))!;
  const els = scene.beats.flatMap((b) => b.elements ?? []);
  const diamondLines = els.filter((e) => e.type === "line" && e.id.includes("_chk_"));
  assert.equal(diamondLines.length, 4, "decision diamond should be 4 line segments");
  const arrows = els.filter((e) => e.type === "arrow");
  assert.ok(arrows.length >= 3, "branch should have action->decision and two outcome arrows");
});

test("loop edge produces connector segments ending in an arrow", () => {
  const sb = composeSceneGraphPlan(PLAN);
  const scene = sb.scenes.find((s) => s.title.includes("PIPELINE"))!;
  const els = scene.beats.flatMap((b) => b.elements ?? []);
  const loopArrow = els.find((e) => e.type === "arrow" && e.id.includes("_c"));
  assert.ok(loopArrow, "loop connector should end in an arrow segment");
});

test("zones stack vertically (zone 2 sits below zone 1)", () => {
  const sb = composeSceneGraphPlan(PLAN);
  const scene = sb.scenes.find((s) => s.title.includes("ECOSYSTEM"))!;
  const els = scene.beats.flatMap((b) => b.elements ?? []);
  const radialYs = els.filter((e) => e.type === "asset").map((e) => e.y);
  const note = els.find((e) => e.type === "text" && (e.text ?? "").includes("CONNECTED"))!;
  const avgRadial = radialYs.reduce((s, y) => s + y, 0) / radialYs.length;
  assert.ok(note.y > avgRadial, "note zone should be below the radial zone");
});

test("composition is deterministic", () => {
  const a = JSON.stringify(composeSceneGraphPlan(PLAN));
  const b = JSON.stringify(composeSceneGraphPlan(PLAN));
  assert.equal(a, b);
});

test("compiles + renders a frame without throwing (no TTS)", () => {
  const sb = composeSceneGraphPlan(PLAN);
  const est = estimateTimepoints(sb);
  const compiled = compileVideo(sb, est.timepoints, est.durationSeconds, RENDER_OPTS);
  // No "error" severity diagnostics => everything fits the safe area.
  const errors = compiled.layoutDiagnostics.filter((d) => d.severity === "error");
  assert.equal(errors.length, 0, `layout errors: ${JSON.stringify(errors.slice(0, 2))}`);
  // Render a frame mid-way through the second scene.
  const t = compiled.scenes[1].start + 1.5;
  const svg = renderFrameSvg(compiled, t);
  assert.ok(svg.includes("<svg"), "frame should be an SVG");
  assert.ok(svg.includes("THE PIPELINE"), "frame should show the scene title");
});

// ----- sanitizer -----

test("sanitizer coerces partial/garbage director JSON", () => {
  const raw = {
    title: "x".repeat(200),
    durationSeconds: 9999,
    scenes: [
      {
        title: "  Messy Scene  ",
        beats: [{ narration: "One." }, "Two as a bare string."],
        nodes: [
          { id: "n 1!", kind: "icon", concept: "Rocket!!", caption: "GO", beat: 99 },
          { id: "n2", kind: "note", caption: "just text" },
          { id: "n3", kind: "icon" }, // no concept/caption -> dropped
        ],
        zones: [{ arrange: "nonsense", nodes: ["n1", "n2", "missing"] }],
        edges: [{ from: "n1", to: "n2", kind: "weird" }, { from: "n1", to: "n1" }],
      },
      { title: "S2", beats: [{ narration: "Hi" }], nodes: [{ id: "a", concept: "brain", caption: "A" }], zones: [{ arrange: "row", nodes: ["a"] }] },
      { title: "S3", beats: [{ narration: "Hi" }], nodes: [{ id: "a", concept: "globe", caption: "B" }], zones: [{ arrange: "row", nodes: ["a"] }] },
    ],
  };
  const plan = sanitizeSceneGraphPlan(raw);
  assert.ok(plan, "should sanitize to a usable plan");
  assert.ok(plan!.title.length <= 64);
  assert.ok(plan!.durationSeconds <= 180);
  const s0 = plan!.scenes[0];
  assert.equal(s0.title, "Messy Scene");
  // bare-string beat coerced; node id cleaned ("n 1!" -> "n1"); bad beat clamped.
  const n1 = s0.nodes.find((n) => n.id === "n1");
  assert.ok(n1, "node id should be cleaned to n1");
  assert.ok(n1!.beat <= s0.beats.length - 1, "beat clamped into range");
  assert.equal(n1!.concept, "Rocket"); // punctuation stripped
  // arrange "nonsense" -> "row"; missing/dropped node ids excluded.
  assert.equal(s0.zones[0].arrange, "row");
  assert.ok(s0.zones[0].nodes.every((id) => id === "n1" || id === "n2"));
  // self-edge and unknown ids dropped; weird kind -> arrow.
  assert.ok(s0.edges.every((e) => e.from !== e.to));
  // composes cleanly end to end.
  composeSceneGraphPlan(plan!);
});

test("named patterns: comparison/fanout/convergence/loopback render correctly", () => {
  const plan: SceneGraphPlan = {
    title: "Patterns",
    durationSeconds: 90,
    scenes: [
      {
        title: "COMPARISON",
        beats: [{ narration: "Old vs new." }],
        nodes: [
          { id: "l1", kind: "icon", concept: "snail", caption: "OLD", side: "left", role: "normal", beat: 0 },
          { id: "r1", kind: "icon", concept: "rocket", caption: "NEW", side: "right", role: "normal", beat: 0 },
        ],
        zones: [{ arrange: "comparison", nodes: ["l1", "r1"] }],
        edges: [],
      },
      {
        title: "FAN OUT",
        beats: [{ narration: "One source, many outputs." }],
        nodes: [
          { id: "s", kind: "icon", concept: "server", caption: "SOURCE", role: "normal", beat: 0 },
          { id: "a", kind: "icon", concept: "phone", caption: "A", role: "normal", beat: 0 },
          { id: "b", kind: "icon", concept: "laptop", caption: "B", role: "normal", beat: 0 },
          { id: "c", kind: "icon", concept: "tablet", caption: "C", role: "normal", beat: 0 },
        ],
        zones: [{ arrange: "fanout", nodes: ["s", "a", "b", "c"] }],
        edges: [],
      },
      {
        title: "CONVERGENCE",
        beats: [{ narration: "Many inputs, one result." }],
        nodes: [
          { id: "i1", kind: "icon", concept: "house", caption: "FAMILY", role: "normal", beat: 0 },
          { id: "i2", kind: "icon", concept: "people", caption: "FRIENDS", role: "normal", beat: 0 },
          { id: "i3", kind: "icon", concept: "globe", caption: "WORLD", role: "normal", beat: 0 },
          { id: "out", kind: "icon", concept: "person", caption: "YOU", role: "normal", beat: 0 },
        ],
        zones: [{ arrange: "convergence", nodes: ["i1", "i2", "i3", "out"] }],
        edges: [],
      },
      {
        title: "LOOPBACK",
        beats: [{ narration: "It cycles." }],
        nodes: [
          { id: "g", kind: "icon", concept: "warning", caption: "GUESS", role: "normal", beat: 0 },
          { id: "m", kind: "icon", concept: "ruler", caption: "MEASURE", role: "normal", beat: 0 },
          { id: "u", kind: "icon", concept: "gear", caption: "UPDATE", role: "normal", beat: 0 },
        ],
        zones: [{ arrange: "loopback", nodes: ["g", "m", "u"] }],
        edges: [],
      },
    ],
  };
  const sb = composeSceneGraphPlan(plan); // validateStoryboard throws on any error

  const els = (title: string) => sb.scenes.find((s) => s.title === title)!.beats.flatMap((b) => b.elements ?? []);

  // comparison: a divider line + left icon x < right icon x.
  const cmp = els("COMPARISON");
  assert.ok(cmp.some((e) => e.type === "line" && e.id.includes("_div")), "comparison needs a divider");
  const leftX = cmp.find((e) => e.type === "asset" && e.assetKey === "snail")!.x;
  const rightX = cmp.find((e) => e.type === "asset" && e.assetKey === "rocket")!.x;
  assert.ok(leftX < rightX, "left-side node should sit left of right-side node");

  // fanout: 3 arrows out of the single source.
  const fan = els("FAN OUT");
  assert.equal(fan.filter((e) => e.type === "arrow").length, 3, "fanout: source -> 3 targets");

  // convergence: 3 arrows into the target.
  const conv = els("CONVERGENCE");
  assert.equal(conv.filter((e) => e.type === "arrow").length, 3, "convergence: 3 sources -> target");

  // loopback: 2 sequence arrows + a loop-back (which ends in an arrow segment).
  const loop = els("LOOPBACK");
  assert.ok(loop.filter((e) => e.type === "arrow").length >= 3, "loopback: sequence arrows + loop arrow");
  assert.ok(loop.some((e) => e.type === "text" && (e.text ?? "").includes("REPEAT")), "loopback shows REPEAT");
});

test("text de-overlap separates colliding connector labels", () => {
  const plan: SceneGraphPlan = {
    title: "T",
    durationSeconds: 90,
    scenes: [
      {
        title: "COLLIDE",
        beats: [{ narration: "a to b twice." }],
        nodes: [
          { id: "a", kind: "icon", concept: "rocket", caption: "A", role: "normal", beat: 0 },
          { id: "b", kind: "icon", concept: "brain", caption: "B", role: "normal", beat: 0 },
        ],
        zones: [{ arrange: "row", nodes: ["a", "b"] }],
        // two edges between the same pair -> both labels want the same midpoint.
        edges: [
          { from: "a", to: "b", kind: "arrow", label: "ALPHA" },
          { from: "a", to: "b", kind: "arrow", label: "BETA" },
        ],
      },
    ],
  };
  const sb = composeSceneGraphPlan(plan);
  const els = sb.scenes[0].beats.flatMap((b) => b.elements ?? []);
  const alpha = els.find((e) => e.type === "text" && e.text === "ALPHA")!;
  const beta = els.find((e) => e.type === "text" && e.text === "BETA")!;
  assert.ok(alpha && beta, "both labels present");
  assert.ok(Math.abs(alpha.y - beta.y) >= 22, `labels must be separated vertically, got dy=${Math.abs(alpha.y - beta.y)}`);
});

test("connector labels never overlap icon captions", () => {
  // Reproduces "THE MIDNIGHT PANIC": a top flow + a node below with a labelled
  // edge whose label could land on a flow caption.
  const plan: SceneGraphPlan = {
    title: "T",
    durationSeconds: 90,
    scenes: [
      {
        title: "PANIC",
        beats: [{ narration: "a." }, { narration: "b." }],
        nodes: [
          { id: "t", kind: "icon", concept: "clock", caption: "2 AM", role: "normal", beat: 0 },
          { id: "h", kind: "icon", concept: "warning", caption: "HIJACKED", role: "normal", beat: 0 },
          { id: "c", kind: "icon", concept: "wheel", caption: "THE CONTROL", role: "normal", beat: 0 },
          { id: "a", kind: "icon", concept: "astronaut", caption: "ASTRONAUT", role: "normal", beat: 1 },
        ],
        zones: [
          { arrange: "flow", nodes: ["t", "h", "c"] },
          { arrange: "row", nodes: ["a"] },
        ],
        edges: [{ from: "a", to: "c", kind: "arrow", label: "STEER" }],
      },
    ],
  };
  const els = composeSceneGraphPlan(plan).scenes[0].beats.flatMap((b) => b.elements ?? []);
  const capBoxes = els
    .filter((e) => (e.type === "asset" || e.type === "logo") && e.label && e.width && e.height)
    .map((e) => {
      const w = (e.label as string).length * 26 * 0.6 + 10;
      return { x: e.x + (e.width ?? 0) / 2 - w / 2, y: e.y + (e.height ?? 0) + 4, w, h: 32 };
    });
  const overlap = (a: any, b: any) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
  for (const t of els.filter((e) => e.type === "text")) {
    const tw = (t.text ?? "").length * 24 * 0.6 + 10;
    const tb = { x: t.x - tw / 2, y: t.y - 24, w: tw, h: 30 };
    for (const cb of capBoxes) {
      assert.ok(!overlap(tb, cb), `text "${t.text}" overlaps an icon caption`);
    }
  }
});

test("comparison drops arrows that cross the divider", () => {
  const plan: SceneGraphPlan = {
    title: "T",
    durationSeconds: 90,
    scenes: [
      {
        title: "CONTRAST",
        beats: [{ narration: "left vs right." }],
        nodes: [
          { id: "l", kind: "icon", concept: "snail", caption: "OLD", side: "left", role: "normal", beat: 0 },
          { id: "r", kind: "icon", concept: "rocket", caption: "NEW", side: "right", role: "normal", beat: 0 },
        ],
        zones: [{ arrange: "comparison", nodes: ["l", "r"] }],
        edges: [{ from: "l", to: "r", kind: "arrow", label: "BECOMES" }],
      },
    ],
  };
  const sb = composeSceneGraphPlan(plan);
  const els = sb.scenes[0].beats.flatMap((b) => b.elements ?? []);
  // The cross-divider edge (el_s1_e0...) must be dropped; only the divider line remains.
  assert.ok(!els.some((e) => e.id.startsWith("el_s1_e0")), "cross-divider edge should be dropped");
  assert.ok(!els.some((e) => e.type === "text" && e.text === "BECOMES"), "its label should be gone too");
  assert.ok(els.some((e) => e.type === "line" && e.id.includes("_div")), "divider still present");
});

test("explicit edges that duplicate automatic pattern connectors are dropped", () => {
  const plan: SceneGraphPlan = {
    title: "T",
    durationSeconds: 90,
    scenes: [
      {
        title: "FLOW",
        beats: [{ narration: "a." }, { narration: "b." }, { narration: "c." }],
        nodes: [
          { id: "a", kind: "icon", concept: "wallet", caption: "A", role: "normal", beat: 0 },
          { id: "b", kind: "icon", concept: "database", caption: "B", role: "normal", beat: 1 },
          { id: "c", kind: "icon", concept: "lock", caption: "C", role: "normal", beat: 2 },
        ],
        zones: [{ arrange: "flow", nodes: ["a", "b", "c"] }],
        edges: [
          { from: "a", to: "b", kind: "arrow" },
          { from: "b", to: "c", kind: "arrow" },
        ],
      },
    ],
  };
  const els = composeSceneGraphPlan(plan).scenes[0].beats.flatMap((b) => b.elements ?? []);
  assert.equal(els.filter((e) => e.type === "arrow").length, 2, "flow should draw each connector once");
  assert.ok(!els.some((e) => e.id.startsWith("el_s1_e")), "duplicate explicit edges should be omitted");
});

test("convergence side labels keep arrows clear of vertical source assets", () => {
  const plan: SceneGraphPlan = {
    title: "T",
    durationSeconds: 90,
    scenes: [
      {
        title: "CROWD",
        beats: [{ narration: "many inputs become one result." }],
        nodes: [
          { id: "earth", kind: "icon", concept: "network", caption: "EARTH COMPUTERS", role: "normal", beat: 0 },
          { id: "light", kind: "icon", concept: "lightbulb", caption: "TOTAL EXPOSURE", role: "normal", beat: 0 },
          { id: "math", kind: "icon", concept: "shield", caption: "MATHEMATICS", role: "normal", beat: 0 },
          { id: "trust", kind: "icon", concept: "gear", caption: "TRUST ENGINE", role: "normal", beat: 0 },
        ],
        zones: [{ arrange: "convergence", nodes: ["earth", "light", "math", "trust"] }],
        edges: [],
      },
    ],
  };
  const els = composeSceneGraphPlan(plan).scenes[0].beats.flatMap((b) => b.elements ?? []);
  const sourceAssets = ["earth", "light", "math"].map((id) => els.find((e) => e.id === `el_s1_${id}`)!);
  const target = els.find((e) => e.id === "el_s1_trust")!;
  const sourceLabels = ["earth", "light", "math"].map((id) => els.find((e) => e.id === `el_s1_${id}_c`)!);
  assert.ok(sourceAssets.every((e) => e.type === "asset" && !e.label), "vertical source labels should be separate side text");
  sourceLabels.forEach((label, i) => {
    assert.ok(label.type === "text" && label.x < sourceAssets[i].x, "source caption should sit left of its icon");
  });
  const arrows = els.filter((e) => e.type === "arrow");
  assert.equal(arrows.length, 3, "convergence should still draw three arrows");
  arrows.forEach((arrow, i) => {
    const source = sourceAssets[i];
    // Horizontal projection of a DIAGONAL arrow (it's >= CONNECTOR_CLEARANCE clear
    // along its own direction, which is what actually prevents overlap).
    assert.ok(arrow.x - (source.x + (source.width ?? 0)) >= 12, "arrow should leave a clear gap after the source asset");
    assert.ok(target.x - (arrow.x2 ?? 0) >= 12, "arrow should stop before the target asset");
  });
});

test("a lone node is centred (never stranded)", () => {
  const plan: SceneGraphPlan = {
    title: "T",
    durationSeconds: 90,
    scenes: [
      {
        title: "SOLO",
        beats: [{ narration: "one thing." }],
        nodes: [{ id: "n", kind: "icon", concept: "brain", caption: "IDEA", role: "hero", beat: 0 }],
        zones: [{ arrange: "row", nodes: ["n"] }],
        edges: [],
      },
    ],
  };
  const sb = composeSceneGraphPlan(plan);
  const icon = sb.scenes[0].beats.flatMap((b) => b.elements ?? []).find((e) => e.type === "asset")!;
  const cx = icon.x + (icon.width ?? 0) / 2;
  assert.ok(Math.abs(cx - 600) < 2, `lone node should be horizontally centred, got cx=${cx}`);
});

test("sanitizer keeps named patterns + node.side", () => {
  const plan = sanitizeSceneGraphPlan({
    title: "T",
    durationSeconds: 90,
    scenes: Array.from({ length: 3 }, (_, i) => ({
      title: `S${i}`,
      beats: [{ narration: "hi" }],
      nodes: [
        { id: "a", concept: "snail", caption: "A", side: "left" },
        { id: "b", concept: "rocket", caption: "B", side: "right" },
      ],
      zones: [{ arrange: "comparison", nodes: ["a", "b"] }],
    })),
  })!;
  assert.equal(plan.scenes[0].zones[0].arrange, "comparison");
  assert.equal(plan.scenes[0].nodes[0].side, "left");
});

test("sanitizer rejects fewer than 3 scenes", () => {
  assert.equal(sanitizeSceneGraphPlan({ scenes: [] }), null);
  assert.equal(sanitizeSceneGraphPlan("nope"), null);
});

test("orphan nodes (not in any zone) are placed, not dropped", () => {
  const raw = {
    title: "T",
    durationSeconds: 90,
    scenes: Array.from({ length: 3 }, (_, i) => ({
      title: `S${i}`,
      beats: [{ narration: "hi" }],
      nodes: [
        { id: "a", concept: "brain", caption: "A" },
        { id: "b", concept: "globe", caption: "B" },
      ],
      zones: [{ arrange: "row", nodes: ["a"] }], // b is orphaned
    })),
  };
  const plan = sanitizeSceneGraphPlan(raw)!;
  const referenced = new Set(plan.scenes[0].zones.flatMap((z) => z.nodes));
  assert.ok(referenced.has("b"), "orphan node b should be added to a fallback zone");
});
