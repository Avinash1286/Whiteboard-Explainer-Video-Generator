import type { VisualElement } from "./storyboard";
import { resolveOpenMojiAssetInfo, type OpenMojiAssetResolution } from "./openMojiAssets";

/**
 * Resolves every icon in a scene ONCE, with per-scene de-duplication so two
 * different concepts never render the same glyph. Memoized by element content
 * (not scene id) so it is safe across jobs that reuse scene ids, and cheap to
 * call every frame.
 */

const cache = new Map<string, Map<string, OpenMojiAssetResolution | null>>();

function hintOf(el: VisualElement): string | undefined {
  return el.searchHint ?? el.label ?? el.text;
}

function signature(elements: VisualElement[]): string {
  return elements.map((el) => `${el.id}:${el.assetKey ?? ""}:${hintOf(el) ?? ""}`).join("|");
}

export function resolveSceneIcons(elements: VisualElement[]): Map<string, OpenMojiAssetResolution | null> {
  const sig = signature(elements);
  const cached = cache.get(sig);
  if (cached) return cached;

  const map = new Map<string, OpenMojiAssetResolution | null>();
  const used = new Set<string>();
  // Cache by assetKey + search hint so the SAME concept (e.g. every cell of a
  // quantity grid) reuses one glyph, while DIFFERENT concepts still de-duplicate
  // against each other (the `used` set forces a distinct icon per concept).
  const byKey = new Map<string, OpenMojiAssetResolution | null>();
  for (const el of elements) {
    if (el.type !== "asset" && el.type !== "logo") continue;
    const key = el.assetKey ?? "generic";
    const hint = hintOf(el);
    const cacheKey = `${key}::${hint ?? ""}`;
    if (byKey.has(cacheKey)) {
      map.set(el.id, byKey.get(cacheKey) ?? null);
      continue;
    }
    // An explicit imagery hint (searchHint) should override an overloaded curated
    // assetKey; a caption/text hint should not.
    const preferImagery = Boolean(el.searchHint);
    const resolved = resolveOpenMojiAssetInfo(key, hint, used, preferImagery);
    if (resolved) used.add(resolved.iconRef);
    byKey.set(cacheKey, resolved);
    map.set(el.id, resolved);
  }
  cache.set(sig, map);
  return map;
}
