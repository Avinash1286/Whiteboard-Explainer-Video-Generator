import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { compileVideo } from "../shared/layout";
import type { Storyboard } from "../shared/storyboard";
import type { ResolvedTimeline } from "../shared/timeline";
import { storyboardToVideoPlan, type VideoPlan } from "../shared/videoPlan";
import { planStoryboard, synthesizeNarration } from "./google";
import type { OrchestrationStage } from "./orchestrator/types";
import { resolveScenesInParallel } from "./orchestrator/resolveScenes";
import { prepareStoryboardAssets, type AssetResolutionRecord } from "./assetResolver";
import { warmIconEmbeddings } from "./iconWarm";
import { rerankIcons } from "./iconRerank";
import { renderVideo, type RenderProgress } from "./render";

export type PipelineProgress =
  | { stage: Extract<OrchestrationStage, "directing" | "generating_assets" | "assembling">; progress: number; message: string; sceneId?: string }
  | { stage: "rendering_final"; phase: RenderProgress["stage"]; progress: number; message: string }
  | { stage: "completed"; progress: number; message: string };

export type PipelineResult = {
  outputPath: string;
  storyboard: Storyboard;
  videoPlan: VideoPlan;
  timeline: ResolvedTimeline;
  artifactPaths: {
    plan: string;
    assetResolution: string;
    resolvedScenes: string;
    timeline: string;
    layoutDiagnostics: string;
    contactSheet: string;
  };
  plannerSource: "agents";
  audioSource: "google-tts";
  durationSeconds: number;
  assetResolution: AssetResolutionRecord[];
};

async function writeJsonArtifact(outputDir: string, filename: string, data: unknown): Promise<string> {
  const artifactPath = path.join(outputDir, filename);
  await writeFile(artifactPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return artifactPath;
}

export async function runVideoPipeline(input: {
  prompt: string;
  outputDir: string;
  background?: "plain" | "grid";
  onProgress?: (progress: PipelineProgress) => void | Promise<void>;
}): Promise<PipelineResult> {
  await mkdir(input.outputDir, { recursive: true });

  await input.onProgress?.({
    stage: "directing",
    progress: 0.08,
    message: "Directing video plan",
  });
  const { storyboard, source: plannerSource } = await planStoryboard(input.prompt);
  const videoPlan = storyboardToVideoPlan(storyboard);
  const planPath = await writeJsonArtifact(input.outputDir, "plan.json", videoPlan);

  await input.onProgress?.({
    stage: "generating_assets",
    progress: 0.15,
    message: "Matching icons by meaning (embeddings)",
  });
  await warmIconEmbeddings(storyboard);

  await input.onProgress?.({
    stage: "generating_assets",
    progress: 0.17,
    message: "Choosing icons in context (rerank)",
  });
  await rerankIcons(storyboard);

  await input.onProgress?.({
    stage: "generating_assets",
    progress: 0.18,
    message: "Resolving OpenMoji and generated SVG assets",
  });
  const assetResolution = await prepareStoryboardAssets(storyboard);
  const assetResolutionPath = await writeJsonArtifact(input.outputDir, "asset-resolution.json", assetResolution);

  await input.onProgress?.({
    stage: "generating_assets",
    progress: 0.24,
    message: "Generating narration timing",
  });
  const audio = await synthesizeNarration(storyboard, input.outputDir);

  await input.onProgress?.({
    stage: "generating_assets",
    progress: 0.3,
    message: "Resolving scene work items",
  });
  const compiled = compileVideo(
    storyboard,
    audio.timepoints,
    audio.durationSeconds,
    {
      width: Number(process.env.VIDEO_WIDTH ?? 1920),
      height: Number(process.env.VIDEO_HEIGHT ?? 1080),
      fps: Number(process.env.VIDEO_FPS ?? 12),
      background: input.background ?? "plain",
    },
  );
  const resolvedScenes = await resolveScenesInParallel({
    videoPlan,
    compiled,
    async onProgress(progress) {
      await input.onProgress?.({
        stage: "generating_assets",
        progress: 0.32 + ((progress.sceneIndex + (progress.status === "completed" ? 1 : 0.25)) / progress.totalScenes) * 0.28,
        message: progress.message,
        sceneId: progress.sceneId,
      });
    },
  });

  await input.onProgress?.({
    stage: "assembling",
    progress: 0.64,
    message: "Assembling validated timeline artifacts",
  });
  const resolvedScenesPath = await writeJsonArtifact(input.outputDir, "resolved-scenes.json", resolvedScenes.scenes);
  const timelinePath = await writeJsonArtifact(input.outputDir, "timeline.json", compiled.timeline);
  const layoutDiagnosticsPath = await writeJsonArtifact(
    input.outputDir,
    "layout-diagnostics.json",
    compiled.layoutDiagnostics,
  );

  const outputPath = await renderVideo(compiled, audio.audioPath, input.outputDir, async (progress) => {
    await input.onProgress?.({
      stage: "rendering_final",
      phase: progress.stage,
      progress: progress.progress,
      message: progress.message,
    });
  });

  await input.onProgress?.({
    stage: "completed",
    progress: 1,
    message: "Video completed",
  });

  return {
    outputPath: path.resolve(outputPath),
    storyboard,
    videoPlan,
    timeline: compiled.timeline,
    artifactPaths: {
      plan: path.resolve(planPath),
      assetResolution: path.resolve(assetResolutionPath),
      resolvedScenes: path.resolve(resolvedScenesPath),
      timeline: path.resolve(timelinePath),
      layoutDiagnostics: path.resolve(layoutDiagnosticsPath),
      contactSheet: path.resolve(path.join(input.outputDir, "contact-sheet.jpg")),
    },
    plannerSource,
    audioSource: audio.source,
    durationSeconds: compiled.duration,
    assetResolution,
  };
}
