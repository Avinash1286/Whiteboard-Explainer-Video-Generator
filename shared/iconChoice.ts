import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Disk-backed cache of Iconify long-tail icon choices, populated by the pipeline
 * warm pass and read synchronously by the render-time resolver. Used only when
 * OpenMoji has no confident match for a concept.
 */
export type IconChoice = { iconRef: string; svgPath: string; label: string };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const cachePath = path.join(root, "assets", "generated", "icon-choice-cache.json");

let cache: Record<string, IconChoice> | undefined;
function load(): Record<string, IconChoice> {
  if (!cache) {
    cache = existsSync(cachePath) ? (JSON.parse(readFileSync(cachePath, "utf8")) as Record<string, IconChoice>) : {};
  }
  return cache;
}

export function cachedChoice(queryKey: string): IconChoice | null {
  return load()[queryKey] ?? null;
}

export function setChoice(queryKey: string, choice: IconChoice): void {
  load()[queryKey] = choice;
}

export function saveChoices(): void {
  if (!cache) return;
  mkdirSync(path.dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(cache, null, 0));
}
