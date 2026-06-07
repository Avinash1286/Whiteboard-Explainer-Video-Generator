import type { CompiledVideo } from "../../shared/layout";
import type { ResolvedTimelineScene } from "../../shared/timeline";
import type { VideoPlan, VideoPlanScene } from "../../shared/videoPlan";

export type OrchestrationStage =
  | "directing"
  | "generating_assets"
  | "assembling"
  | "rendering_final"
  | "completed";

export type SceneWorkItem = {
  jobId?: string;
  sceneIndex: number;
  totalScenes: number;
  plan: VideoPlanScene;
};

export type SceneResolutionProgress = {
  sceneId: string;
  sceneIndex: number;
  totalScenes: number;
  status: "started" | "completed";
  message: string;
};

export type SceneResolverInput = {
  videoPlan: VideoPlan;
  compiled: CompiledVideo;
  onProgress?: (progress: SceneResolutionProgress) => void | Promise<void>;
};

export type SceneResolverOutput = {
  scenes: ResolvedTimelineScene[];
};
