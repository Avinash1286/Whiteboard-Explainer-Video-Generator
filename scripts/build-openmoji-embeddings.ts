import "../shared/loadDotenv";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { embedTexts, EMBED_DIM } from "../worker/embeddings";

/**
 * One-time builder: embeds every OpenMoji icon's label + concepts and writes a
 * compact vector index (binary Float32 + JSON meta) for nearest-neighbour lookup
 * at resolve time. Re-run only when the OpenMoji set changes.
 */

type IndexEntry = {
  hexcode: string;
  label: string;
  concepts: string[];
  group: string;
  subgroup: string;
  colorSvgPath: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dir = path.join(root, "assets", "vendor", "openmoji");
const searchIndexPath = path.join(dir, "search-index.json");
const binPath = path.join(dir, "embeddings.bin");
const metaPath = path.join(dir, "embeddings-meta.json");

function docText(entry: IndexEntry): string {
  const concepts = entry.concepts.filter((c) => c !== entry.group && c !== entry.subgroup);
  return `${entry.label}. ${[...new Set(concepts)].join(", ")}`;
}

const entries = (JSON.parse(readFileSync(searchIndexPath, "utf8")) as { entries: IndexEntry[] }).entries;
console.log(`Embedding ${entries.length} OpenMoji icons...`);

const progressPath = path.join(dir, ".build-progress.txt");
const vectors = await embedTexts(
  entries.map(docText),
  "RETRIEVAL_DOCUMENT",
  (done, total) => {
    writeFileSync(progressPath, `${done}/${total}`);
    process.stdout.write(`\r  ${done}/${total}`);
  },
);
console.log("");

if (vectors.length !== entries.length) {
  throw new Error(`Embedded ${vectors.length} but expected ${entries.length}`);
}

const flat = new Float32Array(entries.length * EMBED_DIM);
vectors.forEach((vec, i) => flat.set(vec, i * EMBED_DIM));
writeFileSync(binPath, Buffer.from(flat.buffer));
writeFileSync(
  metaPath,
  JSON.stringify(
    {
      dim: EMBED_DIM,
      model: process.env.EMBED_MODEL || "text-embedding-004",
      count: entries.length,
      entries: entries.map((e) => ({ hexcode: e.hexcode, label: e.label, svgPath: e.colorSvgPath })),
    },
    null,
    0,
  ),
);
console.log(`Wrote ${binPath} (${(flat.byteLength / 1e6).toFixed(1)} MB) and ${metaPath}`);
