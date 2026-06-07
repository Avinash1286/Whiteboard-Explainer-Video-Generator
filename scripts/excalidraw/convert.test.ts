import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { excalidrawItemToSvg, parseLibraryItems, type ExcaliElement } from "./convert";

const RECT: ExcaliElement = {
  type: "rectangle", x: 100, y: 100, width: 80, height: 60,
  strokeColor: "#1e1e1e", backgroundColor: "#a5d8ff", fillStyle: "solid",
  strokeWidth: 2, roughness: 1, seed: 12345, strokeSharpness: "round",
};
const ELLIPSE: ExcaliElement = {
  type: "ellipse", x: 200, y: 100, width: 50, height: 50,
  strokeColor: "#e03131", backgroundColor: "transparent", strokeWidth: 1, roughness: 1, seed: 9,
};
const LINE: ExcaliElement = {
  type: "line", x: 0, y: 0, width: 100, height: 0,
  points: [[0, 0], [100, 0]], strokeColor: "#1e1e1e", strokeWidth: 2, roughness: 0, seed: 1,
};

test("converts a basic item to a valid, self-contained SVG", () => {
  const out = excalidrawItemToSvg([RECT, ELLIPSE, LINE]);
  assert.ok(out, "should produce an SVG");
  assert.match(out!.svg, /^<svg[^>]*viewBox="0 0 \d+ \d+"/);
  assert.match(out!.svg, /<\/svg>$/);
  assert.ok(out!.width > 0 && out!.height > 0);
  // Bounding box spans the rect (100..180) + ellipse (200..250) with padding.
  assert.ok(out!.width >= 150, `width ${out!.width} should span both shapes`);
  assert.ok(out!.svg.includes("<path"), "should contain rendered paths");
});

test("conversion is deterministic (fixed seeds)", () => {
  const a = excalidrawItemToSvg([RECT, ELLIPSE, LINE])!.svg;
  const b = excalidrawItemToSvg([RECT, ELLIPSE, LINE])!.svg;
  assert.equal(a, b);
});

test("empty / all-deleted items return null", () => {
  assert.equal(excalidrawItemToSvg([]), null);
  assert.equal(excalidrawItemToSvg([{ ...RECT, isDeleted: true }]), null);
});

test("solid fill emits a fill path; transparent does not force one", () => {
  const solid = excalidrawItemToSvg([RECT])!.svg;
  assert.ok(solid.includes('fill="#a5d8ff"'), "solid bg should render a fill");
  const none = excalidrawItemToSvg([ELLIPSE])!.svg;
  assert.ok(!none.includes('fill="transparent"'), "transparent bg should not emit transparent fill");
});

test("parseLibraryItems handles v1 (library[][]) and v2 (libraryItems[])", () => {
  const v1 = parseLibraryItems({ type: "excalidrawlib", version: 1, library: [[RECT], [ELLIPSE, LINE]] });
  assert.equal(v1.length, 2);
  assert.equal(v1[0].name, "");
  assert.equal(v1[1].elements.length, 2);

  const v2 = parseLibraryItems({
    type: "excalidrawlib",
    version: 2,
    libraryItems: [{ id: "a", name: "Box", elements: [RECT] }, { id: "b", name: "", elements: [] }],
  });
  assert.equal(v2.length, 1, "empty-element items are dropped");
  assert.equal(v2[0].name, "Box");
});

// Index sanity: each row should be its own nearest neighbour (score ~1).
test("excalidraw embedding index round-trips (self is top match)", async () => {
  const root = path.resolve(process.cwd());
  const binPath = path.join(root, "assets", "vendor", "excalidraw", "embeddings.bin");
  const metaPath = path.join(root, "assets", "vendor", "excalidraw", "embeddings-meta.json");
  if (!existsSync(binPath) || !existsSync(metaPath)) {
    console.log("  (skipped: excalidraw index not built)");
    return;
  }
  const { matchExcaliVector } = await import("../../shared/excalidrawEmbeddings");
  const meta = JSON.parse(readFileSync(metaPath, "utf8")) as { dim: number; entries: { id: string }[] };
  const buf = readFileSync(binPath);
  const vectors = new Float32Array(buf.buffer, buf.byteOffset, meta.entries.length * meta.dim);
  const row0 = Array.from(vectors.slice(0, meta.dim));
  const top = matchExcaliVector(row0, 3);
  assert.ok(top.length > 0);
  assert.equal(top[0].id, meta.entries[0].id, "row 0 should match itself first");
  assert.ok(top[0].score > 0.99, `self-cosine should be ~1, got ${top[0].score}`);
});
