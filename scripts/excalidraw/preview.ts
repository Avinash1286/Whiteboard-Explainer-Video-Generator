import "../../shared/loadDotenv";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { excalidrawItemToSvg, parseLibraryItems } from "./convert";

const root = path.resolve(process.cwd());
const outDir = path.join(root, "outputs", "_excal_preview");

const LIBS = [
  "youritjang/azure-cloud-services.excalidrawlib",
  "youritjang/software-architecture.excalidrawlib",
  "youritjang/stick-figures.excalidrawlib",
];

async function fetchLib(rel: string): Promise<any> {
  const url = `https://raw.githubusercontent.com/excalidraw/excalidraw-libraries/main/libraries/${rel}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${rel}: ${res.status}`);
  return res.json();
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const tiles: { name: string; png: Buffer }[] = [];
  for (const rel of LIBS) {
    const lib = await fetchLib(rel);
    const items = parseLibraryItems(lib);
    console.log(`${rel}: ${items.length} items`);
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const conv = excalidrawItemToSvg(item.elements);
      if (!conv) {
        console.log(`  [skip] ${item.name || i} (no svg)`);
        continue;
      }
      const png = await sharp(Buffer.from(conv.svg))
        .resize(180, 180, { fit: "contain", background: "#ffffff" })
        .flatten({ background: "#ffffff" })
        .png()
        .toBuffer();
      tiles.push({ name: item.name || `${path.basename(rel)}#${i}`, png });
    }
  }

  // Lay tiles into a contact sheet grid.
  const cols = 8;
  const cell = 188;
  const rows = Math.ceil(tiles.length / cols);
  const W = cols * cell;
  const H = rows * cell;
  const composites = tiles.map((t, i) => ({
    input: t.png,
    left: (i % cols) * cell + 4,
    top: Math.floor(i / cols) * cell + 4,
  }));
  const sheet = await sharp({ create: { width: W, height: H, channels: 3, background: "#f3f4f6" } })
    .composite(composites)
    .jpeg({ quality: 82 })
    .toBuffer();
  const sheetPath = path.join(outDir, "contact-sheet.jpg");
  await writeFile(sheetPath, sheet);
  console.log(`\n${tiles.length} tiles -> ${sheetPath}`);
  console.log("names:", tiles.map((t) => t.name).filter(Boolean).slice(0, 40).join(" | "));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
