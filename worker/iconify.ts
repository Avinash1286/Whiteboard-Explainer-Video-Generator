import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IconChoice } from "../shared/iconChoice";

/**
 * Long-tail icon fallback via Iconify (api.iconify.design). Searches a fixed set
 * of FILL-based icon sets for a concept's keywords, then normalises the monotone
 * SVG into the flat-colour-with-black-outline doodle style (so it blends with
 * OpenMoji) and caches it under assets/generated/iconify/. Used only when
 * OpenMoji has no confident match.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

// Fill-based sets only (stroke/outline sets like lucide/tabler need different
// handling). mdi + healthicons + game-icons cover science/medical/business well.
const PREFIXES = (process.env.ICONIFY_SETS || "mdi,healthicons,game-icons,fluent,ph").split(",");
const PALETTE = ["#5aa9e6", "#9ee7c5", "#ffd166", "#ff7a90", "#b28dff", "#7bdff2", "#a7e163", "#f4a261"];

function accentFor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

async function searchIconify(query: string, exclude?: Set<string>): Promise<{ prefix: string; name: string } | null> {
  const url = `https://api.iconify.design/search?query=${encodeURIComponent(query)}&prefixes=${PREFIXES.join(",")}&limit=16`;
  const response = await fetch(url);
  if (!response.ok) return null;
  const data = (await response.json()) as { icons?: string[] };
  for (const id of data.icons ?? []) {
    const [prefix, name] = id.split(":");
    if (!prefix || !name) continue;
    if (exclude?.has(`iconify:${prefix}:${name}`)) continue;
    return { prefix, name };
  }
  return null;
}

function normalizeBody(body: string, w: number, h: number, accent: string): string {
  // Colour the monotone shape and add a black outline to fill paths. Paths that
  // already carry a stroke (outline sets) are left alone to avoid double strokes.
  const sw = (Math.max(w, h) / 30).toFixed(2);
  const coloured = body.replace(/fill="currentColor"/g, `fill="${accent}"`);
  return coloured.replace(/<path (?![^>]*stroke=)/g, `<path stroke="#111" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round" `);
}

async function fetchAndNormalize(prefix: string, name: string): Promise<IconChoice | null> {
  const safe = `${prefix}_${name}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  const rel = `assets/generated/iconify/${safe}.svg`;
  const abs = path.join(root, rel);
  const iconRef = `iconify:${prefix}:${name}`;
  const label = name.replace(/[-_]+/g, " ");
  if (existsSync(abs)) return { iconRef, svgPath: rel, label };

  const response = await fetch(`https://api.iconify.design/${prefix}.json?icons=${name}`);
  if (!response.ok) return null;
  const data = (await response.json()) as {
    width?: number;
    height?: number;
    icons?: Record<string, { body: string; width?: number; height?: number }>;
  };
  const icon = data.icons?.[name];
  if (!icon) return null;
  const w = icon.width ?? data.width ?? 24;
  const h = icon.height ?? data.height ?? 24;
  const accent = accentFor(name);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" fill="${accent}">${normalizeBody(icon.body, w, h, accent)}</svg>`;
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, svg);
  return { iconRef, svgPath: rel, label };
}

export async function resolveIconifyIcon(query: string, exclude?: Set<string>): Promise<IconChoice | null> {
  try {
    const match = await searchIconify(query, exclude);
    if (!match) return null;
    return await fetchAndNormalize(match.prefix, match.name);
  } catch {
    return null;
  }
}
