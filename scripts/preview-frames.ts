import "../shared/fontconfig";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { compileVideo } from "../shared/layout";
import { estimateTimepoints } from "../shared/ssml";
import { renderFrameSvg } from "../shared/svgFrame";
import { createFallbackStoryboard } from "../shared/fallbackPlanner";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const prompt = process.argv.slice(2).join(" ").trim() || "Explain how the mind works";

const storyboard = createFallbackStoryboard(prompt);
const { timepoints, durationSeconds } = estimateTimepoints(storyboard);
const options = {
  width: Number(process.env.VIDEO_WIDTH ?? 1920),
  height: Number(process.env.VIDEO_HEIGHT ?? 1080),
  fps: Number(process.env.VIDEO_FPS ?? 12),
};
const compiled = compileVideo(storyboard, timepoints, durationSeconds, options);

// Sample two frames per beat (mid-reveal + settled) so the buildup is visible.
const beats = compiled.scenes.flatMap((scene) => scene.beats);
const samples: number[] = [];
for (const beat of beats) {
  samples.push(beat.start + Math.min(0.6, (beat.end - beat.start) * 0.4));
  samples.push(beat.end - 0.15);
}
const times = [...new Set(samples.map((t) => Math.max(0, Math.min(compiled.duration - 0.05, t))))].sort(
  (a, b) => a - b,
);

const outputDir = path.join(root, "video_analysis", "compare");
await mkdir(outputDir, { recursive: true });

const cols = 4;
const tileW = 480;
const tileH = Math.round((options.height / options.width) * tileW);
const labelH = 22;
const rows = Math.ceil(times.length / cols);
const composites: sharp.OverlayOptions[] = [];

for (const [i, time] of times.entries()) {
  const svg = renderFrameSvg(compiled, time);
  const frame = await sharp(Buffer.from(svg)).resize(tileW, tileH, { fit: "fill" }).png().toBuffer();
  const left = (i % cols) * tileW;
  const top = Math.floor(i / cols) * (tileH + labelH);
  const label = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${tileW}" height="${labelH}"><rect width="100%" height="100%" fill="#222"/><text x="6" y="16" font-family="Arial" font-size="13" fill="#fff">${time.toFixed(1)}s</text></svg>`,
  );
  composites.push({ input: frame, left, top });
  composites.push({ input: label, left, top: top + tileH });
}

// Full-res settled frame per scene for close inspection.
for (const [si, scene] of compiled.scenes.entries()) {
  const svg = renderFrameSvg(compiled, Math.max(scene.start, scene.end - 0.25));
  await sharp(Buffer.from(svg))
    .png()
    .toFile(path.join(outputDir, `mine_v2_full_s${si + 1}.png`));
}

const sheetPath = path.join(outputDir, "mine_v2_preview.png");
await sharp({
  create: { width: cols * tileW, height: rows * (tileH + labelH), channels: 3, background: "#222" },
})
  .composite(composites)
  .png()
  .toFile(sheetPath);

console.log(`planner scenes: ${compiled.scenes.length}, duration: ${compiled.duration.toFixed(1)}s`);
console.log(`layout diagnostics: ${compiled.layoutDiagnostics.length}`);
for (const d of compiled.layoutDiagnostics.slice(0, 12)) {
  console.log(`  [${d.severity}] ${d.code} ${d.sceneId} ${d.beatId ?? ""} ${d.elementId ?? ""}`);
}
console.log(`Contact sheet: ${sheetPath}`);
