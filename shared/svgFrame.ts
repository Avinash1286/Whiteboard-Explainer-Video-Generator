import type { Box, CompiledBeat, CompiledScene, CompiledVideo } from "./layout";
import { currentSceneAt } from "./layout";
import type { VisualElement } from "./storyboard";
import { renderSvgAsset } from "./svgAssets";
import { resolveSceneIcons } from "./iconResolver";
import { renderOpenMojiEntry, type OpenMojiAssetResolution } from "./openMojiAssets";
import { renderGeneratedSvgAsset } from "./generatedSvgAssets";

type IconMap = Map<string, OpenMojiAssetResolution | null>;

const DRAW_FONT = "'Patrick Hand', 'Comic Sans MS', cursive, sans-serif";
const LABEL_FONT_SIZE = 28;
const LABEL_LINE_HEIGHT = 31;
const LABEL_GAP = 28;

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function easeOut(value: number): number {
  const t = clamp(value);
  return 1 - Math.pow(1 - t, 3);
}

function textLines(
  lines: string[],
  x: number,
  y: number,
  fontSize: number,
  lineHeight: number,
  attrs = "",
): string {
  const tspans = lines
    .map((line, index) => `<tspan x="${x}" y="${y + index * lineHeight}">${esc(line)}</tspan>`)
    .join("");
  const stroke = (fontSize * 0.05).toFixed(2);
  return `<text font-family="${DRAW_FONT}" font-size="${fontSize}" font-weight="900" letter-spacing="0.5" text-anchor="middle" fill="#121212" stroke="#121212" stroke-width="${stroke}" paint-order="stroke" stroke-linejoin="round" ${attrs}>${tspans}</text>`;
}

function boxCenter(box: Box): { x: number; y: number } {
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

function iconFootprint(box: Box): Box {
  const size = Math.min(box.width, box.height);
  return {
    x: box.x + (box.width - size) / 2,
    y: box.y + (box.height - size) / 2,
    width: size,
    height: size,
  };
}

function edgePoint(box: Box, toward: { x: number; y: number }, pad = 20): { x: number; y: number } {
  const center = boxCenter(box);
  const dx = toward.x - center.x || 0.001;
  const dy = toward.y - center.y || 0.001;
  const sx = (box.width / 2 + pad) / Math.abs(dx);
  const sy = (box.height / 2 + pad) / Math.abs(dy);
  const scale = Math.min(sx, sy);
  return {
    x: center.x + dx * scale,
    y: center.y + dy * scale,
  };
}

function connector(
  from: Box,
  to: Box,
  progress: number,
  style: "arrow" | "line" | "dashed" = "arrow",
): string {
  const drawProgress = clamp((progress - 0.08) / 0.92);
  if (drawProgress <= 0) return "";
  const fromIcon = iconFootprint(from);
  const toIcon = iconFootprint(to);
  const fromCenter = boxCenter(fromIcon);
  const toCenter = boxCenter(toIcon);
  const start = edgePoint(fromIcon, toCenter, 18);
  const end = edgePoint(toIcon, fromCenter, 18);
  const visibleProgress = easeOut(drawProgress);
  const visibleEndX = start.x + (end.x - start.x) * visibleProgress;
  const visibleEndY = start.y + (end.y - start.y) * visibleProgress;
  const angle = (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI;
  const headVisible = style === "arrow" ? clamp((drawProgress - 0.84) / 0.16) : 0;
  const dash = style === "dashed" ? `stroke-dasharray="10 12"` : "";
  return `
    <line x1="${start.x}" y1="${start.y}" x2="${visibleEndX}" y2="${visibleEndY}" stroke="#111" stroke-width="5.4" stroke-linecap="round" ${dash} />
    <g opacity="${headVisible}">
      <path d="M -14 -12 L 6 0 L -14 12" transform="translate(${end.x} ${end.y}) rotate(${angle})" fill="none" stroke="#111" stroke-width="5.4" stroke-linecap="round" stroke-linejoin="round" />
    </g>`;
}

function sceneConnectors(scene: CompiledScene, time: number): string {
  const beats = scene.beats;
  const connect = (
    fromIndex: number,
    toIndex: number,
    style: "arrow" | "line" | "dashed" = "arrow",
    delay = 0,
  ): string => {
    const from = beats[fromIndex];
    const to = beats[toIndex];
    if (!from || !to || time < from.start) return "";
    const triggerTime = toIndex <= fromIndex ? from.start + delay : to.start + delay;
    if (time < triggerTime) return "";
    return connector(from.box, to.box, clamp((time - triggerTime) / 0.52), style);
  };

  if (beats.length < 2) return "";

  switch (scene.composition) {
    case "hub":
      return "";
    case "branch":
      return [connect(0, 1), connect(0, 2)].join("");
    case "cycle":
      return [connect(0, 1), connect(1, 2), connect(2, 0, "arrow", 0.3)].join("");
    case "compare":
      return [connect(0, 2, "line"), connect(1, 2, "line")].join("");
    case "scatter":
      return [connect(0, 1, "dashed"), connect(1, 2, "dashed")].join("");
    case "equation":
      return "";
    case "flow":
    case "balance":
    case "stack":
    default:
      return beats
        .slice(1)
        .map((_, index) => connect(index, index + 1))
        .join("");
  }
}

function compositionBackdrop(scene: CompiledScene, time: number, width: number): string {
  const opacity = clamp((time - scene.start) / 0.45) * 0.78;
  const centerX = width / 2;
  const beatOne = scene.beats[0];
  const beatTwo = scene.beats[1];
  const beatThree = scene.beats[2];

  switch (scene.composition) {
    case "compare":
      return `
        <line x1="${centerX}" y1="178" x2="${centerX}" y2="548" stroke="#e0e5e8" stroke-width="3" stroke-dasharray="12 14" opacity="${opacity}" />
        <text x="${centerX}" y="295" font-family="${DRAW_FONT}" font-size="38" font-weight="900" text-anchor="middle" fill="#202124" opacity="${opacity * 0.55}">VS</text>`;
    case "balance":
      return `
        <g opacity="${opacity * 0.5}" stroke="#111" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" fill="none">
          <path d="M ${centerX} 318 V 535 M ${centerX - 310} 405 H ${centerX + 310}" />
          <path d="M ${centerX - 250} 405 L ${centerX - 295} 480 H ${centerX - 205} Z" />
          <path d="M ${centerX + 250} 405 L ${centerX + 205} 480 H ${centerX + 295} Z" />
        </g>`;
    case "cycle":
      return `
        <path d="M ${centerX - 255} 404 C ${centerX - 205} 178 ${centerX + 205} 178 ${centerX + 255} 404 C ${centerX + 210} 565 ${centerX - 210} 565 ${centerX - 255} 404 Z" fill="none" stroke="#e7ddd1" stroke-width="5" stroke-linecap="round" stroke-dasharray="14 16" opacity="${opacity * 0.62}" />`;
    case "hub":
      if (!beatOne) return "";
      return `
        <circle cx="${boxCenter(beatOne.box).x}" cy="${boxCenter(beatOne.box).y}" r="${Math.max(beatOne.box.width, beatOne.box.height) / 2 + 34}" fill="none" stroke="#e7ebef" stroke-width="5" opacity="${opacity}" />`;
    case "stack":
      if (!beatOne || !beatThree) return "";
      return `
        <path d="M ${boxCenter(beatOne.box).x - 72} ${boxCenter(beatOne.box).y + 88} C ${centerX - 10} 340 ${boxCenter(beatThree.box).x + 74} ${boxCenter(beatThree.box).y - 88} ${boxCenter(beatThree.box).x + 95} ${boxCenter(beatThree.box).y - 58}" fill="none" stroke="#e2e8ee" stroke-width="12" stroke-linecap="round" opacity="${opacity * 0.82}" />`;
    case "scatter":
      return `
        <g opacity="${opacity * 0.4}" fill="#111">
          <circle cx="${centerX - 165}" cy="300" r="5" />
          <circle cx="${centerX + 200}" cy="250" r="4" />
          <circle cx="${centerX + 85}" cy="488" r="6" />
          <circle cx="${centerX - 295}" cy="456" r="4" />
        </g>`;
    case "equation":
      if (!beatOne || !beatTwo || !beatThree) return "";
      return `
        <g font-family="${DRAW_FONT}" font-weight="900" text-anchor="middle" fill="#111">
          <text x="${(boxCenter(beatOne.box).x + boxCenter(beatTwo.box).x) / 2}" y="382" font-size="52" opacity="${time >= beatTwo.start ? opacity : 0}">+</text>
          <text x="${(boxCenter(beatTwo.box).x + boxCenter(beatThree.box).x) / 2}" y="382" font-size="52" opacity="${time >= beatThree.start ? opacity : 0}">=</text>
        </g>`;
    case "branch":
    case "flow":
    default:
      return "";
  }
}

function assetVisual(beat: CompiledBeat, time: number, seed: number): string {
  const { box } = beat;
  const revealDelay = beat.beatIndex === 0 ? 0 : 0.18;
  const local = time - beat.start - revealDelay;
  const outlineProgress = easeOut(local / 0.35);
  const fillProgress = easeOut((local - 0.25) / 0.55);
  const labelOpacity = clamp((local - 0.65) / 0.25);
  const fill = beat.visual.fill ?? "#a7c7ff";
  const clipId = `asset_clip_${beat.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const labelCenterX = box.x + box.width / 2;
  const labelCenterY = box.y + box.height + LABEL_GAP - (beat.labelLines.length - 1) * (LABEL_LINE_HEIGHT / 2);
  const center = boxCenter(box);
  const pop = 0.965 + easeOut(local / 0.42) * 0.035;
  const haloOpacity = local > 0 ? clamp((0.7 - Math.abs(local - 0.35)) / 0.7) * 0.16 : 0;

  return `
    <g transform="translate(${center.x} ${center.y}) scale(${pop}) translate(${-center.x} ${-center.y})">
      <rect x="${box.x - 14}" y="${box.y - 14}" width="${box.width + 28}" height="${box.height + 28}" rx="28" fill="${fill}" opacity="${haloOpacity}" />
      ${renderSvgAsset({
        key: beat.visual.assetKey,
        label: beat.visual.label,
        box,
        color: fill,
        progress: fillProgress,
        opacity: outlineProgress,
        seed,
        clipId,
      })}
    </g>
    ${textLines(beat.labelLines, labelCenterX, labelCenterY, LABEL_FONT_SIZE, LABEL_LINE_HEIGHT, `opacity="${labelOpacity}"`)}
  `;
}

function elementBox(element: VisualElement): Box {
  return {
    x: element.x,
    y: element.y,
    width: element.width ?? 120,
    height: element.height ?? 120,
  };
}

function unionMany(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  return boxes.slice(1).reduce((acc, box) => {
    const x1 = Math.min(acc.x, box.x);
    const y1 = Math.min(acc.y, box.y);
    const x2 = Math.max(acc.x + acc.width, box.x + box.width);
    const y2 = Math.max(acc.y + acc.height, box.y + box.height);
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  }, boxes[0]);
}

function elementTextLines(text: string): string[] {
  return text
    .split(/\n|\|/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function richAssetLabelFontSize(element: VisualElement, width: number): number {
  return element.fontSize ?? Math.max(28, Math.min(36, Math.round(width * 0.19)));
}

function estimatedTextBox(lines: string[], x: number, y: number, fontSize: number): Box {
  const maxChars = Math.max(1, ...lines.map((line) => line.length));
  const width = Math.min(480, Math.max(54, maxChars * fontSize * 0.64));
  const height = fontSize + Math.max(0, lines.length - 1) * fontSize * 1.05 + 8;
  return {
    x: x - width / 2,
    y: y - fontSize,
    width,
    height,
  };
}

function richElementBounds(element: VisualElement): Box {
  if (element.type === "arrow" || element.type === "line") {
    const x2 = element.x2 ?? element.x + 100;
    const y2 = element.y2 ?? element.y;
    return {
      x: Math.min(element.x, x2) - 24,
      y: Math.min(element.y, y2) - 24,
      width: Math.abs(x2 - element.x) + 48,
      height: Math.abs(y2 - element.y) + 48,
    };
  }

  if (element.type === "text") {
    const lines = elementTextLines(element.text ?? element.label ?? "");
    const fontSize = Math.max(28, element.fontSize ?? 28);
    const baselineY = element.y - ((lines.length - 1) * fontSize * 0.58);
    return estimatedTextBox(
      lines,
      element.x,
      baselineY,
      fontSize,
    );
  }

  const box = elementBox(element);
  const label = element.label ? elementTextLines(element.label.toUpperCase()) : [];
  if (!label.length) return box;

  const labelFontSize =
    element.type === "logo" ? Math.max(22, element.fontSize ?? 22) : richAssetLabelFontSize(element, box.width);
  const labelBaselineY =
    box.y +
    box.height +
    (element.type === "logo" ? 26 : 30) -
    (label.length - 1) * (labelFontSize * (element.type === "logo" ? 0.5 : 0.45));
  const labelBox = estimatedTextBox(
    label,
    box.x + box.width / 2,
    labelBaselineY,
    labelFontSize,
  );
  return unionMany([box, labelBox]) ?? box;
}

function richSceneBounds(beats: CompiledBeat[]): Box | null {
  return unionMany(
    beats.flatMap((beat) => (beat.elements ?? []).map((element) => richElementBounds(element))),
  );
}

function richSceneTransform(bounds: Box | null, compiled: CompiledVideo): string {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return "";

  const target = {
    x: 96,
    // Start clearly BELOW the title so no scene crowds the heading.
    y: 232,
    width: compiled.width - 192,
    height: compiled.height - 304,
  };
  // Fit the scene's bounding box to the frame, but in a TIGHT zoom band so icons
  // stay a consistent (big) size across scenes — no wild over-zoom on a sparse
  // scene that then makes the next scene's icons look tiny by comparison.
  const scale = Math.min(
    1.5,
    Math.max(0.85, Math.min(target.width / bounds.width, target.height / bounds.height)),
  );
  const targetCx = target.x + target.width / 2;
  const targetCy = target.y + target.height / 2;
  const sourceCx = bounds.x + bounds.width / 2;
  const sourceCy = bounds.y + bounds.height / 2;

  return `translate(${targetCx} ${targetCy}) scale(${scale}) translate(${-sourceCx} ${-sourceCy})`;
}

function richArrow(element: VisualElement, progress: number): string {
  const x2 = element.x2 ?? element.x + 100;
  const y2 = element.y2 ?? element.y;
  const draw = easeOut(progress);
  const visibleX = element.x + (x2 - element.x) * draw;
  const visibleY = element.y + (y2 - element.y) * draw;
  const angle = (Math.atan2(y2 - element.y, x2 - element.x) * 180) / Math.PI;
  const head = element.type === "arrow" ? clamp((draw - 0.78) / 0.22) : 0;
  const sw = element.strokeWidth ?? 6.4;
  return `
    <line x1="${element.x}" y1="${element.y}" x2="${visibleX}" y2="${visibleY}" stroke="#111" stroke-width="${sw}" stroke-linecap="round" />
    <g opacity="${head}">
      <path d="M -16 -13 L 7 0 L -16 13" transform="translate(${x2} ${y2}) rotate(${angle})" fill="none" stroke="#111" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" />
    </g>`;
}

function richNode(element: VisualElement, beat: CompiledBeat, time: number): string {
  const box = elementBox(element);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const r = box.width / 2;
  const local = time - beat.start - (element.delay ?? 0);
  if (local <= 0) return "";
  const p = easeOut(clamp(local / 0.4));
  const opacity = clamp(local / 0.2);
  const fill = element.fill ?? "#a7c7ff";
  const scale = 0.55 + 0.45 * p;
  const sw = Math.max(2.6, r * 0.16);
  return `<g transform="translate(${cx} ${cy}) scale(${scale})" opacity="${opacity}"><circle r="${r}" fill="${fill}" stroke="#111" stroke-width="${sw.toFixed(1)}"/></g>`;
}

function richText(element: VisualElement, opacity: number): string {
  const fontSize = Math.max(28, element.fontSize ?? 28);
  const lines = elementTextLines(element.text ?? element.label ?? "");
  const y = element.y - ((lines.length - 1) * fontSize * 0.58);
  return textLines(lines, element.x, y, fontSize, fontSize * 1.05, `opacity="${opacity}"`);
}

function logoCard(element: VisualElement, progress: number, opacity: number): string {
  const box = elementBox(element);
  const fill = element.fill ?? "#fdfcf7";
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const scale = 0.96 + progress * 0.04;
  const markWidth = Math.min(58, box.width - 18);
  const text = element.text ?? element.label ?? "LOGO";
  const lines = elementTextLines(text);
  const fontSize = Math.max(22, element.fontSize ?? 22);
  return `
    <g opacity="${opacity}" transform="translate(${centerX} ${centerY}) scale(${scale}) translate(${-centerX} ${-centerY})">
      <rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="5" fill="#fff" stroke="#111" stroke-width="4.2" filter="url(#softShadow)" />
      <rect x="${box.x + 12}" y="${box.y + 12}" width="${markWidth}" height="${Math.min(34, box.height - 24)}" rx="4" fill="${fill}" stroke="#111" stroke-width="2.8" opacity="0.92" />
      ${textLines(lines, centerX, box.y + box.height + 26, fontSize, fontSize * 1.08, "")}
    </g>`;
}

function richAsset(
  element: VisualElement,
  beat: CompiledBeat,
  time: number,
  progress: number,
  opacity: number,
  iconMap?: IconMap,
): string {
  const box = elementBox(element);
  const fill = element.fill ?? "#a7c7ff";
  const clipId = `rich_clip_${beat.id}_${element.id}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  const center = boxCenter(box);
  const scale = 0.965 + progress * 0.035;
  const label = element.label ? elementTextLines(element.label.toUpperCase()) : [];
  // Bigger, bolder captions (Lamina-scale). Scale with the icon a little so a big
  // hero gets a proportionally bigger label.
  const fontSize = richAssetLabelFontSize(element, box.width);
  // First line's baseline sits a clear gap BELOW the icon; extra lines stack
  // downward (textLines draws top-down). Never shift up into the icon.
  const labelY = box.y + box.height + fontSize * 0.55 + 14;
  const seed = beat.sceneIndex * 97 + beat.beatIndex * 31 + element.id.length;
  // Slow, dedicated draw progress (~1s) so the outline-then-fill reveal is visible,
  // and hold the caption back until the icon is mostly drawn (as Lamina does).
  const drawLocal = time - beat.start - (element.delay ?? 0);
  // Steady (near-linear) draw so the outline reads as a deliberate pen-stroke
  // before the colour floods in, then bring the caption in just behind it. Kept
  // snappy (~0.8s) so sparse scenes don't sit half-drawn under a lone title.
  const drawProgress = clamp(drawLocal / 0.82);
  const labelOpacity = clamp((drawLocal - 0.55) / 0.26);
  // Prefer the scene-resolved (de-duplicated, synonym-matched) OpenMoji icon;
  // fall back to the generated-SVG path only when nothing matched.
  const resolved = iconMap?.get(element.id) ?? null;
  const icon = resolved
    ? renderOpenMojiEntry(resolved, { box, progress: drawProgress, opacity, seed, clipId })
    : renderGeneratedSvgAsset({ key: element.assetKey ?? "generic", label: element.label, box, progress: drawProgress, opacity, seed, clipId });
  return `
    <g transform="translate(${center.x} ${center.y}) scale(${scale}) translate(${-center.x} ${-center.y})">
      ${icon}
    </g>
    ${label.length ? textLines(label, center.x, labelY, fontSize, fontSize * 1.08, `opacity="${labelOpacity}"`) : ""}`;
}

function richElement(beat: CompiledBeat, element: VisualElement, time: number, iconMap?: IconMap): string {
  const connectorDelay = element.type === "arrow" || element.type === "line" ? 0.16 : 0;
  const local = time - beat.start - (element.delay ?? 0) - connectorDelay;
  if (local <= 0) return "";
  const progress = easeOut(local / 0.42);
  const opacity = clamp(local / 0.24);

  switch (element.type) {
    case "asset":
      return richAsset(element, beat, time, progress, opacity, iconMap);
    case "logo":
      return logoCard(element, progress, opacity);
    case "text":
      return richText(element, opacity);
    case "line":
    case "arrow":
      return richArrow(element, clamp(local / 0.48));
    case "node":
      return richNode(element, beat, time);
    default:
      return "";
  }
}

function richBeatElements(beat: CompiledBeat, time: number, iconMap?: IconMap): string {
  return (beat.elements ?? [])
    .map((element) => richElement(beat, element, time, iconMap))
    .join("");
}

function hasRichElements(scene: CompiledScene): boolean {
  return scene.beats.some((beat) => (beat.elements?.length ?? 0) > 0);
}

function frameChrome(_compiled: CompiledVideo, _s: number): string {
  // Watermarks removed (top-left "Case Study Compiler" mark + footer
  // "Generated locally by finalwhite"). The top and footer bands are left
  // intentionally blank — the title and scene content keep their own fixed
  // positions, so nothing reflows.
  return "";
}

// The scene heading WRITES IN (left-to-right wipe + fade + small settle) at the
// start of each scene, so a new concept feels like it's being introduced rather
// than the title instantly swapping.
function renderTitle(scene: CompiledScene, compiled: CompiledVideo, time: number, s: number): string {
  const t = time - scene.start;
  const reveal = easeOut(clamp(t / 0.6));
  const opacity = clamp(t / 0.4).toFixed(2);
  const wipeW = (compiled.width * reveal).toFixed(1);
  const dy = ((1 - reveal) * -12).toFixed(1);
  const id = `title_${scene.id}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  const fs = 64 * s;
  return `
    <defs><clipPath id="${id}"><rect x="0" y="0" width="${wipeW}" height="${compiled.height}"/></clipPath></defs>
    <g clip-path="url(#${id})" opacity="${opacity}" transform="translate(0 ${dy})">
      <text x="${compiled.width / 2}" y="${104 * s}" font-family="${DRAW_FONT}" font-size="${fs}" font-weight="900" text-anchor="middle" letter-spacing="${(2 * s).toFixed(1)}" fill="#111" stroke="#111" stroke-width="${(fs * 0.05).toFixed(2)}" paint-order="stroke" stroke-linejoin="round">${esc(scene.title)}</text>
    </g>`;
}

export function renderFrameSvg(compiled: CompiledVideo, time: number): string {
  const scene = currentSceneAt(compiled, time);
  const richMode = hasRichElements(scene);
  const visibleBeats = scene.beats.filter((beat) => time >= beat.start);
  const s = compiled.height / 720;

  const backdrop = richMode ? "" : compositionBackdrop(scene, time, compiled.width);
  const arrows = richMode ? "" : sceneConnectors(scene, time);

  const richTransform = richMode ? richSceneTransform(richSceneBounds(scene.beats), compiled) : "";
  const iconMap = richMode ? resolveSceneIcons(scene.beats.flatMap((beat) => beat.elements ?? [])) : undefined;
  const assets = richMode
    ? `<g transform="${richTransform}">${visibleBeats.map((beat) => richBeatElements(beat, time, iconMap)).join("")}</g>`
    : visibleBeats
        .map((beat, index) => assetVisual(beat, time, beat.sceneIndex * 17 + beat.beatIndex * 31 + index))
        .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="${compiled.width}" height="${compiled.height}" viewBox="0 0 ${compiled.width} ${compiled.height}">
    <defs>
      <filter id="softShadow" x="-15%" y="-15%" width="130%" height="130%">
        <feDropShadow dx="0" dy="3" stdDeviation="2.2" flood-color="#1d2939" flood-opacity="0.12"/>
      </filter>
      <pattern id="bgGrid" width="${Math.round(54 * s)}" height="${Math.round(54 * s)}" patternUnits="userSpaceOnUse">
        <path d="M ${Math.round(54 * s)} 0 L 0 0 0 ${Math.round(54 * s)}" fill="none" stroke="#d7dce2" stroke-width="${(1.4 * s).toFixed(1)}"/>
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="#fbfbfa"/>
    ${compiled.background === "grid" ? `<rect width="100%" height="100%" fill="url(#bgGrid)"/>` : ""}
    ${frameChrome(compiled, s)}
    ${renderTitle(scene, compiled, time, s)}
    ${backdrop}
    ${arrows}
    ${assets}
  </svg>`;
}
