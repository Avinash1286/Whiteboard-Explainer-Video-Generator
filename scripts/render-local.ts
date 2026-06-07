import "../worker/env";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runVideoPipeline } from "../worker/pipeline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const prompt =
  process.argv.slice(2).join(" ").trim() ||
  "Explain how a deterministic explainer video compiler turns a prompt into synced visuals";
const slug = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.join(root, "outputs", `local-${slug}`);

console.log(`Prompt: ${prompt}`);
console.log(`Output directory: ${outputDir}`);

const result = await runVideoPipeline({
  prompt,
  outputDir,
  onProgress(progress) {
    const pct = Math.round(progress.progress * 100);
    console.log(`[${pct}%] ${progress.stage}: ${progress.message}`);
  },
});

console.log("\nDone");
console.log(`Video: ${result.outputPath}`);
console.log(`Planner: ${result.plannerSource}`);
console.log(`Audio: ${result.audioSource}`);
console.log(`Duration: ${result.durationSeconds.toFixed(2)}s`);
