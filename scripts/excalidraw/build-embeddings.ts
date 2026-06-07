import "../../shared/loadDotenv";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { embedTexts, EMBED_DIM } from "../../worker/embeddings";

/**
 * Embed every converted Excalidraw item (name + library context) into a vector
 * index, using the SAME model/dims/task as the OpenMoji index so cosine scores
 * are directly comparable for the unified "best score wins" resolver.
 */

const root = path.resolve(process.cwd());
const dir = path.join(root, "assets", "vendor", "excalidraw");
const manifestPath = path.join(dir, "manifest.json");
const binPath = path.join(dir, "embeddings.bin");
const metaPath = path.join(dir, "embeddings-meta.json");
const progressPath = path.join(dir, ".build-progress.txt");

type Entry = { id: string; name: string; library: string; svgPath: string };

const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { entries: Entry[] };
const entries = manifest.entries;
console.log(`Embedding ${entries.length} Excalidraw items...`);

function docText(e: Entry): string {
  // Name carries the meaning; library adds disambiguating domain context.
  return e.library && !e.name.toLowerCase().includes(e.library.toLowerCase())
    ? `${e.name}. ${e.library}`
    : e.name;
}

const vectors = await embedTexts(entries.map(docText), "RETRIEVAL_DOCUMENT", (done, total) => {
  writeFileSync(progressPath, `${done}/${total}`);
  process.stdout.write(`\r  ${done}/${total}`);
});
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
      model: process.env.EMBED_MODEL || "gemini-embedding-001",
      count: entries.length,
      entries: entries.map((e) => ({ id: e.id, name: e.name, library: e.library, svgPath: e.svgPath })),
    },
    null,
    0,
  ),
);
console.log(`Wrote ${binPath} (${(flat.byteLength / 1e6).toFixed(1)} MB) and ${metaPath}`);
