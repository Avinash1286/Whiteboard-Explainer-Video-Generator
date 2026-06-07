import type { FlatBeat, SceneComposition, Storyboard, VisualElement } from "./storyboard";
import { flattenBeats } from "./storyboard";
import type { Timepoint } from "./ssml";
import type {
  LayoutDiagnostic,
  ResolvedTimeline,
  ResolvedTimelineElement,
  TimelineBox,
} from "./timeline";

export type RenderOptions = {
  width: number;
  height: number;
  fps: number;
  background?: "plain" | "grid";
};

export type Box = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CompiledBeat = FlatBeat & {
  start: number;
  end: number;
  box: Box;
  renderBounds: Box;
  labelLines: string[];
};

export type CompiledScene = {
  id: string;
  title: string;
  composition: SceneComposition;
  start: number;
  end: number;
  beats: CompiledBeat[];
};

export type CompiledVideo = {
  width: number;
  height: number;
  fps: number;
  duration: number;
  title: string;
  background: "plain" | "grid";
  scenes: CompiledScene[];
  beats: CompiledBeat[];
  timeline: ResolvedTimeline;
  layoutDiagnostics: LayoutDiagnostic[];
};

const SAFE_X = 78;
const TITLE_Y = 72;
const VISUAL_Y = 165;
const TITLE_SAFE_BOTTOM = 132;
const BOTTOM_SAFE_MARGIN = 54;
const LABEL_FONT_SIZE = 28;
const LABEL_LINE_HEIGHT = 31;
const LABEL_GAP = 28;

function wrapLabel(label: string, maxChars: number): string[] {
  const words = label.toUpperCase().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const rawWord of words) {
    const word = rawWord.length > maxChars ? `${rawWord.slice(0, Math.max(1, maxChars - 3))}...` : rawWord;
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 2);
}

function expanded(box: Box, amount: number): Box {
  return {
    x: box.x - amount,
    y: box.y - amount,
    width: box.width + amount * 2,
    height: box.height + amount * 2,
  };
}

function boxesOverlap(a: Box, b: Box): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

function unionBoxes(a: Box, b: Box): Box {
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.width, b.x + b.width);
  const y2 = Math.max(a.y + a.height, b.y + b.height);
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function labelBounds(box: Box, lines: string[]): Box {
  const maxChars = Math.max(1, ...lines.map((line) => line.length));
  const estimatedWidth = Math.min(box.width + 84, maxChars * 14);
  const firstBaseline = box.y + box.height + LABEL_GAP - (lines.length - 1) * (LABEL_LINE_HEIGHT / 2);
  const top = firstBaseline - LABEL_FONT_SIZE;
  const height = LABEL_FONT_SIZE + Math.max(0, lines.length - 1) * LABEL_LINE_HEIGHT + 8;
  return {
    x: box.x + box.width / 2 - estimatedWidth / 2,
    y: top,
    width: estimatedWidth,
    height,
  };
}

function renderedBounds(box: Box, lines: string[]): Box {
  return unionBoxes(box, labelBounds(box, lines));
}

function elementTextLines(element: VisualElement): string[] {
  return (element.text ?? element.label ?? "")
    .split(/\n|\|/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function richAssetLabelFontSize(element: VisualElement, width: number): number {
  return element.fontSize ?? Math.max(28, Math.min(36, Math.round(width * 0.19)));
}

function estimatedTextBounds(
  x: number,
  baselineY: number,
  lines: string[],
  fontSize: number,
): Box {
  const maxChars = Math.max(1, ...lines.map((line) => line.length));
  const width = Math.min(420, Math.max(48, maxChars * fontSize * 0.62));
  const height = fontSize + Math.max(0, lines.length - 1) * fontSize * 1.05;
  return {
    x: x - width / 2,
    y: baselineY - fontSize,
    width,
    height: height + 8,
  };
}

function elementBox(element: VisualElement): Box {
  return {
    x: element.x,
    y: element.y,
    width: element.width ?? 120,
    height: element.height ?? 120,
  };
}

function richElementBounds(element: VisualElement): Box | null {
  if (element.type === "arrow" || element.type === "line") {
    const x2 = element.x2 ?? element.x + 100;
    const y2 = element.y2 ?? element.y;
    const x = Math.min(element.x, x2) - 16;
    const y = Math.min(element.y, y2) - 16;
    return {
      x,
      y,
      width: Math.abs(x2 - element.x) + 32,
      height: Math.abs(y2 - element.y) + 32,
    };
  }

  if (element.type === "text") {
    return estimatedTextBounds(
      element.x,
      element.y,
      elementTextLines(element),
      element.fontSize ?? 28,
    );
  }

  const box = elementBox(element);
  const label = elementTextLines(element);
  if (!label.length) {
    return box;
  }

  const fontSize = element.type === "logo" ? element.fontSize ?? 22 : richAssetLabelFontSize(element, box.width);
  const labelBox = estimatedTextBounds(
    box.x + box.width / 2,
    box.y + box.height + (element.type === "logo" ? 24 : fontSize * 0.55 + 14),
    label,
    fontSize,
  );
  return unionBoxes(box, labelBox);
}

function richSafeArea(options: RenderOptions): Box {
  return {
    x: SAFE_X,
    y: TITLE_SAFE_BOTTOM,
    width: options.width - SAFE_X * 2,
    height: options.height - TITLE_SAFE_BOTTOM - BOTTOM_SAFE_MARGIN,
  };
}

function translateElement(element: VisualElement, dx: number, dy: number): VisualElement {
  return {
    ...element,
    x: element.x + dx,
    y: element.y + dy,
    x2: element.x2 === undefined ? undefined : element.x2 + dx,
    y2: element.y2 === undefined ? undefined : element.y2 + dy,
  };
}

function translateIntoArea(
  element: VisualElement,
  bounds: Box,
  area: Box,
): { element: VisualElement; bounds: Box; moved: boolean } {
  let dx = 0;
  let dy = 0;
  if (bounds.x < area.x) {
    dx = area.x - bounds.x;
  }
  if (bounds.x + bounds.width + dx > area.x + area.width) {
    dx = area.x + area.width - (bounds.x + bounds.width);
  }
  if (bounds.y < area.y) {
    dy = area.y - bounds.y;
  }
  if (bounds.y + bounds.height + dy > area.y + area.height) {
    dy = area.y + area.height - (bounds.y + bounds.height);
  }

  if (dx === 0 && dy === 0) {
    return { element, bounds, moved: false };
  }

  return {
    element: translateElement(element, dx, dy),
    bounds: { ...bounds, x: bounds.x + dx, y: bounds.y + dy },
    moved: true,
  };
}

function boxWithinArea(box: Box, area: Box): boolean {
  return (
    box.x >= area.x &&
    box.y >= area.y &&
    box.x + box.width <= area.x + area.width &&
    box.y + box.height <= area.y + area.height
  );
}

function overlapArea(a: Box, b: Box): number {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return x * y;
}

function shouldRepairCollision(element: VisualElement): boolean {
  // Only icons are ever nudged. Text (captions, arrow labels), arrows and lines
  // are positioned relative to their anchor by the composer; moving them would
  // break the template's symmetry (e.g. shoving an arrow label off its arrow).
  return element.type === "asset" || element.type === "logo";
}

function repairCollision(
  element: VisualElement,
  bounds: Box,
  placed: Box[],
  area: Box,
): { element: VisualElement; bounds: Box; moved: boolean } {
  if (!shouldRepairCollision(element)) {
    return { element, bounds, moved: false };
  }

  let current = element;
  let currentBounds = bounds;
  let moved = false;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const overlap = placed.find((box) => {
      const overlapPixels = overlapArea(expanded(currentBounds, 8), expanded(box, 8));
      return overlapPixels > Math.min(currentBounds.width * currentBounds.height, box.width * box.height) * 0.16;
    });
    if (!overlap) break;

    const candidates = [
      { dx: 0, dy: overlap.y + overlap.height - currentBounds.y + 24 },
      { dx: 0, dy: overlap.y - (currentBounds.y + currentBounds.height) - 24 },
      { dx: overlap.x + overlap.width - currentBounds.x + 24, dy: 0 },
      { dx: overlap.x - (currentBounds.x + currentBounds.width) - 24, dy: 0 },
    ];

    const candidate = candidates
      .map((shift) => ({
        shift,
        bounds: {
          ...currentBounds,
          x: currentBounds.x + shift.dx,
          y: currentBounds.y + shift.dy,
        },
      }))
      .find((entry) => boxWithinArea(entry.bounds, area));

    if (!candidate) break;
    current = translateElement(current, candidate.shift.dx, candidate.shift.dy);
    currentBounds = candidate.bounds;
    moved = true;
  }

  return { element: current, bounds: currentBounds, moved };
}

function shiftBox(box: Box, dx: number, dy: number): Box {
  return {
    ...box,
    x: box.x + dx,
    y: box.y + dy,
  };
}

function shiftCompiledBeat(beat: CompiledBeat, dx: number, dy: number): CompiledBeat {
  const box = shiftBox(beat.box, dx, dy);
  return {
    ...beat,
    box,
    renderBounds: renderedBounds(box, beat.labelLines),
  };
}

function repairCompiledBeatSafeArea(
  beat: CompiledBeat,
  area: Box,
): { beat: CompiledBeat; moved: boolean; before: Box; after: Box } {
  const before = beat.renderBounds;
  let dx = 0;
  let dy = 0;
  if (before.x < area.x) {
    dx = area.x - before.x;
  }
  if (before.x + before.width + dx > area.x + area.width) {
    dx = area.x + area.width - (before.x + before.width);
  }
  if (before.y < area.y) {
    dy = area.y - before.y;
  }
  if (before.y + before.height + dy > area.y + area.height) {
    dy = area.y + area.height - (before.y + before.height);
  }

  if (dx === 0 && dy === 0) {
    return { beat, moved: false, before, after: before };
  }

  const shifted = shiftCompiledBeat(beat, dx, dy);
  return { beat: shifted, moved: true, before, after: shifted.renderBounds };
}

function repairCompiledBeatCollision(
  beat: CompiledBeat,
  placed: CompiledBeat[],
  area: Box,
): { beat: CompiledBeat; moved: boolean; before: Box; after: Box } {
  let current = beat;
  const before = beat.renderBounds;
  let moved = false;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const currentBounds = expanded(current.renderBounds, 8);
    const overlap = placed.find((placedBeat) => boxesOverlap(currentBounds, expanded(placedBeat.renderBounds, 8)));
    if (!overlap) break;

    const overlapBounds = expanded(overlap.renderBounds, 8);
    const candidates = [
      { dx: 0, dy: overlapBounds.y + overlapBounds.height - currentBounds.y + 26 },
      { dx: 0, dy: overlapBounds.y - (currentBounds.y + currentBounds.height) - 26 },
      { dx: overlapBounds.x + overlapBounds.width - currentBounds.x + 26, dy: 0 },
      { dx: overlapBounds.x - (currentBounds.x + currentBounds.width) - 26, dy: 0 },
    ];

    const candidate = candidates
      .map((shift) => {
        const shifted = shiftCompiledBeat(current, shift.dx, shift.dy);
        return { shift, shifted };
      })
      .find((entry) => boxWithinArea(expanded(entry.shifted.renderBounds, 8), area));

    if (!candidate) break;
    current = candidate.shifted;
    moved = true;
  }

  return { beat: current, moved, before, after: current.renderBounds };
}

function repairCompiledSceneBeats(
  sceneId: string,
  beats: CompiledBeat[],
  options: RenderOptions,
  diagnostics: LayoutDiagnostic[],
): CompiledBeat[] {
  const area = richSafeArea(options);
  const repaired: CompiledBeat[] = [];

  for (const beat of beats) {
    let current = beat;
    const safeRepair = repairCompiledBeatSafeArea(current, area);
    current = safeRepair.beat;
    if (safeRepair.moved) {
      diagnostics.push({
        severity: "warning",
        code: "beat_visual_out_of_bounds_repaired",
        message: "Moved beat visual back inside the safe render area.",
        sceneId,
        beatId: beat.id,
        before: safeRepair.before,
        after: safeRepair.after,
      });
    }

    const collisionRepair = repairCompiledBeatCollision(current, repaired, area);
    current = collisionRepair.beat;
    if (collisionRepair.moved) {
      diagnostics.push({
        severity: "warning",
        code: "beat_visual_collision_repaired",
        message: "Moved beat visual to reduce overlap with an earlier beat visual.",
        sceneId,
        beatId: beat.id,
        before: collisionRepair.before,
        after: collisionRepair.after,
      });
    }

    repaired.push(current);
  }

  return repaired;
}

function resolveRichElementLayouts(
  storyboard: Storyboard,
  _options: RenderOptions,
): { storyboard: Storyboard; diagnostics: LayoutDiagnostic[] } {
  // Rich scene-graph elements live in a local design canvas. The renderer applies
  // one scene-level fit transform, so mutating individual icons here breaks their
  // routed connectors and separates value labels from their icons.
  return { storyboard, diagnostics: [] };
}

function fitBoxIntoSafeArea(box: Box, lines: string[], options: RenderOptions): Box {
  const bottomSafe = options.height - BOTTOM_SAFE_MARGIN;
  let adjusted = { ...box };
  let bounds = renderedBounds(adjusted, lines);
  if (bounds.y < TITLE_SAFE_BOTTOM) {
    adjusted.y += TITLE_SAFE_BOTTOM - bounds.y;
  }
  bounds = renderedBounds(adjusted, lines);
  if (bounds.y + bounds.height > bottomSafe) {
    adjusted.y -= bounds.y + bounds.height - bottomSafe;
  }
  return adjusted;
}

function visualSize(beat: FlatBeat, scale = 1): { width: number; height: number } {
  const isSquare = beat.visual.shape === "square";
  return {
    width: Math.round((isSquare ? 212 : 278) * scale),
    height: Math.round((isSquare ? 212 : 196) * scale),
  };
}

function boxAt(beat: FlatBeat, centerX: number, centerY: number, scale = 1): Box {
  const { width, height } = visualSize(beat, scale);
  const x = centerX - width / 2;
  const y = centerY - height / 2;
  return { x, y, width, height };
}

type LayoutSlot = {
  x: number;
  y: number;
  scale?: number;
};

function baseSlots(options: RenderOptions): Record<string, LayoutSlot> {
  const center = options.width / 2;
  const left = SAFE_X + 238;
  const right = options.width - SAFE_X - 238;
  const midLeft = SAFE_X + 312;
  const midRight = options.width - SAFE_X - 312;
  return {
    left: { x: left, y: 365 },
    center: { x: center, y: 365 },
    right: { x: right, y: 365 },
    top: { x: center, y: 245, scale: 0.94 },
    bottom: { x: center, y: 485, scale: 0.84 },
    leftTop: { x: midLeft, y: 275, scale: 0.92 },
    rightTop: { x: midRight, y: 275, scale: 0.92 },
    leftMid: { x: midLeft, y: 420, scale: 0.96 },
    rightMid: { x: midRight, y: 420, scale: 0.96 },
    leftBottom: { x: midLeft, y: 485, scale: 0.84 },
    rightBottom: { x: midRight, y: 485, scale: 0.84 },
    stackTop: { x: center - 260, y: 235, scale: 0.82 },
    stackMiddle: { x: center, y: 360, scale: 0.86 },
    stackBottom: { x: center + 260, y: 485, scale: 0.82 },
    scatterOne: { x: SAFE_X + 292, y: 270, scale: 0.9 },
    scatterTwo: { x: options.width - SAFE_X - 300, y: 345, scale: 0.9 },
    scatterThree: { x: center - 80, y: 485, scale: 0.84 },
  };
}

function compositionSlots(composition: SceneComposition, options: RenderOptions): LayoutSlot[] {
  const slots = baseSlots(options);
  switch (composition) {
    case "hub":
      return [
        { x: options.width / 2, y: 300, scale: 1.02 },
        { x: SAFE_X + 250, y: 425, scale: 0.92 },
        { x: options.width - SAFE_X - 250, y: 425, scale: 0.92 },
      ];
    case "branch":
      return [slots.left, { ...slots.rightTop, y: 235, scale: 0.86 }, slots.rightBottom];
    case "cycle":
      return [slots.top, slots.rightMid, slots.leftMid];
    case "compare":
      return [slots.leftTop, slots.rightTop, slots.bottom];
    case "balance":
      return [slots.leftMid, { x: options.width / 2, y: 250, scale: 0.88 }, slots.rightMid];
    case "stack":
      return [slots.stackTop, slots.stackMiddle, slots.stackBottom];
    case "scatter":
      return [slots.scatterOne, slots.scatterTwo, slots.scatterThree];
    case "equation":
      return [
        { x: SAFE_X + 222, y: 365 },
        slots.center,
        { x: options.width - SAFE_X - 222, y: 365 },
      ];
    case "flow":
    default:
      return [slots.left, slots.center, slots.right];
  }
}

function fallbackGridSlots(count: number, options: RenderOptions): LayoutSlot[] {
  const cols = Math.min(3, Math.max(1, count));
  const rows = Math.ceil(count / cols);
  const xGap = (options.width - SAFE_X * 2) / cols;
  const yTop = rows > 1 ? 245 : 365;
  const yGap = rows > 1 ? 225 : 0;
  return Array.from({ length: count }, (_, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    return {
      x: SAFE_X + xGap * col + xGap / 2,
      y: yTop + row * yGap,
      scale: rows > 1 ? 0.82 : 1,
    };
  });
}

function layoutSceneBeats(
  composition: SceneComposition,
  beats: FlatBeat[],
  options: RenderOptions,
): Box[] {
  const template = compositionSlots(composition, options);
  const slots = beats.length <= template.length ? template : fallbackGridSlots(beats.length, options);
  return beats.map((beat, index) => {
    const slot = slots[index] ?? slots.at(-1) ?? { x: options.width / 2, y: 365 };
    return boxAt(beat, slot.x, slot.y, slot.scale ?? 1);
  });
}

function toTimelineBox(box: Box): TimelineBox {
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
  };
}

function resolvedElementFromRichElement(
  element: VisualElement,
  beat: CompiledBeat,
  scene: CompiledScene,
  z: number,
): ResolvedTimelineElement {
  const bounds = richElementBounds(element) ?? elementBox(element);
  const x2 = element.x2 ?? element.x + 100;
  const y2 = element.y2 ?? element.y;
  const isLine = element.type === "arrow" || element.type === "line";
  return {
    id: element.id,
    kind: element.type,
    assetKey: element.assetKey,
    text: element.text,
    label: element.label,
    box: toTimelineBox(isLine ? bounds : elementBox(element)),
    line: isLine
      ? {
          x1: element.x,
          y1: element.y,
          x2,
          y2,
        }
      : undefined,
    fill: element.fill,
    fontSize: element.fontSize,
    start: beat.start + (element.delay ?? 0),
    end: scene.end,
    z,
    sourceBeatId: beat.id,
  };
}

function resolvedElementFromBeatVisual(
  beat: CompiledBeat,
  scene: CompiledScene,
  z: number,
): ResolvedTimelineElement {
  return {
    id: `el_primary_${beat.id.replace(/^beat_/, "")}`,
    kind: "asset",
    assetKey: beat.visual.assetKey,
    label: beat.visual.label,
    box: toTimelineBox(beat.box),
    fill: beat.visual.fill,
    start: beat.start,
    end: scene.end,
    z,
    sourceBeatId: beat.id,
  };
}

function buildResolvedTimeline(
  input: {
    width: number;
    height: number;
    fps: number;
    duration: number;
    title: string;
    scenes: CompiledScene[];
  },
  diagnostics: LayoutDiagnostic[],
): ResolvedTimeline {
  return {
    version: 1,
    width: input.width,
    height: input.height,
    fps: input.fps,
    duration: input.duration,
    title: input.title,
    diagnostics,
    scenes: input.scenes.map((scene) => {
      const richMode = scene.beats.some((beat) => (beat.elements?.length ?? 0) > 0);
      return {
        id: scene.id,
        title: scene.title,
        composition: scene.composition,
        start: scene.start,
        end: scene.end,
        diagnostics: diagnostics.filter((diagnostic) => diagnostic.sceneId === scene.id),
        beats: scene.beats.map((beat) => ({
          id: beat.id,
          narration: beat.narration,
          start: beat.start,
          end: beat.end,
          elements: richMode
            ? (beat.elements ?? []).map((element, index) =>
                resolvedElementFromRichElement(element, beat, scene, beat.beatIndex * 100 + index),
              )
            : [resolvedElementFromBeatVisual(beat, scene, beat.beatIndex * 100)],
        })),
      };
    }),
  };
}

export function compileVideo(
  storyboard: Storyboard,
  timepoints: Timepoint[],
  audioDurationSeconds: number,
  options: RenderOptions,
): CompiledVideo {
  const resolvedLayout = resolveRichElementLayouts(storyboard, options);
  const resolvedStoryboard = resolvedLayout.storyboard;
  const pointMap = new Map(timepoints.map((point) => [point.markName, point.timeSeconds]));
  const flat = flattenBeats(resolvedStoryboard);
  const boxesByBeatId = new Map<string, Box>();
  for (const scene of resolvedStoryboard.scenes) {
    const sceneBeats = flat.filter((beat) => beat.sceneId === scene.id);
    const boxes = layoutSceneBeats(scene.composition, sceneBeats, options);
    sceneBeats.forEach((beat, index) => boxesByBeatId.set(beat.id, boxes[index]));
  }

  let compiledBeats: CompiledBeat[] = flat.map((beat, index) => {
    const start = pointMap.get(beat.id) ?? (index / Math.max(1, flat.length)) * audioDurationSeconds;
    const next = flat[index + 1];
    const end =
      next !== undefined
        ? pointMap.get(next.id) ?? Math.min(audioDurationSeconds, start + 4)
        : audioDurationSeconds;
    const initialBox = boxesByBeatId.get(beat.id) ?? boxAt(beat, options.width / 2, 365);
    const labelLines = wrapLabel(beat.visual.label, Math.max(8, Math.floor(initialBox.width / 16)));
    const box = fitBoxIntoSafeArea(initialBox, labelLines, options);
    // Resolve each element's reveal step to an absolute offset from its narration
    // mark, so sub-elements appear in time with the words instead of a fixed stagger.
    const elements = beat.elements?.map((element) => {
      const step = element.revealStep ?? 0;
      if (step <= 0) return element;
      const stepTime = pointMap.get(`${beat.id}__r${step}`);
      if (stepTime === undefined) return element;
      return { ...element, delay: Math.max(0, stepTime - start) + (element.delay ?? 0) };
    });
    return {
      ...beat,
      elements,
      start,
      end: Math.max(start + 1.4, end),
      box,
      renderBounds: renderedBounds(box, labelLines),
      labelLines,
    };
  });

  for (const scene of resolvedStoryboard.scenes) {
    const sceneBeats = compiledBeats.filter((beat) => beat.sceneId === scene.id);
    if (!sceneBeats.some((beat) => (beat.elements?.length ?? 0) > 0)) {
      const repaired = repairCompiledSceneBeats(scene.id, sceneBeats, options, resolvedLayout.diagnostics);
      const repairedById = new Map(repaired.map((beat) => [beat.id, beat]));
      compiledBeats = compiledBeats.map((beat) => repairedById.get(beat.id) ?? beat);
    }
  }

  for (const scene of resolvedStoryboard.scenes) {
    const sceneBeats = compiledBeats.filter((beat) => beat.sceneId === scene.id);
    if (sceneBeats.some((beat) => (beat.elements?.length ?? 0) > 0)) {
      const sceneDiagnostics = resolvedLayout.diagnostics.filter((diagnostic) => diagnostic.sceneId === scene.id);
      if (sceneDiagnostics.some((diagnostic) => diagnostic.severity === "error")) {
        throw new Error(`Rich layout validation failed in ${scene.id}`);
      }
      continue;
    }
    const boxes = sceneBeats
      .map((beat) => expanded(beat.renderBounds, 8));
    for (let i = 0; i < boxes.length; i += 1) {
      const box = boxes[i];
      const bottomSafe = options.height - BOTTOM_SAFE_MARGIN;
      if (
        box.x < SAFE_X ||
        box.x + box.width > options.width - SAFE_X ||
        box.y < TITLE_SAFE_BOTTOM ||
        box.y + box.height > bottomSafe
      ) {
        resolvedLayout.diagnostics.push({
          severity: "error",
          code: "beat_visual_safe_area_violation",
          message: `Beat visual ${i + 1} still violates the safe render area after repair.`,
          sceneId: scene.id,
          beatId: sceneBeats[i]?.id,
          after: box,
        });
      }
      for (let j = i + 1; j < boxes.length; j += 1) {
        if (boxesOverlap(boxes[i], boxes[j])) {
          resolvedLayout.diagnostics.push({
            severity: "error",
            code: "beat_visual_collision",
            message: `Beat visual ${i + 1} still overlaps visual ${j + 1} after repair.`,
            sceneId: scene.id,
            beatId: sceneBeats[i]?.id,
            after: boxes[i],
          });
        }
      }
    }
  }

  const scenes: CompiledScene[] = resolvedStoryboard.scenes.map((scene) => {
    const beats = compiledBeats.filter((beat) => beat.sceneId === scene.id);
    const start = beats[0]?.start ?? 0;
    const end = beats.at(-1)?.end ?? start + 1;
    return {
      id: scene.id,
      title: scene.title.toUpperCase(),
      composition: scene.composition,
      start,
      end,
      beats,
    };
  });

  const duration = Math.max(audioDurationSeconds, resolvedStoryboard.durationSeconds);
  const timeline = buildResolvedTimeline(
    {
      width: options.width,
      height: options.height,
      fps: options.fps,
      duration,
      title: resolvedStoryboard.title,
      scenes,
    },
    resolvedLayout.diagnostics,
  );

  return {
    width: options.width,
    height: options.height,
    fps: options.fps,
    duration,
    title: resolvedStoryboard.title,
    background: options.background ?? "plain",
    scenes,
    beats: compiledBeats,
    timeline,
    layoutDiagnostics: resolvedLayout.diagnostics,
  };
}

export function currentSceneAt(compiled: CompiledVideo, time: number): CompiledScene {
  return (
    compiled.scenes.find((scene) => time >= scene.start && time < scene.end) ??
    compiled.scenes.filter((scene) => time >= scene.start).at(-1) ??
    compiled.scenes[0]
  );
}

export function currentBeatAt(scene: CompiledScene, time: number): CompiledBeat {
  return (
    scene.beats.find((beat) => time >= beat.start && time < beat.end) ??
    scene.beats.filter((beat) => beat.start <= time).at(-1) ??
    scene.beats[0]
  );
}

export const layoutConstants = {
  safeX: SAFE_X,
  titleY: TITLE_Y,
  visualY: VISUAL_Y,
  titleSafeBottom: TITLE_SAFE_BOTTOM,
  bottomSafeMargin: BOTTOM_SAFE_MARGIN,
  labelFontSize: LABEL_FONT_SIZE,
  labelLineHeight: LABEL_LINE_HEIGHT,
  labelGap: LABEL_GAP,
};
