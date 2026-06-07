import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { CompiledVideo } from "../shared/layout";
import { renderFrameSvg } from "../shared/svgFrame";
import { runCommand } from "./ffmpeg";

export type RenderProgress = {
  stage: "frames" | "encoding";
  progress: number;
  message: string;
};

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function writeContactSheet(
  compiled: CompiledVideo,
  framesDir: string,
  outputDir: string,
  frameCount: number,
): Promise<string> {
  const intervalSeconds = 4;
  const samples: { frame: number; time: number }[] = [];
  for (let time = 0; time < compiled.duration; time += intervalSeconds) {
    samples.push({
      frame: Math.min(frameCount - 1, Math.round(time * compiled.fps)),
      time,
    });
  }
  if (!samples.length) {
    samples.push({ frame: 0, time: 0 });
  }

  const thumbWidth = 320;
  const thumbHeight = 180;
  const labelHeight = 28;
  const cols = 4;
  const rows = Math.ceil(samples.length / cols);
  const width = cols * thumbWidth;
  const height = rows * (thumbHeight + labelHeight);
  const composites: sharp.OverlayOptions[] = [];

  for (const [index, sample] of samples.entries()) {
    const left = (index % cols) * thumbWidth;
    const top = Math.floor(index / cols) * (thumbHeight + labelHeight);
    const filePath = path.join(framesDir, `${String(sample.frame).padStart(5, "0")}.png`);
    const frame = await sharp(filePath).resize(thumbWidth, thumbHeight, { fit: "cover" }).png().toBuffer();
    const label = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${thumbWidth}" height="${labelHeight}">
        <rect width="100%" height="100%" fill="#fbfbfa"/>
        <text x="10" y="20" font-family="Arial, sans-serif" font-size="16" font-weight="700" fill="#333">${esc(sample.time.toFixed(1))}s</text>
      </svg>`,
    );
    composites.push({ input: frame, left, top });
    composites.push({ input: label, left, top: top + thumbHeight });
  }

  const outputPath = path.join(outputDir, "contact-sheet.jpg");
  await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: "#fbfbfa",
    },
  })
    .composite(composites)
    .jpeg({ quality: 88 })
    .toFile(outputPath);

  return outputPath;
}

export async function renderVideo(
  compiled: CompiledVideo,
  audioPath: string,
  outputDir: string,
  onProgress?: (progress: RenderProgress) => void | Promise<void>,
): Promise<string> {
  const framesDir = path.join(outputDir, "frames");
  await rm(framesDir, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });

  const frameCount = Math.ceil(compiled.duration * compiled.fps);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const time = frame / compiled.fps;
    const svg = renderFrameSvg(compiled, time);
    const filePath = path.join(framesDir, `${String(frame).padStart(5, "0")}.png`);
    await sharp(Buffer.from(svg)).png().toFile(filePath);
    if (frame % compiled.fps === 0 || frame === frameCount - 1) {
      await onProgress?.({
        stage: "frames",
        progress: frame / Math.max(1, frameCount - 1),
        message: `Rendered frame ${frame + 1} of ${frameCount}`,
      });
    }
  }

  await writeContactSheet(compiled, framesDir, outputDir, frameCount);

  await onProgress?.({
    stage: "encoding",
    progress: 0.92,
    message: "Encoding MP4",
  });

  const outputPath = path.join(outputDir, "final.mp4");
  await runCommand("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-framerate",
    String(compiled.fps),
    "-i",
    path.join(framesDir, "%05d.png"),
    "-i",
    audioPath,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-shortest",
    outputPath,
  ]);

  await onProgress?.({
    stage: "encoding",
    progress: 1,
    message: "MP4 ready",
  });

  return outputPath;
}
