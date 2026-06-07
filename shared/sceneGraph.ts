import { z } from "zod";
import { assetKeySchema } from "./assetCatalog";
import { validateStoryboard, type Beat, type Scene, type Storyboard, type VisualElement } from "./storyboard";

/**
 * Free-form scene-graph layout system (the Lamina-style alternative to fixed
 * templates).
 *
 * The director emits a GRAPH per scene: nodes (icons / big numbers / notes) with
 * a role, grouped into vertically-stacked ZONES that each pick an arrangement
 * primitive (row, flow, column, grid, radial, branch, ladder, hero), plus EDGES
 * (content-aware connectors) between any two nodes. A deterministic solver places
 * every node from the graph — not from fixed pixel slots — and routes connectors
 * from the nodes' actual positions. The output is a normal `Storyboard` whose
 * beats carry positioned `elements[]`, so the existing compile + render path
 * (scene-wide collision repair + fit-to-frame scaling) is reused unchanged.
 */

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const nodeKindSchema = z.enum(["icon", "value", "note"]);
export const nodeRoleSchema = z.enum(["hero", "normal"]);
export const zoneArrangeSchema = z.enum([
  "row",
  "flow",
  "column",
  "stack",
  "grid",
  "radial",
  "branch",
  "ladder",
  "hero",
  // Named canonical patterns (clean, polished presets the director can pick when a
  // scene maps to one of them; otherwise it composes freely with multiple zones).
  "comparison", // two sides split by a divider (use node.side)
  "fanout", // one source -> many targets
  "convergence", // many sources -> one target
  "loopback", // a linear sequence that cycles back to the start (arc over the top)
  "cycle", // nodes arranged in a RING with arrows flowing around it
]);
export const edgeKindSchema = z.enum(["arrow", "line", "loop"]);

export const graphNodeSchema = z.object({
  id: z.string().min(1).max(24),
  kind: nodeKindSchema.default("icon"),
  // assetKey-style concept (what to draw). Optional for note/value-only nodes.
  concept: assetKeySchema.optional(),
  // Concrete imagery metaphor used purely to FIND the icon (never shown).
  imagery: z.string().max(40).optional(),
  // The visible caption under/next to the node.
  caption: z.string().max(28).optional(),
  // Big headline number for `value` nodes (e.g. "10X", "3.1B").
  value: z.string().max(24).optional(),
  // Render the icon as a grid of N copies to convey quantity.
  count: z.number().int().min(1).max(9).optional(),
  // Which side of a `comparison` zone this node belongs to.
  side: z.enum(["left", "right"]).optional(),
  role: nodeRoleSchema.default("normal"),
  // Which beat (narration sentence index) reveals this node.
  beat: z.number().int().min(0).max(7).default(0),
});

export const graphZoneSchema = z.object({
  arrange: zoneArrangeSchema,
  // Node ids placed in this zone, in reveal/reading order. For `radial` the first
  // node is the centre; for `branch` the order is [action, decision, ...outcomes].
  nodes: z.array(z.string().min(1)).min(1).max(8),
});

export const graphEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  kind: edgeKindSchema.default("arrow"),
  label: z.string().max(16).optional(),
});

export const graphBeatSchema = z.object({
  narration: z.string().min(1).max(240),
});

export const graphSceneSchema = z.object({
  title: z.string().min(1).max(40),
  beats: z.array(graphBeatSchema).min(1).max(8),
  nodes: z.array(graphNodeSchema).min(1).max(14),
  zones: z.array(graphZoneSchema).min(1).max(4),
  edges: z.array(graphEdgeSchema).max(20).default([]),
});

export const sceneGraphPlanSchema = z.object({
  title: z.string().min(1).max(64),
  durationSeconds: z.number().int().min(40).max(180),
  scenes: z.array(graphSceneSchema).min(3).max(8),
});

export type GraphNode = z.infer<typeof graphNodeSchema>;
export type GraphZone = z.infer<typeof graphZoneSchema>;
export type GraphEdge = z.infer<typeof graphEdgeSchema>;
export type GraphScene = z.infer<typeof graphSceneSchema>;
export type SceneGraphPlan = z.infer<typeof sceneGraphPlanSchema>;
export type ZoneArrange = z.infer<typeof zoneArrangeSchema>;

// ---------------------------------------------------------------------------
// Design canvas
// ---------------------------------------------------------------------------

const CENTER_X = 600;
const X_MIN = 200;
const X_MAX = 1000;
const Y_TOP = 185;
const Y_BOT = 650;
const PALETTE = ["#5aa9e6", "#9ee7c5", "#ffd166", "#ff7a90", "#b28dff", "#7bdff2", "#a7e163", "#f4a261"];
const CONNECTOR_CLEARANCE = 30;
const MIN_CONNECTOR_SPAN = 34;

type Pt = { x: number; y: number };
type Placed = { node: GraphNode; cx: number; cy: number; size: number; r: number; step: number; captionH: number };
type Band = { cy: number; height: number; top: number };
type Placement = { beatIndex: number; element: VisualElement };

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

function upper(s: string, max = 28): string {
  return s.toUpperCase().slice(0, max);
}

// Wrap a multi-word caption onto two balanced lines (narrower, Lamina-style
// stacked labels) so adjacent captions don't run into each other.
function wrapCaption(caption: string): string {
  const up = caption.toUpperCase().trim().slice(0, 28);
  if (up.length <= 9 || !up.includes(" ")) return up;
  const words = up.split(/\s+/);
  let best = up;
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i += 1) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    const diff = Math.abs(a.length - b.length);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = `${a}\n${b}`;
    }
  }
  return best;
}

// Longest line length of a (possibly wrapped) caption — for spacing math.
function captionMaxChars(caption?: string): number {
  if (!caption) return 0;
  return Math.max(...wrapCaption(caption).split("\n").map((l) => l.length));
}

function iconSizeFor(node: GraphNode, base: number): number {
  if (node.role === "hero") return Math.round(base * 1.5);
  return base;
}

function captionTextWidth(caption: string, fontSize: number): number {
  const lines = caption.includes("\n") ? caption.split("\n") : wrapCaption(caption).split("\n");
  const maxLen = Math.max(...lines.map((line) => line.length));
  return maxLen * fontSize * 0.6 + 10;
}

// ---------------------------------------------------------------------------
// Element builders (same VisualElement model the renderer already understands)
// ---------------------------------------------------------------------------

function iconElement(id: string, node: GraphNode, cx: number, cy: number, size: number, withCaption: boolean, step: number, fillIdx: number, micro = 0): VisualElement {
  return {
    id,
    type: "asset",
    assetKey: node.concept ?? "generic",
    x: Math.round(cx - size / 2),
    y: Math.round(cy - size / 2),
    width: size,
    height: size,
    ...(withCaption && node.caption ? { label: wrapCaption(node.caption) } : {}),
    ...(node.imagery?.trim() ? { searchHint: node.imagery.trim().slice(0, 80) } : {}),
    fill: PALETTE[fillIdx % PALETTE.length],
    delay: micro,
    revealStep: step,
  };
}

function textElement(id: string, text: string, cx: number, cy: number, fontSize: number, step: number, micro = 0): VisualElement {
  return {
    id,
    type: "text",
    text: upper(text, 40),
    x: Math.round(cx),
    y: Math.round(cy),
    fontSize,
    delay: micro,
    revealStep: step,
  };
}

function lineElement(id: string, a: Pt, b: Pt, kind: "arrow" | "line", step: number, micro = 0, strokeWidth?: number): VisualElement {
  return {
    id,
    type: kind,
    x: Math.round(a.x),
    y: Math.round(a.y),
    x2: Math.round(b.x),
    y2: Math.round(b.y),
    ...(strokeWidth ? { strokeWidth } : {}),
    delay: micro,
    revealStep: step,
  };
}

function gridIconElements(idBase: string, node: GraphNode, cx: number, cy: number, footprint: number, step: number, fillIdx: number): VisualElement[] {
  const n = Math.min(Math.max(1, node.count ?? 1), 9);
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const cell = footprint / Math.max(cols, rows);
  const iconSize = Math.max(26, Math.round(cell * 0.82));
  const x0 = cx - (cols * cell) / 2 + cell / 2;
  const y0 = cy - (rows * cell) / 2 + cell / 2;
  const out: VisualElement[] = [];
  for (let i = 0; i < n; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    out.push(iconElement(`${idBase}_g${i}`, node, x0 + col * cell, y0 + row * cell, iconSize, false, step, fillIdx, Math.min(0.45, i * 0.04)));
  }
  return out;
}

function diamondElements(idBase: string, cx: number, cy: number, hw: number, hh: number, step: number): VisualElement[] {
  const t: Pt = { x: cx, y: cy - hh };
  const r: Pt = { x: cx + hw, y: cy };
  const b: Pt = { x: cx, y: cy + hh };
  const l: Pt = { x: cx - hw, y: cy };
  return [
    lineElement(`${idBase}_t`, t, r, "line", step),
    lineElement(`${idBase}_r`, r, b, "line", step),
    lineElement(`${idBase}_b`, b, l, "line", step),
    lineElement(`${idBase}_l`, l, t, "line", step),
  ];
}

// ---------------------------------------------------------------------------
// Zone vertical allocation
// ---------------------------------------------------------------------------

function zoneRows(zone: GraphZone): number {
  const n = zone.nodes.length;
  switch (zone.arrange) {
    case "column":
    case "stack":
      return n;
    case "comparison":
      return Math.max(1, Math.ceil(n / 2));
    case "grid":
      return Math.ceil(n / (n <= 3 ? n : n === 4 ? 2 : 3));
    case "radial":
      return 2.2;
    case "fanout":
    case "convergence":
      return Math.max(1.6, n - 1);
    case "hero":
      return 1.6;
    case "loopback":
      return 1.5;
    case "cycle":
      return 2.1;
    default:
      return 1;
  }
}

function allocateBands(zones: GraphZone[]): Band[] {
  const weights = zones.map(zoneRows);
  const totalW = weights.reduce((s, w) => s + w, 0) || 1;
  const gap = zones.length > 1 ? 26 : 0;
  const available = Y_BOT - Y_TOP - gap * (zones.length - 1);
  const bands: Band[] = [];
  let cursor = Y_TOP;
  zones.forEach((_, i) => {
    const h = (available * weights[i]) / totalW;
    bands.push({ top: cursor, height: h, cy: cursor + h / 2 });
    cursor += h + gap;
  });
  return bands;
}

// ---------------------------------------------------------------------------
// Arrangement primitives -> local node centres within a band
// ---------------------------------------------------------------------------

function spread(n: number, min: number, max: number): number[] {
  if (n <= 1) return [(min + max) / 2];
  const step = (max - min) / (n - 1);
  return Array.from({ length: n }, (_, i) => min + step * i);
}

// Horizontal positions that CLUSTER toward the centre when there are few nodes —
// so 2-3 big icons sit close together (short arrows, full board) instead of being
// stranded at the far edges with a giant arrow spanning the gap.
function adaptiveXs(n: number, ideal = 380): number[] {
  const half = Math.min((X_MAX - X_MIN) / 2, ((n - 1) * ideal) / 2);
  return spread(n, CENTER_X - half, CENTER_X + half);
}

function arrangeRow(nodes: GraphNode[], band: Band): Pt[] {
  // Space by the widest CAPTION (wrapped) so adjacent labels never run together.
  const maxCap = Math.max(0, ...nodes.map((nd) => captionMaxChars(nd.caption)));
  const ideal = Math.max(360, maxCap * 23 + 80);
  return adaptiveXs(nodes.length, ideal).map((x) => ({ x, y: band.cy }));
}

function arrangeColumn(nodes: GraphNode[], band: Band): Pt[] {
  const ys = spread(nodes.length, band.top + 60, band.top + band.height - 60);
  return ys.map((y) => ({ x: CENTER_X, y }));
}

function arrangeGrid(nodes: GraphNode[], band: Band): Pt[] {
  const n = nodes.length;
  const cols = n <= 3 ? n : n === 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const xs = spread(cols, X_MIN + 80, X_MAX - 80);
  const ys = rows > 1 ? spread(rows, band.top + 70, band.top + band.height - 70) : [band.cy];
  return nodes.map((_, i) => ({ x: xs[i % cols], y: ys[Math.floor(i / cols)] }));
}

function arrangeRadial(nodes: GraphNode[], band: Band): Pt[] {
  if (!nodes.length) return [];
  const cx = CENTER_X;
  const cy = band.cy;
  const spokes = nodes.length - 1;
  const R = Math.min(230, band.height / 2 - 24, 260);
  const pts: Pt[] = [{ x: cx, y: cy }];
  for (let i = 0; i < spokes; i += 1) {
    const a = (-90 + (360 / Math.max(1, spokes)) * i) * (Math.PI / 180);
    pts.push({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
  }
  return pts;
}

function arrangeBranch(nodes: GraphNode[], band: Band): Pt[] {
  // [action, decision, positive, negative, ...extras]
  const pts: Pt[] = [];
  const actionX = X_MIN + 80;
  const decX = CENTER_X - 30;
  const outX = X_MAX - 90;
  const cy = band.cy;
  pts.push({ x: actionX, y: cy }); // action
  pts.push({ x: decX, y: cy }); // decision (diamond)
  const outcomes = nodes.slice(2);
  outcomes.forEach((_, i) => {
    const dir = i === 0 ? -1 : i === 1 ? 1 : 0;
    pts.push({ x: outX, y: cy + dir * Math.min(120, band.height / 2 - 40) });
  });
  return pts;
}

function arrangeLadder(nodes: GraphNode[], band: Band): Pt[] {
  const n = nodes.length;
  const xs = spread(n, X_MIN + 80, X_MAX - 90);
  // Ascend bottom-left -> top-right.
  const ys = n > 1 ? spread(n, band.top + band.height - 60, band.top + 60) : [band.cy];
  return nodes.map((_, i) => ({ x: xs[i], y: ys[i] }));
}

function arrangeHero(nodes: GraphNode[], band: Band): Pt[] {
  if (nodes.length === 1) return [{ x: CENTER_X, y: band.cy }];
  // Hero centred, the rest as a small row beneath.
  const pts: Pt[] = [{ x: CENTER_X, y: band.top + band.height * 0.38 }];
  const rest = nodes.slice(1);
  const xs = spread(rest.length, X_MIN + 90, X_MAX - 90);
  rest.forEach((_, i) => pts.push({ x: xs[i], y: band.top + band.height * 0.82 }));
  return pts;
}

// Two sides split by a centre divider. Nodes carry side:"left"|"right"; if a node
// has no side, fall back to first-half-left / second-half-right.
function arrangeComparison(nodes: GraphNode[], band: Band): Pt[] {
  const half = Math.ceil(nodes.length / 2);
  const leftIdx: number[] = [];
  const rightIdx: number[] = [];
  nodes.forEach((n, i) => {
    const side = n.side ?? (i < half ? "left" : "right");
    (side === "right" ? rightIdx : leftIdx).push(i);
  });
  const pts: Pt[] = new Array(nodes.length);
  const place = (idxs: number[], x: number) => {
    const ys = spread(idxs.length, band.top + 60, band.top + band.height - 60);
    idxs.forEach((ni, r) => (pts[ni] = { x, y: ys[r] }));
  };
  place(leftIdx, CENTER_X - 232);
  place(rightIdx, CENTER_X + 232);
  return pts;
}

// One source (node 0) on the left fanning out to many targets on the right.
function arrangeFanout(nodes: GraphNode[], band: Band): Pt[] {
  const pts: Pt[] = [{ x: X_MIN + 110, y: band.cy }];
  const targets = nodes.length - 1;
  const ys = spread(targets, band.top + 42, band.top + band.height - 42);
  for (let i = 1; i < nodes.length; i += 1) pts.push({ x: X_MAX - 110, y: ys[i - 1] });
  return pts;
}

// Many sources on the left converging into one target (the LAST node) on the right.
function arrangeConvergence(nodes: GraphNode[], band: Band): Pt[] {
  const sources = nodes.length - 1;
  const ys = spread(sources, band.top + 42, band.top + band.height - 42);
  const pts: Pt[] = [];
  for (let i = 0; i < sources; i += 1) pts.push({ x: X_MIN + 110, y: ys[i] });
  pts.push({ x: X_MAX - 110, y: band.cy }); // target
  return pts;
}

// A sequence that loops back to the start (the loop arc is drawn above the row).
function arrangeLoopback(nodes: GraphNode[], band: Band): Pt[] {
  return adaptiveXs(nodes.length, 360).map((x) => ({ x, y: band.cy + band.height * 0.16 }));
}

// Nodes evenly on a ring (a real cycle), arrows flow around it. A distinct loop
// visual from the linear loopback.
function arrangeCycle(nodes: GraphNode[], band: Band): Pt[] {
  const n = nodes.length;
  const cx = CENTER_X;
  const cy = band.cy;
  const R = Math.min(band.height / 2 - 30, 230);
  return nodes.map((_, i) => {
    const a = (-90 + (360 / n) * i) * (Math.PI / 180);
    return { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
  });
}

function arrangeNodes(zone: GraphZone, nodes: GraphNode[], band: Band): Pt[] {
  // A lone node always sits dead-centre of its band (never stranded in a corner).
  if (nodes.length === 1) return [{ x: CENTER_X, y: band.cy }];

  switch (zone.arrange) {
    case "column":
    case "stack":
      return arrangeColumn(nodes, band);
    case "grid":
      return arrangeGrid(nodes, band);
    case "radial":
      return nodes.length >= 3 ? arrangeRadial(nodes, band) : arrangeRow(nodes, band);
    case "branch":
      // A real branch needs action+decision+2 outcomes; otherwise lay out as a flow.
      return nodes.length >= 4 ? arrangeBranch(nodes, band) : arrangeRow(nodes, band);
    case "ladder":
      return arrangeLadder(nodes, band);
    case "hero":
      return arrangeHero(nodes, band);
    case "comparison":
      return arrangeComparison(nodes, band);
    case "fanout":
    case "convergence":
      // Need at least one source AND one target; else a plain row reads better.
      return nodes.length >= 2 ? (zone.arrange === "fanout" ? arrangeFanout(nodes, band) : arrangeConvergence(nodes, band)) : arrangeRow(nodes, band);
    case "loopback":
      return arrangeLoopback(nodes, band);
    case "cycle":
      return nodes.length >= 3 ? arrangeCycle(nodes, band) : arrangeLoopback(nodes, band);
    case "row":
    case "flow":
    default:
      return arrangeRow(nodes, band);
  }
}

// Whether a zone's auto-connectors should run (the arrange actually placed nodes
// in its canonical shape rather than degrading to a row).
function patternActive(zone: GraphZone): boolean {
  const n = zone.nodes.length;
  if (n <= 1) return false;
  switch (zone.arrange) {
    case "radial":
      return n >= 3;
    case "branch":
      return n >= 4;
    case "fanout":
    case "convergence":
      return n >= 2;
    case "cycle":
      return n >= 3;
    default:
      return true;
  }
}

function sideCaptionSide(zone: GraphZone, index: number, count: number): "left" | "right" | null {
  if (zone.arrange === "stack" || zone.arrange === "column") return "right";
  if (zone.arrange === "convergence" && index < count - 1) return "left";
  if (zone.arrange === "fanout" && index > 0) return "right";
  return null;
}

function sideCaptionElement(
  id: string,
  caption: string,
  pt: Pt,
  size: number,
  side: "left" | "right",
  step: number,
): VisualElement {
  const text = wrapCaption(caption);
  const fontSize = 24;
  const width = captionTextWidth(text, fontSize);
  const gap = 18;
  const x =
    side === "left"
      ? pt.x - size / 2 - gap - width / 2
      : pt.x + size / 2 + gap + width / 2;
  return textElement(id, text, x, pt.y + 8, fontSize, step, 0.1);
}

// Big, Lamina-scale icons that fill the board (the fit transform keeps them
// roughly consistent across scenes).
function baseSizeFor(zone: GraphZone, count: number): number {
  switch (zone.arrange) {
    case "grid":
      return count > 4 ? 150 : 178;
    case "radial":
      return 138;
    case "branch":
      return 150;
    case "ladder":
      return 150;
    case "hero":
      return 250;
    case "stack":
    case "column":
      return 150;
    case "comparison":
      return count <= 4 ? 150 : 122;
    case "fanout":
    case "convergence":
      return 150;
    case "cycle":
      return 132;
    case "row":
    case "flow":
    case "loopback":
    default:
      return count <= 2 ? 216 : count === 3 ? 188 : count === 4 ? 162 : 138;
  }
}

// ---------------------------------------------------------------------------
// Connector routing (content-aware, from real node centres)
// ---------------------------------------------------------------------------

function connectorKey(from: Placed, to: Placed, kind: "arrow" | "line" | "loop"): string {
  return `${from.node.id}->${to.node.id}:${kind}`;
}

function connect(idBase: string, from: Placed, to: Placed, kind: "arrow" | "line", label: string | undefined, step: number): Placement[] {
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  // Captions sit BELOW each node, so a line leaving downward (uy>0) or arriving
  // from below (uy<0) must clear that caption instead of piercing it.
  const fromGap = from.r + CONNECTOR_CLEARANCE + (uy > 0.35 ? from.captionH : 0);
  const toGap = to.r + CONNECTOR_CLEARANCE + (uy < -0.35 ? to.captionH : 0);
  const start: Pt = { x: from.cx + ux * fromGap, y: from.cy + uy * fromGap };
  const end: Pt = { x: to.cx - ux * toGap, y: to.cy - uy * toGap };
  // If the two nodes are so close there's no clear gap, a connector would just
  // overlap them — skip it rather than draw a stub through the icons.
  const span = (end.x - start.x) * ux + (end.y - start.y) * uy;
  if (span < MIN_CONNECTOR_SPAN) return [];
  const out: Placement[] = [
    { beatIndex: to.node.beat, element: lineElement(idBase, start, end, kind, to.step, 0.16) },
  ];
  if (label) {
    out.push({
      beatIndex: to.node.beat,
      element: textElement(`${idBase}_l`, label, (start.x + end.x) / 2, (start.y + end.y) / 2 - 16, 20, to.step, 0.2),
    });
  }
  return out;
}

// A loop-back connector routed up and over the two nodes (e.g. a "REPEAT" cycle).
function loopConnect(idBase: string, from: Placed, to: Placed, label: string | undefined, step: number): Placement[] {
  const topY = Math.min(from.cy, to.cy) - Math.max(from.r, to.r) - 46;
  const a: Pt = { x: from.cx, y: from.cy - from.r - 6 };
  const b: Pt = { x: from.cx, y: topY };
  const c: Pt = { x: to.cx, y: topY };
  const d: Pt = { x: to.cx, y: to.cy - to.r - 6 };
  const out: Placement[] = [
    { beatIndex: to.node.beat, element: lineElement(`${idBase}_a`, a, b, "line", to.step, 0.16) },
    { beatIndex: to.node.beat, element: lineElement(`${idBase}_b`, b, c, "line", to.step, 0.18) },
    { beatIndex: to.node.beat, element: lineElement(`${idBase}_c`, c, d, "arrow", to.step, 0.2) },
  ];
  if (label) {
    out.push({
      beatIndex: to.node.beat,
      element: textElement(`${idBase}_l`, label, (from.cx + to.cx) / 2, topY - 12, 20, to.step, 0.22),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Text de-overlap (so labels/captions never stack into an unreadable blob)
// ---------------------------------------------------------------------------

function textBox(el: VisualElement): { x: number; y: number; w: number; h: number } {
  const fs = Math.max(24, el.fontSize ?? 24);
  const lines = (el.text ?? "").split("\n");
  const maxLen = Math.max(1, ...lines.map((l) => l.length));
  const w = maxLen * fs * 0.6 + 10;
  const h = lines.length * fs * 1.25;
  return { x: el.x - w / 2, y: el.y - h + fs * 0.2, w, h };
}

function boxesOverlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }, pad = 4): boolean {
  return !(a.x + a.w + pad <= b.x || b.x + b.w + pad <= a.x || a.y + a.h + pad <= b.y || b.y + b.h + pad <= a.y);
}

// Earlier text holds its place (captions are added before connector labels), and
// each later overlapping text is nudged away vertically — up if it sits in the top
// half of the board, down if in the bottom half — so nothing lands toward content.
function deoverlapText(placements: Placement[]): void {
  const mid = (Y_TOP + Y_BOT) / 2;
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  // Seed obstacles with ICONS and their captions. Asset labels are drawn inside
  // the asset element, so movable text labels would otherwise be blind to them.
  for (const p of placements) {
    const el = p.element;
    if ((el.type === "asset" || el.type === "logo") && el.width && el.height) {
      placed.push({ x: el.x - 8, y: el.y - 8, w: el.width + 16, h: el.height + 16 });
      if (el.label) {
        const fs = Math.max(28, Math.min(36, Math.round(el.width * 0.19)));
        const lines = el.label.split("\n");
        const w = Math.max(...lines.map((l) => l.length)) * fs * 0.6 + 10;
        placed.push({ x: el.x + el.width / 2 - w / 2, y: el.y + el.height + 8, w, h: lines.length * fs * 1.2 });
      }
    }
  }
  for (const p of placements) {
    const el = p.element;
    if (el.type !== "text") continue;
    let box = textBox(el);
    for (let iter = 0; iter < 16; iter += 1) {
      const hit = placed.find((b) => boxesOverlap(box, b));
      if (!hit) break;
      const up = box.y < mid;
      const shift = up ? hit.y - 8 - (box.y + box.h) : hit.y + hit.h + 8 - box.y;
      el.y += shift;
      box = { ...box, y: box.y + shift };
    }
    placed.push(box);
  }
}

// ---------------------------------------------------------------------------
// Compose one scene graph into positioned elements
// ---------------------------------------------------------------------------

function composeGraphScene(scene: GraphScene, sceneIndex: number): Scene {
  const sid = sceneIndex + 1;
  const nodeById = new Map(scene.nodes.map((n) => [n.id, n]));
  const beatCount = scene.beats.length;
  const clampBeat = (b: number) => clampInt(b, 0, beatCount - 1);

  const bands = allocateBands(scene.zones);
  const placedById = new Map<string, Placed>();
  const placements: Placement[] = [];
  const autoConnectorKeys = new Set<string>();

  // Per-beat running reveal-step counter (so nodes appear in narration order).
  const stepByBeat = new Map<number, number>();
  const nextStep = (beat: number): number => {
    const cur = stepByBeat.get(beat) ?? 0;
    stepByBeat.set(beat, cur + 1);
    return Math.min(cur, 7);
  };

  let fillIdx = 0;

  // ONE consistent icon size for the whole scene (the smallest any zone needs),
  // so icons don't jump between tiny and huge within a scene. Heroes get a modest
  // bump; value/grid icons derive from this too.
  const sceneSize = clampInt(Math.min(...scene.zones.map((z) => baseSizeFor(z, z.nodes.length))), 132, 196);
  const addAutoConnector = (
    idBase: string,
    from: Placed,
    to: Placed,
    kind: "arrow" | "line",
    label: string | undefined,
  ) => {
    autoConnectorKeys.add(connectorKey(from, to, kind));
    placements.push(...connect(idBase, from, to, kind, label, to.step));
  };
  const addAutoLoop = (idBase: string, from: Placed, to: Placed, label: string | undefined) => {
    autoConnectorKeys.add(connectorKey(from, to, "loop"));
    placements.push(...loopConnect(idBase, from, to, label, from.step));
  };

  scene.zones.forEach((zone, zi) => {
    const band = bands[zi];
    const nodes = zone.nodes.map((id) => nodeById.get(id)).filter((n): n is GraphNode => Boolean(n));
    if (!nodes.length) return;
    const pts = arrangeNodes(zone, nodes, band);

    nodes.forEach((node, i) => {
      const pt = pts[i] ?? { x: CENTER_X, y: band.cy };
      const beat = clampBeat(node.beat);
      const step = nextStep(beat);
      const myFill = fillIdx++;
      const captionSide = node.caption ? sideCaptionSide(zone, i, nodes.length) : null;

      if (zone.arrange === "branch" && i === 1) {
        // Decision node -> diamond with caption inside.
        const hw = 104;
        const hh = 80;
        const r = Math.max(hw, hh);
        placedById.set(node.id, { node: { ...node, beat }, cx: pt.x, cy: pt.y, size: r * 2, r, step, captionH: 0 });
        for (const line of diamondElements(`el_s${sid}_${node.id}`, pt.x, pt.y, hw, hh, step)) {
          placements.push({ beatIndex: beat, element: line });
        }
        if (node.caption) {
          placements.push({ beatIndex: beat, element: textElement(`el_s${sid}_${node.id}_c`, node.caption, pt.x, pt.y + 7, node.caption.length > 8 ? 19 : 22, step, 0.12) });
        }
        return;
      }

      // Hero (oversized) icons only in a hero zone or a lone-node scene — never in
      // a multi-node flow/row, where a giant icon crowds and overlaps the arrows.
      const allowHero = zone.arrange === "hero" || nodes.length === 1;
      let size = allowHero && node.role === "hero" ? Math.round(sceneSize * 1.3) : sceneSize;
      // Cap by the horizontal spacing of line-type zones so icons + their gap (room
      // for an arrow) always fit without touching.
      const lineZone = zone.arrange === "row" || zone.arrange === "flow" || zone.arrange === "loopback" || zone.arrange === "ladder";
      if (lineZone && nodes.length > 1) {
        const spacing = (X_MAX - X_MIN) / (nodes.length - 1);
        size = Math.min(size, Math.max(76, spacing - 72));
      }
      const r = size / 2;
      // Vertical space a caption (and value) occupy BELOW the node, so connectors
      // can be routed clear of it. Captions may wrap to 2 lines, so reserve enough.
      const capLines = node.caption ? wrapCaption(node.caption).split("\n").length : 1;
      const captionH = node.kind === "value" ? 124 : node.kind === "note" ? 0 : !captionSide && node.caption ? 44 + capLines * 32 : 0;
      placedById.set(node.id, { node: { ...node, beat }, cx: pt.x, cy: pt.y, size, r, step, captionH });

      if (node.kind === "value") {
        // Icon (consistent scene size) on top, the big number, then the caption.
        const vIcon = Math.round(size * 0.82);
        if (node.concept) {
          placements.push({ beatIndex: beat, element: iconElement(`el_s${sid}_${node.id}_i`, node, pt.x, pt.y - vIcon * 0.55, vIcon, false, step, myFill) });
        }
        if (node.value) {
          placements.push({ beatIndex: beat, element: textElement(`el_s${sid}_${node.id}_v`, node.value, pt.x, pt.y + vIcon * 0.4, 46, step, 0.1) });
        }
        if (node.caption) {
          placements.push({ beatIndex: beat, element: textElement(`el_s${sid}_${node.id}_c`, node.caption, pt.x, pt.y + vIcon * 0.4 + 50, 26, step, 0.16) });
        }
        return;
      }

      if (node.kind === "note") {
        placements.push({ beatIndex: beat, element: textElement(`el_s${sid}_${node.id}`, node.caption ?? "", pt.x, pt.y, 30, step) });
        return;
      }

      // icon node
      if ((node.count ?? 1) > 1) {
        for (const el of gridIconElements(`el_s${sid}_${node.id}`, node, pt.x, pt.y, size * 1.6, step, myFill)) {
          placements.push({ beatIndex: beat, element: el });
        }
      } else {
        placements.push({ beatIndex: beat, element: iconElement(`el_s${sid}_${node.id}`, node, pt.x, pt.y, size, !captionSide, step, myFill) });
      }
      if (captionSide && node.caption) {
        placements.push({ beatIndex: beat, element: sideCaptionElement(`el_s${sid}_${node.id}_c`, node.caption, pt, size, captionSide, step) });
      }
    });

    // Auto-connectors implied by the arrangement.
    const placedNodes = nodes.map((n) => placedById.get(n.id)).filter((p): p is Placed => Boolean(p));
    const active = patternActive(zone);
    if ((zone.arrange === "flow" || zone.arrange === "ladder") && placedNodes.length >= 2) {
      for (let i = 1; i < placedNodes.length; i += 1) {
        addAutoConnector(`el_s${sid}_z${zi}_a${i}`, placedNodes[i - 1], placedNodes[i], "arrow", undefined);
      }
    } else if (zone.arrange === "radial" && active) {
      const hub = placedNodes[0];
      for (let i = 1; i < placedNodes.length; i += 1) {
        addAutoConnector(`el_s${sid}_z${zi}_s${i}`, hub, placedNodes[i], "line", undefined);
      }
    } else if (zone.arrange === "branch" && active) {
      const [action, decision, ...outcomes] = placedNodes;
      addAutoConnector(`el_s${sid}_z${zi}_ad`, action, decision, "arrow", undefined);
      outcomes.forEach((o, i) => addAutoConnector(`el_s${sid}_z${zi}_o${i}`, decision, o, "arrow", o.node.caption && i < 2 ? (i === 0 ? "YES" : "NO") : undefined));
    } else if (zone.arrange === "comparison" && active) {
      // Centre divider line (no arrows).
      placements.push({
        beatIndex: 0,
        element: lineElement(`el_s${sid}_z${zi}_div`, { x: CENTER_X, y: band.top + 12 }, { x: CENTER_X, y: band.top + band.height - 12 }, "line", 0, 0.05),
      });
    } else if (zone.arrange === "fanout" && active) {
      const src = placedNodes[0];
      for (let i = 1; i < placedNodes.length; i += 1) {
        addAutoConnector(`el_s${sid}_z${zi}_f${i}`, src, placedNodes[i], "arrow", undefined);
      }
    } else if (zone.arrange === "convergence" && active) {
      const target = placedNodes[placedNodes.length - 1];
      for (let i = 0; i < placedNodes.length - 1; i += 1) {
        addAutoConnector(`el_s${sid}_z${zi}_c${i}`, placedNodes[i], target, "arrow", undefined);
      }
    } else if (zone.arrange === "loopback" && placedNodes.length >= 2) {
      for (let i = 1; i < placedNodes.length; i += 1) {
        addAutoConnector(`el_s${sid}_z${zi}_a${i}`, placedNodes[i - 1], placedNodes[i], "arrow", undefined);
      }
      const last = placedNodes[placedNodes.length - 1];
      const first = placedNodes[0];
      addAutoLoop(`el_s${sid}_z${zi}_loop`, last, first, "REPEAT");
    } else if (zone.arrange === "cycle" && active) {
      // Arrows flow around the ring: each node -> the next, closing the loop.
      for (let i = 0; i < placedNodes.length; i += 1) {
        const a = placedNodes[i];
        const b = placedNodes[(i + 1) % placedNodes.length];
        addAutoConnector(`el_s${sid}_z${zi}_cy${i}`, a, b, "arrow", undefined);
      }
    }
  });

  // Explicit edges (hub links, cross-zone, loops, branches the director declared).
  // A `loopback` zone already draws its own loop arc, so drop redundant explicit
  // loop edges — that double-label collision is what garbled the loop caption.
  const hasLoopbackZone = scene.zones.some((z) => z.arrange === "loopback");
  const hasComparisonZone = scene.zones.some((z) => z.arrange === "comparison");
  scene.edges.forEach((edge, ei) => {
    if (edge.kind === "loop" && hasLoopbackZone) return;
    const from = placedById.get(edge.from);
    const to = placedById.get(edge.to);
    if (!from || !to) return;
    // In a comparison scene, an arrow crossing the centre divider (one node on
    // each side) reads as a mistake and collides with the divider — drop it.
    if (hasComparisonZone && Math.sign(from.cx - CENTER_X) !== Math.sign(to.cx - CENTER_X)) return;
    const explicitKind = edge.kind === "line" || edge.kind === "loop" ? edge.kind : "arrow";
    if (autoConnectorKeys.has(connectorKey(from, to, explicitKind))) return;
    const idBase = `el_s${sid}_e${ei}`;
    if (edge.kind === "loop") {
      placements.push(...loopConnect(idBase, from, to, edge.label, to.step));
    } else {
      placements.push(...connect(idBase, from, to, edge.kind, edge.label, to.step));
    }
  });

  // Final safety net: nudge any overlapping TEXT apart so captions and connector
  // labels can never stack into an unreadable blob (the renderer's collision
  // repair only moves icons, not text).
  deoverlapText(placements);

  // Group elements by beat.
  const elementsByBeat: VisualElement[][] = scene.beats.map(() => []);
  for (const p of placements) {
    const bucket = elementsByBeat[clampBeat(p.beatIndex)] ?? elementsByBeat[0];
    bucket.push(p.element);
  }

  const repIcon = scene.nodes.find((n) => n.concept)?.concept ?? "generic";
  const beats: Beat[] = scene.beats.map((beat, beatIndex) => ({
    id: `beat_${sceneIndex * 8 + beatIndex + 1}`,
    narration: beat.narration,
    visual: {
      type: "asset",
      assetKey: repIcon,
      label: scene.title.toUpperCase().slice(0, 32),
      shape: "square",
      position: "center",
      fill: "#a7c7ff",
    },
    elements: elementsByBeat[beatIndex],
  }));

  return {
    id: `scene_${sid}`,
    title: scene.title.toUpperCase().slice(0, 48),
    composition: "flow",
    beats,
  };
}

export function composeSceneGraphPlan(plan: SceneGraphPlan): Storyboard {
  return validateStoryboard({
    title: plan.title.slice(0, 64),
    durationSeconds: plan.durationSeconds,
    scenes: plan.scenes.map((scene, index) => composeGraphScene(scene, index)),
  });
}

// ---------------------------------------------------------------------------
// Sanitiser — coerce arbitrary director JSON into a valid SceneGraphPlan.
// ---------------------------------------------------------------------------

const ARRANGES: ZoneArrange[] = [
  "row", "flow", "column", "stack", "grid", "radial", "branch", "ladder", "hero",
  "comparison", "fanout", "convergence", "loopback", "cycle",
];

function str(v: unknown, max: number): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : undefined;
}

function cleanId(v: unknown): string | undefined {
  const s = typeof v === "string" ? v.replace(/[^a-zA-Z0-9_-]/g, "") : "";
  return s ? s.slice(0, 24) : undefined;
}

function cleanConcept(v: unknown): string | undefined {
  const raw = typeof v === "string" ? v.replace(/[^a-zA-Z0-9_-]/g, "").replace(/^[^a-zA-Z]+/, "") : "";
  return raw.length >= 2 ? raw.slice(0, 64) : undefined;
}

function sanitizeNode(raw: any): GraphNode | null {
  if (!raw || typeof raw !== "object") return null;
  const id = cleanId(raw.id);
  if (!id) return null;
  const kind = raw.kind === "value" || raw.kind === "note" ? raw.kind : "icon";
  const node: GraphNode = {
    id,
    kind,
    role: raw.role === "hero" ? "hero" : "normal",
    beat: clampInt(Number(raw.beat) || 0, 0, 7),
  };
  const concept = cleanConcept(raw.concept);
  if (concept) node.concept = concept;
  const imagery = str(raw.imagery, 40);
  if (imagery) node.imagery = imagery;
  const caption = str(raw.caption, 28);
  if (caption) node.caption = caption;
  const value = str(raw.value, 24);
  if (value) node.value = value;
  if (typeof raw.count === "number" && Number.isFinite(raw.count)) node.count = clampInt(raw.count, 1, 9);
  if (raw.side === "left" || raw.side === "right") node.side = raw.side;
  // A note needs a caption (it is text-only); an icon needs a concept.
  if (kind === "note" && !node.caption) return null;
  if (kind === "icon" && !node.concept && !node.caption) return null;
  return node;
}

function sanitizeZone(raw: any, validIds: Set<string>): GraphZone | null {
  if (!raw || typeof raw !== "object") return null;
  const arrange: ZoneArrange = ARRANGES.includes(raw.arrange) ? raw.arrange : "row";
  const ids = Array.isArray(raw.nodes)
    ? raw.nodes.map(cleanId).filter((id: string | undefined): id is string => Boolean(id) && validIds.has(id!)).slice(0, 8)
    : [];
  if (!ids.length) return null;
  return { arrange, nodes: ids };
}

function sanitizeEdge(raw: any, validIds: Set<string>): GraphEdge | null {
  if (!raw || typeof raw !== "object") return null;
  const from = cleanId(raw.from);
  const to = cleanId(raw.to);
  if (!from || !to || from === to || !validIds.has(from) || !validIds.has(to)) return null;
  const kind = raw.kind === "line" || raw.kind === "loop" ? raw.kind : "arrow";
  const edge: GraphEdge = { from, to, kind };
  const label = str(raw.label, 16);
  if (label) edge.label = label;
  return edge;
}

export function sanitizeGraphScene(raw: any): GraphScene | null {
  if (!raw || typeof raw !== "object") return null;
  const title = str(raw.title, 40);
  if (!title) return null;

  const beats = Array.isArray(raw.beats)
    ? raw.beats
        .map((b: any) => str(b?.narration ?? b, 240))
        .filter((n: string | undefined): n is string => Boolean(n))
        .slice(0, 8)
        .map((narration: string) => ({ narration }))
    : [];
  if (beats.length < 1) return null;

  const nodes = Array.isArray(raw.nodes)
    ? raw.nodes.map(sanitizeNode).filter((n: GraphNode | null): n is GraphNode => n !== null)
    : [];
  // De-duplicate node ids and clamp beats into range.
  const seen = new Set<string>();
  const uniqueNodes: GraphNode[] = [];
  for (const n of nodes) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    uniqueNodes.push({ ...n, beat: clampInt(n.beat, 0, beats.length - 1) });
  }
  if (uniqueNodes.length < 1) return null;
  const trimmedNodes = uniqueNodes.slice(0, 10);
  const trimmedIds = new Set(trimmedNodes.map((n) => n.id));

  let zones = Array.isArray(raw.zones)
    ? raw.zones.map((z: any) => sanitizeZone(z, trimmedIds)).filter((z: GraphZone | null): z is GraphZone => z !== null).slice(0, 3)
    : [];
  // Any node not referenced by a zone goes into a trailing fallback row so it is
  // never dropped silently.
  const referenced = new Set(zones.flatMap((z: GraphZone) => z.nodes));
  const orphans = trimmedNodes.filter((n) => !referenced.has(n.id)).map((n) => n.id);
  if (!zones.length && orphans.length) {
    zones = [{ arrange: orphans.length > 4 ? "grid" : "row", nodes: orphans.slice(0, 8) }];
  } else if (orphans.length) {
    zones.push({ arrange: orphans.length > 4 ? "grid" : "row", nodes: orphans.slice(0, 8) });
  }
  if (!zones.length) return null;

  const edges = Array.isArray(raw.edges)
    ? raw.edges.map((e: any) => sanitizeEdge(e, trimmedIds)).filter((e: GraphEdge | null): e is GraphEdge => e !== null).slice(0, 4)
    : [];

  return { title, beats, nodes: trimmedNodes, zones, edges: edges.length ? edges : [] };
}

/** Coerce arbitrary director JSON into a valid SceneGraphPlan, or null if unusable. */
export function sanitizeSceneGraphPlan(raw: unknown): SceneGraphPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as any;
  const title = str(r.title, 64) ?? "Explainer";
  const durationSeconds = clampInt(Number(r.durationSeconds) || 110, 40, 180);
  const scenes = Array.isArray(r.scenes)
    ? r.scenes.map(sanitizeGraphScene).filter((s: GraphScene | null): s is GraphScene => s !== null)
    : [];
  if (scenes.length < 3) return null;
  return { title, durationSeconds, scenes: scenes.slice(0, 8) };
}
