import rough from "roughjs";
import { getStroke } from "perfect-freehand";

/**
 * DOM-free converter: an Excalidraw library item (an array of Excalidraw
 * elements) -> a normalized, self-contained SVG string in the same flat shape our
 * renderer consumes (a tight viewBox, hand-drawn strokes + fills).
 *
 * It reproduces Excalidraw's look using the very libraries Excalidraw renders
 * with: roughjs (RoughGenerator.opsToPath, no canvas/DOM) for rect/ellipse/
 * diamond/line/polygon, and perfect-freehand for `draw` strokes. Text uses our
 * hand-drawn font. Build-time only.
 */

const generator = rough.generator();

export type ExcaliElement = {
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  angle?: number;
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: string;
  strokeWidth?: number;
  strokeStyle?: string;
  roughness?: number;
  opacity?: number;
  seed?: number;
  points?: [number, number][];
  pressures?: number[];
  strokeSharpness?: string;
  roundness?: { type: number } | null;
  text?: string;
  fontSize?: number;
  fontFamily?: number;
  textAlign?: string;
  startArrowhead?: string | null;
  endArrowhead?: string | null;
  isDeleted?: boolean;
};

export type ConvertedSvg = { svg: string; viewBox: string; width: number; height: number };

const HAND_FONT = "'Patrick Hand', 'Comic Sans MS', cursive, sans-serif";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function num(v: unknown, d = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : d;
}

function roughOptions(el: ExcaliElement) {
  const fill = el.backgroundColor && el.backgroundColor !== "transparent" ? el.backgroundColor : undefined;
  const sw = num(el.strokeWidth, 1) || 1;
  return {
    seed: num(el.seed, 1) || 1,
    stroke: el.strokeColor && el.strokeColor !== "transparent" ? el.strokeColor : "#1e1e1e",
    strokeWidth: sw,
    roughness: num(el.roughness, 1),
    fill,
    fillStyle: el.fillStyle || "hachure",
    fillWeight: sw / 2,
    hachureGap: sw * 4,
    disableMultiStroke: false,
    preserveVertices: false,
  };
}

// Mirror roughjs's SVG renderer: turn a Drawable's op-sets into <path> elements.
function drawableToSvg(drawable: ReturnType<typeof generator.rectangle>, opt: ReturnType<typeof roughOptions>): string {
  const parts: string[] = [];
  for (const set of drawable.sets) {
    const d = generator.opsToPath(set);
    if (!d) continue;
    if (set.type === "path") {
      parts.push(`<path d="${d}" fill="none" stroke="${opt.stroke}" stroke-width="${opt.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`);
    } else if (set.type === "fillPath") {
      parts.push(`<path d="${d}" fill="${opt.fill}" stroke="none" fill-rule="evenodd"/>`);
    } else if (set.type === "fillSketch") {
      const fw = opt.fillWeight > 0 ? opt.fillWeight : opt.strokeWidth / 2;
      parts.push(`<path d="${d}" fill="none" stroke="${opt.fill ?? opt.stroke}" stroke-width="${fw}" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
  }
  return parts.join("");
}

function roundedRectPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  return [
    `M ${x + rr} ${y}`,
    `L ${x + w - rr} ${y}`,
    `Q ${x + w} ${y} ${x + w} ${y + rr}`,
    `L ${x + w} ${y + h - rr}`,
    `Q ${x + w} ${y + h} ${x + w - rr} ${y + h}`,
    `L ${x + rr} ${y + h}`,
    `Q ${x} ${y + h} ${x} ${y + h - rr}`,
    `L ${x} ${y + rr}`,
    `Q ${x} ${y} ${x + rr} ${y}`,
    "Z",
  ].join(" ");
}

function freehandToSvg(el: ExcaliElement): string {
  const pts = (el.points ?? []).map((p) => [el.x + num(p[0]), el.y + num(p[1])] as [number, number]);
  if (pts.length < 2) return "";
  const sw = num(el.strokeWidth, 1) || 1;
  const stroke = getStroke(pts, {
    size: sw * 4.25,
    thinning: 0.6,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: !(el.pressures && el.pressures.length),
    last: true,
  }) as [number, number][];
  if (!stroke.length) return "";
  const d = stroke.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" ") + " Z";
  const color = el.strokeColor && el.strokeColor !== "transparent" ? el.strokeColor : "#1e1e1e";
  return `<path d="${d}" fill="${color}" stroke="none"/>`;
}

function lineToSvg(el: ExcaliElement, opt: ReturnType<typeof roughOptions>): string {
  const pts = (el.points ?? []).map((p) => [el.x + num(p[0]), el.y + num(p[1])] as [number, number]);
  if (pts.length < 2) return "";
  const first = pts[0];
  const last = pts[pts.length - 1];
  const closed = Math.hypot(first[0] - last[0], first[1] - last[1]) < 2 || Boolean(opt.fill);
  const rounded = el.strokeSharpness !== "sharp" && el.roundness !== null && pts.length > 2;
  let drawable;
  if (closed && pts.length >= 3) {
    drawable = generator.polygon(pts, opt);
  } else if (rounded) {
    drawable = generator.curve(pts, opt);
  } else {
    drawable = generator.linearPath(pts, opt);
  }
  return drawableToSvg(drawable, opt);
}

function textToSvg(el: ExcaliElement): string {
  if (!el.text) return "";
  const size = num(el.fontSize, 20) || 20;
  const fill = el.strokeColor && el.strokeColor !== "transparent" ? el.strokeColor : "#1e1e1e";
  const family = el.fontFamily === 3 ? "'Cascadia Code', monospace" : el.fontFamily === 2 ? "Helvetica, Arial, sans-serif" : HAND_FONT;
  const lines = el.text.split("\n");
  return lines
    .map(
      (line, i) =>
        `<text x="${el.x}" y="${(el.y + size * 0.82 + i * size * 1.25).toFixed(1)}" font-family="${family}" font-size="${size}" fill="${fill}">${esc(line)}</text>`,
    )
    .join("");
}

function elementToSvg(el: ExcaliElement): string {
  if (el.isDeleted) return "";
  const opt = roughOptions(el);
  const w = num(el.width);
  const h = num(el.height);
  let body = "";
  switch (el.type) {
    case "rectangle": {
      if (el.strokeSharpness === "sharp" || el.roundness === null) {
        body = drawableToSvg(generator.rectangle(el.x, el.y, w, h, opt), opt);
      } else {
        const r = Math.min(32, Math.min(w, h) * 0.25);
        body = drawableToSvg(generator.path(roundedRectPath(el.x, el.y, w, h, r), opt), opt);
      }
      break;
    }
    case "ellipse":
      body = drawableToSvg(generator.ellipse(el.x + w / 2, el.y + h / 2, w, h, opt), opt);
      break;
    case "diamond":
      body = drawableToSvg(
        generator.polygon(
          [
            [el.x + w / 2, el.y],
            [el.x + w, el.y + h / 2],
            [el.x + w / 2, el.y + h],
            [el.x, el.y + h / 2],
          ],
          opt,
        ),
        opt,
      );
      break;
    case "line":
    case "arrow":
      body = lineToSvg(el, opt);
      break;
    case "draw":
    case "freedraw":
      body = freehandToSvg(el);
      break;
    case "text":
      body = textToSvg(el);
      break;
    default:
      return "";
  }
  if (!body) return "";
  const opacity = num(el.opacity, 100) / 100;
  const angle = num(el.angle);
  const transforms: string[] = [];
  if (angle) {
    const cx = el.x + w / 2;
    const cy = el.y + h / 2;
    transforms.push(`rotate(${(angle * 180) / Math.PI} ${cx} ${cy})`);
  }
  const attrs = [opacity < 1 ? `opacity="${opacity.toFixed(2)}"` : "", transforms.length ? `transform="${transforms.join(" ")}"` : ""].filter(Boolean).join(" ");
  return attrs ? `<g ${attrs}>${body}</g>` : body;
}

function elementBounds(el: ExcaliElement): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (el.isDeleted) return null;
  const w = num(el.width);
  const h = num(el.height);
  if (el.type === "line" || el.type === "arrow" || el.type === "draw" || el.type === "freedraw") {
    const pts = el.points ?? [];
    if (!pts.length) return { minX: el.x, minY: el.y, maxX: el.x + w, maxY: el.y + h };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, el.x + num(p[0]));
      minY = Math.min(minY, el.y + num(p[1]));
      maxX = Math.max(maxX, el.x + num(p[0]));
      maxY = Math.max(maxY, el.y + num(p[1]));
    }
    return { minX, minY, maxX, maxY };
  }
  return { minX: el.x, minY: el.y, maxX: el.x + w, maxY: el.y + h };
}

/** Convert an Excalidraw library item (array of elements) into a normalized SVG. */
export function excalidrawItemToSvg(elements: ExcaliElement[]): ConvertedSvg | null {
  const all = (elements ?? []).filter((e) => e && !e.isDeleted && e.type !== "image");
  // Drop baked-in TEXT labels from icon items (those whose meaning is carried by
  // shapes) — they clutter the icon and duplicate our own caption ("Search",
  // "Rack ID", "sat_rt_"). Keep text only for text-ONLY items (no shapes).
  const hasShape = all.some((e) => e.type !== "text");
  const live = hasShape ? all.filter((e) => e.type !== "text") : all;
  if (!live.length) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of live) {
    const b = elementBounds(el);
    if (!b) continue;
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) return null;

  const pad = 6;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const width = Math.round(maxX - minX);
  const height = Math.round(maxY - minY);

  const bodies = live.map(elementToSvg).filter(Boolean).join("\n");
  if (!bodies.trim()) return null;

  const viewBox = `0 0 ${width} ${height}`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}">` +
    `<g transform="translate(${(-minX).toFixed(2)} ${(-minY).toFixed(2)})">${bodies}</g></svg>`;
  return { svg, viewBox, width, height };
}

// Both Excalidraw library schema versions: v1 `{ library: Element[][] }`,
// v2 `{ libraryItems: [{ id, name, elements: Element[] }] }`.
export type ParsedLibraryItem = { name: string; elements: ExcaliElement[]; id?: string };

export function parseLibraryItems(lib: any): ParsedLibraryItem[] {
  if (Array.isArray(lib?.libraryItems)) {
    return lib.libraryItems
      .map((it: any) => ({ name: String(it?.name ?? "").trim(), elements: Array.isArray(it?.elements) ? it.elements : [], id: it?.id }))
      .filter((it: ParsedLibraryItem) => it.elements.length);
  }
  if (Array.isArray(lib?.library)) {
    return lib.library
      .map((els: any, i: number) => ({ name: "", elements: Array.isArray(els) ? els : [], id: `i${i}` }))
      .filter((it: ParsedLibraryItem) => it.elements.length);
  }
  return [];
}
