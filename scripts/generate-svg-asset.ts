import "../worker/env";
import { generateSvgAssetWithAgent } from "../worker/svgGeneratorAgent";

const args = process.argv.slice(2);
const force = args.includes("--force");
const filteredArgs = args.filter((arg) => arg !== "--force");
const key = filteredArgs[0];
const label = filteredArgs.slice(1).join(" ").trim() || undefined;

if (!key) {
  throw new Error(`Usage: npm run assets:generate -- <assetKey> [Label words...] [--force]`);
}

const entry = await generateSvgAssetWithAgent({ key, label, force });

console.log(`Resolved SVG asset`);
console.log(`assetKey: ${entry.assetKey}`);
console.log(`label: ${entry.label ?? ""}`);
console.log(`source: ${entry.source}`);
if (entry.model) console.log(`model: ${entry.model}`);
console.log(`svgPath: ${entry.svgPath}`);
if (entry.reason) console.log(`reason: ${entry.reason}`);
