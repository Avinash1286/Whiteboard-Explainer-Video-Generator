import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, statSync, rmSync } from "node:fs";
import path from "node:path";
import { excalidrawItemToSvg, parseLibraryItems } from "./convert";

/**
 * Build-time ingestion: walk the cloned excalidraw-libraries repo, convert every
 * library item to a normalized SVG, and emit a manifest + an embedding text list.
 * Idempotent: rewrites assets/vendor/excalidraw/ from scratch each run.
 */

const root = path.resolve(process.cwd());
const srcRoot = path.join(root, "outputs", "excalidraw-src");
const libsDir = path.join(srcRoot, "libraries");
const outDir = path.join(root, "assets", "vendor", "excalidraw");
const svgDir = path.join(outDir, "svg");

type ManifestEntry = {
  id: string;
  name: string;
  library: string;
  source: string;
  svgPath: string; // relative to repo root
  width: number;
  height: number;
  tags: string[];
};

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

function tokens(...parts: string[]): string[] {
  return [
    ...new Set(
      parts
        .join(" ")
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 1),
    ),
  ];
}

function walkLibFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkLibFiles(full));
    else if (name.endsWith(".excalidrawlib")) out.push(full);
  }
  return out;
}

function main() {
  if (!existsSync(libsDir)) {
    throw new Error(`Missing ${libsDir}. Clone excalidraw-libraries into outputs/excalidraw-src first.`);
  }

  // Library-level metadata: source path -> { name, description }.
  const meta = new Map<string, { name: string; description: string }>();
  const metaPath = path.join(srcRoot, "libraries.json");
  if (existsSync(metaPath)) {
    for (const m of JSON.parse(readFileSync(metaPath, "utf8")) as any[]) {
      if (m?.source) meta.set(m.source, { name: String(m.name ?? ""), description: String(m.description ?? "") });
    }
  }

  // Fresh output tree.
  rmSync(svgDir, { recursive: true, force: true });
  mkdirSync(svgDir, { recursive: true });

  const entries: ManifestEntry[] = [];
  const usedIds = new Set<string>();
  let files = 0;
  let converted = 0;
  let skipped = 0;

  for (const file of walkLibFiles(libsDir)) {
    files += 1;
    const rel = path.relative(libsDir, file).replace(/\\/g, "/"); // author/name.excalidrawlib
    const author = rel.split("/")[0];
    const libMeta = meta.get(rel);
    const libraryName = libMeta?.name || path.basename(file, ".excalidrawlib").replace(/[-_]/g, " ");
    const description = libMeta?.description || "";

    let lib: any;
    try {
      lib = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    const items = parseLibraryItems(lib);

    items.forEach((item, i) => {
      const conv = excalidrawItemToSvg(item.elements);
      if (!conv) {
        skipped += 1;
        return;
      }
      const name = item.name || `${libraryName} ${i + 1}`;
      let id = slugify(`${author}-${path.basename(file, ".excalidrawlib")}-${item.name || i}`);
      if (!id) id = slugify(`${author}-${i}`);
      while (usedIds.has(id)) id = `${id}-x`;
      usedIds.add(id);

      const svgRel = path.join("assets", "vendor", "excalidraw", "svg", `${id}.svg`).replace(/\\/g, "/");
      writeFileSync(path.join(root, svgRel), conv.svg, "utf8");

      entries.push({
        id,
        name,
        library: libraryName,
        source: rel,
        svgPath: svgRel,
        width: conv.width,
        height: conv.height,
        tags: tokens(name, libraryName, item.name ? "" : description),
      });
      converted += 1;
    });
  }

  const manifest = {
    provider: "excalidraw",
    style: "hand-drawn",
    libraryCount: files,
    count: entries.length,
    generatedAt: new Date().toISOString(),
    entries,
  };
  writeFileSync(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest)}\n`, "utf8");

  console.log(`libraries: ${files}`);
  console.log(`items converted: ${converted}`);
  console.log(`items skipped (empty/unsupported): ${skipped}`);
  console.log(`named items: ${entries.filter((e) => !/ \d+$/.test(e.name) || e.name !== `${e.library} ${e.name.split(" ").pop()}`).length}`);
  console.log(`manifest -> ${path.relative(root, path.join(outDir, "manifest.json"))} (${entries.length} entries)`);
}

main();
