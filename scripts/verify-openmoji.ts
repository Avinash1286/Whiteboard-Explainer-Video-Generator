import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assetKeys } from "../shared/assetCatalog";
import { assertOpenMojiAssetLibrary } from "../shared/openMojiAssets";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const vendorDir = path.join(root, "assets", "vendor", "openmoji");
const svgDir = path.join(vendorDir, "color", "svg");
const generatedDir = path.join(root, "assets", "generated", "openmoji-inspired");
const generatedManifestPath = path.join(generatedDir, "manifest.json");
const generatedSvgDir = path.join(generatedDir, "color", "svg");

assertOpenMojiAssetLibrary();

const files = await readdir(svgDir);
const svgCount = files.filter((file) => file.endsWith(".svg")).length;
const registry = JSON.parse(await readFile(path.join(vendorDir, "registry.json"), "utf8")) as { total: number };
const searchIndex = JSON.parse(await readFile(path.join(vendorDir, "search-index.json"), "utf8")) as { total: number };

console.log(`OpenMoji library OK`);
console.log(`Asset keys: ${assetKeys.length}`);
console.log(`Color SVG files: ${svgCount}`);
console.log(`Registry entries: ${registry.total}`);
console.log(`Search index entries: ${searchIndex.total}`);

if (existsSync(generatedManifestPath)) {
  const generatedManifest = JSON.parse(await readFile(generatedManifestPath, "utf8")) as { total: number };
  const generatedFiles = existsSync(generatedSvgDir)
    ? (await readdir(generatedSvgDir)).filter((file) => file.endsWith(".svg")).length
    : 0;
  console.log(`Generated OpenMoji-inspired entries: ${generatedManifest.total}`);
  console.log(`Generated OpenMoji-inspired SVG files: ${generatedFiles}`);
} else {
  console.log(`Generated OpenMoji-inspired entries: 0`);
}
